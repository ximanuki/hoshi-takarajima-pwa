import { describe, expect, it } from 'vitest';
import { Dataset, inferRevisionDates, listChangeDates } from './dataset.ts';
import { agreement, fixtureDataset, fixtureInput, REVISION } from './testing/fixtures.ts';

describe('applicableList', () => {
  const ds = fixtureDataset();

  it('moves an agreed customer to the new 定価 and remembers the old one', () => {
    const l = ds.applicableList('000001', 'DB-1001', '2025-05-10');
    expect(l).toMatchObject({ price: 770, basis: 'current', previousPrice: 710, since: REVISION });
    expect(ds.applicableList('000001', 'DB-1001', '2025-03-31')).toMatchObject({
      price: 710,
      previousPrice: null,
    });
  });

  it('keeps the old 定価 for 見送り, excluded categories and before an agreed later date', () => {
    expect(ds.applicableList('000002', 'DB-1001', '2025-05-10')).toMatchObject({
      price: 710,
      basis: 'kept_declined',
      previousPrice: null,
    });
    expect(ds.applicableList('000003', 'KG-1001', '2025-05-10')).toMatchObject({
      price: 1000,
      basis: 'kept_excluded_category',
    });
    expect(ds.applicableList('000003', 'DB-1001', '2025-05-10')).toMatchObject({
      price: 770,
      basis: 'current',
    });
    expect(ds.applicableList('000004', 'DB-1001', '2025-05-31')).toMatchObject({
      price: 710,
      basis: 'kept_before_agreed_date',
    });
    expect(ds.applicableList('000004', 'DB-1001', '2025-06-01')).toMatchObject({
      price: 770,
      basis: 'current',
      previousPrice: 710,
      since: '2025-06-01',
    });
  });

  it('applies a 定価 change to a customer with no recorded answer', () => {
    const input = fixtureInput();
    const rev = input.revisions?.[0];
    if (!rev) throw new Error('fixture');
    const ds2 = new Dataset({
      ...input,
      revisions: [{ ...rev, agreements: rev.agreements.filter((a) => a.cust !== '000001') }],
    });
    expect(ds2.applicableList('000001', 'DB-1001', '2025-05-10')).toMatchObject({
      price: 770,
      previousPrice: 710,
    });
  });

  it('returns null before the first 定価 and uses the master 定価 without history', () => {
    expect(ds.applicableList('000001', 'DB-1001', '2020-01-01')).toBeNull();
    const ds2 = fixtureDataset({ listPriceHistory: [] });
    expect(ds2.applicableList('000001', 'DB-1001', '2020-01-01')).toMatchObject({
      price: 770,
      previousPrice: null,
    });
  });
});

describe('expected price, 特値 and cost', () => {
  const ds = fixtureDataset();

  it('uses a valid 特値, else 定価 × 掛率', () => {
    expect(ds.expectedPrice('000002', 'DB-1001', '2025-05-10')).toMatchObject({
      price: 450,
      kind: 'special',
    });
    expect(ds.expectedPrice('000001', 'DB-1001', '2025-05-10')).toMatchObject({
      price: 554,
      kind: 'list_rate',
      ratePm: 720,
    });
    expect(ds.expectedPrice('000003', 'DB-1001', '2025-05-10')?.price).toBe(446);
    expect(ds.expectedPrice('999999', 'DB-1001', '2025-05-10')).toBeNull();
  });

  it('lists expired 特値', () => {
    expect(ds.validSpecial('000001', 'DB-1002', '2025-03-31')?.price).toBe(330);
    expect(ds.validSpecial('000001', 'DB-1002', '2025-04-01')).toBeNull();
    expect(ds.expiredSpecials('000001', 'DB-1002', '2025-04-01').map((s) => s.price)).toEqual([330]);
  });

  it('reads cost from history, falling back to the master', () => {
    expect(ds.costAt('DB-1001', '2025-03-31')).toBe(29323);
    expect(ds.costAt('DB-1001', '2025-04-01')).toBe(31141);
    expect(ds.costAt('KG-1001', '2025-04-01')).toBe(60000);
    expect(ds.costShareOf('KG-1001')).toEqual({ material: 45, labor: 30, energy: 12, other: 13 });
  });

  it('uses only history rows that cover the day (no borrowing across gaps or ends)', () => {
    // 定価: 2024-04-01..2024-12-31, gap in 2025-01..03, then from 2025-04-01. 原単価 starts 2024-07-01 and ends 2025-01-31.
    const gap = fixtureDataset({
      listPriceHistory: [
        { sku: 'DB-1001', price: 710, start: '2024-04-01', end: '2024-12-31' },
        { sku: 'DB-1001', price: 770, start: REVISION, end: null },
      ],
      costHistory: [{ sku: 'DB-1001', costSen: 29323, start: '2024-07-01', end: '2025-01-31' }],
    });
    expect(gap.listPriceAt('DB-1001', '2024-12-31')).toBe(710);
    expect(gap.listPriceAt('DB-1001', '2025-02-15')).toBeNull(); // in the gap, not the expired 710
    expect(gap.applicableList('000001', 'DB-1001', '2025-02-15')).toBeNull();
    expect(gap.listPriceAt('DB-1001', '2025-04-01')).toBe(770);
    // before the first cost row and after its end: no cost (not today's master cost, not the history row)
    expect(gap.costAt('DB-1001', '2024-05-01')).toBeNull();
    expect(gap.costAt('DB-1001', '2024-08-01')).toBe(29323);
    expect(gap.costAt('DB-1001', '2025-03-01')).toBeNull();
    // a product without any cost history uses the product master
    expect(gap.costAt('DB-1002', '2020-01-01')).toBe(20000);
  });

  it('flags an open-ended history row followed by a later one', () => {
    const open = fixtureDataset({
      listPriceHistory: [
        { sku: 'DB-1001', price: 710, start: '2024-04-01', end: null },
        { sku: 'DB-1001', price: 770, start: REVISION, end: null },
      ],
    });
    expect(open.issues.some((i) => i.kind === 'overlapping_period' && i.ref === 'DB-1001')).toBe(true);
  });

  it('never treats a 定価 cut as a missed increase', () => {
    const cut = fixtureDataset({
      listPriceHistory: [
        { sku: 'DB-1001', price: 800, start: '2024-04-01', end: '2025-03-31' },
        { sku: 'DB-1001', price: 770, start: REVISION, end: null },
      ],
    });
    expect(cut.applicableList('000001', 'DB-1001', '2025-05-10')?.previousPrice).toBeNull();
    expect(fixtureDataset().applicableList('000001', 'DB-1001', '2025-05-10')?.previousPrice).toBe(710);
  });

  it('reports 合意状況 that had to be interpreted, and reads negations as not agreed', () => {
    const neg = fixtureDataset({
      revisions: [
        {
          date: REVISION,
          label: '令和7年4月1日 定価改定',
          agreements: [
            agreement('000001', '合意に至らず', REVISION),
            agreement('000002', '対象外（改定後に取引開始）', null),
          ],
        },
      ],
    });
    const a = neg.applicableList('000001', 'DB-1001', '2025-05-10');
    expect(a?.basis).toBe('kept_declined');
    expect(a?.price).toBe(710);
    const notes = neg.issues.filter((i) => i.kind === 'interpreted_agreement_status');
    expect(notes.map((i) => i.ref)).toEqual(['000001']);
    expect(notes[0]?.message).toContain('「見送り」として扱いました');
  });

  it('merges agreement files that share a revision date (e.g. one per branch)', () => {
    const label = '令和7年4月1日 定価改定';
    const split = fixtureDataset({
      revisions: [
        {
          date: REVISION,
          label,
          agreements: [agreement('000001', '合意', REVISION), agreement('000002', '見送り', null)],
        },
        {
          date: REVISION,
          label,
          agreements: [
            agreement('000003', '一部合意', REVISION, ['KG']),
            agreement('000004', '合意(適用日変更)', '2025-06-01'),
          ],
        },
      ],
    });
    expect(split.revisions).toHaveLength(1);
    expect(split.revisions[0]?.agreements.map((a) => a.cust).sort()).toEqual([
      '000001',
      '000002',
      '000003',
      '000004',
    ]);
    // 000002 is only in the first file: still 見送り, not the new 定価
    expect(split.applicableList('000002', 'DB-1001', '2025-05-10')).toMatchObject({
      price: 710,
      basis: 'kept_declined',
    });
    expect(split.applicableList('000004', 'DB-1001', '2025-05-31')).toMatchObject({
      basis: 'kept_before_agreed_date',
    });
    expect(split.issues.filter((i) => i.kind === 'conflicting_agreement')).toEqual([]);

    // the same customer answered differently in two files: reported, the later file wins
    const clash = fixtureDataset({
      revisions: [
        { date: REVISION, label, agreements: [agreement('000002', '見送り', null)] },
        { date: REVISION, label, agreements: [agreement('000002', '合意', REVISION)] },
      ],
    });
    expect(clash.issues.filter((i) => i.kind === 'conflicting_agreement').map((i) => i.ref)).toEqual([
      '000002',
    ]);
    expect(clash.applicableList('000002', 'DB-1001', '2025-05-10')).toMatchObject({
      price: 770,
      basis: 'current',
    });
  });

  it('resolves codes written in any style', () => {
    expect(ds.resolveSku('ＤＢー１００１')).toBe('DB-1001');
    expect(ds.resolveSku('9999')).toBeNull();
  });
});

describe('data checks', () => {
  it('reports duplicate codes, ambiguous keys, unknown ranks and rates outside the rank', () => {
    const input = fixtureInput();
    const p = input.products[0];
    const c = input.customers[0];
    if (!p || !c) throw new Error('fixture');
    const ds = new Dataset({
      ...input,
      products: [...input.products, { ...p, code: 'DB1001', key: 'DB1001' }],
      customers: [
        ...input.customers,
        { ...c, code: '000009', rank: 'Z' },
        { ...c, code: '000010', ratePm: 900 },
      ],
    });
    const kinds = ds.issues.map((i) => i.kind);
    expect(kinds).toContain('ambiguous_key');
    expect(kinds).toContain('unknown_rank');
    expect(kinds).toContain('rate_outside_tier');
  });

  it('reports overlapping 特値 and unknown products in histories', () => {
    const input = fixtureInput();
    const ds = new Dataset({
      ...input,
      specials: [
        ...(input.specials ?? []),
        {
          cust: '000002',
          sku: null,
          skuKey: 'DB1001',
          rawSku: 'DB-1001',
          price: 440,
          start: '2025-06-01',
          end: null,
          reason: '',
        },
        {
          cust: '000002',
          sku: null,
          skuKey: 'XX1',
          rawSku: 'XX-1',
          price: 1,
          start: '2025-06-01',
          end: null,
          reason: '',
        },
      ],
      listPriceHistory: [
        ...(input.listPriceHistory ?? []),
        { sku: 'ZZ-1', price: 1, start: '2024-01-01', end: null },
      ],
    });
    const kinds = ds.issues.map((i) => i.kind);
    expect(kinds).toContain('overlapping_period');
    expect(kinds.filter((k) => k === 'unknown_product')).toHaveLength(2);
  });

  it('infers revision dates from the 定価 history', () => {
    const rows = [];
    for (let i = 0; i < 40; i++) {
      rows.push({ sku: `P${i}`, price: 100, start: '2024-04-01', end: '2025-03-31' });
      rows.push({ sku: `P${i}`, price: 110, start: '2025-04-01', end: null });
    }
    rows.push(
      { sku: 'Q', price: 100, start: '2024-04-01', end: '2025-07-31' },
      { sku: 'Q', price: 120, start: '2025-08-01', end: null },
    );
    expect(inferRevisionDates(rows)).toEqual(['2025-04-01']);
    // every day on which any 定価 changed, also for a single product; a new row at the same price is no change
    rows.push(
      { sku: 'R', price: 300, start: '2024-04-01', end: '2025-05-31' },
      { sku: 'R', price: 300, start: '2025-06-01', end: null },
    );
    expect(listChangeDates(rows)).toEqual(['2025-04-01', '2025-08-01']);
    expect(inferRevisionDates(rows)).toEqual(['2025-04-01']);
  });
});
