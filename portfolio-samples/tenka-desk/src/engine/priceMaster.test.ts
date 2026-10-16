import { describe, expect, it } from 'vitest';
import { BOM } from './csv.ts';
import { decodeBytes } from './encoding.ts';
import { importFile } from './importers.ts';
import { appendEvent, createLog } from './negotiation.ts';
import {
  buildPriceMaster,
  exportPriceMaster,
  indexPriceMaster,
  type NegotiationOutcome,
  outcomeFromLog,
  outcomesFromAgreements,
} from './priceMaster.ts';
import type { PairProposal } from './proposal.ts';
import { fixtureDataset } from './testing/fixtures.ts';

const ds = fixtureDataset();

function pair(
  cust: string,
  sku: string,
  currentPrice: number,
  newPrice: number,
  extra: Partial<PairProposal> = {},
): PairProposal {
  return {
    cust,
    sku,
    category: sku.slice(0, 2),
    status: 'proposed',
    excludedReason: null,
    basis: 'list_rate',
    currentPrice,
    lastBilledPrice: currentPrice,
    ongoingLeak: null,
    systemPrice: currentPrice,
    newPrice,
    changeYen: newPrice - currentPrice,
    changeBp: 0,
    currentList: 0,
    newList: 0,
    ratePm: 0,
    costCurrentSen: 0,
    costNewSen: 0,
    marginCurrentBp: null,
    marginNoActionBp: null,
    marginNewBp: null,
    qty: 1,
    salesYen: 0,
    guardrails: [],
    ...extra,
  };
}

const pairs = [
  pair('000003', 'KG-1001', 580, 696),
  pair('000001', 'DB-1001', 554, 612, { lastBilledPrice: 511, systemPrice: 511, ongoingLeak: 'old_price' }),
  pair('000001', 'KG-1001', 792, 864),
  pair('000002', 'DB-1001', 450, 450, { status: 'excluded', excludedReason: 'special_price' }),
  pair('000003', 'DB-1001', 446, 493),
  pair('000004', 'DB-1001', 539, 595),
];

const outcomes = new Map<string, NegotiationOutcome>([
  [
    '000001',
    { cust: '000001', agreed: true, effective: '2026-12-01', excludedCategories: [], itemPrices: new Map() },
  ],
  [
    '000002',
    { cust: '000002', agreed: false, effective: null, excludedCategories: [], itemPrices: new Map() },
  ],
  [
    '000003',
    {
      cust: '000003',
      agreed: true,
      effective: '2026-12-01',
      excludedCategories: ['KG'],
      itemPrices: new Map(),
    },
  ],
  [
    '000004',
    {
      cust: '000004',
      agreed: true,
      effective: '2027-01-01',
      excludedCategories: [],
      itemPrices: new Map([['DB-1001', 590]]),
    },
  ],
]);

describe('buildPriceMaster', () => {
  it('keeps agreed customers, drops kept categories, applies agreed prices, sorts', () => {
    const rows = buildPriceMaster(pairs, outcomes);
    expect(rows.map((r) => [r.cust, r.sku, r.effective, r.newPrice, r.currentPrice])).toEqual([
      ['000001', 'DB-1001', '2026-12-01', 612, 511],
      ['000001', 'KG-1001', '2026-12-01', 864, 792],
      ['000003', 'DB-1001', '2026-12-01', 493, 446],
      ['000004', 'DB-1001', '2027-01-01', 590, 539],
    ]);
  });

  it('can put the correct or the last billed price in 現単価', () => {
    expect(buildPriceMaster(pairs, outcomes, { currentPrice: 'expected' })[0]?.currentPrice).toBe(554);
    expect(buildPriceMaster(pairs, outcomes, { currentPrice: 'last_billed' })[0]?.currentPrice).toBe(511);
  });

  it('reads outcomes from a 協議結果 file and from a 協議記録', () => {
    const fromFile = outcomesFromAgreements([
      {
        cust: '000001',
        status: '合意',
        kind: 'agreed',
        effective: '2026-12-01',
        excludedCategories: [],
        requestedOn: null,
        answeredOn: null,
        note: '',
      },
      {
        cust: '000002',
        status: '協議中',
        kind: 'negotiating',
        effective: null,
        excludedCategories: [],
        requestedOn: null,
        answeredOn: null,
        note: '',
      },
    ]);
    expect(fromFile.get('000001')?.agreed).toBe(true);
    expect(fromFile.get('000002')?.agreed).toBe(false);

    let log = createLog('000004');
    expect(outcomeFromLog(log)).toBeNull();
    log = appendEvent(log, {
      at: '2026-10-16T10:00:00+09:00',
      kind: 'letter_sent',
      author: '佐藤',
      summary: '送付',
      status: '申入れ済',
    });
    log = appendEvent(log, {
      at: '2026-11-01T10:00:00+09:00',
      kind: 'customer_reply',
      author: '佐藤',
      summary: '合意',
      status: '合意',
      terms: {
        effective: '2027-01-01',
        excludedCategories: [],
        itemPrices: [{ sku: 'DB-1001', price: 590 }],
      },
    });
    const o = outcomeFromLog(log);
    expect(o).toMatchObject({ agreed: true, effective: '2027-01-01' });
    expect(o?.itemPrices.get('DB-1001')).toBe(590);
  });
});

describe('exportPriceMaster', () => {
  const rows = buildPriceMaster(pairs, outcomes).slice(0, 2);

  it('writes layout A: BOM, CRLF, quoted, 全角, 和暦, 3桁区切り', () => {
    const f = exportPriceMaster(ds, rows, 'A');
    expect(f.fileName).toBe('price_master_A_20261201.csv');
    expect(f.text).toBe(
      `${BOM}"得意先コード","得意先名","商品コード","商品名","適用開始日","新単価","現単価"\r\n` +
        '"０００００１","株式会社A商事","ＤＢ－１００１","段ボール箱　Ａ式　２００×１５０×１００ｍｍ　１０枚入","R08/12/01","612","511"\r\n' +
        '"０００００１","株式会社A商事","ＫＧ－１００１","両口スパナ　１０×１２ｍｍ","R08/12/01","864","792"\r\n',
    );
    expect([...f.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('writes layout B: plain, LF, 半角, yyyymmdd', () => {
    const f = exportPriceMaster(ds, rows, 'B');
    expect(f.text).toBe(
      '得意先CD,品番,適用開始日,売単価,旧売単価\n1,DB-1001,20261201,612,511\n1,KG-1001,20261201,864,792\n',
    );
  });

  it('writes Shift_JIS without a BOM when asked', () => {
    const f = exportPriceMaster(ds, rows, 'A', { encoding: 'shift_jis', fileName: 'tanka.csv' });
    expect(f.fileName).toBe('tanka.csv');
    expect(f.bytes[0]).toBe(0x22);
    const d = decodeBytes(f.bytes);
    expect(d.encoding).toBe('shift_jis');
    expect(d.text).toBe(f.text);
  });

  it('round-trips through the importer in both layouts', () => {
    const all = buildPriceMaster(pairs, outcomes);
    for (const layout of ['A', 'B'] as const) {
      const f = exportPriceMaster(ds, all, layout);
      const imp = importFile(f.fileName, f.bytes);
      if (imp.data.kind !== 'priceMaster') throw new Error('kind');
      expect(imp.spec.variant).toBe(layout);
      const back = imp.data.result.records.map((r) => [
        r.cust,
        ds.resolveSku(r.skuKey),
        r.effective,
        r.newPrice,
        r.currentPrice,
      ]);
      expect(back).toEqual(all.map((r) => [r.cust, r.sku, r.effective, r.newPrice, r.currentPrice]));
    }
  });

  it('indexes rows by customer and product in date order', () => {
    const idx = indexPriceMaster([
      {
        cust: '1',
        sku: 'X',
        skuKey: 'X',
        rawSku: 'X',
        effective: '2027-04-01',
        newPrice: 3,
        currentPrice: 2,
      },
      {
        cust: '1',
        sku: 'X',
        skuKey: 'X',
        rawSku: 'X',
        effective: '2026-12-01',
        newPrice: 2,
        currentPrice: 1,
      },
      {
        cust: '1',
        sku: null,
        skuKey: 'Y',
        rawSku: 'Y',
        effective: '2026-12-01',
        newPrice: 2,
        currentPrice: 1,
      },
    ]);
    expect(idx.get('1|X')?.map((r) => r.effective)).toEqual(['2026-12-01', '2027-04-01']);
    expect(idx.size).toBe(1);
  });
});
