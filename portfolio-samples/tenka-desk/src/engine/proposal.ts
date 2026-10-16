/**
 * 値上げ案: new 定価 per product, then a new unit price per customer × product,
 * with guardrails.
 *
 * 1. 定価 per product (proposeListPrices), by one of:
 *    - keep_margin_rate:    raise 定価 by the cost increase rate (keeps the 粗利率)
 *    - pass_through_amount: raise 定価 so that the cost increase in 円 is passed on
 *                           at the buyers' quantity-weighted average 掛率 (keeps the 粗利額)
 *    - fixed_list:          use a given new 定価 table
 *    then round to the Japanese price grid (10/50/100円, optional ending).
 * 2. Unit price per customer × product (proposePairs): new 定価 × the customer's
 *    掛率, so every customer stays inside their 掛率ランク. Guardrails:
 *    - 値上げ率の上限: no customer's increase goes above the cap
 *    - 粗利率の下限: a price below the floor is raised to it when the cap and the
 *      rank range allow, otherwise flagged for a person to decide
 *    - 掛率ランク: a resulting price outside the rank range is flagged
 *    - 特値: excluded (negotiated one by one) or scaled with the 定価
 *    - 最小値上げ率: smaller increases are left out
 */

import { type Dataset, pairKey } from './dataset.ts';
import type { IsoDate } from './dates.ts';
import { changeBp, divCeil, divFloor, marginBp, marginFloorPrice, priceAtRate } from './money.ts';
import { roundPrice } from './rounding.ts';
import type { ScenarioResult } from './scenario.ts';
import { isSampleRemark } from './text.ts';
import type { NewListPrice, PriceRoundingRule, SalesLine } from './types.ts';

export type ProposalMethod = 'keep_margin_rate' | 'pass_through_amount' | 'fixed_list';

export const PROPOSAL_METHOD_JA: Record<ProposalMethod, string> = {
  keep_margin_rate: '粗利率を保つ（原価の上昇率で定価を改定）',
  pass_through_amount: '粗利額を保つ（原価の上昇額を定価に上乗せ）',
  fixed_list: '新定価表を使う',
};

export interface Guardrails {
  marginFloorBp: number;
  /** cap on the increase per customer × product (null = no cap) */
  maxIncreaseBp: number | null;
  /** increases below this are left out (0 = keep every increase) */
  minIncreaseBp: number;
  listRounding: PriceRoundingRule;
  specials: 'exclude' | 'scale';
  /** raise prices below the margin floor up to it (within the cap and the rank range) */
  raiseToMarginFloor: boolean;
}

export function defaultGuardrails(ds: Dataset): Guardrails {
  return {
    marginFloorBp: ds.settings.marginFloorBp,
    maxIncreaseBp: 2000,
    minIncreaseBp: 0,
    listRounding: ds.settings.listRounding,
    specials: 'exclude',
    raiseToMarginFloor: true,
  };
}

export interface PairVolume {
  cust: string;
  sku: string;
  qty: number;
  salesYen: number;
  lines: number;
  lastDate: IsoDate;
  lastBilledPrice: number;
}

/**
 * Quantities bought per customer × product in a window (sales lines only:
 * no returns, free samples or non-product codes).
 */
export function collectPairVolumes(
  lines: readonly SalesLine[],
  window: { start: IsoDate; end: IsoDate },
): Map<string, PairVolume> {
  const out = new Map<string, PairVolume>();
  for (const l of lines) {
    if (l.sku === null || l.isReturn || l.qty <= 0) continue;
    if (l.unitPrice === 0 && isSampleRemark(l.remark)) continue;
    if (l.date < window.start || l.date > window.end) continue;
    const k = pairKey(l.cust, l.sku);
    const v = out.get(k);
    const amount = l.amount ?? l.unitPrice * l.qty;
    if (!v) {
      out.set(k, {
        cust: l.cust,
        sku: l.sku,
        qty: l.qty,
        salesYen: amount,
        lines: 1,
        lastDate: l.date,
        lastBilledPrice: l.unitPrice,
      });
    } else {
      v.qty += l.qty;
      v.salesYen += amount;
      v.lines++;
      if (l.date >= v.lastDate) {
        v.lastDate = l.date;
        v.lastBilledPrice = l.unitPrice;
      }
    }
  }
  return out;
}

export interface ProposalInput {
  method: ProposalMethod;
  /** required for keep_margin_rate / pass_through_amount; gives new costs for the margin checks in every method */
  scenario?: ScenarioResult;
  /** required for fixed_list */
  newListPrices?: readonly NewListPrice[];
  /** share of the cost increase to pass on (default 10000 = 100%) */
  passThroughBp?: number;
  /** 適用日 of the new prices */
  effectiveDate: IsoDate;
  /** day the current prices and costs are read (e.g. the last day of the sales data) */
  asOf: IsoDate;
  /** limit to these customers */
  customers?: readonly string[];
}

export interface ListProposal {
  sku: string;
  currentList: number;
  newList: number;
  /** 定価 before rounding, in 銭 */
  rawNewListSen: number;
  changeBp: number;
  costCurrentSen: number;
  costNewSen: number;
  /** quantity-weighted 掛率 of the buyers (pass_through_amount) */
  weightedRatePm: number | null;
  capped: boolean;
  method: ProposalMethod;
}

function scenarioCosts(ds: Dataset, input: ProposalInput, sku: string): { current: number; next: number } {
  const item = input.scenario?.items.get(sku);
  if (item) return { current: item.currentCostSen, next: item.newCostSen };
  const c = ds.costAt(sku, input.asOf) ?? 0;
  return { current: c, next: c };
}

/** New 定価 per product (products bought in the window, or all with a new 定価 in fixed_list). */
export function proposeListPrices(
  ds: Dataset,
  volumes: ReadonlyMap<string, PairVolume>,
  input: ProposalInput,
  guard: Guardrails,
): Map<string, ListProposal> {
  if (input.method !== 'fixed_list' && !input.scenario)
    throw new RangeError('この方法には原価シナリオが必要です');
  if (input.method === 'fixed_list' && !input.newListPrices) throw new RangeError('新定価表が必要です');
  const pt = input.passThroughBp ?? 10000;
  const fixed = new Map<string, number>();
  for (const n of input.newListPrices ?? []) {
    const sku = ds.resolveSku(n.sku);
    if (sku !== null) fixed.set(sku, n.newPrice);
  }
  const rateBySku = new Map<string, { qty: number; weighted: number }>();
  for (const v of volumes.values()) {
    const c = ds.customers.get(v.cust);
    if (!c) continue;
    const r = rateBySku.get(v.sku) ?? { qty: 0, weighted: 0 };
    r.qty += v.qty;
    r.weighted += v.qty * c.ratePm;
    rateBySku.set(v.sku, r);
  }
  let rateSum = 0;
  for (const c of ds.customers.values()) rateSum += c.ratePm;
  const meanRatePm = ds.customers.size > 0 ? Math.round(rateSum / ds.customers.size) : 1000;

  const skus = new Set<string>([...volumes.values()].map((v) => v.sku));
  const out = new Map<string, ListProposal>();
  for (const sku of [...skus].sort()) {
    const currentList = ds.listPriceAt(sku, input.asOf);
    if (currentList === null) continue;
    const cost = scenarioCosts(ds, input, sku);
    const deltaCost = cost.next - cost.current;
    let rawSen = currentList * 100;
    let weightedRatePm: number | null = null;
    if (input.method === 'fixed_list') {
      rawSen = (fixed.get(sku) ?? currentList) * 100;
    } else if (deltaCost > 0 && cost.current > 0) {
      if (input.method === 'keep_margin_rate') {
        const target = divCeil(currentList * 100 * cost.next, cost.current);
        rawSen = currentList * 100 + divCeil((target - currentList * 100) * pt, 10000);
      } else {
        const r = rateBySku.get(sku);
        weightedRatePm = r && r.qty > 0 ? Math.round(r.weighted / r.qty) : meanRatePm;
        rawSen = currentList * 100 + divCeil(deltaCost * 1000 * pt, weightedRatePm * 10000);
      }
    }
    let newList =
      input.method === 'fixed_list'
        ? rawSen / 100
        : rawSen > currentList * 100
          ? roundPrice(rawSen, guard.listRounding)
          : currentList;
    let capped = false;
    if (input.method !== 'fixed_list' && guard.maxIncreaseBp !== null) {
      const capSen = divFloor(currentList * (10000 + guard.maxIncreaseBp), 100);
      const capList = Math.max(currentList, roundPrice(capSen, { ...guard.listRounding, mode: 'floor' }));
      if (newList > capList) {
        newList = capList;
        capped = true;
      }
    }
    out.set(sku, {
      sku,
      currentList,
      newList,
      rawNewListSen: rawSen,
      changeBp: currentList > 0 ? changeBp(newList, currentList) : 0,
      costCurrentSen: cost.current,
      costNewSen: cost.next,
      weightedRatePm,
      capped,
      method: input.method,
    });
  }
  return out;
}

export type GuardrailRule =
  | 'max_increase_capped'
  | 'margin_floor_raised'
  | 'margin_floor_unmet'
  | 'tier_conflict';

export interface GuardrailHit {
  rule: GuardrailRule;
  message: string;
}

export type ExclusionReason =
  | 'special_price'
  | 'no_list_change'
  | 'no_increase'
  | 'below_min_increase'
  | 'no_price_basis';

export const EXCLUSION_REASON_JA: Record<ExclusionReason, string> = {
  special_price: '期間内の特値があるため個別に協議',
  no_list_change: '定価の改定なし',
  no_increase: '値上げにならない（現在の単価が新しい単価以上）',
  below_min_increase: '値上げ率が最小値上げ率より小さい',
  no_price_basis: '基準単価を決められない',
};

export interface PairProposal {
  cust: string;
  sku: string;
  category: string;
  status: 'proposed' | 'excluded';
  excludedReason: ExclusionReason | null;
  basis: 'list_rate' | 'special_scaled';
  /** correct unit price on asOf (特値 or 定価 × 掛率) */
  currentPrice: number;
  /** latest billed price in the window (what the sales system currently uses) */
  lastBilledPrice: number;
  newPrice: number;
  changeYen: number;
  changeBp: number;
  currentList: number;
  newList: number;
  ratePm: number;
  costCurrentSen: number;
  costNewSen: number;
  marginCurrentBp: number | null;
  /** margin with the new cost and the current price (何もしない場合) */
  marginNoActionBp: number | null;
  marginNewBp: number | null;
  qty: number;
  salesYen: number;
  guardrails: GuardrailHit[];
}

/** New unit price per customer × product bought in the window. Excluded pairs are kept (with newPrice = currentPrice). */
export function proposePairs(
  ds: Dataset,
  volumes: ReadonlyMap<string, PairVolume>,
  lists: ReadonlyMap<string, ListProposal>,
  input: ProposalInput,
  guard: Guardrails,
): PairProposal[] {
  const rounding = ds.settings.unitRounding;
  const scope = input.customers ? new Set(input.customers) : null;
  const out: PairProposal[] = [];
  const sortedVolumes = [...volumes.values()].sort((a, b) =>
    a.cust !== b.cust ? (a.cust < b.cust ? -1 : 1) : a.sku < b.sku ? -1 : 1,
  );
  for (const v of sortedVolumes) {
    if (scope && !scope.has(v.cust)) continue;
    const product = ds.products.get(v.sku);
    const customer = ds.customers.get(v.cust);
    const expected = ds.expectedPrice(v.cust, v.sku, input.asOf);
    if (!product || !customer || !expected) continue;
    const cost = scenarioCosts(ds, input, v.sku);
    const lp = lists.get(v.sku);
    const newList = lp?.newList ?? expected.list.row.price;
    const currentPrice = expected.price;
    const special = expected.special ?? ds.validSpecial(v.cust, v.sku, input.effectiveDate);
    const base: PairProposal = {
      cust: v.cust,
      sku: v.sku,
      category: product.category,
      status: 'excluded',
      excludedReason: null,
      basis: special ? 'special_scaled' : 'list_rate',
      currentPrice,
      lastBilledPrice: v.lastBilledPrice,
      newPrice: currentPrice,
      changeYen: 0,
      changeBp: 0,
      currentList: expected.list.price,
      newList,
      ratePm: customer.ratePm,
      costCurrentSen: cost.current,
      costNewSen: cost.next,
      marginCurrentBp: marginBp(currentPrice, cost.current),
      marginNoActionBp: marginBp(currentPrice, cost.next),
      marginNewBp: marginBp(currentPrice, cost.next),
      qty: v.qty,
      salesYen: v.salesYen,
      guardrails: [],
    };
    if (!lp || lp.newList <= lp.currentList) {
      out.push({ ...base, excludedReason: 'no_list_change' });
      continue;
    }
    if (special && guard.specials === 'exclude') {
      out.push({ ...base, excludedReason: 'special_price' });
      continue;
    }
    let newPrice = special
      ? Math.max(special.price, divFloor(special.price * newList, expected.list.price))
      : priceAtRate(newList, customer.ratePm, rounding);
    const hits: GuardrailHit[] = [];
    const tier = ds.tierOf(v.cust);
    const tierMax = tier ? priceAtRate(newList, tier.maxPm, rounding) : null;
    const tierMin = tier ? priceAtRate(newList, tier.minPm, rounding) : null;
    const capPrice =
      guard.maxIncreaseBp !== null ? divFloor(currentPrice * (10000 + guard.maxIncreaseBp), 10000) : null;
    if (capPrice !== null && newPrice > capPrice) {
      newPrice = Math.max(currentPrice, capPrice);
      hits.push({ rule: 'max_increase_capped', message: `値上げ率の上限で ${capPrice}円 に抑えました` });
    }
    if (
      cost.next > 0 &&
      marginBp(newPrice, cost.next) !== null &&
      (marginBp(newPrice, cost.next) ?? 0) < guard.marginFloorBp
    ) {
      const target = marginFloorPrice(cost.next, guard.marginFloorBp);
      const withinCap = capPrice === null || target <= capPrice;
      const withinTier = special !== null || tierMax === null || target <= tierMax;
      if (guard.raiseToMarginFloor && withinCap && withinTier) {
        newPrice = Math.max(newPrice, target);
        hits.push({
          rule: 'margin_floor_raised',
          message: `粗利率の下限を満たす ${target}円 に引き上げました`,
        });
      } else {
        const why = !withinCap ? '値上げ率の上限' : !withinTier ? '掛率ランクの上限' : '設定';
        hits.push({
          rule: 'margin_floor_unmet',
          message: `${why}のため、粗利率の下限（${target}円 以上）に届きません。個別に判断してください`,
        });
      }
    }
    if (
      special === null &&
      tierMin !== null &&
      tierMax !== null &&
      (newPrice < tierMin || newPrice > tierMax)
    ) {
      hits.push({
        rule: 'tier_conflict',
        message: `新しい単価が掛率ランクの範囲（${tierMin}〜${tierMax}円）の外です`,
      });
    }
    const changeYen = newPrice - currentPrice;
    const cb = currentPrice > 0 ? changeBp(newPrice, currentPrice) : 0;
    if (changeYen <= 0) {
      out.push({ ...base, excludedReason: 'no_increase', guardrails: hits });
      continue;
    }
    if (cb < guard.minIncreaseBp) {
      out.push({ ...base, excludedReason: 'below_min_increase', guardrails: hits });
      continue;
    }
    out.push({
      ...base,
      status: 'proposed',
      newPrice,
      changeYen,
      changeBp: cb,
      marginNewBp: marginBp(newPrice, cost.next),
      guardrails: hits,
    });
  }
  return out;
}
