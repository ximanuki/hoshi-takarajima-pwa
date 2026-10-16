/**
 * 手入力の単価と差出人の会社情報は、サンプル（架空）と自社データで別々に持つ。自社データで入れた値が、
 * 「サンプルデータで試す」を押しただけで消えたり、サンプルに付いたりしないことを確かめる。
 * Needs the sample data (`npm run sample`) and a build.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const SAMPLE = join(import.meta.dirname, '..', 'public', 'sample');
/** The sample's A-layout files, uploaded as if they were the user's own (same customer codes). */
const OWN_FILES = readdirSync(SAMPLE)
  .filter((f) => f.endsWith('.csv') && !f.includes('_B') && !f.startsWith('supplier'))
  .map((f) => join(SAMPLE, f));
const OWN_COMPANY = '自社テスト株式会社';
const MANUAL = /^手入力 \d+$/;

async function uploadOwn(page: Page) {
  await page.goto('./#/import');
  await page.locator('input[type=file]').first().setInputFiles(OWN_FILES);
  // the sample stays on screen until the upload is read (its file names are the same)
  await expect(page.getByText('サンプルデータ（架空）', { exact: true })).toHaveCount(0, {
    timeout: 120_000,
  });
  await expect(page.getByRole('link', { name: /診断を見る/ })).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 120_000 });
}

async function loadSample(page: Page) {
  await page.goto('./#/import');
  await page.getByRole('button', { name: 'サンプルデータで試す（A形式）' }).click();
  // a loaded sample goes straight on to the diagnosis
  await expect(page.getByTestId('leak-total')).toBeVisible({ timeout: 120_000 });
}

async function openProposal(page: Page) {
  await page.goto('./#/proposal');
  await expect(page.getByText('提案する得意先')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('status').filter({ hasText: '計算しています' })).toHaveCount(0);
}

async function companyName(page: Page) {
  await page.goto('./#/letter');
  await page.getByText('差出人（自社）の情報').click();
  return page.getByRole('textbox', { name: '会社名', exact: true });
}

test('a manual price and the company entered for own data survive trying the sample', async ({ page }) => {
  // own data: one manual price and the sender's company name
  await uploadOwn(page);
  await openProposal(page);
  const firstCustomer = page.locator('table tbody tr').first().getByRole('button');
  const customerName = (await firstCustomer.textContent()) ?? '';
  await firstCustomer.click();
  const price = page.getByRole('textbox', { name: /^新単価/ }).first();
  // shown as "¥4,237" until focused
  const proposed = Number((await price.inputValue()).replace(/[^\d]/g, ''));
  await price.fill(String(proposed - 1));
  await price.press('Enter');
  const restoreButton = `戻す（${proposed.toLocaleString('ja-JP')}）`;
  await expect(page.getByRole('button', { name: restoreButton })).toBeVisible();
  await expect(page.getByText('手入力 1')).toBeVisible();
  await (await companyName(page)).fill(OWN_COMPANY);

  // the sample: none of the user's values
  await loadSample(page);
  await openProposal(page);
  await expect(page.getByText(MANUAL)).toHaveCount(0);
  await expect(await companyName(page)).not.toHaveValue(OWN_COMPANY);

  // reloading with the sample open restores the sample's (empty) values, not the user's
  await page.waitForTimeout(1000); // let the settings be saved (they are written shortly after a change)
  await page.reload();
  await openProposal(page);
  await expect(page.getByText(MANUAL)).toHaveCount(0);

  // own data again: the manual price and the company are still there
  await uploadOwn(page);
  await openProposal(page);
  await expect(page.getByText('手入力 1')).toBeVisible();
  await page.locator('table tbody tr').first().getByRole('button', { name: customerName }).click();
  await expect(page.getByRole('button', { name: restoreButton })).toBeVisible();
  await expect(await companyName(page)).toHaveValue(OWN_COMPANY);

  // and after a reload with own data open
  await page.waitForTimeout(1000);
  await page.reload();
  await openProposal(page);
  await expect(page.getByText('手入力 1')).toBeVisible();
});
