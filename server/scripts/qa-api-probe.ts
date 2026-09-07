

import { app } from '../app';
import { pool } from '../db/pool';
import type { AddressInfo } from 'node:net';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(ROOT, 'docs', 'qa', 'evidence', 'api-probe.json');

let base = '';
const results: Result[] = [];

interface Result {
  id: string;
  group: string;
  method: string;
  path: string;
  as: string;
  expected: string;
  status: number;
  ok: boolean;
  note?: string;
  body?: string;
  headers?: Record<string, string>;
}

interface Session { cookie: string; label: string }
const anon: Session = { cookie: '', label: 'anonymous' };

async function call(method: string, path: string, opts: {
  as?: Session; body?: unknown; raw?: string; contentType?: string;
} = {}) {
  const session = opts.as ?? anon;
  const headers: Record<string, string> = {};
  if (opts.contentType !== null) headers['content-type'] = opts.contentType ?? 'application/json';
  if (session.cookie) headers.cookie = session.cookie;

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.raw !== undefined ? opts.raw
      : opts.body === undefined ? undefined : JSON.stringify(opts.body),
    redirect: 'manual',
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && session !== anon) session.cookie = setCookie.split(';')[0] ?? session.cookie;
  const text = await res.text().catch(() => '');
  return { status: res.status, text, res, setCookie };
}

let counter = 0;
async function probe(
  group: string, method: string, path: string,
  expect: number | number[], opts: Parameters<typeof call>[2] & { note?: string } = {},
) {
  counter += 1;
  const id = `API-${String(counter).padStart(3, '0')}`;
  const wanted = Array.isArray(expect) ? expect : [expect];
  const { status, text } = await call(method, path, opts);
  const ok = wanted.includes(status);
  results.push({
    id, group, method, path,
    as: opts.as?.label ?? 'anonymous',
    expected: wanted.join(' or '),
    status, ok,
    note: opts.note,
    body: text.slice(0, 200),
  });
  if (!ok) console.log(`  ✗ ${id} ${method} ${path} as ${opts.as?.label ?? 'anon'} — expected ${wanted.join('/')}, got ${status}`);
  return { id, status, text, ok };
}

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  const stamp = process.pid;
  const userA: Session = { cookie: '', label: 'owner (A)' };
  const userB: Session = { cookie: '', label: 'other user (B)' };

  try {
    /* ---------------------------------------------------- setup ---- */
    console.log('\nsetting up two users and one owned project…');
    await call('POST', '/auth/register', { as: userA, body: { email: `qa-a+${stamp}@biz2code.local`, password: 'qa-password-123' } });
    await call('POST', '/auth/register', { as: userB, body: { email: `qa-b+${stamp}@biz2code.local`, password: 'qa-password-123' } });

    const created = await call('POST', '/projects/seed', { as: userA });
    const projectId: number = JSON.parse(created.text).project.id;
    console.log(`  user A owns project ${projectId}`);

    /* --------------------------------------- 1. public surface ---- */
    console.log('\n1. public surface');
    await probe('public', 'GET', '/health', 200, { note: 'liveness probe is intentionally public' });

    /* ---------------------------------------- 2. authentication --- */
    console.log('\n2. authentication');
    await probe('auth', 'GET', '/auth/me', 401, { note: 'no cookie' });
    await probe('auth', 'GET', '/auth/me', 200, { as: userA });
    await probe('auth', 'POST', '/auth/register', 400, { body: { email: `x+${stamp}@b.local` }, note: 'missing password' });
    await probe('auth', 'POST', '/auth/register', 400, { body: { email: `x+${stamp}@b.local`, password: 'short' }, note: 'password below minimum' });
    await probe('auth', 'POST', '/auth/register', 409, { body: { email: `qa-a+${stamp}@biz2code.local`, password: 'qa-password-123' }, note: 'duplicate email' });
    await probe('auth', 'POST', '/auth/login', 401, { body: { email: `qa-a+${stamp}@biz2code.local`, password: 'wrong-password' }, note: 'wrong password' });
    await probe('auth', 'POST', '/auth/login', 401, { body: { email: `nobody+${stamp}@biz2code.local`, password: 'qa-password-123' }, note: 'unknown account' });

    const wrongPw = await call('POST', '/auth/login', { body: { email: `qa-a+${stamp}@biz2code.local`, password: 'wrong-password' } });
    const noUser = await call('POST', '/auth/login', { body: { email: `nobody+${stamp}@biz2code.local`, password: 'qa-password-123' } });
    results.push({
      id: 'SEC-ENUM', group: 'security', method: 'POST', path: '/auth/login', as: 'anonymous',
      expected: 'identical status and body for wrong-password vs unknown-account',
      status: wrongPw.status,
      ok: wrongPw.status === noUser.status && wrongPw.text === noUser.text,
      note: `wrong-password=${wrongPw.text} | unknown-account=${noUser.text}`,
    });

    /* ------------------------------------- 3. cookie hardening ---- */
    console.log('\n3. session cookie flags');
    const fresh = await call('POST', '/auth/login', { as: { cookie: '', label: 'probe' }, body: { email: `qa-a+${stamp}@biz2code.local`, password: 'qa-password-123' } });
    const sc = fresh.setCookie ?? '';
    for (const [flag, present, why] of [
      ['HttpOnly', /HttpOnly/i.test(sc), 'page scripts must not be able to read the token'],
      ['SameSite', /SameSite=(Lax|Strict)/i.test(sc), 'CSRF defence for a cookie-authenticated API'],
      ['Path', /Path=\//i.test(sc), 'scope'],
      ['Secure', /Secure/i.test(sc), 'required under TLS; absent is expected on plain-HTTP localhost'],
    ] as const) {
      results.push({
        id: `SEC-COOKIE-${flag.toUpperCase()}`, group: 'security', method: 'POST', path: '/auth/login',
        as: 'anonymous', expected: `${flag} present`, status: fresh.status, ok: present,
        note: `${why} — raw: ${sc.replace(/token=[^;]+/, 'token=<redacted>')}`,
      });
    }

    /* ------------------------------- 4. broken object-level auth -- */
    console.log('\n4. ownership — user B against user A objects (BOLA)');
    const owned: Array<[string, string, number | number[]]> = [
      ['GET', `/projects/${projectId}`, 404],
      ['GET', `/projects/${projectId}/answers`, 404],
      ['POST', `/projects/${projectId}/answers`, 404],
      ['GET', `/projects/${projectId}/phases`, 404],
      ['GET', `/projects/${projectId}/phases/1`, 404],
      ['POST', `/projects/${projectId}/phases/1/approve`, 404],
      ['POST', `/projects/${projectId}/phases/1/revise`, 404],
      ['GET', `/projects/${projectId}/documents`, 404],
      ['POST', `/projects/${projectId}/documents/generate`, 404],
      ['GET', `/projects/${projectId}/documents/1/download`, 404],
    ];
    for (const [m, p, exp] of owned) {
      await probe('ownership', m, p, exp, { as: userB, body: m === 'POST' ? { questionId: 'p1q1', value: 'x' } : undefined, note: "another user's object must be indistinguishable from absent" });
      await probe('ownership', m, p, 401, { note: 'unauthenticated' });
    }

    const bList = await call('GET', '/projects', { as: userB });
    results.push({
      id: 'SEC-LIST-ISOLATION', group: 'ownership', method: 'GET', path: '/projects', as: 'other user (B)',
      expected: "B's list contains none of A's projects", status: bList.status,
      ok: !bList.text.includes(`"id":${projectId}`),
      note: bList.text.slice(0, 120),
    });

    /* ---------------------------------- 5. parameter handling ----- */
    console.log('\n5. malformed and hostile parameters');
    for (const [bad, why] of [
      ['abc', 'non-numeric id'],
      ['-1', 'negative id'],
      ['0', 'zero id'],
      ['1.5', 'fractional id'],
      ['99999999', 'non-existent id'],
      ["1' OR '1'='1", 'SQL injection attempt in the path'],
      ['1;DROP TABLE projects', 'SQL injection attempt in the path'],
      ['%2e%2e%2f%2e%2e%2fetc%2fpasswd', 'path traversal attempt'],
      ['1e400', 'numeric overflow'],
    ] as const) {
      await probe('input', 'GET', `/projects/${encodeURIComponent(bad)}`, [400, 404], { as: userA, note: why });
    }
    for (const [bad, why] of [['0', 'below range'], ['5', 'above range'], ['abc', 'non-numeric'], ['-1', 'negative']] as const) {
      await probe('input', 'GET', `/projects/${projectId}/phases/${bad}`, [400, 404], { as: userA, note: `phase ${why}` });
    }

    /* ------------------------------------- 6. body validation ----- */
    console.log('\n6. request body validation');
    await probe('input', 'POST', `/projects/${projectId}/answers`, 400, { as: userA, body: {}, note: 'empty body' });
    await probe('input', 'POST', `/projects/${projectId}/answers`, 404, { as: userA, body: { questionId: 'nope', value: 'x' }, note: 'unknown question id' });
    await probe('input', 'POST', `/projects/${projectId}/answers`, 400, { as: userA, body: { questionId: 'p4q2', value: 'not a number' }, note: 'type mismatch' });
    await probe('input', 'POST', `/projects/${projectId}/answers`, 400, { as: userA, body: { questionId: 'p4q2', value: 1e12 }, note: 'above declared max' });
    await probe('input', 'POST', `/projects/${projectId}/answers`, 400, { as: userA, body: { questionId: 'p1q2', value: 'not-an-option' }, note: 'select value not on the list' });
    await probe('input', 'POST', `/projects/${projectId}/answers`, [400, 500], { as: userA, raw: '{not json', note: 'malformed JSON body' });
    await probe('input', 'POST', `/projects/${projectId}/answers`, [400, 415, 500], { as: userA, raw: 'questionId=p1q1', contentType: 'text/plain', note: 'wrong content type' });
    await probe('input', 'POST', '/projects', 400, { as: userA, body: { name: '' }, note: 'blank project name' });
    await probe('input', 'POST', '/projects', [201, 400], { as: userA, body: { name: 'x'.repeat(5000) }, note: 'oversized project name — no declared limit' });
    await probe('input', 'POST', '/projects', [201, 400], { as: userA, body: { name: '<script>alert(1)</script>' }, note: 'XSS payload stored — checked on render, see XSS probe' });
    await probe('input', 'POST', '/projects', [201, 400], { as: userA, body: { name: 'ok', extraField: 'ignored?' }, note: 'unexpected extra field' });

    /* --------------------------------------- 7. the gate rules ---- */
    console.log('\n7. gate rules enforced server-side');
    await probe('gate', 'POST', `/projects/${projectId}/phases/3/approve`, 409, { as: userA, note: 'approving a locked phase' });
    await probe('gate', 'POST', `/projects/${projectId}/phases/1/approve`, 409, { as: userA, note: 'approving an incomplete phase' });
    await probe('gate', 'POST', `/projects/${projectId}/documents/generate`, 409, { as: userA, note: 'generating before the final gate' });
    await probe('gate', 'POST', `/projects/${projectId}/phases/4/revise`, [200, 409], { as: userA, note: 'revising a phase that was never approved' });

    /* ------------------------------ 8. response headers ----------- */
    console.log('\n8. response headers');
    const h = await call('GET', '/health');
    const hdr = (n: string) => h.res.headers.get(n);
    for (const [name, value, why] of [
      ['x-powered-by', hdr('x-powered-by'), 'framework banner should be suppressed'],
      ['content-security-policy', hdr('content-security-policy'), 'CSP'],
      ['x-content-type-options', hdr('x-content-type-options'), 'MIME sniffing'],
      ['x-frame-options', hdr('x-frame-options'), 'clickjacking'],
      ['strict-transport-security', hdr('strict-transport-security'), 'HSTS (N/A on plain HTTP)'],
      ['referrer-policy', hdr('referrer-policy'), 'referrer leakage'],
    ] as const) {
      results.push({
        id: `SEC-HDR-${name}`, group: 'security', method: 'GET', path: '/health', as: 'anonymous',
        expected: name === 'x-powered-by' ? 'absent' : 'present',
        status: h.status,
        ok: name === 'x-powered-by' ? value === null : value !== null,
        note: `${why} — value: ${value ?? '(absent)'}`,
      });
    }

    /* ----------------------------------- 9. CORS behaviour -------- */
    console.log('\n9. CORS');
    for (const origin of ['http://evil.example', 'http://localhost:5173', 'null']) {
      const res = await fetch(`${base}/health`, { headers: { Origin: origin } });
      const allow = res.headers.get('access-control-allow-origin');
      const creds = res.headers.get('access-control-allow-credentials');
      results.push({
        id: `SEC-CORS-${origin}`, group: 'security', method: 'GET', path: '/health', as: `Origin: ${origin}`,
        expected: origin === 'http://localhost:5173' ? 'allowed' : 'not reflected',
        status: res.status,
        ok: origin === 'http://localhost:5173' ? allow === origin : allow !== origin,
        note: `allow-origin=${allow ?? '(none)'} allow-credentials=${creds ?? '(none)'}`,
      });
    }

    /* ------------------------------------ 10. rate limiting ------- */
    console.log('\n10. rate limiting on the login endpoint');
    const started = Date.now();
    const codes: number[] = [];
    for (let n = 0; n < 30; n += 1) {
      const r = await call('POST', '/auth/login', { body: { email: `qa-a+${stamp}@biz2code.local`, password: `wrong-${n}` } });
      codes.push(r.status);
    }
    const limited = codes.some((c) => c === 429);
    results.push({
      id: 'SEC-RATELIMIT', group: 'security', method: 'POST', path: '/auth/login', as: 'anonymous',
      expected: 'some 429 after repeated failures', status: codes[codes.length - 1] ?? 0,
      ok: limited,
      note: `30 failed logins in ${Date.now() - started}ms, all answered ${[...new Set(codes)].join('/')} — no throttling observed`,
    });

    /* --------------------------------- 11. session invalidation --- */
    console.log('\n11. session lifecycle');
    const throwaway: Session = { cookie: '', label: 'throwaway' };
    await call('POST', '/auth/register', { as: throwaway, body: { email: `qa-c+${stamp}@biz2code.local`, password: 'qa-password-123' } });
    const beforeLogout = throwaway.cookie;
    await call('POST', '/auth/logout', { as: throwaway });
    const replay = await call('GET', '/auth/me', { as: { cookie: beforeLogout, label: 'replayed cookie' } });
    results.push({
      id: 'SEC-LOGOUT-REPLAY', group: 'security', method: 'GET', path: '/auth/me', as: 'cookie captured before logout',
      expected: '401 — the token should not work after logout',
      status: replay.status, ok: replay.status === 401,
      note: 'stateless JWT: logout clears the cookie but cannot revoke a copied token before it expires',
    });

    const forged = await call('GET', '/auth/me', { as: { cookie: 'token=not.a.real.jwt', label: 'forged' } });
    results.push({
      id: 'SEC-JWT-FORGED', group: 'security', method: 'GET', path: '/auth/me', as: 'forged token',
      expected: '401', status: forged.status, ok: forged.status === 401,
      note: 'signature verification',
    });
    const noneAlg = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VySWQiOjF9.';
    const alg = await call('GET', '/auth/me', { as: { cookie: `token=${noneAlg}`, label: 'alg:none' } });
    results.push({
      id: 'SEC-JWT-ALG-NONE', group: 'security', method: 'GET', path: '/auth/me', as: 'alg:none token',
      expected: '401', status: alg.status, ok: alg.status === 401,
      note: 'unsigned token must be rejected',
    });

    /* --------------------------------- 12. sensitive fields ------- */
    console.log('\n12. response payload hygiene');
    const me = await call('GET', '/auth/me', { as: userA });
    results.push({
      id: 'SEC-NO-HASH', group: 'security', method: 'GET', path: '/auth/me', as: 'owner (A)',
      expected: 'no password_hash in any response', status: me.status,
      ok: !/password|hash/i.test(me.text),
      note: me.text.slice(0, 160),
    });
    const boom = await call('GET', '/projects/abc', { as: userA });
    results.push({
      id: 'SEC-NO-STACK', group: 'security', method: 'GET', path: '/projects/abc', as: 'owner (A)',
      expected: 'no stack trace or SQL in the error body', status: boom.status,
      ok: !/at .*\(|node_modules|SELECT |pg_/i.test(boom.text),
      note: boom.text.slice(0, 160),
    });
  } finally {
    await pool.query('DELETE FROM users WHERE email LIKE $1', [`%+${process.pid}@biz2code.local`]);
    server.close();
    await pool.end();
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`${results.length} probes · ${results.length - failed.length} as expected · ${failed.length} NOT as expected`);
  for (const f of failed) console.log(`  ⚠ ${f.id.padEnd(24)} ${f.expected} → got ${f.status}  ${f.note ?? ''}`.slice(0, 200));
  console.log(`\nevidence: docs/qa/evidence/api-probe.json`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
