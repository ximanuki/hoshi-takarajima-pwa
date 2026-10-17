/**
 * An agreements file (合意状況) that the app cannot tie to a 定価改定 must be
 * impossible to miss: a warning on the import and diagnosis screens, 「仮」 on the
 * 反映漏れ and 掛率ランク外 amounts and in the CSV, a banner on the later screens and
 * a printed 仮 on the letter, until the 改定日 is entered. When the file name names the revision, the app uses it and
 * says so. Uses the small fictional (架空) fixture of engine/testing/twoRevisions.ts,
 * so it does not need the bundled sample.
 */

import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import {
  DECLINED_VOLUME_DISCOUNT_LINE,
  type TwoRevisionOptions,
  twoRevisionFiles,
} from '../src/engine/testing/twoRevisions.ts';

const TITLE = '合意状況のファイルを使っていません。反映漏れが多めに出ています';

// Chromium names a download "download" when the system locale cannot encode its Japanese
// name (LANG unset, as in some containers): give the browser a UTF-8 locale.
test.use({ launchOptions: { env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } } });

async function upload(page: Page, options: TwoRevisionOptions = {}) {
  await page.goto('./#/import');
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles(
      twoRevisionFiles(options).map((f) => ({
        name: f.name,
        mimeType: 'text/csv',
        buffer: Buffer.from(f.text, 'utf8'),
      })),
    );
  await expect(page.getByRole('link', { name: /診断を見る/ })).toBeVisible({ timeout: 60_000 });
}

async function enterRevisionDate(page: Page, file: string, date: string) {
  await page.goto('./#/import');
  await page.getByLabel(`${file} の改定日`).fill(date);
  await page.getByRole('button', { name: 'この日付で計算し直す' }).click();
}

test('an agreements file that is not used is shown as a warning and its 反映漏れ as 仮, until the date is entered', async ({
  page,
}) => {
  // with the declined customer's correct 数量値引, which looks 掛率ランク外 (960円) while the file is not used
  await upload(page, { extraSales: [DECLINED_VOLUME_DISCOUNT_LINE] });

  // import screen: a warning, not an info note
  await expect(
    page.locator('.notice-warning').filter({ hasText: '合意状況のファイルを使っていません' }),
  ).toBeVisible();
  await expect(page.locator('.notice-info').filter({ hasText: '使っていません' })).toHaveCount(0);

  await page.goto('./#/diagnosis');
  await expect(page.getByText(TITLE)).toBeVisible();
  await expect(page.getByTestId('leak-total')).toHaveText('¥2,760');
  await expect(page.getByTestId('leak-total-provisional')).toHaveText('仮');
  const tierBar = page.locator('.barlist-row').filter({ hasText: '掛率ランク外' });
  await expect(tierBar).toContainText('¥960（仮）');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /診断結果をCSVで保存/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/_仮\.csv$/);
  expect(readFileSync(await download.path(), 'utf8')).toContain('仮：合意状況のファイルを使っていない');
  // free goods are counted apart, at 定価
  await expect(page.getByTestId('free-goods')).toContainText('1行');
  await expect(page.getByTestId('free-goods')).toContainText('¥2,400');

  // the later screens reuse the result: a banner says it is provisional
  await page.goto('./#/scenario');
  await expect(page.getByTestId('agreements-unused-banner')).toBeVisible();
  // the printed letter says 仮 and does not call the declined customer's kept price a billing error
  await page.goto('./#/letter/000002');
  await expect(page.getByTestId('letter')).toContainText('拝啓', { timeout: 60_000 });
  await expect(page.getByTestId('letter-provisional')).toHaveCount(3);
  await expect(page.getByTestId('letter')).not.toContainText('※ご請求');

  await enterRevisionDate(page, 'agreements.csv', '2025-10-01');
  await expect(page.getByText('令和7年10月1日として使用中')).toBeVisible({ timeout: 60_000 });

  await page.goto('./#/diagnosis');
  await expect(page.getByTestId('leak-total')).toHaveText('¥720');
  await expect(page.getByTestId('leak-total-provisional')).toHaveCount(0);
  await expect(page.getByText(TITLE)).toHaveCount(0);
  await expect(tierBar).toContainText('¥0');
  await expect(tierBar).not.toContainText('仮');
  await page.goto('./#/scenario');
  await expect(page.getByTestId('agreements-unused-banner')).toHaveCount(0);
  await page.goto('./#/letter/000002');
  await expect(page.getByTestId('letter')).toContainText('拝啓', { timeout: 60_000 });
  await expect(page.getByTestId('letter-provisional')).toHaveCount(0);
});

test('the revision named in the file name is used and shown, and can be changed', async ({ page }) => {
  const name = 'revision_2025-10_agreements.csv';
  await upload(page, { agreementsName: name });
  await expect(page.getByText('令和7年10月1日の改定として扱いました').first()).toBeVisible();
  await expect(
    page.locator('.notice-warning').filter({ hasText: '合意状況のファイルを使っていません' }),
  ).toHaveCount(0);

  await page.goto('./#/diagnosis');
  await expect(page.getByTestId('leak-total')).toHaveText('¥720');
  await expect(page.getByText(TITLE)).toHaveCount(0);
  await expect(page.locator('.notice-info').filter({ hasText: 'ファイル名の年月から判断' })).toBeVisible();

  await enterRevisionDate(page, name, '2025-04-01');
  await expect(page.getByText('令和7年4月1日として使用中')).toBeVisible({ timeout: 60_000 });
});
