/**
 * 値上げ案 for the screens: the engine's proposal with the user's settings, plus
 * manual unit prices (overrides) checked against the same guardrails.
 *
 * Override rules:
 *  - never below the current price (equal = leave the item out)
 *  - never above the 値上げ率の上限 (when a cap is set)
 *  - inside the customer's 掛率ランク at the new 定価, unless the proposal itself
 *    already could not stay inside (then only a warning)
 *  - below the 粗利率の下限 is allowed but flagged for a person to decide
 */

import {
  changeBp,
  type Dataset,
  divFloor,
  type GuardrailHit,
  type Guardrails,
  type IsoDate,
  isBelowMarginFloor,
  type ListProposal,
  marginBp,
  marginFloorPrice,
  ongoingBillingLeaks,
  type PairProposal,
  type ProposalInput,
  pairKey,
  priceAtRate,
  proposeListPrices,
  proposePairs,
  runScenario,
  type ScenarioResult,
} from '../../engine/index.ts';
import { firstOfMonthAfter } from '../format.ts';
import type { Loaded } from './load.ts';
import { type GuardSettings, type ScenarioSettings, toBp } from './settings.ts';

export interface AppPair extends PairProposal {
  /** the engine's proposed price before any manual change */
  enginePrice: number;
  enginePriceStatus: PairProposal['status'];
  /** manual price in effect (null = none) */
  override: number | null;
  /** a saved manual price that the current guardrails do not allow */
  overrideRejected: string | null;
  /** limits for a manual price (from the engine's proposal) */
  bounds: OverrideBounds;
}

export interface CustomerProposal {
  cust: string;
  name: string;
  rank: string;
  ratePm: number;
  pairs: AppPair[];
  proposedItems: number;
  /** Σ (new − current) × 数量 over proposed items (年間, 依頼どおり) */
  requestedYen: number;
  /** sales of the proposed items at the current price (年間) */
  baseYen: number;
  changeBp: number | null;
  costIncreaseYen: number;
  /** items flagged for a person to decide (粗利率の下限に届かない／ランク外) */
  attention: number;
  overrides: number;
  ongoingLeaks: number;
}

export interface ProposalOk {
  ok: true;
  effectiveDate: IsoDate;
  asOf: IsoDate;
  input: ProposalInput;
  guardrails: Guardrails;
  scenario: ScenarioResult;
  lists: Map<string, ListProposal>;
  pairs: AppPair[];
  pairByKey: Map<string, AppPair>;
  customers: CustomerProposal[];
  customerByCode: Map<string, CustomerProposal>;
}

export type ProposalResult = ProposalOk | { ok: false; error: string };

export function defaultEffectiveDate(loaded: Loaded): IsoDate | null {
  if (loaded.demoNextRevision) return loaded.demoNextRevision;
  return loaded.asOf ? firstOfMonthAfter(loaded.asOf, 2) : null;
}

export function guardrailsFrom(ds: Dataset, g: GuardSettings): Guardrails {
  return {
    marginFloorBp: g.marginFloorPct === null ? ds.settings.marginFloorBp : toBp(g.marginFloorPct),
    maxIncreaseBp: g.capEnabled ? toBp(g.maxIncreasePct) : null,
    minIncreaseBp: toBp(g.minIncreasePct),
    listRounding: {
      bands: [
        { below: 1000, unit: g.units[0] },
        { below: 10000, unit: g.units[1] },
        { below: null, unit: g.units[2] },
      ],
      mode: g.mode,
      ...(g.ending !== null ? { ending: g.ending } : {}),
    },
    specials: g.specials,
    raiseToMarginFloor: g.raiseToMarginFloor,
  };
}

/** Checks that do not need the data: rounding units and the ending. */
export function guardSettingsError(g: GuardSettings): string | null {
  if (g.units.some((u) => !Number.isInteger(u) || u <= 0)) return '定価の丸め単位は1円以上の整数にしてください。';
  if (g.ending !== null) {
    if (!Number.isInteger(g.ending) || g.ending < 0) return '末尾の指定は0以上の整数にしてください。';
    const smallest = Math.min(...g.units);
    if (g.ending >= smallest)
      return `末尾の指定（${g.ending}円）は、いちばん小さい丸め単位（${smallest}円）より小さくしてください。`;
  }
  if (g.capEnabled && !(g.maxIncreasePct > 0)) return '値上げ率の上限は0%より大きくしてください。';
  return null;
}

export interface OverrideBounds {
  current: number;
  cap: number | null;
  tierMin: number | null;
  tierMax: number | null;
  /** the tier range must hold (the proposal itself stays inside it) */
  tierStrict: boolean;
  floor: number | null;
}

export function overrideBounds(ds: Dataset, p: PairProposal, guard: Guardrails): OverrideBounds {
  const rounding = ds.settings.unitRounding;
  const tier = p.basis === 'list_rate' ? ds.tierOf(p.cust) : null;
  return {
    current: p.currentPrice,
    cap:
      guard.maxIncreaseBp !== null ? divFloor(p.currentPrice * (10000 + guard.maxIncreaseBp), 10000) : null,
    tierMin: tier ? priceAtRate(p.newList, tier.minPm, rounding) : null,
    tierMax: tier ? priceAtRate(p.newList, tier.maxPm, rounding) : null,
    tierStrict: tier !== null && !p.guardrails.some((h) => h.rule === 'tier_conflict'),
    floor: p.costNewSen > 0 ? marginFloorPrice(p.costNewSen, guard.marginFloorBp) : null,
  };
}

export type OverrideVerdict = { ok: true; warnings: string[] } | { ok: false; error: string };

export function checkOverride(b: OverrideBounds, price: number): OverrideVerdict {
  if (!Number.isSafeInteger(price) || price <= 0) return { ok: false, error: '1円以上の整数で入力してください。' };
  if (price < b.current)
    return { ok: false, error: `現在の単価 ${b.current.toLocaleString('ja-JP')}円 より下げることはできません。` };
  if (b.cap !== null && price > b.cap)
    return {
      ok: false,
      error: `値上げ率の上限を超えます（上限は ${b.cap.toLocaleString('ja-JP')}円）。`,
    };
  const warnings: string[] = [];
  if (b.tierMin !== null && b.tierMax !== null && price > b.current && (price < b.tierMin || price > b.tierMax)) {
    const msg = `掛率ランクの範囲（${b.tierMin.toLocaleString('ja-JP')}〜${b.tierMax.toLocaleString('ja-JP')}円）の外です。`;
    if (b.tierStrict) return { ok: false, error: msg };
    warnings.push(msg);
  }
  if (b.floor !== null && price < b.floor)
    warnings.push(`粗利率の下限（${b.floor.toLocaleString('ja-JP')}円 以上）に届きません。`);
  return { ok: true, warnings };
}

function withOverride(ds: Dataset, p: PairProposal, price: number, guard: Guardrails): PairProposal {
  const b = overrideBounds(ds, p, guard);
  const hits: GuardrailHit[] = [];
  if (b.tierMin !== null && b.tierMax !== null && price > p.currentPrice && (price < b.tierMin || price > b.tierMax))
    hits.push({
      rule: 'tier_conflict',
      message: `手入力の単価が掛率ランクの範囲（${b.tierMin}〜${b.tierMax}円）の外です`,
    });
  if (p.costNewSen > 0 && isBelowMarginFloor(price, p.costNewSen, guard.marginFloorBp))
    hits.push({
      rule: 'margin_floor_unmet',
      message: `手入力の単価は粗利率の下限（${b.floor ?? '-'}円 以上）に届きません。個別に判断してください`,
    });
  const changeYen = price - p.currentPrice;
  return {
    ...p,
    status: changeYen > 0 ? 'proposed' : 'excluded',
    excludedReason: changeYen > 0 ? null : 'no_increase',
    newPrice: changeYen > 0 ? price : p.currentPrice,
    changeYen: Math.max(0, changeYen),
    changeBp: changeYen > 0 && p.currentPrice > 0 ? changeBp(price, p.currentPrice) : 0,
    marginNewBp: marginBp(changeYen > 0 ? price : p.currentPrice, p.costNewSen),
    guardrails: hits,
  };
}

export function applyOverrides(
  ds: Dataset,
  pairs: readonly PairProposal[],
  overrides: Readonly<Record<string, number>>,
  guard: Guardrails,
): AppPair[] {
  return pairs.map((p) => {
    const bounds = overrideBounds(ds, p, guard);
    const base: AppPair = {
      ...p,
      enginePrice: p.newPrice,
      enginePriceStatus: p.status,
      override: null,
      overrideRejected: null,
      bounds,
    };
    const o = overrides[pairKey(p.cust, p.sku)];
    if (o === undefined) return base;
    const verdict = checkOverride(bounds, o);
    if (!verdict.ok) return { ...base, overrideRejected: `手入力の単価 ${o}円 は使えません：${verdict.error}` };
    return {
      ...withOverride(ds, p, o, guard),
      enginePrice: p.newPrice,
      enginePriceStatus: p.status,
      override: o,
      overrideRejected: null,
      bounds,
    };
  });
}

function summarise(ds: Dataset, pairs: AppPair[]): CustomerProposal[] {
  const by = new Map<string, AppPair[]>();
  for (const p of pairs) {
    const list = by.get(p.cust);
    if (list) list.push(p);
    else by.set(p.cust, [p]);
  }
  const out: CustomerProposal[] = [];
  for (const [cust, list] of by) {
    const c = ds.customers.get(cust);
    let requested = 0;
    let base = 0;
    let costUpSen = 0;
    let attention = 0;
    let proposed = 0;
    for (const p of list) {
      costUpSen += (p.costNewSen - p.costCurrentSen) * p.qty;
      if (p.status === 'proposed') {
        proposed++;
        requested += p.changeYen * p.qty;
        base += p.currentPrice * p.qty;
      }
      if (p.guardrails.some((h) => h.rule === 'margin_floor_unmet' || h.rule === 'tier_conflict')) attention++;
    }
    out.push({
      cust,
      name: c?.name ?? cust,
      rank: c?.rank ?? '',
      ratePm: c?.ratePm ?? 0,
      pairs: list,
      proposedItems: proposed,
      requestedYen: requested,
      baseYen: base,
      changeBp: base > 0 ? changeBp(base + requested, base) : null,
      costIncreaseYen: Math.round(costUpSen / 100),
      attention,
      overrides: list.filter((p) => p.override !== null).length,
      ongoingLeaks: list.filter((p) => p.ongoingLeak !== null).length,
    });
  }
  return out.sort((a, b) => b.requestedYen - a.requestedYen || (a.cust < b.cust ? -1 : 1));
}

export function computeProposal(
  loaded: Loaded,
  scenario: ScenarioSettings,
  guard: GuardSettings,
  overrides: Readonly<Record<string, number>>,
): ProposalResult {
  const ds = loaded.ws.dataset;
  if (!loaded.diagnosis || !loaded.asOf) return { ok: false, error: '先に売上明細とマスタを読み込んでください。' };
  const guardError = guardSettingsError(guard);
  if (guardError) return { ok: false, error: guardError };
  const effectiveDate = scenario.effectiveDate ?? defaultEffectiveDate(loaded);
  if (!effectiveDate) return { ok: false, error: '適用日を決められません。' };
  if (scenario.method === 'fixed_list' && loaded.ws.newListPrices.length === 0)
    return { ok: false, error: '「新定価表を使う」には、新定価表のファイルを読み込んでください。' };
  const asOf = loaded.asOf;
  try {
    const result = runScenario(ds, {
      shock: scenario.shock,
      categoryShocks: scenario.categoryShocks,
      supplierNotices: scenario.useNotices ? 'use' : 'ignore',
      asOf,
    });
    const input: ProposalInput = {
      method: scenario.method,
      scenario: result,
      passThroughBp: toBp(scenario.passThroughPct),
      effectiveDate,
      asOf,
      ongoingLeaks: ongoingBillingLeaks(loaded.diagnosis),
      ...(scenario.method === 'fixed_list' ? { newListPrices: loaded.ws.newListPrices } : {}),
    };
    const guardrails = guardrailsFrom(ds, guard);
    const lists = proposeListPrices(ds, loaded.volumes, input, guardrails);
    const enginePairs = proposePairs(ds, loaded.volumes, lists, input, guardrails);
    const pairs = applyOverrides(ds, enginePairs, overrides, guardrails);
    const customers = summarise(ds, pairs);
    return {
      ok: true,
      effectiveDate,
      asOf,
      input,
      guardrails,
      scenario: result,
      lists,
      pairs,
      pairByKey: new Map(pairs.map((p) => [pairKey(p.cust, p.sku), p])),
      customers,
      customerByCode: new Map(customers.map((c) => [c.cust, c])),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
