/**
 * A 協議結果 file or a new price master with a row the app cannot read is refused
 * (with the row and the reason on screen) instead of being used without that row;
 * sales rows left out of the 反映チェック are listed. Needs the sample data
 * (`npm run sample`) and a build.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const NEXT = join(import.meta.dirname, '..', 'public', 'sample', 'next');
const text = (name: string) => readFileSync(join(NEXT, name), 'utf8');

/** The file with its first data row changed. */
function withFirstRow(name: string, change: (row: string) => string) {
  const lines = text(name).split('\n');
  lines[1] = change(lines[1] ?? '');
  return { name, mimeType: 'text/csv', buffer: Buffer.from(lines.join('\n'), 'utf8') };
}
const original = (name: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text(name), 'utf8') });

async function loadSample(page: Page) {
  await page.goto('./#/import');
  await page.getByRole('button', { name: 'サンプルデータで試す（A形式）' }).click();
  await expect(page.getByTestId('leak-total')).toBeVisible({ timeout: 120_000 });
}

test('files with unreadable rows are refused or listed, not silently shortened', async ({ page }) => {
  await loadSample(page);

  // 書き出し: an agreed customer's 適用日 is not a date
  await page.goto('./#/export');
  await page.getByRole('radio', { name: /協議結果のファイル/ }).check();
  const outcomes = 'revision_2026-12_outcomes.csv';
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles(withFirstRow(outcomes, (r) => r.replace('2026-12-01', '2026-13-01')));
  await expect(page.getByText('2行目「適用日」：日付として読めません（2026-13-01）')).toBeVisible();
  await expect(page.getByRole('button', { name: /販売管理A形式で保存/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /販売管理B形式で保存/ })).toBeDisabled();
  // an agreed customer whose 適用日 is 未定 has no 適用開始日: refused, not left out
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles(withFirstRow(outcomes, (r) => r.replace('2026-12-01', '未定')));
  await expect(
    page.getByText('2行目「適用日」：合意ですが適用日が決まっていません', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /販売管理A形式で保存/ })).toBeDisabled();
  // a 対象外カテゴリ that is no category: refused, not exported at the new price
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles(
      withFirstRow(outcomes, (r) => r.replace(',合意,2026-12-01,,', ',一部合意,2026-12-01,梱包材,')),
    );
  await expect(
    page.getByText('2行目「対象外カテゴリ」：カテゴリのコードにも名前にも合いません', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /販売管理A形式で保存/ })).toBeDisabled();
  // the fixed file is used
  await page.locator('input[type=file]').first().setInputFiles(original(outcomes));
  await expect(page.getByText('協議結果を読めません')).toBeHidden();
  await expect(page.getByRole('button', { name: /販売管理A形式で保存/ })).toBeEnabled();

  // 反映チェック: a price master row whose 売単価 is not a number, and a sales row whose date is not a date
  await page.goto('./#/followup');
  const master = 'price_master_B_20261201.csv';
  const sales = 'sales_B_202612.csv';
  await page
    .locator('input[type=file]')
    .nth(1)
    .setInputFiles(withFirstRow(sales, (r) => r.replace(/^\d{8}/, '20261299')));
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles(withFirstRow(master, (r) => r.replace(/^([^,]*,[^,]*,[^,]*),\d+/, '$1,abc')));
  await expect(page.getByText('チェックできません')).toBeVisible();
  await expect(page.getByText('2行目「売単価」：整数として読めません（abc）')).toBeVisible();
  await expect(page.locator('.kpi').filter({ hasText: '旧単価のまま' })).toBeHidden();

  await page.locator('input[type=file]').first().setInputFiles(original(master));
  await expect(page.locator('.kpi').filter({ hasText: '旧単価のまま' })).toBeVisible();
  await expect(
    page.getByText('売上明細のうち 1行は読めなかったため、チェックに含めていません'),
  ).toBeVisible();
  await expect(page.getByText('2行目「伝票日付」：日付として読めません（20261299）')).toBeVisible();
});
