

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/pool';
import { query, queryOne } from '../db/query';
import { register } from '../services/auth.service';
import { createFromSeed } from '../services/project.service';
import { saveAnswers } from '../services/answer.service';
import { approvePhase, revisePhase } from '../services/gate.service';
import { generateAll } from '../services/generation.service';
import { calculate, inputsFromAnswers } from '../services/calculation.service';
import { getAnswers } from '../services/answer.service';
import { PHASE_COUNT } from '../services/questionBank.service';
import { absolutePathFor } from '../services/docx.service';
import { stat } from 'node:fs/promises';


const flagSet = (name: string, env: string) =>
  process.argv.includes(name) || process.env[env] === '1' || process.env[env] === 'true';

const DRY = flagSet('--dry', 'REHEARSE_DRY');
const CLEAN = flagSet('--clean', 'REHEARSE_CLEAN');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const seed = JSON.parse(readFileSync(resolve(ROOT, 'data', 'seed-project.json'), 'utf8')) as {
  demoProtocol: { steps: string[]; talkingPoints: string[] };
  answers: Array<{
    questionId: string; phaseNo: number; valueText: string | null;
    valueNumber: number | null; valueJson: string[] | null; clearOnDemo: boolean;
  }>;
  externalCache: Array<{ source: string; cacheKey: string }>;
};

const problems: string[] = [];
const flag = (what: string) => { problems.push(what); console.log(`  ⚠  ${what}`); };
const line = (label: string, value: unknown) =>
  console.log(`     ${label.padEnd(34)} ${value}`);

const money = (n: number | null) =>
  n === null ? 'unavailable' : `$${Math.round(n).toLocaleString('en-US')}`;

async function main() {
  console.log(`\n${'═'.repeat(64)}\n  DRESS REHEARSAL${DRY ? '  (dry — no documents generated)' : ''}\n${'═'.repeat(64)}`);

  /* ---------------------------------------------------------- preflight --- */
  console.log('\n▸ Preflight');

  const cached = await query<{ source: string; cache_key: string }>(
    'SELECT source, cache_key FROM external_cache ORDER BY source, cache_key',
  );
  const cachedKeys = new Set(cached.map((c) => `${c.source}/${c.cache_key}`));
  const wanted = seed.externalCache.map((e) => `${e.source}/${e.cacheKey}`);
  const missing = wanted.filter((k) => !cachedKeys.has(k));

  line('external responses pre-cached', `${wanted.length - missing.length}/${wanted.length}`);
  if (missing.length) {
    flag(`not pre-cached: ${missing.join(', ')} — run "npm run db:seed". ` +
         'The demo will depend on the network without them.');
  }

  const demoAnswers = seed.answers.filter((a) => a.clearOnDemo);
  line('answers typed live on stage', demoAnswers.length);
  line('answers pre-filled', seed.answers.length - demoAnswers.length);

  /* ------------------------------------------------------------- the run --- */
  console.log('\n▸ Step 1 — a fresh account and the example project');
  const email = `rehearsal+${Date.now()}@biz2code.local`;
  const user = await register(email, 'rehearsal-pw-12345');
  const project = await createFromSeed(user.id);
  line('project', `#${project.id} — ${project.name}`);
  line('category', project.vertical_id ?? 'none');

  console.log('\n▸ Steps 2-5 — type the five demo answers, approve four gates');
  for (let phaseNo = 1; phaseNo <= PHASE_COUNT; phaseNo += 1) {
    const due = demoAnswers.filter((a) => a.phaseNo === phaseNo);
    if (due.length) {
      await saveAnswers(project.id, due.map((a) => ({
        questionId: a.questionId,
        value: (a.valueJson ?? a.valueNumber ?? a.valueText) as string | number | string[],
      })));
    }
    const result = await approvePhase(project.id, phaseNo);
    line(`phase ${phaseNo}`, `${due.length} typed → approved → ${result.nextPhase ? `phase ${result.nextPhase}` : 'documents'}`);
  }

  /* ------------------------------------------------ what will be on screen --- */
  console.log('\n▸ The numbers a grader will see');
  const answers = await getAnswers(project.id);
  const calc = calculate(inputsFromAnswers(project.vertical_id ?? '', answers));

  line('paying customers / month', calc.payingUsers.value?.toLocaleString('en-US') ?? 'unavailable');
  line('net monthly revenue', money(calc.netMonthlyRevenue.value));
  line('monthly profit', money(calc.monthlyProfit.value));
  line('customer acquisition cost', money(calc.cacEstimate.value));
  line('lifetime value', money(calc.ltvEstimate.value));
  line('LTV:CAC', calc.ltvCacRatio.value?.toFixed(2) ?? 'unavailable');
  line('  ...vs the sourced floor', calc.comparisons.ltvCac.verdict.toUpperCase());
  line('assumed customer lifetime', `${calc.expectedLifetimeMonths.value} months (answered)`);
  line('  ...vs published retention', `${calc.benchmarkImpliedLifetimeMonths.value?.toFixed(2)} months implied`);
  line('ARPU vs category benchmark', calc.comparisons.arpu.verdict.toUpperCase());


  console.log('\n▸ The talking points, checked against the data');
  const proxies = Object.values(calc.benchmarksUsed).filter((b) => b.isProxy);
  line('PROXY benchmarks in play', proxies.length ? proxies.map((p) => p.metricKey).join(', ') : 'NONE');
  if (proxies.length === 0) flag('the "this vertical has no published benchmarks" point no longer holds');

  const unsourced = Object.values(calc.benchmarksUsed).filter((b) => b.unvalidated);
  line('unvalidated benchmarks', unsourced.length ? unsourced.map((p) => p.metricKey).join(', ') : 'NONE');

  if (calc.comparisons.lifetime.verdict !== 'above')
    flag('the assumed lifetime no longer diverges from the benchmark — the strongest talking point is gone');

  const twice = JSON.stringify(calculate(inputsFromAnswers(project.vertical_id ?? '', answers)));
  if (twice !== JSON.stringify(calc)) flag('the numbers are NOT reproducible between runs');
  else line('reproducible across runs', 'yes');

  /* ---------------------------------------------------------- generation --- */
  if (DRY) {
    console.log('\n▸ Steps 6-8 — skipped (--dry)');
  } else {
    console.log('\n▸ Step 6 — generation (one model writes all three, ~70 s cold)');
    const startedAt = Date.now();
    const v1 = await generateAll(project.id);
    line('elapsed', `${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    line('written by', `${v1.provenance.model}${v1.provenance.usedFallback ? ' (FALLBACK)' : ''}`);
    if (v1.provenance.usedFallback)
      flag('the primary model could not write the set — the fallback did. Wait a minute and re-run.');
    if (v1.provenance.escalations.length)
      flag(`escalations: ${v1.provenance.escalations.map((e) => e.model).join(' → ')}`);

    const voices = new Set(v1.documents.map((d) => d.model));
    line('one voice across the set', voices.size === 1 ? 'yes' : `NO — ${[...voices].join(', ')}`);
    if (voices.size !== 1) flag('the three documents were written by different models');

    for (const doc of v1.documents) {
      const exists = await stat(absolutePathFor(doc.filePath)).then((s) => s.size, () => 0);
      line(doc.docType, `${doc.sectionsGenerated} sections · ${(exists / 1024).toFixed(0)} kB · ${doc.filePath}`);
      if (exists < 5000) flag(`${doc.filePath} looks too small to be a real document`);
    }

    console.log('\n▸ Step 7 — the badge a grader is asked to look for');
    line('fields marked unvalidated', v1.unvalidated.length);
    for (const u of v1.unvalidated.slice(0, 4)) console.log(`       ${u.field}`);
    if (v1.unvalidated.length === 0)
      flag('NOTHING is marked unvalidated — the guardrail has nothing to show on stage');

    console.log('\n▸ Step 8 — revise, regenerate, v2 beside v1');
    await revisePhase(project.id, 2);
    await saveAnswers(project.id, [{ questionId: 'p2q3', value: 450000 }]);
    await approvePhase(project.id, 2);
    const v2 = await generateAll(project.id);
    line('second version', `v${v2.version} by ${v2.provenance.model}`);

    const kept = await Promise.all(v1.documents.map((d) =>
      stat(absolutePathFor(d.filePath)).then(() => true, () => false)));
    line('v1 files still on disk', kept.every(Boolean) ? 'yes' : 'NO');
    if (!kept.every(Boolean)) flag('a v1 file disappeared — ADR-007 says revision never destroys');

    const rows = await queryOne<{ n: string }>(
      'SELECT count(*) AS n FROM deliverables WHERE project_id = $1', [project.id]);
    line('deliverable rows', `${rows?.n} (3 per version)`);
  }

  /* -------------------------------------------------------------- wrap up --- */
  if (CLEAN) {
    await query('DELETE FROM users WHERE id = $1', [user.id]);
    console.log('\n  (--clean: the rehearsal project was deleted)');
  } else {
    console.log(`\n  Left in place for you to click through:`);
    console.log(`     sign in as ${email} / rehearsal-pw-12345`);
    console.log(`     http://localhost:5173/projects/${project.id}/documents`);
  }

  console.log(`\n${'═'.repeat(64)}`);
  if (problems.length) {
    console.log(`  ${problems.length} thing${problems.length === 1 ? '' : 's'} to fix before Demo Day:\n`);
    problems.forEach((p) => console.log(`   - ${p}`));
    process.exitCode = 1;
  } else {
    console.log('  Rehearsal clean. Nothing to fix.');
  }
  console.log(`${'═'.repeat(64)}\n`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
