/**
 * What goes into a customer's letter besides the engine's text: the reasons it
 * names (from the user's cost scenario, not from the statistics), the evidence
 * that matches those reasons, and the checks shown before printing.
 */

import {
  buildEvidence,
  type COST_COMPONENTS,
  type Company,
  type Dataset,
  divRound,
  type EvidenceItem,
  type EvidenceTopic,
  type IsoDate,
  type LetterCause,
  type PairProposal,
  type StatsBundle,
  seriesForCategory,
  shareBp,
} from '../../engine/index.ts';
import type { LetterSettings, ScenarioSettings } from './settings.ts';

export const LETTER_CAUSES: readonly LetterCause[] = [
  'material',
  'purchase',
  'energy',
  'logistics',
  'labor',
  'other',
];

/** Evidence topics that back each reason. */
const CAUSE_TOPICS: Record<LetterCause, EvidenceTopic[]> = {
  material: ['material'],
  purchase: ['material'],
  energy: ['energy'],
  logistics: ['logistics'],
  labor: ['labor'],
  other: [],
};

/**
 * Reasons the cost scenario supports: the components set above 0% (in general or
 * for a category), and 仕入価格 when suppliers' price notices are used.
 */
export function scenarioCauses(sc: ScenarioSettings, hasNotices: boolean): LetterCause[] {
  const up = (c: (typeof COST_COMPONENTS)[number]) =>
    sc.shock[c] > 0 || Object.values(sc.categoryShocks).some((x) => (x[c] ?? 0) > 0);
  const out: LetterCause[] = [];
  if (up('material')) out.push('material');
  if (sc.useNotices && hasNotices) out.push('purchase');
  if (up('energy')) out.push('energy');
  if (up('labor')) out.push('labor');
  if (up('other')) out.push('other');
  return out;
}

/** Topics the chosen reasons allow (物価全般 always). */
export function allowedTopics(causes: readonly LetterCause[]): Set<EvidenceTopic> {
  const out = new Set<EvidenceTopic>(['general']);
  for (const c of causes) for (const t of CAUSE_TOPICS[c]) out.add(t);
  return out;
}

export interface LetterEvidence {
  /** items put into the letter */
  items: EvidenceItem[];
  /** items left out because the statistic fell or stayed flat */
  notRising: EvidenceItem[];
}

/**
 * Evidence for one customer's letter. The minimum wage quoted is the sender's
 * prefecture (where its staff work), never the customer's; without one, no
 * prefecture is quoted. Statistics that fell or stayed flat are left out.
 */
export function letterEvidence(
  stats: StatsBundle,
  ds: Dataset,
  cust: string,
  pairs: readonly PairProposal[],
  company: Company,
  ls: LetterSettings,
  causes: readonly LetterCause[],
  issueDate: IsoDate,
): LetterEvidence {
  const cats = new Set(
    pairs.filter((p) => p.cust === cust && p.status === 'proposed').map((p) => p.category),
  );
  const materialSeries: string[] = [];
  if (stats.cgpi) {
    for (const code of cats) {
      const cat = ds.categories.get(code);
      if (cat)
        for (const s of seriesForCategory(cat, stats.cgpi))
          if (!materialSeries.includes(s)) materialSeries.push(s);
    }
  }
  const allowed = allowedTopics(causes);
  const include: Record<EvidenceTopic, boolean> = {
    material: ls.topics.material && allowed.has('material'),
    energy: ls.topics.energy && allowed.has('energy'),
    logistics: ls.topics.logistics && allowed.has('logistics'),
    labor: ls.topics.labor && allowed.has('labor'),
    general: ls.topics.general,
  };
  const prefecture = company.prefecture?.trim();
  const all = buildEvidence(stats, {
    asOf: issueDate,
    materialSeries,
    include,
    ...(prefecture ? { prefecture } : {}),
  });
  return { items: all.filter((e) => e.trend === 'up'), notRising: all.filter((e) => e.trend !== 'up') };
}

/** 転嫁率 of one customer's request: requested increase ÷ cost increase of the same items (bp; null without a cost increase). */
export function passThroughOf(
  pairs: readonly PairProposal[],
  cust: string,
): {
  requestedYen: number;
  costIncreaseYen: number;
  bp: number | null;
} {
  let requested = 0;
  let costUpSen = 0;
  for (const p of pairs) {
    if (p.cust !== cust || p.status !== 'proposed') continue;
    requested += p.changeYen * p.qty;
    costUpSen += (p.costNewSen - p.costCurrentSen) * p.qty;
  }
  return {
    requestedYen: requested,
    costIncreaseYen: divRound(costUpSen, 100),
    bp: costUpSen > 0 ? shareBp(requested * 100, costUpSen) : null,
  };
}
