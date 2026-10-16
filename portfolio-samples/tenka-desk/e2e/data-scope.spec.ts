/**
 * 協議記録はサンプル（架空）と自社データで別々に持つ。サンプルで記録した「合意」が、
 * 同じ得意先コードを持つ自社の得意先に付いたり、自社の記録がサンプルを試しただけで
 * 消えたりしないことを確かめる。Needs the sample data (`npm run sample`) and a build.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const SAMPLE = join(import.meta.dirname, '..', 'public', 'sample');
/** The sample's A-layout files, uploaded as if they were the user's own (same customer codes). */
const OWN_FILES = readdirSync(SAMPLE)
  .filter((f) => f.endsWith('.csv') && !f.includes('_B') && !f.startsWith('supplier'))
  .map((f) => join(SAMPLE, f));

const STATUSES = ['申入れ前', '申入れ済', '協議中', '一部合意', '合意', '見送り'] as const;

/** Customer count per status column on the 交渉 screen. */
async function statusCounts(page: Page): Promise<Record<string, number>> {
  await page.goto('./#/negotiation');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('交渉');
  const text = await page.locator('main').innerText();
  const counts: Record<string, number> = {};
  for (const m of text.matchAll(/(申入れ前|申入れ済|協議中|一部合意|合意|見送り)\s*(\d+)社/g)) {
    const [, status, n] = m;
    if (status && !(status in counts)) counts[status] = Number(n);
  }
  expect(Object.keys(counts).sort()).toEqual([...STATUSES].sort());
  return counts;
}

// Hash navigation keeps the page loaded, like moving between screens; a full reload right after
// recording could drop the last IndexedDB write, which is not what this test is about.
async function loadSample(page: Page) {
  await page.goto('./#/import');
  await page.getByRole('button', { name: 'サンプルデータで試す（A形式）' }).click();
  // a loaded sample goes straight on to the diagnosis
  await expect(page.getByTestId('leak-total')).toBeVisible({ timeout: 120_000 });
}

test('sample 協議記録 never carry over to uploaded data, and come back with the sample', async ({ page }) => {
  page.on('dialog', (d) => d.accept());

  await loadSample(page);
  await page.goto('./#/negotiation');
  await page.getByRole('button', { name: 'サンプルの協議結果（架空）で埋める' }).click();
  await expect.poll(async () => (await statusCounts(page))['合意'], { timeout: 60_000 }).toBeGreaterThan(0);
  const sample = await statusCounts(page);

  // the user's own files, with the same customer codes as the sample
  await page.goto('./#/import');
  await page.locator('input[type=file]').first().setInputFiles(OWN_FILES);
  // the sample stays on screen until the upload is read, so wait for the file list to show the upload
  await expect(page.getByText('sales_A_202410-202609.csv').first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('link', { name: /診断を見る/ })).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => (await statusCounts(page))['申入れ前'], { timeout: 60_000 })
    .toBeGreaterThan(sample['申入れ前'] ?? 0);
  const own = await statusCounts(page);
  expect(own['合意']).toBe(0);
  expect(own['一部合意']).toBe(0);
  expect(own['申入れ前']).toBeGreaterThan(0);

  // trying the sample again shows the sample's records, not the user's (and loses neither)
  await loadSample(page);
  await expect.poll(() => statusCounts(page), { timeout: 60_000 }).toEqual(sample);
});
