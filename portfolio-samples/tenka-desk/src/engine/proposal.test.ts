import { describe, expect, it } from 'vitest';
import { diagnose } from './diagnosis.ts';
import {
  collectPairVolumes,
  defaultGuardrails,
  type Guardrails,
  ongoingBillingLeaks,
  type ProposalInput,
  proposeListPrices,
  proposePairs,
} from './proposal.ts';
import { runScenario } from './scenario.ts';
import { fixtureDataset, line } from './testing/fixtures.ts';

const ds = fixtureDataset();
const W = { start: '2025-10-01', end: '2026-09-30' };
const sales = ds.resolveLines([
  line({ cust: '000001', rawSku: 'DB-1001', date: '2026-03-01', unitPrice: 554, qty: 60 }),
  line({ cust: '000001', rawSku: 'DB-1001', date: '2026-08-01', unitPrice: 554, qty: 40 }),
  line({ cust: '000003', rawSku: 'DB-1001', date: '2026-05-01', unitPrice: 446, qty: 50 }),
  line({ cust: '000002', rawSku: 'DB-1001', date: '2026-05-01', unitPrice: 450, qty: 20 }),
  line({ cust: '000003', rawSku: 'KG-1001', date: '2026-06-01', unitPrice: 580, qty: 10 }),
  line({ cust: '000003', rawSku: 'KG-1001', date: '2026-06-02', unitPrice: 580, qty: -1, isReturn: true }),
  line({ cust: '000001', rawSku: 'DB-1001', date: '2025-01-01', unitPrice: 511, qty: 99 }),
]);
const volumes = collectPairVolumes(sales, W);
const scenario = runScenario(ds, {
  shock: { material: 10, labor: 5, energy: 20, other: 0 },
  asOf: '2026-09-30',
});
const base: ProposalInput = {
  method: 'keep_margin_rate',
  scenario,
  effectiveDate: '2026-12-01',
  asOf: '2026-09-30',
};
const guard: Guardrails = { ...defaultGuardrails(ds), maxIncreaseBp: null };

describe('collectPairVolumes', () => {
  it('sums sales in the window and keeps the latest price', () => {
    expect(volumes.get('000001|DB-1001')).toMatchObject({
      qty: 100,
      lines: 2,
      lastDate: '2026-08-01',
      lastBilledPrice: 554,
    });
    expect(volumes.get('000003|KG-1001')?.qty).toBe(10);
    expect(volumes.size).toBe(4);
  });
});

describe('proposeListPrices', () => {
  it('keep_margin_rate: raises 定価 by the cost increase rate, rounded up to the grid', () => {
    const lists = proposeListPrices(ds, volumes, base, guard);
    // 770 × 340.22 / 311.41 = 841.23 → 850円 (10円単位・切り上げ)
    expect(lists.get('DB-1001')).toMatchObject({
      currentList: 770,
      rawNewListSen: 84124,
      newList: 850,
      changeBp: 1039,
      capped: false,
    });
    // 1,100 × 650.40 / 600.00 = 1,192.40 → 1,200円 (50円単位)
    expect(lists.get('KG-1001')).toMatchObject({ newList: 1200 });
  });

  it('pass_through_amount: adds the cost increase divided by the buyers’ average 掛率', () => {
    const lists = proposeListPrices(ds, volumes, { ...base, method: 'pass_through_amount' }, guard);
    // weighted 掛率 (100×72.0 + 50×58.0 + 20×72.0) / 170 = 67.9%; 28.81円 / 0.679 = 42.44円 → 812.44 → 820円
    expect(lists.get('DB-1001')).toMatchObject({ weightedRatePm: 679, rawNewListSen: 81244, newList: 820 });
  });

  it('passes only part of the increase when asked', () => {
    const lists = proposeListPrices(ds, volumes, { ...base, passThroughBp: 5000 }, guard);
    // 770 + (841.24 − 770) / 2 = 805.62 → 810円
    expect(lists.get('DB-1001')?.newList).toBe(810);
  });

  it('fixed_list: takes the given table', () => {
    const lists = proposeListPrices(
      ds,
      volumes,
      {
        ...base,
        method: 'fixed_list',
        newListPrices: [{ sku: 'ＤＢ－１００１', currentPrice: 770, newPrice: 840, effective: '2026-12-01' }],
      },
      guard,
    );
    expect(lists.get('DB-1001')?.newList).toBe(840);
    expect(lists.get('KG-1001')?.newList).toBe(1100);
  });

  it('caps the 定価 increase and requires its inputs', () => {
    const lists = proposeListPrices(ds, volumes, base, { ...guard, maxIncreaseBp: 1000 });
    expect(lists.get('DB-1001')).toMatchObject({ newList: 840, capped: true });
    expect(() =>
      proposeListPrices(ds, volumes, { ...base, scenario: undefined } as unknown as ProposalInput, guard),
    ).toThrow();
    expect(() => proposeListPrices(ds, volumes, { ...base, method: 'fixed_list' }, guard)).toThrow();
  });
});

describe('proposePairs', () => {
  const lists = proposeListPrices(ds, volumes, base, guard);
  const pairs = proposePairs(ds, volumes, lists, base, guard);
  const get = (cust: string, sku: string) => pairs.find((p) => p.cust === cust && p.sku === sku);

  it('prices each customer at new 定価 × their 掛率, staying in their rank', () => {
    expect(get('000001', 'DB-1001')).toMatchObject({
      status: 'proposed',
      currentPrice: 554,
      newPrice: 612,
      changeYen: 58,
      changeBp: 1047,
      guardrails: [],
    });
    expect(get('000003', 'DB-1001')).toMatchObject({ status: 'proposed', currentPrice: 446, newPrice: 493 });
  });

  it('leaves 特値 out (or scales them when asked)', () => {
    expect(get('000002', 'DB-1001')).toMatchObject({
      status: 'excluded',
      excludedReason: 'special_price',
      newPrice: 450,
    });
    const scaled = proposePairs(ds, volumes, lists, base, { ...guard, specials: 'scale' }).find(
      (p) => p.cust === '000002',
    );
    // the customer declined the last revision, so its base 定価 is still 710: 450 × 850 / 710 = 538.7 → 538
    expect(scaled).toMatchObject({ status: 'proposed', basis: 'special_scaled', newPrice: 538 });
  });

  it('flags a margin floor it cannot reach within the cap', () => {
    // C物流 × KG-1001: kept at the old 定価 (580円); new 1,200 × 58% = 696円 (+20%), floor price 723円
    const p = get('000003', 'KG-1001');
    expect(p).toMatchObject({ status: 'proposed', newPrice: 696, costNewSen: 65040 });
    expect(p?.guardrails.map((g) => g.rule)).toEqual(['margin_floor_unmet']);
    expect(p?.guardrails[0]?.message).toContain('掛率ランクの上限');
  });

  it('raises a price to the margin floor when the cap and the rank allow it', () => {
    const highCost = runScenario(ds, {
      shock: { material: 10, labor: 5, energy: 20, other: 0 },
      asOf: '2026-09-30',
    });
    const kg = highCost.items.get('KG-1001');
    if (!kg) throw new Error('fixture');
    kg.newCostSen = 59000;
    kg.currentCostSen = 52000;
    const input = { ...base, scenario: highCost };
    const out = proposePairs(ds, volumes, proposeListPrices(ds, volumes, input, guard), input, {
      ...guard,
      marginFloorBp: 2000,
    });
    const p = out.find((x) => x.cust === '000003' && x.sku === 'KG-1001');
    // floor price for 590円 at 20% = 737.5 → 738円; rank S maximum for the new 定価 is 60% of 定価
    expect(p?.guardrails.map((g) => g.rule)).toContain('margin_floor_raised');
    expect(p?.newPrice).toBe(738);
  });

  it('caps each customer’s increase', () => {
    const capped = proposePairs(ds, volumes, lists, base, { ...guard, maxIncreaseBp: 1000 });
    const p = capped.find((x) => x.cust === '000001' && x.sku === 'DB-1001');
    expect(p).toMatchObject({ newPrice: 609, changeBp: 993 });
    expect(p?.guardrails.map((g) => g.rule)).toContain('max_increase_capped');
  });

  it('leaves out small increases and products without a new 定価', () => {
    const small = proposePairs(ds, volumes, lists, base, { ...guard, minIncreaseBp: 1050 });
    expect(small.find((x) => x.cust === '000001')?.excludedReason).toBe('below_min_increase');
    const none = proposePairs(ds, volumes, new Map(), base, guard);
    expect(none.every((x) => x.excludedReason === 'no_list_change')).toBe(true);
    expect(
      proposePairs(ds, volumes, lists, { ...base, customers: ['000003'] }, guard).every(
        (x) => x.cust === '000003',
      ),
    ).toBe(true);
  });

  it('marks the system price of a pair with an ongoing billing leak', () => {
    const leaking = ds.resolveLines([
      line({ cust: '000001', rawSku: 'DB-1001', date: '2026-08-01', unitPrice: 511, qty: 40 }),
      line({ cust: '000003', rawSku: 'DB-1001', date: '2026-05-01', unitPrice: 446, qty: 50 }),
    ]);
    const vol = collectPairVolumes(leaking, W);
    const input = { ...base, ongoingLeaks: ongoingBillingLeaks(diagnose(ds, leaking)) };
    const out = proposePairs(ds, vol, proposeListPrices(ds, vol, input, guard), input, guard);
    expect(out.find((p) => p.cust === '000001')).toMatchObject({
      ongoingLeak: 'old_price',
      lastBilledPrice: 511,
      systemPrice: 511,
      currentPrice: 554,
    });
    expect(out.find((p) => p.cust === '000003')).toMatchObject({ ongoingLeak: null, systemPrice: 446 });
  });
});
