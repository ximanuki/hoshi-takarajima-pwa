import { describe, expect, it } from 'vitest';
import { Dataset } from './dataset.ts';
import { diagnose, diagnoseLine, explainLine } from './diagnosis.ts';
import { fixtureDataset, fixtureInput, line, REVISION } from './testing/fixtures.ts';
import { codeKey } from './text.ts';
import type { Product } from './types.ts';

const ds = fixtureDataset();
const D = '2025-05-10';
const check = (p: Parameters<typeof line>[0]) =>
  diagnoseLine(ds, ds.resolveLines([line(p)])[0] as ReturnType<typeof line>);

describe('diagnoseLine: correct prices', () => {
  it('accepts 定価 × 掛率, a valid 特値 and a kept old 定価', () => {
    expect(check({ cust: '000001', rawSku: 'DB-1001', date: D, unitPrice: 554 }).status).toBe('ok');
    expect(check({ cust: '000002', rawSku: 'DB-1001', date: D, unitPrice: 450 }).status).toBe('ok_special');
    expect(check({ cust: '000002', rawSku: 'KG-1001', date: D, unitPrice: 720 }).status).toBe(
      'ok_kept_price',
    );
    expect(check({ cust: '000004', rawSku: 'DB-1001', date: D, unitPrice: 497 }).status).toBe(
      'ok_kept_price',
    );
  });

  it('accepts a volume discount stated in the remark, even below the rank range', () => {
    // 554 × 0.97 = 537.38 → 537 (below the B range minimum 539)
    const d = check({ cust: '000001', rawSku: 'DB-1001', date: D, unitPrice: 537, remark: '数量値引3%' });
    expect(d.status).toBe('ok_volume_discount');
    expect(d.discountBp).toBe(300);
    expect(check({ cust: '000001', rawSku: 'DB-1001', date: D, unitPrice: 537 }).leak).toBe(
      'rate_out_of_tier',
    );
  });

  it('excludes returns, free samples and codes outside the product master', () => {
    expect(
      check({ cust: '000001', rawSku: 'DB-1001', date: D, unitPrice: 554, qty: -2, isReturn: true }).status,
    ).toBe('excluded_return');
    expect(check({ cust: '000001', rawSku: 'DB-1001', date: D, unitPrice: 0, remark: '見本品' }).status).toBe(
      'excluded_sample',
    );
    expect(check({ cust: '000001', rawSku: '9999', date: D, unitPrice: 1500 }).status).toBe(
      'excluded_non_product',
    );
    expect(check({ cust: '999999', rawSku: 'DB-1001', date: D, unitPrice: 554 }).status).toBe(
      'excluded_unknown_customer',
    );
    expect(check({ cust: '000001', rawSku: 'DB-1001', date: '2020-01-01', unitPrice: 554 }).status).toBe(
      'excluded_no_list_price',
    );
  });
});

describe('diagnoseLine: leaks', () => {
  it('反映漏れ: billed at the old 定価 × 掛率 after the revision', () => {
    const d = check({ cust: '000001', rawSku: 'DB-1001', date: D, unitPrice: 511, qty: 10 });
    expect(d.leak).toBe('old_price');
    expect(d.oldPrice).toBe(511);
    expect(d.shortfallYen).toBe((554 - 511) * 10);
    expect(d.flags).toContain('rate_out_of_tier');
    const text = explainLine(d).join('');
    expect(text).toContain('710円 → 770円');
    expect(text).toContain('旧定価 710円 × 掛率 72.0%');
    expect(text).toContain('430円');
  });

  it('反映漏れ after an agreed later 適用日 only', () => {
    expect(check({ cust: '000004', rawSku: 'DB-1001', date: '2025-05-31', unitPrice: 497 }).status).toBe(
      'ok_kept_price',
    );
    const d = check({ cust: '000004', rawSku: 'DB-1001', date: '2025-06-02', unitPrice: 497 });
    expect(d.leak).toBe('old_price');
    expect(d.expected?.price).toBe(539);
  });

  it('特値の期限切れ: billed at a 特値 whose period ended', () => {
    const d = check({ cust: '000001', rawSku: 'DB-1002', date: D, unitPrice: 330, qty: 5 });
    expect(d.leak).toBe('expired_special');
    expect(d.expiredSpecial?.end).toBe('2025-03-31');
    expect(d.shortfallYen).toBe((360 - 330) * 5);
    expect(explainLine(d).join('')).toContain('令和7年3月31日');
  });

  it('掛け率ランク外: below or above the rank range of 定価', () => {
    const under = check({ cust: '000001', rawSku: 'DB-1001', date: D, unitPrice: 530 });
    expect(under.leak).toBe('rate_out_of_tier');
    expect(under.tier).toMatchObject({ minPrice: 539, maxPrice: 577 });
    const over = check({ cust: '000001', rawSku: 'DB-1001', date: D, unitPrice: 600, qty: 2 });
    expect(over.leak).toBe('rate_out_of_tier');
    expect(over.shortfallYen).toBe(-92);
    expect(explainLine(over).join('')).toContain('上回っています');
  });

  it('粗利下限割れ on a correctly billed line', () => {
    // C物流 keeps KG at the old 定価: 1,000 × 58% = 580円, cost 600円 → margin −3.4%
    const d = check({ cust: '000003', rawSku: 'KG-1001', date: D, unitPrice: 580, qty: 3 });
    expect(d.leak).toBe('below_margin_floor');
    expect(d.floorPrice).toBe(667);
    expect(d.shortfallYen).toBe((667 - 580) * 3);
    expect(d.mismatch).toBe(false);
    expect(explainLine(d).join('')).toContain('粗利率が -3.4% で、下限 10.0% を下回っています');
  });

  it('uses the cost printed on the line when there is one', () => {
    const d = check({ cust: '000001', rawSku: 'DB-1001', date: D, unitPrice: 554, costSen: 52000 });
    expect(d.leak).toBe('below_margin_floor');
  });

  it('価格差（原因不明）: differs for no known reason', () => {
    const d = check({ cust: '000001', rawSku: 'DB-1001', date: D, unitPrice: 560 });
    expect(d.status).toBe('price_mismatch');
    expect(d.mismatch).toBe(true);
    expect(d.shortfallYen).toBe(-60);
    expect(explainLine(d).join('')).toContain('どれにも当てはまりません');
  });
});

describe('data without a 定価 history', () => {
  it('explains a finding without a start date for the 定価', () => {
    const bare = new Dataset({ ...fixtureInput(), listPriceHistory: [], costHistory: [] });
    const d = diagnoseLine(
      bare,
      bare.resolveLines([
        line({ cust: '000001', rawSku: 'DB-1001', date: D, unitPrice: 520 }),
      ])[0] as ReturnType<typeof line>,
    );
    expect(d.leak).toBe('rate_out_of_tier');
    const text = explainLine(d).join('');
    expect(text).toContain('定価 770円 が基準です');
    const r = diagnose(
      bare,
      bare.resolveLines([line({ cust: '000001', rawSku: 'DB-1001', date: D, unitPrice: 520 })]),
    );
    expect(r.findings).toHaveLength(1);
  });
});

describe('diagnose: findings and impact', () => {
  const lines = [
    // 反映漏れ for A商事 × DB-1001, outside and inside the window, still going on
    line({ cust: '000001', rawSku: 'DB-1001', date: '2025-05-10', unitPrice: 511, qty: 10 }),
    line({ cust: '000001', rawSku: 'ＤＢ－１００１', date: '2025-11-10', unitPrice: 511, qty: 10 }),
    line({ cust: '000001', rawSku: 'db1001', date: '2026-03-10', unitPrice: 511, qty: 20 }),
    // expired 特値, fixed later
    line({ cust: '000001', rawSku: 'DB-1002', date: '2025-12-01', unitPrice: 330, qty: 5 }),
    line({ cust: '000001', rawSku: 'DB-1002', date: '2026-02-01', unitPrice: 360, qty: 5 }),
    // correct lines
    line({ cust: '000002', rawSku: 'DB-1001', date: '2026-01-15', unitPrice: 450, qty: 4 }),
    line({ cust: '000003', rawSku: 'DB-1001', date: '2026-09-30', unitPrice: 446, qty: 1 }),
    line({ cust: '000001', rawSku: '9999', date: '2026-01-15', unitPrice: 1500, qty: 1 }),
  ];
  const r = diagnose(ds, lines);

  it('uses the last 12 calendar months as the window', () => {
    expect(r.window).toEqual({ start: '2025-10-01', end: '2026-09-30' });
  });

  it('groups lines into findings with yearly impact', () => {
    const rev = r.findings.find((f) => f.type === 'old_price');
    expect(rev).toMatchObject({
      id: 'REV-0001',
      cust: '000001',
      sku: 'DB-1001',
      lines: 3,
      linesInWindow: 2,
      shortfallTotalYen: 43 * 40,
      annualImpactYen: 43 * 30,
      ongoing: true,
      firstDate: '2025-05-10',
      lastDate: '2026-03-10',
    });
    const spx = r.findings.find((f) => f.type === 'expired_special');
    expect(spx).toMatchObject({ lines: 1, annualImpactYen: 150, ongoing: false });
  });

  it('summarises by type and counts statuses', () => {
    expect(r.summary.find((s) => s.type === 'old_price')).toMatchObject({
      pairs: 1,
      customers: 1,
      annualImpactYen: 1290,
    });
    expect(r.statusCounts.leak).toBe(4);
    expect(r.statusCounts.ok_special).toBe(1);
    expect(r.statusCounts.excluded_non_product).toBe(1);
    expect(r.salesInWindowYen).toBe(511 * 30 + 330 * 5 + 360 * 5 + 450 * 4 + 446 + 1500);
  });

  it('flags a customer whose items nearly all show the same problem', () => {
    const many = [];
    const input = fixtureDataset().products;
    expect(input.size).toBe(3);
    // build a customer-wide 反映漏れ: every DB/KG item at the old price
    for (const sku of ['DB-1001', 'KG-1001']) {
      const old = sku === 'DB-1001' ? 511 : 720;
      for (let m = 1; m <= 3; m++)
        many.push(line({ cust: '000001', rawSku: sku, date: `2025-0${m + 4}-10`, unitPrice: old }));
    }
    const res = diagnose(ds, many);
    const roll = res.customers.find((c) => c.type === 'old_price');
    expect(roll).toMatchObject({ affectedPairs: 2, eligiblePairs: 2, shareBp: 10000, wholeCustomer: false });
  });
});

describe('customer-wide problems', () => {
  it('flags a customer when at least 5 items and 80% of them show the problem while it lasts', () => {
    const base = fixtureInput();
    const extra = Array.from({ length: 6 }, (_, i) => `DB-20${i}`);
    const big = new Dataset({
      ...base,
      products: [
        ...base.products,
        ...extra.map((code) => ({ ...(base.products[0] as Product), code, key: codeKey(code) })),
      ],
      listPriceHistory: [
        ...(base.listPriceHistory ?? []),
        ...extra.flatMap((sku) => [
          { sku, price: 710, start: '2024-04-01', end: '2025-03-31' },
          { sku, price: 770, start: REVISION, end: null },
        ]),
      ],
    });
    const lines = [
      ...extra.map((sku, i) =>
        line({ cust: '000001', rawSku: sku, date: `2025-0${5 + (i % 3)}-10`, unitPrice: 511 }),
      ),
      // after the fix, correct prices
      ...extra.map((sku) => line({ cust: '000001', rawSku: sku, date: '2026-02-10', unitPrice: 554 })),
      // another customer with one leak among many correct items
      line({ cust: '000004', rawSku: 'DB-200', date: '2025-07-10', unitPrice: 497 }),
      ...extra.map((sku) => line({ cust: '000004', rawSku: sku, date: '2025-07-11', unitPrice: 539 })),
    ];
    const res = diagnose(big, lines);
    const a = res.customers.find((c) => c.cust === '000001' && c.type === 'old_price');
    const d = res.customers.find((c) => c.cust === '000004' && c.type === 'old_price');
    expect(a).toMatchObject({
      affectedPairs: 6,
      eligiblePairs: 6,
      wholeCustomer: true,
      lastDate: '2025-07-10',
    });
    expect(d).toMatchObject({ affectedPairs: 1, wholeCustomer: false });
    expect(res.findings.filter((f) => f.cust === '000001').every((f) => !f.ongoing)).toBe(true);
  });
});
