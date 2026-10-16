/**
 * Cost-shock scenario: how much each product's unit cost rises when 原材料,
 * 労務費, エネルギー and その他 costs rise by given percentages.
 *
 * Each product's cost is split by its cost structure (原価構成比, from the product
 * master or its category). The increase of a component is
 *   原単価 × 構成比 × 上昇率
 * rounded to the 銭, and the product's increase is the sum over components.
 * Optionally, a supplier's price notice (仕入先の値上げ通知) replaces the model for
 * that product: the cost then rises by the notified rate.
 */

import type { Dataset } from './dataset.ts';
import type { IsoDate } from './dates.ts';
import { changeBp, divRound, pctToBp } from './money.ts';
import type { CostShare, SupplierNotice } from './types.ts';

export type CostComponent = 'material' | 'labor' | 'energy' | 'other';

export const COST_COMPONENTS: readonly CostComponent[] = ['material', 'labor', 'energy', 'other'];

export const COST_COMPONENT_JA: Record<CostComponent, string> = {
  material: '原材料',
  labor: '労務費',
  energy: 'エネルギー',
  other: 'その他',
};

/** Percent increase per component (e.g. { material: 8, labor: 5, energy: 12, other: 0 }). */
export type CostShock = Record<CostComponent, number>;

export interface ScenarioInput {
  shock: CostShock;
  /** per category code, components that differ from the general shock */
  categoryShocks?: Record<string, Partial<CostShock>>;
  /** use suppliers' price notices where there is one (default: 'ignore') */
  supplierNotices?: 'ignore' | 'use';
  /** notice statuses to use (default: ['予定']) */
  noticeStatuses?: string[];
  /** the day of the current cost (現在の原単価) */
  asOf: IsoDate;
  /**
   * the proposal's 適用日: only notices in force by then count (default: every notice
   * after asOf). Without it a proposal could use an increase that has not started yet.
   */
  horizon?: IsoDate;
  /** limit to these products (default: all) */
  skus?: readonly string[];
}

export interface SkuCostImpact {
  sku: string;
  category: string;
  currentCostSen: number;
  newCostSen: number;
  deltaSen: number;
  changeBp: number;
  /** increase per component in 銭 (all zero when a notice was used) */
  byComponent: Record<CostComponent, number>;
  source: 'model' | 'notice';
  /** the latest notice in force by the horizon (null when the cost model was used) */
  notice: SupplierNotice | null;
  /** every notice in force by the horizon, oldest first */
  notices: SupplierNotice[];
  share: CostShare | null;
  /** component increases that applied (percent, as basis points) */
  appliedBp: Record<CostComponent, number>;
}

export interface ScenarioResult {
  input: ScenarioInput;
  items: Map<string, SkuCostImpact>;
}

const ZERO: Record<CostComponent, number> = { material: 0, labor: 0, energy: 0, other: 0 };

export function runScenario(ds: Dataset, input: ScenarioInput): ScenarioResult {
  const items = new Map<string, SkuCostImpact>();
  const statuses = input.noticeStatuses ?? ['予定'];
  // 適用日までに始まる通知だけを、日付の順に並べて使う（それより後の値上げはまだ起きていない）
  const notices = new Map<string, SupplierNotice[]>();
  if (input.supplierNotices === 'use') {
    for (const n of ds.supplierNotices) {
      if (!statuses.includes(n.status) || n.effective <= input.asOf) continue;
      if (input.horizon !== undefined && n.effective > input.horizon) continue;
      const sku = ds.resolveSku(n.sku);
      if (sku === null) continue;
      const list = notices.get(sku) ?? [];
      list.push(n);
      notices.set(sku, list);
    }
    for (const list of notices.values())
      list.sort((a, b) => (a.effective < b.effective ? -1 : a.effective > b.effective ? 1 : 0));
  }
  const skus = input.skus ?? [...ds.products.keys()];
  for (const sku of skus) {
    const p = ds.products.get(sku);
    if (!p) continue;
    const current = ds.costAt(sku, input.asOf) ?? p.costSen;
    const override = input.categoryShocks?.[p.category] ?? {};
    const appliedBp = { ...ZERO };
    for (const c of COST_COMPONENTS) appliedBp[c] = pctToBp(override[c] ?? input.shock[c]);
    const applied = notices.get(sku) ?? [];
    const first = applied[0];
    const notice = applied.at(-1) ?? null;
    const share = ds.costShareOf(sku);
    if (first && notice && first.currentCostSen > 0) {
      // Several notices: the cost by the horizon is the last notice's new cost, measured from
      // the first notice's starting cost. This is right whether the notices are chained
      // (A→B, then B→C) or each states today's cost (A→B, then A→C), and with one notice it
      // is that notice's own rate. The rate is applied to this company's current cost.
      const delta = divRound(current * (notice.newCostSen - first.currentCostSen), first.currentCostSen);
      items.set(sku, {
        sku,
        category: p.category,
        currentCostSen: current,
        newCostSen: current + delta,
        deltaSen: delta,
        changeBp: current > 0 ? changeBp(current + delta, current) : 0,
        byComponent: { ...ZERO },
        source: 'notice',
        notice,
        notices: applied,
        share,
        appliedBp,
      });
      continue;
    }
    const byComponent = { ...ZERO };
    if (share) {
      for (const c of COST_COMPONENTS)
        byComponent[c] = divRound(current * share[c] * appliedBp[c], 100 * 10000);
    }
    const delta = byComponent.material + byComponent.labor + byComponent.energy + byComponent.other;
    items.set(sku, {
      sku,
      category: p.category,
      currentCostSen: current,
      newCostSen: current + delta,
      deltaSen: delta,
      changeBp: current > 0 ? changeBp(current + delta, current) : 0,
      byComponent,
      source: 'model',
      notice: null,
      notices: [],
      share,
      appliedBp,
    });
  }
  return { input, items };
}
