

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface SeedFile {
  answers: Array<{
    questionId: string; phaseNo: number; valueText: string | null;
    valueNumber: number | null;
    valueJson: string[] | { min: number; max: number } | null;
    clearOnDemo: boolean;
  }>;
}
const seed = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'data', 'seed-project.json'), 'utf8'),
) as SeedFile;


const EMAIL = `ui-${Date.now()}@biz2code.local`;
const PASSWORD = 'ui-test-pw-12345';
let projectId = 0;


let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  await page.close();
});


async function answerDemoQuestions(target: Page, phaseNo: number) {
  const due = seed.answers.filter((a) => a.clearOnDemo && a.phaseNo === phaseNo);
  expect(due.length, `the seed should leave demo answers on phase ${phaseNo}`).toBeGreaterThan(0);

  for (const answer of due) {
    const field = target.locator(`#q-${answer.questionId}`);
    await expect(field, `${answer.questionId} should be on phase ${phaseNo}`).toBeVisible();

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

test.describe.serial('the whole journey', () => {
  test('a visitor can create an account', async () => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await page.getByRole('button', { name: 'Create one' }).click();
    await page.fill('#email', EMAIL);
    await page.fill('#password', PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByText(EMAIL)).toBeVisible();
  });

  test('the session survives a reload', async () => {
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole('heading', { name: 'Your projects' })).toBeVisible();
  });

  test('the example project opens on phase 1', async () => {
    await page.goto('/projects');
    await page.getByRole('button', { name: /Start from the example project/ }).click();

    await expect(page).toHaveURL(/\/phase\/1$/);
    projectId = Number(page.url().match(/projects\/(\d+)/)?.[1]);
    expect(projectId).toBeGreaterThan(0);

    await expect(page.getByRole('heading', { name: /Phase 1/ })).toBeVisible();
  });

  test('the stepper shows four phases on one row, with later ones locked', async () => {
    await page.goto(`/projects/${projectId}/phase/1`);
    const stepper = page.getByRole('navigation', { name: 'Phases' });
    const items = stepper.locator('> *');
    await expect(items).toHaveCount(4);


    const first = await items.first().boundingBox();
    const last = await items.last().boundingBox();
    expect(first).not.toBeNull();
    expect(last).not.toBeNull();
    expect(Math.abs((first!.y) - (last!.y))).toBeLessThan(4);

    await expect(stepper.getByText('Locked').first()).toBeVisible();
    await expect(stepper.locator('a')).toHaveCount(1);      
  });

  test('the gate refuses an incomplete phase, and says which questions are missing', async () => {
    await page.goto(`/projects/${projectId}/phase/1`);

    const approve = page.getByRole('button', { name: /Approve this phase/ });
    await expect(approve).toBeDisabled();

    await expect(page.getByText(/required question(s)? (is|are) unanswered/)).toBeVisible();
    await expect(page.getByText('In one or two sentences, what does your app do and who is it for?').last())
      .toBeVisible();
  });

  test('answering enables the gate, and approving moves forward — not back', async () => {
    await page.goto(`/projects/${projectId}/phase/1`);
    await answerDemoQuestions(page, 1);

    const approve = page.getByRole('button', { name: /Approve this phase/ });
    await expect(approve).toBeEnabled();
    await approve.click();


    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/phase/2$`));
    await expect(page.getByRole('heading', { name: /Phase 2/ })).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/phase/2$`));
    await expect(page.getByRole('heading', { name: /Phase 2/ })).toBeVisible();
  });

  test('an approved phase is locked until it is revised', async () => {
    await page.goto(`/projects/${projectId}/phase/1`);
    await expect(page.getByText('This phase is approved')).toBeVisible();
    await expect(page.locator('#q-p1q1')).toBeDisabled();

    await page.getByRole('button', { name: 'Revise this phase' }).click();
    await expect(page.getByText('Reopen this phase for editing?')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#q-p1q1')).toBeDisabled();
  });

  test('the remaining three gates pass, and the project completes', async () => {
    for (const phaseNo of [2, 3, 4]) {
      await page.goto(`/projects/${projectId}/phase/${phaseNo}`);
      await expect(page.getByRole('heading', { name: new RegExp(`Phase ${phaseNo}`) })).toBeVisible();
      await answerDemoQuestions(page, phaseNo);

      const approve = page.getByRole('button', { name: /Approve this phase/ });
      await expect(approve).toBeEnabled();
      await approve.click();

      const expected = phaseNo < 4 ? `/phase/${phaseNo + 1}$` : '/documents$';
      await expect(page).toHaveURL(new RegExp(expected));
    }

    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
  });

  test('the documents page offers generation and warns how long it takes', async () => {
    await page.goto(`/projects/${projectId}/documents`);
    await expect(page.getByRole('button', { name: /Generate the documents/ })).toBeEnabled();
    await expect(page.getByText(/Takes about \d+ seconds/)).toBeVisible();
  });


  test('generation produces downloadable documents with visible badges', async () => {
    test.skip(!process.env.UI_TEST_GENERATE, 'set UI_TEST_GENERATE=1 to run live generation');
    /*
      Overrides the 150s per-test budget in playwright.config.ts. Three
      documents are written by one model one after another and that measures
      126-135s in practice, so the per-test timeout — not the expect timeout —
      was what killed this test and reported it as "page has been closed".
     */
    test.setTimeout(300_000);

    await page.goto(`/projects/${projectId}/documents`);
    await page.getByRole('button', { name: /Generate the documents/ }).click();

    await expect(page.getByRole('heading', { name: 'Version 1' })).toBeVisible({ timeout: 240_000 });
    await expect(page.getByRole('link', { name: 'Download .docx' })).toHaveCount(3);
    await expect(page.getByText('Market Requirements Document')).toBeVisible();
    await expect(page.getByText('Business Plan').first()).toBeVisible();

    const badges = page.getByText(/UNVALIDATED|PROXY|SOURCES DISAGREE/);
    expect(await badges.count()).toBeGreaterThan(0);
  });

  test('signing out closes the protected pages', async () => {
    await page.goto('/projects');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto(`/projects/${projectId}/phase/1`);
    await expect(page).toHaveURL(/\/login$/);
  });
});
