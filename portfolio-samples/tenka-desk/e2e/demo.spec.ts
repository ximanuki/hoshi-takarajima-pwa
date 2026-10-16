/**
 * Smoke test: walks the demo story with the fictional sample data and saves
 * screenshots to docs/screenshots/. Needs the sample data (`npm run sample`)
 * and a build (`npm run build`).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const SHOTS = join(import.meta.dirname, '..', 'docs', 'screenshots');
const ORIGIN = 'http://127.0.0.1:4180';
/** 2026-10-16 10:00 in Japan: the day the demo story takes place */
const DEMO_NOW = new Date('2026-10-16T10:00:00+09:00');

function watch(page: Page) {
  const foreign: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== ORIGIN) foreign.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return { foreign, errors };
}

async function go(page: Page, label: string) {
  await page.getByRole('navigation', { name: '手順' }).getByRole('link', { name: label }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(label.slice(0, 2));
}

async function loadSample(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'サンプルデータで試す（A形式）' }).click();
  await expect(page.getByRole('link', { name: /診断を見る/ })).toBeVisible({ timeout: 120_000 });
}

test('demo story with the sample data (架空)', async ({ page }, info) => {
  const seen = watch(page);
  await page.clock.setFixedTime(DEMO_NOW);

  // 1. 取り込み
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1, name: '取り込み' })).toBeVisible();
  await expect(page.getByText('データはこのブラウザの中だけで処理し、外部に送信しません')).toBeVisible();
  await loadSample(page);
  await expect(page.getByText('56,328行')).toBeVisible();
  await page.screenshot({ path: join(SHOTS, '01-import.png') });

  // 2. 診断: summary first, then the evidence of one finding
  await page.getByRole('link', { name: /診断を見る/ }).click();
  await expect(page.getByTestId('leak-total')).toHaveText('¥4,598,211');
  await expect(page.getByText('¥2,204,568')).toBeVisible();
  await page.screenshot({ path: join(SHOTS, '02-diagnosis.png') });
  await page.getByText(/^反映漏れ（旧価格のまま）（211）$/).click();
  await page.getByRole('button', { name: 'REV-0001' }).click();
  const detail = page.locator('.finding-detail');
  await expect(detail).toContainText('旧定価');
  await detail.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, '03-diagnosis-evidence.png') });

  // 3. シナリオ
  await go(page, 'シナリオ');
  await page.getByRole('spinbutton', { name: '原材料（%）' }).fill('10');
  await expect(page.getByRole('status').filter({ hasText: '計算しています' })).toHaveCount(0);
  await expect(page.locator('.kpi').filter({ hasText: '転嫁率（依頼どおり）' })).toContainText('%');
  await page.screenshot({ path: join(SHOTS, '04-scenario.png') });

  // 4. 提案: a manual price outside the guardrails is refused, a valid one is used
  await go(page, '提案');
  await expect(page.getByText('提案する得意先')).toBeVisible();
  const firstCustomer = page.locator('table tbody tr').first().getByRole('button');
  const customerName = (await firstCustomer.textContent()) ?? '';
  await firstCustomer.click();
  const price = page.getByRole('textbox', { name: /^新単価/ }).first();
  const proposed = Number(await price.inputValue());
  await price.fill('9999999');
  await price.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: '値上げ率の上限を超えます' })).toBeVisible();
  await price.fill(String(proposed - 1));
  await price.press('Enter');
  await expect(
    page.getByRole('button', { name: `戻す（${proposed.toLocaleString('ja-JP')}）` }),
  ).toBeVisible();
  await expect(page.getByText('手入力 1')).toBeVisible();
  await page.screenshot({ path: join(SHOTS, '05-proposal.png') });

  // 5. 申入書: formal letter, items table, evidence charts; A4 print layout
  await go(page, '申入書');
  const letter = page.getByTestId('letter');
  await expect(letter).toContainText('拝啓');
  await expect(letter).toContainText('敬具');
  await expect(letter).toContainText('令和8年12月1日出荷分より');
  await expect(letter).toContainText(customerName);
  await expect(letter.locator('.evidence-item svg').first()).toBeVisible();
  await page.screenshot({ path: join(SHOTS, '06-letter.png') });
  await letter
    .locator('.sheet')
    .first()
    .screenshot({ path: join(SHOTS, '06-letter-sheet.png') });
  await letter.locator('.sheet.evidence').screenshot({ path: join(SHOTS, '06-letter-evidence.png') });
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('navigation', { name: '手順' })).toBeHidden();
  const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true });
  await page.emulateMedia({ media: 'screen' });
  const pages = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
  expect(pages).toBeGreaterThanOrEqual(3);
  writeFileSync(info.outputPath('letter.pdf'), pdf);
  await page.getByRole('button', { name: '協議記録に「申入書送付」を記録' }).click();
  await expect(page.getByText('今の状況：申入れ済')).toBeVisible();

  // 6. 交渉: kanban, demo outcomes, an appended entry, print view of the 協議記録
  await go(page, '交渉');
  await page.getByRole('button', { name: 'サンプルの協議結果（架空）で埋める' }).click();
  await expect(page.getByText(/社に、サンプルの協議結果（架空）から記録を追加しました/)).toBeVisible();
  await expect(page.getByRole('region', { name: /^合意/ })).not.toContainText('0社');
  await page
    .getByRole('region', { name: /^申入れ済/ })
    .getByRole('link', { name: new RegExp(customerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
    .click();
  await expect(page.getByRole('list', { name: '協議記録' })).toContainText('申入書送付');
  await page.getByLabel('要旨').fill('購買部と面談。改定率と根拠資料を説明');
  await page.getByLabel('先方の出席者・担当者').fill('購買部 課長');
  await page.getByLabel('状況の変更').selectOption('協議中');
  await page.getByRole('button', { name: '追記する' }).click();
  await expect(page.getByText('記録を追加しました。', { exact: true })).toBeVisible();
  await expect(page.getByText('記録のつながりを確認しました（2件・変更なし）')).toBeVisible();
  await page.screenshot({ path: join(SHOTS, '07-negotiation.png'), fullPage: true });
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('heading', { name: '価格協議の記録' })).toBeVisible();
  await expect(page.locator('.kanban')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });

  // 7. 書き出し: new price master in layout A
  await go(page, '書き出し');
  await expect(page.getByRole('button', { name: /販売管理A形式で保存/ })).toBeEnabled();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /販売管理A形式で保存/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^price_master_A_\d{8}\.csv$/);
  const saved = info.outputPath('price_master_A.csv');
  await download.saveAs(saved);
  const bytes = readFileSync(saved);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(bytes.toString('utf8')).toContain('"得意先コード","得意先名","商品コード"');
  await page.screenshot({ path: join(SHOTS, '08-export.png') });

  // 8. 反映チェック with the December sample (架空)
  await go(page, '反映チェック');
  await page.getByRole('button', { name: 'サンプル（令和8年12月分・架空）で試す' }).click();
  const stillOld = page.locator('.kpi').filter({ hasText: '旧単価のまま' });
  await expect(stillOld).toContainText('79行');
  await expect(page.locator('.kpi').filter({ hasText: '不足額' })).toContainText('¥343,144');
  await page.screenshot({ path: join(SHOTS, '09-followup.png') });

  // saved in this browser: a reload restores the data and the 協議記録
  await page.reload();
  await expect(page.locator('.kpi').filter({ hasText: '旧単価のまま' })).toContainText('79行', {
    timeout: 120_000,
  });
  await go(page, '交渉');
  await expect(page.getByRole('region', { name: /^協議中/ })).toContainText(customerName);

  // 「データを消す」 removes everything
  await page.getByRole('button', { name: 'データを消す' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'すべて消す' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '取り込み' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '読み込んだデータ' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'サンプルデータで試す（A形式）' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '読み込んだデータ' })).toHaveCount(0);

  expect(seen.foreign, 'requests to other origins').toEqual([]);
  expect(seen.errors, 'errors in the page').toEqual([]);
});

test('tablet width: no sideways scrolling', async ({ page }) => {
  const seen = watch(page);
  await page.setViewportSize({ width: 820, height: 1180 });
  await loadSample(page);
  for (const label of ['診断', 'シナリオ', '提案', '申入書', '交渉']) {
    await go(page, label);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${label}: page wider than the screen`).toBeLessThanOrEqual(0);
    if (label === '診断') await page.screenshot({ path: join(SHOTS, '10-tablet-diagnosis.png') });
  }
  expect(seen.foreign).toEqual([]);
  expect(seen.errors).toEqual([]);
});

test('own files: an unknown header is read after choosing the columns', async ({ page }) => {
  const seen = watch(page);
  await page.goto('./');
  const csv = (s: string) => Buffer.from(s, 'utf8');
  await page.getByTestId('file-input').setInputFiles([
    {
      name: 'customers.csv',
      mimeType: 'text/csv',
      buffer: csv('得意先コード,得意先名,掛率ランク,掛率(%)\n000001,株式会社テスト商事（架空）,B,72.0\n'),
    },
    {
      name: 'products.csv',
      mimeType: 'text/csv',
      buffer: csv(
        '商品コード,商品名,カテゴリコード,定価(円),原単価(円)\nDB-1001,段ボール箱（架空）,DB,770,400.00\n',
      ),
    },
    {
      name: 'tiers.csv',
      mimeType: 'text/csv',
      buffer: csv('掛率ランク,標準掛率(%),下限(%),上限(%)\nB,72.0,70.0,75.0\n'),
    },
    {
      name: 'uriage.csv',
      mimeType: 'text/csv',
      buffer: csv(
        '日付,伝票,明細,顧客番号,品目コード,数量,販売単価\n20260901,1,1,1,ＤＢ－１００１,5,554\n20260902,2,1,1,db1001,5,520\n',
      ),
    },
  ]);
  const row = page.getByRole('row', { name: /uriage\.csv/ });
  await expect(row).toContainText('形式を判別できません');
  await row.getByRole('button', { name: '列を指定' }).click();
  const mapper = page.getByRole('region', { name: /uriage\.csv の列の対応/ });
  await mapper.getByLabel('ファイルの種類').selectOption('sales-B');
  const pick = async (label: string, header: string) =>
    mapper.getByLabel(new RegExp(`^${label}（必須）$`)).selectOption(header);
  await pick('伝票日付', '日付');
  await pick('伝票No', '伝票');
  await pick('明細No', '明細');
  await pick('得意先CD', '顧客番号');
  await pick('品番', '品目コード');
  await pick('売単価', '販売単価');
  await mapper.getByRole('button', { name: 'この対応で読み込む' }).click();
  await expect(page.getByRole('row', { name: /uriage\.csv/ })).toContainText('売上データ（販売管理B形式）');
  await expect(page.getByText('2行', { exact: true })).toBeVisible();
  await go(page, '診断');
  // 554 = 770 × 72%: correct; 520 is below the rank range (70% = 539)
  await expect(page.getByTestId('leak-total')).toHaveText('¥170');
  await expect(page.getByText('特値一覧が読み込まれていません')).toBeVisible();
  expect(seen.foreign).toEqual([]);
  expect(seen.errors).toEqual([]);
});
