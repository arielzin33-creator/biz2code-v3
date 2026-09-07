

import { app } from '../app';
import { pool } from '../db/pool';
import { query } from '../db/query';
import type { AddressInfo } from 'node:net';
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(ROOT, 'docs', 'qa', 'evidence', 'resilience-probe.json');

interface Finding { id: string; category: string; ok: boolean; summary: string; detail?: unknown }
const findings: Finding[] = [];
const record = (f: Finding) => {
  findings.push(f);
  console.log(`  ${f.ok ? 'ok  ' : 'FIND'} ${f.id.padEnd(26)} ${f.summary}`);
};

let base = '';
let cookie = '';
async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0] ?? cookie;
  const text = await res.text();
  return { status: res.status, text };
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};

async function main() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const stamp = process.pid;

  try {
    /* --------------------------------- 1. migration ledger -------- */
    console.log('\n1. schema and migrations');
    const applied = await query<{ filename: string }>('SELECT filename FROM schema_migrations ORDER BY filename');
    const onDisk = readdirSync(join(ROOT, 'server', 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    record({
      id: 'DB-MIGRATIONS', category: 'data', ok: applied.length === onDisk.length,
      summary: `${applied.length} applied, ${onDisk.length} on disk — ledger tracked in schema_migrations, so re-running is safe`,
      detail: { applied: applied.map((a) => a.filename), onDisk },
    });

    const constraints = await query<{ table_name: string; constraint_type: string; n: string }>(`
      SELECT table_name, constraint_type, count(*)::text AS n
      FROM information_schema.table_constraints
      WHERE table_schema = 'public' AND constraint_type IN ('PRIMARY KEY','FOREIGN KEY','UNIQUE','CHECK')
      GROUP BY table_name, constraint_type ORDER BY table_name, constraint_type`);
    const byType = constraints.reduce<Record<string, number>>((a, c) => {
      a[c.constraint_type] = (a[c.constraint_type] ?? 0) + Number(c.n); return a;
    }, {});
    record({
      id: 'DB-CONSTRAINTS', category: 'data',

      ok: (byType['FOREIGN KEY'] ?? 0) >= 4 && (byType.UNIQUE ?? 0) >= 3 && (byType.CHECK ?? 0) >= 5,
      summary: `constraints: ${Object.entries(byType).map(([k, v]) => `${k}=${v}`).join(' ')}`,
      detail: constraints,
    });

    const guard = await query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conname = 'approved_needs_timestamp'`);
    record({
      id: 'DB-GATE-CONSTRAINT', category: 'data', ok: guard.length === 1,
      summary: 'approved_needs_timestamp CHECK present — the database refuses an approved phase with no approval time',
    });

    /* ------------------------------------- 2. concurrency --------- */
    console.log('\n2. concurrency on the gate');
    await call('POST', '/auth/register', { email: `qa-res+${stamp}@biz2code.local`, password: 'qa-res-password-1' });
    const seeded = await call('POST', '/projects/seed');
    const projectId: number = JSON.parse(seeded.text).project.id;

    const seed = JSON.parse(readFileSync(join(ROOT, 'data', 'seed-project.json'), 'utf8')) as {
      answers: Array<{ questionId: string; phaseNo: number; valueText: string | null; valueNumber: number | null; valueJson: string[] | null; clearOnDemo: boolean }>;
    };
    const demo = seed.answers.filter((a) => a.clearOnDemo);
    await call('POST', `/projects/${projectId}/answers`, {
      answers: demo.map((a) => ({ questionId: a.questionId, value: a.valueJson ?? a.valueNumber ?? a.valueText })),
    });

    const burst = await Promise.all(Array.from({ length: 10 }, () =>
      call('POST', `/projects/${projectId}/phases/1/approve`)));
    const okCount = burst.filter((b) => b.status === 200).length;
    const phases = await query<{ phase_no: number; status: string; approved_at: string | null }>(
      'SELECT phase_no, status, approved_at FROM phases WHERE project_id = $1 ORDER BY phase_no', [projectId]);
    const project = await query<{ current_phase: number }>('SELECT current_phase FROM projects WHERE id = $1', [projectId]);

    record({
      id: 'RACE-DOUBLE-APPROVE', category: 'functional',
      ok: phases[0]?.status === 'approved' && project[0]?.current_phase === 2,
      summary: `10 simultaneous approvals of phase 1: ${okCount} accepted, ${10 - okCount} refused; `
        + `final state phase1=${phases[0]?.status}, current_phase=${project[0]?.current_phase} (must be 2, not ${1 + okCount})`,
      detail: { statuses: burst.map((b) => b.status), phases },
    });

    const mixed = await Promise.all([
      call('POST', `/projects/${projectId}/phases/1/revise`),
      call('POST', `/projects/${projectId}/phases/1/approve`),
    ]);
    const after = await query<{ status: string; approved_at: string | null }>(
      'SELECT status, approved_at FROM phases WHERE project_id = $1 AND phase_no = 1', [projectId]);
    const impossible = after[0]?.status === 'approved' && after[0]?.approved_at === null;
    record({
      id: 'RACE-APPROVE-VS-REVISE', category: 'functional', ok: !impossible,
      summary: `concurrent revise+approve left phase 1 = ${after[0]?.status}, approved_at ${after[0]?.approved_at ? 'set' : 'null'} — impossible state: ${impossible}`,
      detail: { statuses: mixed.map((m) => m.status), after },
    });

    await Promise.all(Array.from({ length: 8 }, (_, i) =>
      call('POST', `/projects/${projectId}/answers`, { questionId: 'p1q1', value: `concurrent write ${i}` })));
    const dupes = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM answers WHERE project_id = $1 AND question_id = 'p1q1'`, [projectId]);
    record({
      id: 'RACE-ANSWER-UPSERT', category: 'data', ok: Number(dupes[0]?.n) === 1,
      summary: `8 concurrent writes to one question produced ${dupes[0]?.n} row(s) — UNIQUE(project_id, question_id) holds`,
    });

    const bad = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM phases WHERE status = 'approved' AND approved_at IS NULL`);
    record({
      id: 'DATA-NO-IMPOSSIBLE-STATE', category: 'data', ok: Number(bad[0]?.n) === 0,
      summary: `${bad[0]?.n} approved phases with no approval timestamp, across every project in the database`,
    });

    /* --------------------------------- 3. API latency ------------- */
    console.log('\n3. API latency (local, warm, LLM excluded)');
    const endpoints: Array<[string, string, unknown?]> = [
      ['GET', '/health'],
      ['GET', '/auth/me'],
      ['GET', '/projects'],
      ['GET', `/projects/${projectId}`],
      ['GET', `/projects/${projectId}/phases/2`],
      ['POST', `/projects/${projectId}/answers`, { questionId: 'p1q1', value: 'latency probe answer' }],
    ];
    const latency: Record<string, unknown> = {};
    for (const [method, path, body] of endpoints) {
      const times: number[] = [];
      for (let i = 0; i < 60; i += 1) {
        const t = performance.now();
        await call(method, path, body);
        times.push(performance.now() - t);
      }
      const row = { p50: +pct(times, 50).toFixed(1), p95: +pct(times, 95).toFixed(1), p99: +pct(times, 99).toFixed(1), max: +Math.max(...times).toFixed(1) };
      latency[`${method} ${path.replace(String(projectId), ':id')}`] = row;
      record({
        id: `PERF-API-${method}-${path.split('/')[1]}${path.includes('phases') ? '-phase' : path.includes('answers') ? '-answers' : ''}`,
        category: 'performance', ok: row.p95 < 200,
        summary: `${method} ${path.replace(String(projectId), ':id')} — p50 ${row.p50}ms · p95 ${row.p95}ms · p99 ${row.p99}ms (n=60)`,
        detail: row,
      });
    }

    /* -------------------------- 4. database unavailability -------- */
    console.log('\n4. resilience — database unavailable');
    const realQuery = pool.query.bind(pool);
    (pool as unknown as { query: unknown }).query = () => Promise.reject(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    const down = await call('GET', '/projects');
    const health = await call('GET', '/health');
    (pool as unknown as { query: unknown }).query = realQuery;

    record({
      id: 'RES-DB-DOWN', category: 'resilience', ok: down.status === 500 && !/ECONNREFUSED|at .*\(/.test(down.text),
      summary: `with the database refusing connections: ${down.status}, body ${down.text.slice(0, 60)} — no driver internals leaked`,
    });
    record({
      id: 'RES-HEALTH-LIES', category: 'resilience', ok: health.status === 200,
      summary: `/health answered ${health.status} while the database was down — it is a liveness probe, not a readiness probe`,
      detail: { note: 'documented behaviour, but a readiness endpoint that checks the database would be more useful to an operator' },
    });

    const recovered = await call('GET', '/projects');
    record({
      id: 'RES-DB-RECOVERY', category: 'resilience', ok: recovered.status === 200,
      summary: `first request after the database returned: ${recovered.status} — pool recovered without a restart`,
    });

    /* ---------------------------- 5. large payload handling ------- */
    console.log('\n5. resource limits');
    const huge = 'x'.repeat(2 * 1024 * 1024);
    const big = await call('POST', '/projects', { name: huge });
    record({
      id: 'RES-LARGE-BODY', category: 'resilience', ok: [400, 413].includes(big.status),
      summary: `2 MB request body answered ${big.status} — express.json default limit is 100 kB`,
    });
    if (big.status === 201) await query('DELETE FROM projects WHERE name = $1', [huge]);

    await query('DELETE FROM users WHERE email LIKE $1', [`%+${stamp}@biz2code.local`]);
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), latency, findings }, null, 2));
  } finally {
    server.close();
    await pool.end();
  }

  const bad = findings.filter((f) => !f.ok);
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`${findings.length} checks · ${findings.length - bad.length} clean · ${bad.length} findings`);
  for (const f of bad) console.log(`  ⚠ ${f.id}: ${f.summary}`);
  console.log('evidence: docs/qa/evidence/resilience-probe.json');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
