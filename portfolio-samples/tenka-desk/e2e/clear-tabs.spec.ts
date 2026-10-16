/**
 * 「データを消す」は、同じアプリを別のタブで開いていても本当に消す。消した後は、
 * 別のタブにもデータが残って見えない。Needs the sample data (`npm run sample`) and a build.
 */

import { expect, type Page, test } from '@playwright/test';

const ROWS = '56,328行';

async function loadSample(page: Page) {
  await page.goto('./#/import');
  await page.getByRole('button', { name: 'サンプルデータで試す（A形式）' }).click();
  await expect(page.getByText(ROWS)).toBeVisible({ timeout: 120_000 });
}

test('「データを消す」 erases the data even while another tab has the app open', async ({ page, context }) => {
  await loadSample(page);

  // a second tab restores the same data from this browser
  const other = await context.newPage();
  await other.goto('./#/import');
  await expect(other.getByText(ROWS)).toBeVisible({ timeout: 120_000 });

  await page.getByRole('button', { name: 'データを消す' }).click();
  await page.getByRole('button', { name: 'すべて消す' }).click();

  await expect(page.getByText(ROWS)).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText('消し切れていません')).toHaveCount(0);
  // the other tab is told and drops what it showed
  await expect(other.getByText(ROWS)).toHaveCount(0, { timeout: 30_000 });

  // and nothing comes back after reloading either tab
  for (const p of [page, other]) {
    await p.reload();
    await expect(p.getByRole('button', { name: 'サンプルデータで試す（A形式）' })).toBeEnabled({ timeout: 30_000 });
    await expect(p.getByText(ROWS)).toHaveCount(0);
  }
});
