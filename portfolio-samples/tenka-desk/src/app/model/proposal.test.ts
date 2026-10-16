import { describe, expect, it } from 'vitest';
import {
  collectPairVolumes,
  type PairProposal,
  pairKey,
  proposeListPrices,
  proposePairs,
  runScenario,
} from '../../engine/index.ts';
import { fixtureDataset, line } from '../../engine/testing/fixtures.ts';
import {
  applyOverrides,
  checkOverride,
  guardrailsFrom,
  guardSettingsError,
  overrideBounds,
} from './proposal.ts';
import { DEFAULT_GUARD, type GuardSettings } from './settings.ts';

const ds = fixtureDataset();
const sales = ds.resolveLines([
  line({ cust: '000001', rawSku: 'DB-1001', date: '2026-03-01', unitPrice: 554, qty: 100 }),
  line({ cust: '000003', rawSku: 'DB-1001', date: '2026-05-01', unitPrice: 446, qty: 50 }),
]);
const volumes = collectPairVolumes(sales, { start: '2025-10-01', end: '2026-09-30' });
const scenario = runScenario(ds, {
  shock: { material: 10, labor: 5, energy: 20, other: 0 },
  asOf: '2026-09-30',
});
const input = {
  method: 'keep_margin_rate' as const,
  scenario,
  effectiveDate: '2026-12-01',
  asOf: '2026-09-30',
};

function pairsWith(g: GuardSettings): { pairs: PairProposal[]; guard: ReturnType<typeof guardrailsFrom> } {
  const guard = guardrailsFrom(ds, g);
  const lists = proposeListPrices(ds, volumes, input, guard);
  return { pairs: proposePairs(ds, volumes, lists, input, guard), guard };
}

describe('guardrailsFrom', () => {
  it('turns the percentages of the screen into the engine units', () => {
    const g = guardrailsFrom(ds, { ...DEFAULT_GUARD, maxIncreasePct: 12.5, minIncreasePct: 1, ending: 0 });
    expect(g.maxIncreaseBp).toBe(1250);
    expect(g.minIncreaseBp).toBe(100);
    expect(g.marginFloorBp).toBe(ds.settings.marginFloorBp);
    expect(g.listRounding.bands.map((b) => b.unit)).toEqual([10, 50, 100]);
    expect(g.listRounding.ending).toBe(0);
    expect(guardrailsFrom(ds, { ...DEFAULT_GUARD, capEnabled: false }).maxIncreaseBp).toBeNull();
  });

  it('rejects settings the price rounding cannot use', () => {
    expect(guardSettingsError(DEFAULT_GUARD)).toBeNull();
    expect(guardSettingsError({ ...DEFAULT_GUARD, ending: 80 })).toContain('10円');
    expect(guardSettingsError({ ...DEFAULT_GUARD, units: [0, 50, 100] })).not.toBeNull();
    expect(guardSettingsError({ ...DEFAULT_GUARD, maxIncreasePct: 0 })).not.toBeNull();
  });
});

describe('manual prices (overrides)', () => {
  const { pairs, guard } = pairsWith(DEFAULT_GUARD);
  const a = pairs.find((p) => p.cust === '000001' && p.sku === 'DB-1001') as PairProposal;

  it('has the bounds of the guardrails: current price, cap and the 掛率ランク at the new 定価', () => {
    // 定価 770 → 850; A商事 is rank B (70.0〜75.0%), 掛率 72.0%
    expect(a.status).toBe('proposed');
    expect(a.currentPrice).toBe(554);
    expect(a.newPrice).toBe(612);
    const b = overrideBounds(ds, a, guard);
    expect(b).toMatchObject({ current: 554, cap: 664, tierMin: 595, tierMax: 637, tierStrict: true });
  });

  it('refuses prices outside the guardrails and warns below the margin floor', () => {
    const b = overrideBounds(ds, a, guard);
    expect(checkOverride(b, 553)).toMatchObject({ ok: false });
    expect(checkOverride(b, 700)).toMatchObject({ ok: false });
    expect(checkOverride(b, 650)).toMatchObject({ ok: false });
    expect(checkOverride(b, 0)).toMatchObject({ ok: false });
    expect(checkOverride(b, 600)).toEqual({ ok: true, warnings: [] });
    expect(checkOverride({ ...b, floor: 610 }, 600)).toMatchObject({
      ok: true,
      warnings: [expect.stringContaining('粗利率')],
    });
    // the proposal itself could not stay inside the rank: only a warning
    expect(checkOverride({ ...b, tierStrict: false }, 650)).toMatchObject({ ok: true });
  });

  it('applies a valid manual price and recomputes the change', () => {
    const out = applyOverrides(ds, pairs, { [pairKey('000001', 'DB-1001')]: 600 }, guard);
    const p = out.find((x) => x.cust === '000001' && x.sku === 'DB-1001');
    expect(p).toMatchObject({
      override: 600,
      enginePrice: 612,
      newPrice: 600,
      changeYen: 46,
      status: 'proposed',
    });
    expect(p?.changeBp).toBe(830);
  });

  it('leaves an item out when the manual price equals the current price', () => {
    const out = applyOverrides(ds, pairs, { [pairKey('000001', 'DB-1001')]: 554 }, guard);
    const p = out.find((x) => x.cust === '000001' && x.sku === 'DB-1001');
    expect(p).toMatchObject({
      status: 'excluded',
      excludedReason: 'no_increase',
      changeYen: 0,
      newPrice: 554,
    });
  });

  it('ignores a saved manual price the current guardrails do not allow', () => {
    const tight = pairsWith({ ...DEFAULT_GUARD, maxIncreasePct: 5 });
    const out = applyOverrides(ds, tight.pairs, { [pairKey('000001', 'DB-1001')]: 600 }, tight.guard);
    const p = out.find((x) => x.cust === '000001' && x.sku === 'DB-1001');
    expect(p?.override).toBeNull();
    expect(p?.overrideRejected).toContain('600円');
    expect(p?.newPrice).toBe(p?.enginePrice);
  });
});

describe('manual prices of a pair whose customer is invoiced less (ongoing billing leak)', () => {
  const { pairs, guard } = pairsWith(DEFAULT_GUARD);
  const a = pairs.find((p) => p.cust === '000001' && p.sku === 'DB-1001') as PairProposal;
  const leaking: PairProposal = { ...a, ongoingLeak: 'old_price', systemPrice: 511, lastBilledPrice: 511 };

  it('warns, and flags for a person, above the cap counted from the invoiced price', () => {
    const b = overrideBounds(ds, leaking, guard);
    // 511 × 1.20 = 613
    expect(b).toMatchObject({ billed: 511, billedCap: 613 });
    expect(checkOverride(b, 612)).toEqual({ ok: true, warnings: [] });
    expect(checkOverride(b, 620)).toMatchObject({
      ok: true,
      warnings: [expect.stringContaining('今の請求単価 511円')],
    });
    const out = applyOverrides(ds, [leaking], { [pairKey('000001', 'DB-1001')]: 620 }, guard);
    expect(out[0]?.guardrails.map((g) => g.rule)).toContain('billed_increase_over_cap');
    expect(overrideBounds(ds, a, guard).billed).toBeNull();
  });

  it('refuses a margin floor of 100% or more', () => {
    expect(guardSettingsError({ ...DEFAULT_GUARD, marginFloorPct: 99.996 })).toContain('100%未満');
    expect(guardSettingsError({ ...DEFAULT_GUARD, marginFloorPct: 99.99 })).toBeNull();
  });
});
