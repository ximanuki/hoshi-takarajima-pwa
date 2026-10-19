/**
 * Rows of a used agreements file that the app cannot take as written must never turn a
 * customer into 「合意」 silently: the import and diagnosis screens name each customer
 * in a warning. Uses the small fictional (架空) fixture of engine/testing/twoRevisions.ts.
 */

import { expect, type Page, test } from '@playwright/test';
import { twoRevisionFiles } from '../src/engine/testing/twoRevisions.ts';

async function upload(page: Page, agreementRows: string[]) {
  await page.goto('./#/import');
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles(
      twoRevisionFiles({ agreementsName: 'revision_2025-10_agreements.csv', agreementRows }).map((f) => ({
        name: f.name,
        mimeType: 'text/csv',
        buffer: Buffer.from(f.text, 'utf8'),
      })),
    );
  await expect(page.getByRole('link', { name: /診断を見る/ })).toBeVisible({ timeout: 60_000 });
}

test('agreements rows read with a 「未定」 date, an unknown category or not at all are named on both screens', async ({
  page,
}) => {
  await upload(page, [
    // 合意 with no date yet: kept on the old 定価
    '000001,株式会社甲見本商事（架空）,2025-07-01,2025-08-01,合意,未定,,',
    // a 対象外カテゴリ that is neither a code nor a name: the new 定価 applies
    '000002,乙見本工業株式会社（架空）,2025-07-01,2025-08-01,一部合意,2025-10-01,梱包材,',
    // a 適用日 that is not a date: the row is left out and the customer counts as 合意
    '000003,丙見本（架空）,2025-07-01,2025-08-01,合意,来春,,',
  ]);

  const check = async () => {
    const box = page.getByTestId('agreement-warnings');
    await expect(box).toBeVisible();
    await expect(box).toContainText('書いたとおりに読めなかった行があります');
    await expect(box).toContainText('得意先 000001（株式会社甲見本商事(架空)）');
    await expect(box).toContainText('「未定」');
    await expect(box).toContainText('得意先 000002（乙見本工業株式会社(架空)）');
    await expect(box).toContainText('「梱包材」');
    await expect(box).toContainText('得意先 000003');
    await expect(box).toContainText('合意したものとして扱っています');
  };
  await check();

  await page.goto('./#/diagnosis');
  await check();
  // 000001 keeps 1,100円 (its 792円 lines are correct); 000002's two lines at 1,100円 are 反映漏れ
  await expect(page.getByTestId('leak-total')).toHaveText('¥1,080');
});
