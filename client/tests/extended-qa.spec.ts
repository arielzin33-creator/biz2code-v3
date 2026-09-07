/* Extended End-to-End QA Testing Suite: Exercises all 10 manual QA flows in real Chromium. */

import { test, expect, type Page } from '@playwright/test';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCREENSHOT_DIR = resolve(REPO_ROOT, 'outputs', 'qa-screenshots');

if (!existsSync(SCREENSHOT_DIR)) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

interface SeedFile {
  answers: Array<{
    questionId: string;
    phaseNo: number;
    valueText: string | null;
    valueNumber: number | null;
    valueJson: string[] | { min: number; max: number } | null;
    clearOnDemo: boolean;
  }>;
}

const seed = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'data', 'seed-project.json'), 'utf8'),
) as SeedFile;

const EMAIL = `qa-expert-${Date.now()}@biz2code.local`;
const PASSWORD = 'QAPassword12345!';
let projectId = 0;
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
});

test.afterAll(async () => {
  await page.close();
});

async function answerDemoQuestions(target: Page, phaseNo: number) {
  const due = seed.answers.filter((a) => a.clearOnDemo && a.phaseNo === phaseNo);
  expect(due.length, `the seed should leave demo answers on phase ${phaseNo}`).toBeGreaterThan(0);

  for (const answer of due) {
    const field = target.locator(`#q-${answer.questionId}`);
    await expect(field, `${answer.questionId} should be visible on phase ${phaseNo}`).toBeVisible();

    const tag = await field.evaluate((el) => el.tagName.toLowerCase());

    const saved = target.waitForResponse(
      (r) => r.url().includes('/answers') && r.request().method() === 'POST',
      { timeout: 30_000 },
    );

    if (answer.valueText !== null) {
      if (tag === 'select') await field.selectOption({ label: answer.valueText });
      else { await field.fill(answer.valueText); await field.blur(); }
    } else if (answer.valueNumber !== null) {
      await field.fill(String(answer.valueNumber));
      await field.blur();
    } else if (Array.isArray(answer.valueJson)) {
      /* multiselect: the field is a role="group"; tick each seeded option. */
      for (const option of answer.valueJson) {
        await field.getByRole('checkbox', { name: option, exact: true }).check();
      }
    } else if (answer.valueJson) {
      /* range: two bounds, and the client only commits once both are given. */
      const lo = target.locator(`#q-${answer.questionId}-min`);
      const hi = target.locator(`#q-${answer.questionId}-max`);
      await lo.fill(String(answer.valueJson.min));
      await hi.fill(String(answer.valueJson.max));
      await hi.blur();
    } else {
      saved.catch(() => {});
      throw new Error(`seed answer ${answer.questionId} has no value to type`);
    }

    await saved;
  }
}

test.describe.serial('Biz2Code Comprehensive End-to-End QA Suite', () => {

  test('QA-01: Auth & Registration Form Validation', async () => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '01_login_screen.png') });

    await page.getByRole('button', { name: 'Create one' }).click();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();

    await page.fill('#email', EMAIL);
    await page.fill('#password', PASSWORD);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '02_registration_form.png') });

    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByText(EMAIL)).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '03_projects_dashboard_empty.png') });
  });

  test('QA-02: Session Persistence across Page Reload', async () => {
    await page.reload();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole('heading', { name: 'Your projects' })).toBeVisible();
    await expect(page.getByText(EMAIL)).toBeVisible();
  });

  test('QA-03: Create Seed Project (IndoorWay)', async () => {
    await page.getByRole('button', { name: /Start from the example project/ }).click();
    await expect(page).toHaveURL(/\/phase\/1$/);

    projectId = Number(page.url().match(/projects\/(\d+)/)?.[1]);
    expect(projectId).toBeGreaterThan(0);

    await expect(page.getByRole('heading', { name: /Phase 1/ })).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '04_phase1_initial_view.png') });
  });

  test('QA-04: Responsive Stepper Layout on Multiple Viewports', async () => {
    const stepper = page.getByRole('navigation', { name: 'Phases' });
    const items = stepper.locator('> *');
    await expect(items).toHaveCount(4);

    await page.setViewportSize({ width: 1280, height: 800 });
    let first = await items.first().boundingBox();
    let last = await items.last().boundingBox();
    expect(Math.abs((first!.y) - (last!.y))).toBeLessThan(4);

    await page.setViewportSize({ width: 1024, height: 768 });
    first = await items.first().boundingBox();
    last = await items.last().boundingBox();
    expect(Math.abs((first!.y) - (last!.y))).toBeLessThan(6);

    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('QA-05: Phase 1 Missing Fields Refusal & Successful Approval', async () => {
    const approve = page.getByRole('button', { name: /Approve this phase/ });
    await expect(approve).toBeDisabled();
    await expect(page.getByText(/required question(s)? (is|are) unanswered/)).toBeVisible();

    await answerDemoQuestions(page, 1);
    await expect(approve).toBeEnabled();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '05_phase1_ready_to_approve.png') });

    await approve.click();

    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/phase/2$`));
    await expect(page.getByRole('heading', { name: /Phase 2/ })).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/phase/2$`));
  });

  test('QA-06: Phase 2 External APIs, Reachable Market & Approval', async () => {
    await expect(page.getByRole('heading', { name: /Phase 2/ })).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '06_phase2_view.png') });

    await answerDemoQuestions(page, 2);

    const approve = page.getByRole('button', { name: /Approve this phase/ });
    await expect(approve).toBeEnabled();
    await approve.click();

    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/phase/3$`));
    await expect(page.getByRole('heading', { name: /Phase 3/ })).toBeVisible();
  });

  test('QA-07: Phase 3 Product Architecture & Approval', async () => {
    await expect(page.getByRole('heading', { name: /Phase 3/ })).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '07_phase3_view.png') });

    await answerDemoQuestions(page, 3);

    const approve = page.getByRole('button', { name: /Approve this phase/ });
    await expect(approve).toBeEnabled();
    await approve.click();

    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/phase/4$`));
    await expect(page.getByRole('heading', { name: /Phase 4/ })).toBeVisible();
  });

  test('QA-08: Phase 4 Deterministic Economics Cards & Unvalidated Badges', async () => {
    await expect(page.getByRole('heading', { name: /Phase 4/ })).toBeVisible();

    await answerDemoQuestions(page, 4);

    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '08_phase4_economics_cards.png') });

    const approve = page.getByRole('button', { name: /Approve this phase/ });
    await expect(approve).toBeEnabled();
    await approve.click();

    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/documents$`));
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '09_documents_page_initial.png') });
  });

  test('QA-09: Revision Flow on an Approved Phase', async () => {
    await page.goto(`/projects/${projectId}/phase/2`);
    await expect(page.getByText('This phase is approved')).toBeVisible();

    await page.getByRole('button', { name: 'Revise this phase' }).click();
    await expect(page.getByText('Reopen this phase for editing?')).toBeVisible();
    await page.getByRole('button', { name: 'Yes, revise' }).click();

    /*
      p2q3 was a numeric market-size question and no longer exists: ADR-012
      moved the market from something the founder states to something the app
      derives, and the bank's own noMarketEstimatesAsked rule now forbids it.
      p2q2 is the phase-2 market question that replaced it, and it is text.
     */
    const marketField = page.locator('#q-p2q2');
    await expect(marketField).toBeEnabled();
    await marketField.fill('Israel — Tel Aviv metro first, then the rest of the country');
    await marketField.blur();

    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '10_phase2_revision.png') });

    const approve = page.getByRole('button', { name: /Approve this phase/ });
    await expect(approve).toBeEnabled();
    await approve.click();

    await page.goto(`/projects/${projectId}/documents`);
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
  });

  test('QA-10: Live Document Generation (MRD, PRD, Business Plan)', async () => {
    /* Same reason as journey.spec.ts: generation outlives the 150s default. */
    test.setTimeout(300_000);
    await page.goto(`/projects/${projectId}/documents`);
    const generateBtn = page.getByRole('button', { name: /Generate the documents/ });
    await expect(generateBtn).toBeEnabled();

    await generateBtn.click();

    await expect(page.getByRole('heading', { name: 'Version 1' })).toBeVisible({ timeout: 240_000 });
    await expect(page.getByRole('link', { name: 'Download .docx' })).toHaveCount(3);

    await expect(page.getByText('Market Requirements Document')).toBeVisible();
    await expect(page.getByText('Product Requirements Document')).toBeVisible();
    await expect(page.getByText('Business Plan').first()).toBeVisible();

    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '11_documents_generated_v1.png') });
  });

  test('QA-11: Custom Blank Project Creation & Validation Testing', async () => {
    await page.goto('/projects');
    await page.getByPlaceholder('What are you building?').fill('HealthPulse AI');
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '12_new_project_form.png') });

    await page.getByRole('button', { name: 'New project' }).click();

    await expect(page).toHaveURL(/\/phase\/1$/);
    await expect(page.getByRole('heading', { name: /Phase 1/ })).toBeVisible();
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '13_custom_project_phase1.png') });
  });

  test('QA-12: Sign Out & Route Guard Protection', async () => {
    await page.goto('/projects');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto(`/projects/${projectId}/phase/1`);
    await expect(page).toHaveURL(/\/login$/);
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '14_logout_and_redirect.png') });
  });

});
