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
  notice: SupplierNotice | null;
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
  const notices = new Map<string, SupplierNotice>();
  if (input.supplierNotices === 'use') {
    for (const n of ds.supplierNotices) {
      if (!statuses.includes(n.status) || n.effective <= input.asOf) continue;
      const sku = ds.resolveSku(n.sku);
      if (sku === null) continue;
      const prev = notices.get(sku);
      if (!prev || n.effective > prev.effective) notices.set(sku, n);
    }
  }
  const skus = input.skus ?? [...ds.products.keys()];
  for (const sku of skus) {
    const p = ds.products.get(sku);
    if (!p) continue;
    const current = ds.costAt(sku, input.asOf) ?? p.costSen;
    const override = input.categoryShocks?.[p.category] ?? {};
    const appliedBp = { ...ZERO };
    for (const c of COST_COMPONENTS) appliedBp[c] = pctToBp(override[c] ?? input.shock[c]);
    const notice = notices.get(sku) ?? null;
    const share = ds.costShareOf(sku);
    if (notice && notice.currentCostSen > 0) {
      const delta = divRound(current * (notice.newCostSen - notice.currentCostSen), notice.currentCostSen);
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
        share,
        appliedBp,
      });
      continue;
    }
    const byComponent = { ...ZERO };
    if (share) {
      for (const c of COST_COMPONENTS) byComponent[c] = divRound(current * share[c] * appliedBp[c], 100 * 10000);
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
      share,
      appliedBp,
    });
  }
  return { input, items };
}
