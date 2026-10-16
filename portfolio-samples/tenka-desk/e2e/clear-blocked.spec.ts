/**
 * 「データを消す」 while another tab keeps the database open (as a tab of an older version of the app
 * would): the browser erases it as soon as that tab closes and cannot be stopped, so the app waits and
 * says so instead of reporting a failure, then drops everything once it is erased.
 * Needs the sample data (`npm run sample`) and a build.
 */

import { expect, type Page, test } from '@playwright/test';

const ROWS = '56,328行';
const WAITING = 'ほかのタブが閉じるのを待っています';

async function loadSample(page: Page) {
  await page.goto('./#/import');
  await page.getByRole('button', { name: 'サンプルデータで試す（A形式）' }).click();
  await expect(page.getByTestId('leak-total')).toBeVisible({ timeout: 120_000 });
  await page.goto('./#/import');
  await expect(page.getByText(ROWS)).toBeVisible({ timeout: 30_000 });
}

test('「データを消す」 waits for a tab that keeps the database open, then erases everything', async ({
  page,
  context,
}) => {
  await loadSample(page);

  // a connection that, unlike this version of the app, does not let go when asked to
  const other = await context.newPage();
  await other.goto('./#/import');
  await other.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('tenka-desk');
        req.onsuccess = () => {
          (window as unknown as { held: IDBDatabase }).held = req.result;
          resolve();
        };
        req.onerror = () => reject(req.error);
      }),
  );

  await page.getByRole('button', { name: 'データを消す' }).click();
  await page.getByRole('button', { name: 'すべて消す' }).click();
  const waiting = page.getByRole('status').filter({ hasText: WAITING });
  await expect(waiting).toBeVisible();
  // longer than the 5 seconds after which the erase used to be reported as failed
  await page.waitForTimeout(7_000);
  await expect(waiting).toBeVisible();
  await expect(page.getByText('消し切れていません')).toHaveCount(0);
  await expect(page.getByText('消せませんでした')).toHaveCount(0);

  // the other tab is closed: the erase finishes and this tab drops what it showed
  await other.close();
  await expect(waiting).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText(ROWS)).toHaveCount(0);
  await expect(page.getByText('消せませんでした')).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('button', { name: 'サンプルデータで試す（A形式）' })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page.getByText(ROWS)).toHaveCount(0);
});
