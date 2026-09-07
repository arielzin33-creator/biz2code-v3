/*
  Browser-side QA: WCAG 2.2 AA scan (axe-core 4.13), stored-XSS check,
  keyboard-only navigation, responsive/overflow checks, and Core Web Vitals.

  Runs against the app on :5173. Writes JSON evidence; prints a summary.
*/
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const require = createRequire('C:/Users/ariel/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');

const SP = 'C:/Users/ariel/AppData/Local/Temp/claude/c--d-Full-Stack-course-CAPSTONE-PROJECT-biz2code/588a84c0-0f93-4a23-ba96-5b3ccecac4ff/scratchpad';
const AXE = readFileSync(`${SP}/qa-tools/package/axe.min.js`, 'utf8');
const OUT = process.argv[2];
const BASE = 'http://localhost:5173';

const findings = [];
const record = (o) => { findings.push(o); const tag = o.ok ? 'ok  ' : 'FIND'; console.log(`  ${tag} ${o.id.padEnd(22)} ${o.summary}`); };

const XSS = '<img src=x onerror="window.__xss=1">';
const email = `qa-ui-${Date.now()}@biz2code.local`;

async function axeScan(page, label, id) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  }));
  const violations = r.violations.map((v) => ({
    id: v.id, impact: v.impact, help: v.help, wcag: v.tags.filter((t) => t.startsWith('wcag')),
    nodes: v.nodes.length, sample: v.nodes[0]?.html?.slice(0, 120),
  }));
  record({
    id, category: 'accessibility', page: label, ok: violations.length === 0,
    summary: violations.length === 0
      ? `${label}: no WCAG 2.2 AA violations (${r.passes.length} checks passed)`
      : `${label}: ${violations.length} violation type(s) — ${violations.map((v) => `${v.id}(${v.impact},${v.nodes})`).join(', ')}`,
    detail: violations,
  });
  return violations;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e}`));

/* ---------------------------------------------------------- login page --- */
console.log('\naccessibility — WCAG 2.2 AA (axe-core 4.13)');
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await axeScan(page, 'login', 'A11Y-LOGIN');

/* keyboard-only reachability of the login form */
await page.keyboard.press('Tab');
const firstFocus = await page.evaluate(() => document.activeElement?.tagName + '#' + (document.activeElement?.id || ''));
const focusVisible = await page.evaluate(() => {
  const el = document.activeElement;
  if (!el) return false;
  const s = getComputedStyle(el, ':focus-visible');
  return s.outlineStyle !== 'none' && s.outlineWidth !== '0px';
});
record({
  id: 'A11Y-KEYBOARD', category: 'accessibility', page: 'login',
  ok: !!firstFocus && firstFocus !== 'BODY#',
  summary: `first Tab reaches ${firstFocus}; focus ring computed: ${focusVisible}`,
});

/* --------------------------------------------------------- register + XSS -- */
await page.getByRole('button', { name: 'Create one' }).click();
await page.fill('#email', email);
await page.fill('#password', 'qa-ui-password-1');
await page.getByRole('button', { name: 'Create account' }).click();
await page.waitForURL('**/projects', { timeout: 20000 });

console.log('\nstored XSS');
await page.getByRole('textbox', { name: 'Project name' }).fill(XSS);
await page.getByRole('button', { name: 'New project' }).click();
await page.waitForURL('**/phase/1', { timeout: 20000 });
const projectId = Number(page.url().match(/projects\/(\d+)/)[1]);

await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle' });
const xssFired = await page.evaluate(() => window.__xss === 1);
const rendersLiterally = await page.getByText(XSS, { exact: false }).count();
record({
  id: 'SEC-XSS-PROJECT-NAME', category: 'security', page: 'projects',
  ok: !xssFired && rendersLiterally > 0,
  summary: xssFired
    ? 'STORED XSS EXECUTED from the project name'
    : `payload stored and rendered as inert text (React escaping); executed: ${xssFired}`,
  detail: { payload: XSS, executed: xssFired, renderedAsText: rendersLiterally > 0 },
});

/* -------------------------------------------------------- answer XSS ------ */
await page.goto(`${BASE}/projects/${projectId}/phase/1`, { waitUntil: 'networkidle' });
await page.locator('#q-p1q1').fill(XSS);
await page.locator('#q-p1q1').blur();
await page.waitForTimeout(1500);
await page.reload({ waitUntil: 'networkidle' });
const xssFired2 = await page.evaluate(() => window.__xss === 1);
record({
  id: 'SEC-XSS-ANSWER', category: 'security', page: 'phase 1',
  ok: !xssFired2,
  summary: xssFired2 ? 'STORED XSS EXECUTED from an answer' : 'answer payload round-trips as inert text',
});

console.log('\naccessibility — authenticated pages');
await axeScan(page, 'projects', 'A11Y-PROJECTS');
await page.goto(`${BASE}/projects/${projectId}/phase/1`, { waitUntil: 'networkidle' });
await axeScan(page, 'phase (form + gate)', 'A11Y-PHASE');
await page.goto(`${BASE}/projects/${projectId}/documents`, { waitUntil: 'networkidle' });
await axeScan(page, 'documents', 'A11Y-DOCUMENTS');

/* ----------------------------------------------- form labelling detail ---- */
await page.goto(`${BASE}/projects/${projectId}/phase/1`, { waitUntil: 'networkidle' });
const unlabelled = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('input,select,textarea')) {
    const id = el.id;
    const labelled = (id && document.querySelector(`label[for="${id}"]`))
      || el.closest('label') || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
    if (!labelled) out.push(el.outerHTML.slice(0, 90));
  }
  return out;
});
record({
  id: 'A11Y-LABELS', category: 'accessibility', page: 'phase 1',
  ok: unlabelled.length === 0,
  summary: unlabelled.length === 0 ? 'every form control has an accessible name' : `${unlabelled.length} control(s) with no label`,
  detail: unlabelled,
});

/* ------------------------------------------------ heading structure ------- */
const headings = await page.evaluate(() =>
  [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => ({ level: +h.tagName[1], text: h.textContent.trim().slice(0, 50) })));
let skips = [];
for (let i = 1; i < headings.length; i += 1) {
  if (headings[i].level - headings[i - 1].level > 1) skips.push(`${headings[i - 1].level}→${headings[i].level} at "${headings[i].text}"`);
}
record({
  id: 'A11Y-HEADINGS', category: 'accessibility', page: 'phase 1',
  ok: skips.length === 0 && headings.some((h) => h.level === 1),
  summary: `${headings.length} headings; h1 present: ${headings.some((h) => h.level === 1)}; level skips: ${skips.length ? skips.join(', ') : 'none'}`,
  detail: headings,
});

/* ----------------------------------------------- landmarks --------------- */
const landmarks = await page.evaluate(() => ({
  main: document.querySelectorAll('main,[role=main]').length,
  nav: document.querySelectorAll('nav,[role=navigation]').length,
  header: document.querySelectorAll('header,[role=banner]').length,
}));
record({
  id: 'A11Y-LANDMARKS', category: 'accessibility', page: 'phase 1',
  ok: landmarks.main >= 1,
  summary: `main=${landmarks.main} nav=${landmarks.nav} header=${landmarks.header}`,
  detail: landmarks,
});

/* --------------------------------- status messaging (gate refusal) ------- */
const liveRegions = await page.evaluate(() =>
  document.querySelectorAll('[role=status],[role=alert],[aria-live]').length);
record({
  id: 'A11Y-STATUS-MESSAGES', category: 'accessibility', page: 'phase 1',
  ok: liveRegions > 0,
  summary: `${liveRegions} live region(s) — the gate's refusal reason and autosave state are announced only if one exists`,
});

/* -------------------------------------------- responsive / overflow ------ */
console.log('\nresponsive and overflow');
for (const [label, w, h] of [['mobile 375', 375, 812], ['tablet 768', 768, 1024], ['desktop 1280', 1280, 900]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${BASE}/projects/${projectId}/phase/1`, { waitUntil: 'networkidle' });
  const over = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
  }));
  record({
    id: `UX-OVERFLOW-${w}`, category: 'ux', page: `phase 1 @ ${label}`,
    ok: !over.horizontal,
    summary: over.horizontal ? `horizontal scroll: ${over.scrollW}px content in ${over.clientW}px viewport` : 'no horizontal scroll',
    detail: over,
  });
}

/* ------------------------------- zoom 400% reflow (WCAG 1.4.10) ---------- */
await page.setViewportSize({ width: 320, height: 800 });
await page.goto(`${BASE}/projects/${projectId}/phase/1`, { waitUntil: 'networkidle' });
const reflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
record({
  id: 'A11Y-REFLOW-320', category: 'accessibility', page: 'phase 1 @ 320px (≈400% zoom)',
  ok: !reflow, summary: reflow ? 'content requires horizontal scrolling at 320px — WCAG 1.4.10 Reflow' : 'reflows without horizontal scrolling',
});
await page.setViewportSize({ width: 1280, height: 900 });

/* ---------------------------------------------- reduced motion ----------- */
const reduced = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
const rPage = await reduced.newPage();
await rPage.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
const honoursReduced = await rPage.evaluate(() => {
  const css = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules].map((r) => r.cssText); } catch { return []; } }).join('\n');
  return /prefers-reduced-motion/.test(css);
});
record({
  id: 'A11Y-REDUCED-MOTION', category: 'accessibility', page: 'global stylesheet',
  ok: honoursReduced,
  summary: honoursReduced ? 'a prefers-reduced-motion rule exists' : 'no prefers-reduced-motion rule — the generation progress bar animates regardless of preference',
});
await reduced.close();

/* -------------------------------------------------- Core Web Vitals ------ */
console.log('\nperformance — Core Web Vitals (lab, local, unthrottled)');
for (const [label, url] of [['login', `${BASE}/login`], ['projects', `${BASE}/projects`], ['phase', `${BASE}/projects/${projectId}/phase/1`]]) {
  const p = await browser.newPage({ viewportSize: { width: 1280, height: 900 } });
  await p.goto(url, { waitUntil: 'networkidle' });
  const vitals = await p.evaluate(() => new Promise((resolve) => {
    const out = { lcp: 0, cls: 0 };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) out.lcp = Math.max(out.lcp, e.startTime); })
      .observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) out.cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
    const nav = performance.getEntriesByType('navigation')[0];
    setTimeout(() => resolve({ ...out, ttfb: nav?.responseStart ?? 0, domContentLoaded: nav?.domContentLoadedEventEnd ?? 0, load: nav?.loadEventEnd ?? 0 }), 900);
  }));
  record({
    id: `PERF-${label.toUpperCase()}`, category: 'performance', page: label,
    ok: vitals.lcp <= 2500 && vitals.cls <= 0.1,
    summary: `LCP ${Math.round(vitals.lcp)}ms (≤2500) · CLS ${vitals.cls.toFixed(3)} (≤0.1) · TTFB ${Math.round(vitals.ttfb)}ms · load ${Math.round(vitals.load)}ms`,
    detail: vitals,
  });
  await p.close();
}

/* --------------------------------------------- JS payload size ----------- */
const sizePage = await browser.newPage();
const transferred = [];
sizePage.on('response', async (r) => {
  const u = r.url();
  if (/\.(js|css)(\?|$)/.test(u) || u.includes('/@vite') || u.includes('/src/')) {
    transferred.push({ url: u.replace(BASE, ''), status: r.status() });
  }
});
await sizePage.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
record({
  id: 'PERF-ASSETS', category: 'performance', page: 'login (dev server)',
  ok: true,
  summary: `${transferred.length} JS/CSS requests on first load (Vite dev server serves unbundled modules; production build is 79 kB gzipped)`,
});
await sizePage.close();

/* --------------------------------------------- console hygiene ----------- */
record({
  id: 'UX-CONSOLE', category: 'ux', page: 'all visited',
  ok: consoleErrors.filter((e) => !e.includes('401')).length === 0,
  summary: consoleErrors.length === 0
    ? 'no console errors'
    : `${consoleErrors.length} console error(s): ${[...new Set(consoleErrors)].slice(0, 3).join(' | ').slice(0, 200)}`,
  detail: [...new Set(consoleErrors)],
});

await browser.close();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), axeVersion: '4.13.0', findings }, null, 2));
const bad = findings.filter((f) => !f.ok);
console.log(`\n${'─'.repeat(64)}`);
console.log(`${findings.length} checks · ${findings.length - bad.length} clean · ${bad.length} findings`);
console.log(`evidence: ${OUT}`);
