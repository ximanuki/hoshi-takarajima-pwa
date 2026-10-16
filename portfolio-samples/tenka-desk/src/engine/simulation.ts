/**
 * 転嫁シミュレーション: with the quantities of the last 12 months, how much of
 * the cost increase the proposal passes on (転嫁率) and how much gross profit
 * it recovers (回復粗利).
 *
 * Definitions (quantities are those of the window and are assumed unchanged):
 *   コスト上昇額   = Σ 数量 × (新原単価 − 現原単価)
 *   値上げ額(依頼) = Σ 数量 × (提案単価 − 現単価)                 (proposed pairs)
 *   値上げ額(見込) = 値上げ額(依頼) × 受け入れの見込み              (per customer)
 *   転嫁率         = 値上げ額 ÷ コスト上昇額
 *   回復粗利       = 値上げ額 (粗利 after the cost increase with the new prices,
 *                    minus 粗利 after the cost increase with today's prices)
 * Pairs left out of the proposal (特値, no change) still count in the cost increase.
 */

import { divRound, shareBp } from './money.ts';
import type { PairProposal } from './proposal.ts';

export type Acceptance =
  | { kind: 'full' }
  | { kind: 'none' }
  /** accepted except these categories */
  | { kind: 'partial'; excludedCategories: string[] }
  /** a share of the requested increase (e.g. 7000 = 70%) */
  | { kind: 'share'; shareBp: number };

export interface SimulationOptions {
  /** per customer; others use defaultAcceptance */
  acceptance?: ReadonlyMap<string, Acceptance>;
  defaultAcceptance?: Acceptance;
}

export interface SimulationRow {
  key: string;
  pairs: number;
  proposedPairs: number;
  salesYen: number;
  costIncreaseYen: number;
  requestedIncreaseYen: number;
  expectedIncreaseYen: number;
  /** null when costs did not rise */
  passThroughRequestedBp: number | null;
  passThroughExpectedBp: number | null;
  grossProfitBeforeYen: number;
  grossProfitNoActionYen: number;
  grossProfitRequestedYen: number;
  grossProfitExpectedYen: number;
  /** = expectedIncreaseYen */
  recoveredGrossProfitYen: number;
}

export interface SimulationResult {
  total: SimulationRow;
  byCustomer: SimulationRow[];
  byCategory: SimulationRow[];
  assumptions: string[];
}

interface Acc {
  pairs: number;
  proposed: number;
  sales: number;
  costUpSen: number;
  requested: number;
  expectedSen: number;
  gpBeforeSen: number;
  gpNoActionSen: number;
}

function newAcc(): Acc {
  return { pairs: 0, proposed: 0, sales: 0, costUpSen: 0, requested: 0, expectedSen: 0, gpBeforeSen: 0, gpNoActionSen: 0 };
}

/** Accepted share of the requested increase for one pair, in basis points. */
export function acceptedShareBp(a: Acceptance, category: string): number {
  switch (a.kind) {
    case 'full':
      return 10000;
    case 'none':
      return 0;
    case 'partial':
      return a.excludedCategories.includes(category) ? 0 : 10000;
    case 'share':
      return Math.max(0, Math.min(10000, a.shareBp));
  }
}

function toRow(key: string, a: Acc): SimulationRow {
  const costUp = divRound(a.costUpSen, 100);
  const expected = divRound(a.expectedSen, 100);
  const gpBefore = divRound(a.gpBeforeSen, 100);
  const gpNoAction = divRound(a.gpNoActionSen, 100);
  return {
    key,
    pairs: a.pairs,
    proposedPairs: a.proposed,
    salesYen: a.sales,
    costIncreaseYen: costUp,
    requestedIncreaseYen: a.requested,
    expectedIncreaseYen: expected,
    passThroughRequestedBp: a.costUpSen > 0 ? shareBp(a.requested * 100, a.costUpSen) : null,
    passThroughExpectedBp: a.costUpSen > 0 ? shareBp(a.expectedSen, a.costUpSen) : null,
    grossProfitBeforeYen: gpBefore,
    grossProfitNoActionYen: gpNoAction,
    grossProfitRequestedYen: gpNoAction + a.requested,
    grossProfitExpectedYen: divRound(a.gpNoActionSen + a.expectedSen, 100),
    recoveredGrossProfitYen: expected,
  };
}

export function simulatePassThrough(pairs: readonly PairProposal[], options: SimulationOptions = {}): SimulationResult {
  const def = options.defaultAcceptance ?? { kind: 'full' };
  const total = newAcc();
  const byCust = new Map<string, Acc>();
  const byCat = new Map<string, Acc>();
  for (const p of pairs) {
    const acceptance = options.acceptance?.get(p.cust) ?? def;
    const requested = p.status === 'proposed' ? p.changeYen * p.qty : 0;
    const expectedSen = divRound(requested * 100 * acceptedShareBp(acceptance, p.category), 10000);
    const costUpSen = (p.costNewSen - p.costCurrentSen) * p.qty;
    const gpBeforeSen = (p.currentPrice * 100 - p.costCurrentSen) * p.qty;
    const gpNoActionSen = (p.currentPrice * 100 - p.costNewSen) * p.qty;
    for (const acc of [total, getOrNew(byCust, p.cust), getOrNew(byCat, p.category)]) {
      acc.pairs++;
      if (p.status === 'proposed') acc.proposed++;
      acc.sales += p.currentPrice * p.qty;
      acc.costUpSen += costUpSen;
      acc.requested += requested;
      acc.expectedSen += expectedSen;
      acc.gpBeforeSen += gpBeforeSen;
      acc.gpNoActionSen += gpNoActionSen;
    }
  }
  const assumptions = [
    '数量は直近12か月の実績と同じと仮定しています（値上げによる数量の変化は見込んでいません）。',
    '現単価は、特値または 定価 × 掛率 による正しい単価です（利益漏れの修正分は含みません）。',
    '特値などで提案から外した品目も、原価の上昇額には含めています。',
  ];
  return {
    total: toRow('合計', total),
    byCustomer: [...byCust.entries()].map(([k, a]) => toRow(k, a)).sort((a, b) => b.costIncreaseYen - a.costIncreaseYen || (a.key < b.key ? -1 : 1)),
    byCategory: [...byCat.entries()].map(([k, a]) => toRow(k, a)).sort((a, b) => (a.key < b.key ? -1 : 1)),
    assumptions,
  };
}

function getOrNew(m: Map<string, Acc>, k: string): Acc {
  let a = m.get(k);
  if (!a) {
    a = newAcc();
    m.set(k, a);
  }
  return a;
}
