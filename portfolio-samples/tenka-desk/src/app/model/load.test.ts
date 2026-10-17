/**
 * Sales lines from several files: the same sale exported twice collapses to one
 * line, but a different sale that reuses a 伝票番号-行 (another month, branch or
 * system) is kept and reported. All data here is fictional (架空).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLetter } from '../../engine/index.ts';
import { twoRevisionFiles } from '../../engine/testing/twoRevisions.ts';
import { agreementsNotUsed, buildLoaded, type Loaded, type LoadOptions, type SourceFile } from './load.ts';
import { computeProposal } from './proposal.ts';
import { DEFAULT_GUARD, DEFAULT_SCENARIO } from './settings.ts';

const OPTS: LoadOptions = { revisionDates: {}, diagnosisFloorPct: null, isSample: false };

const B_HEADER =
  '伝票日付,伝票No,明細No,得意先CD,得意先略称,品番,品名,売上区分,数量,単位,標準価格,掛率,売単価,売上金額,原価単価,原価金額,単価種別,摘要';
const A_HEADER =
  '"売上日","伝票番号","行","取引区分","部門","得意先コード","得意先名","商品コード","商品名","数量","単位","定価","掛率(%)","単価","金額","原単価","原価金額","粗利額","単価区分","備考"';

/** 2024-10-01, 伝票1000001: two lines for 木漏日商店 */
const B_ROWS = [
  '20241001,1000001,1,1011,木漏日商店(株),DB-1044,段ﾎﾞｰﾙ箱 A式 500×350×300mm ｸﾗﾌﾄ 10枚入,1,50,ｹｰｽ,2350,0.650,1527,76350,1137.40,56870,1,',
  '20241001,1000001,2,1011,木漏日商店(株),DB-1252,紙製手提げ袋 M 白 300枚入,1,15,ｹｰｽ,4800,0.650,3120,46800,2140.80,32112,1,',
];
/** the same two lines as the 販売管理A形式 writes them */
const A_ROWS = [
  '"R06/10/01","1000001","1","売上","本社営業部","００１０１１","木漏日商店株式会社","ＤＢ－１０４４","段ボール箱　Ａ式　５００×３５０×３００ｍｍ　クラフト　１０枚入","50","ケース","2,350","65.0","1,527","76,350","1,137.40","56,870","19,480","得意先",""',
  '"R06/10/01","1000001","2","売上","本社営業部","００１０１１","木漏日商店株式会社","ＤＢ－１２５２","紙製手提げ袋　Ｍ　白　３００枚入","15","ケース","4,800","65.0","3,120","46,800","2,140.80","32,112","14,688","得意先",""',
];
/** another branch's export: its own 伝票1000001-1 is a different sale (other day, customer and product) */
const OTHER_BRANCH_ROW =
  '20241105,1000001,1,1127,(同)月光商事,KG-1128,ﾍﾟﾝﾁ 125mm,1,3,本,1250,0.574,718,2154,588.75,1766,1,';

const csv = (name: string, header: string, rows: readonly string[]): SourceFile => ({
  name,
  bytes: new TextEncoder().encode(`${[header, ...rows].join('\r\n')}\r\n`),
});

describe('buildLoaded: sales lines from several files', () => {
  it('keeps a different sale that reuses a 伝票番号-行 in another file, and reports it', async () => {
    const loaded = await buildLoaded(
      [csv('本社_202410.csv', B_HEADER, B_ROWS), csv('東支店_202411.csv', B_HEADER, [OTHER_BRANCH_ROW])],
      OPTS,
    );
    expect(loaded.lines).toHaveLength(3);
    expect(loaded.duplicateLines).toBe(0);
    // every line keeps its own id so the diagnosis can point at each one
    expect(new Set(loaded.lines.map((l) => l.id)).size).toBe(3);
    const other = loaded.lines.find((l) => l.cust === '001127');
    expect(other?.id).toContain('1000001-1');
    expect(other?.id).not.toBe('1000001-1');
    expect(loaded.period).toEqual({ first: '2024-10-01', last: '2024-11-05' });

    expect(loaded.slipCollisions.count).toBe(1);
    expect(loaded.slipCollisions.examples).toEqual([
      {
        slipLine: '1000001-1',
        first: {
          file: '本社_202410.csv',
          row: 2,
          id: '1000001-1',
          date: '2024-10-01',
          cust: '001011',
          rawSku: 'DB-1044',
          qty: 50,
          unitPrice: 1527,
        },
        other: {
          file: '東支店_202411.csv',
          row: 2,
          id: other?.id,
          date: '2024-11-05',
          cust: '001127',
          rawSku: 'KG-1128',
          qty: 3,
          unitPrice: 718,
        },
      },
    ]);
  });

  it('keeps a line whose 伝票番号-行, day, customer and product match but whose quantity differs', async () => {
    const changed = B_ROWS[0]?.replace(',1,50,ｹｰｽ,', ',1,40,ｹｰｽ,').replace(',76350,', ',61080,') ?? '';
    const loaded = await buildLoaded(
      [csv('a.csv', B_HEADER, B_ROWS), csv('b.csv', B_HEADER, [changed])],
      OPTS,
    );
    expect(loaded.lines.map((l) => l.qty)).toEqual([50, 15, 40]);
    expect(loaded.duplicateLines).toBe(0);
    expect(loaded.slipCollisions.count).toBe(1);
  });

  it('collapses the same export loaded twice under another name', async () => {
    const loaded = await buildLoaded(
      [csv('売上_10月.csv', B_HEADER, B_ROWS), csv('売上_10月 (1).csv', B_HEADER, B_ROWS)],
      OPTS,
    );
    expect(loaded.lines.map((l) => l.id)).toEqual(['1000001-1', '1000001-2']);
    expect(loaded.duplicateLines).toBe(2);
    expect(loaded.slipCollisions).toEqual({ count: 0, examples: [] });
  });

  it('collapses the A and B layouts of the same export', async () => {
    const loaded = await buildLoaded(
      [csv('sales_A.csv', A_HEADER, A_ROWS), csv('sales_B.csv', B_HEADER, B_ROWS)],
      OPTS,
    );
    expect(loaded.files.map((f) => f.label)).toEqual([
      '売上明細（販売管理A形式）',
      '売上データ（販売管理B形式）',
    ]);
    expect(loaded.lines.map((l) => l.id)).toEqual(['1000001-1', '1000001-2']);
    expect(loaded.duplicateLines).toBe(2);
    expect(loaded.slipCollisions.count).toBe(0);
  });

  it('treats a file without 売上金額 as the same sale when everything else matches', async () => {
    const header = B_HEADER.replace(',売上金額', '');
    const rows = B_ROWS.map((r) => r.replace(',76350,', ',').replace(',46800,', ','));
    const loaded = await buildLoaded([csv('a.csv', B_HEADER, B_ROWS), csv('b.csv', header, rows)], OPTS);
    expect(loaded.lines).toHaveLength(2);
    expect(loaded.duplicateLines).toBe(2);
    expect(loaded.slipCollisions.count).toBe(0);
  });
});

/** The fixture with two 定価改定 in the history (see engine/testing/twoRevisions.ts). */
const twoRevisions = (extra: SourceFile[] = [], without = ''): SourceFile[] => [
  ...twoRevisionFiles()
    .filter((f) => f.name !== without)
    .map((f) => ({ name: f.name, bytes: new TextEncoder().encode(f.text) })),
  ...extra,
];
const json = (name: string, value: unknown): SourceFile => ({
  name,
  bytes: new TextEncoder().encode(JSON.stringify(value)),
});

describe('buildLoaded: which revision the agreements file answers', () => {
  it('reads previousRevisionDate from demo_settings.json and uses the agreements file', async () => {
    const loaded = await buildLoaded(
      twoRevisions([json('demo_settings.json', { marginFloorPct: 10, previousRevisionDate: '2025-10-01' })]),
      OPTS,
    );
    expect(loaded.ws.dataset.revisions.map((r) => r.date)).toEqual(['2025-10-01']);
    expect(loaded.ws.agreementFiles[0]?.signals).toEqual(['settings']);
    expect(agreementsNotUsed(loaded)).toEqual([]);
    expect(loaded.diagnosis?.summary.reduce((s, x) => s + x.annualImpactYen, 0)).toBe(720);
  });

  it('reads a JSON that holds only previousRevisionDate as settings, not as an error', async () => {
    const loaded = await buildLoaded(
      twoRevisions([json('settings.json', { previousRevisionDate: '2025-10-01' })]),
      OPTS,
    );
    expect(loaded.files.find((f) => f.name === 'settings.json')).toMatchObject({
      status: 'json',
      label: '設定（JSON）',
    });
    expect(loaded.ws.dataset.revisions.map((r) => r.date)).toEqual(['2025-10-01']);
  });

  it('lists the agreements files that are loaded but not used', async () => {
    const unused = await buildLoaded(twoRevisions(), OPTS);
    expect(agreementsNotUsed(unused).map((a) => a.file)).toEqual(['agreements.csv']);
    expect(unused.diagnosis?.summary.reduce((s, x) => s + x.annualImpactYen, 0)).toBe(1800);

    const entered = await buildLoaded(twoRevisions(), {
      ...OPTS,
      revisionDates: { 'agreements.csv': '2025-10-01' },
    });
    expect(agreementsNotUsed(entered)).toEqual([]);

    // without a 定価の履歴 there is no 反映漏れ for the file to correct
    const noHistory = await buildLoaded(twoRevisions([], 'list_price_history.csv'), OPTS);
    expect(noHistory.ws.agreementFiles[0]?.used).toBe(false);
    expect(agreementsNotUsed(noHistory)).toEqual([]);
  });

  it('marks the declined customer letter 仮, with no ※ご請求, while the file is not used', async () => {
    // as LetterScreen builds it: provisional while agreementsNotUsed is not empty
    const letterOf = (loaded: Loaded) => {
      const p = computeProposal(
        loaded,
        structuredClone(DEFAULT_SCENARIO),
        structuredClone(DEFAULT_GUARD),
        {},
      );
      if (!p.ok) throw new Error(p.error);
      const company = { name: '架空', business: '', address: '', tel: '', representative: '', branches: [] };
      return buildLetter(loaded.ws.dataset, '000002', p.pairs, [], company, {
        issueDate: '2026-01-10',
        effectiveDate: p.effectiveDate,
        basis: '出荷分',
        provisional: agreementsNotUsed(loaded).length > 0,
      });
    };
    const unused = letterOf(await buildLoaded(twoRevisions(), OPTS));
    expect(unused.provisional).toBe(true);
    // its correct kept price 792 is not a billing error to point out
    expect(unused.items.map((i) => [i.sku, i.billedPrice])).toEqual([
      ['DB-2001', null],
      ['DB-2002', null],
    ]);
    expect(unused.itemsNotes.join('')).not.toContain('※印');

    const entered = letterOf(
      await buildLoaded(twoRevisions(), { ...OPTS, revisionDates: { 'agreements.csv': '2025-10-01' } }),
    );
    expect(entered.provisional).toBe(false);
    expect(entered.items.map((i) => [i.sku, i.currentPrice, i.billedPrice])).toEqual([
      ['DB-2001', 792, null],
      ['DB-2002', 792, null],
    ]);
  });
});

const SAMPLE = join(import.meta.dirname, '..', '..', '..', 'public', 'sample');
const present = existsSync(join(SAMPLE, 'sales_A_202410-202609.csv'));
const sample = (name: string): SourceFile => ({
  name,
  bytes: new Uint8Array(readFileSync(join(SAMPLE, name))),
});

describe.skipIf(!present)('buildLoaded on the sample data (架空)', () => {
  it('reads the A and B sales exports of the sample as one set of 56,328 lines', async () => {
    const loaded = await buildLoaded(
      [sample('sales_A_202410-202609.csv'), sample('sales_B_202410-202609.csv')],
      OPTS,
    );
    expect(loaded.lines).toHaveLength(56328);
    expect(loaded.duplicateLines).toBe(56328);
    expect(loaded.slipCollisions.count).toBe(0);
  });

  it('diagnoses both sales that share a 伝票番号-行', async () => {
    const loaded = await buildLoaded(
      [
        sample('customers.csv'),
        sample('products.csv'),
        csv('本社_202410.csv', B_HEADER, B_ROWS),
        csv('東支店_202411.csv', B_HEADER, [OTHER_BRANCH_ROW]),
      ],
      OPTS,
    );
    expect(loaded.diagnosis?.lines).toHaveLength(3);
    expect(loaded.lineById.size).toBe(3);
    for (const l of loaded.lines) expect(loaded.lineById.get(l.id)?.line.cust).toBe(l.cust);
  });
});
