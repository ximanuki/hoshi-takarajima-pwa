/**
 * The user's settings (saved in this browser). Percentages are kept as the user
 * types them and turned into the engine's integer units (bp) in one place.
 */

import {
  type Company,
  type CostShock,
  type EffectiveBasis,
  type EvidenceTopic,
  type IsoDate,
  type ProposalMethod,
  pctToBp,
  type Rounding,
} from '../../engine/index.ts';

export interface ScenarioSettings {
  /** % increase per cost component */
  shock: CostShock;
  /** per category code: components that differ from the general shock (%) */
  categoryShocks: Record<string, Partial<CostShock>>;
  /** use suppliers' price notices (予定) where there is one */
  useNotices: boolean;
  method: ProposalMethod;
  /** share of the cost increase to pass on (%) */
  passThroughPct: number;
  /** 適用日; null = default (the demo's next revision, or the 1st of the month after next) */
  effectiveDate: IsoDate | null;
  /** expected acceptance for customers without an answer in the 協議記録 (%) */
  acceptancePct: number;
}

export interface GuardSettings {
  capEnabled: boolean;
  maxIncreasePct: number;
  minIncreasePct: number;
  /** null = the data's setting (粗利率の下限 used by the diagnosis) */
  marginFloorPct: number | null;
  raiseToMarginFloor: boolean;
  specials: 'exclude' | 'scale';
  /** 定価 rounding units: below 1,000円 / below 10,000円 / otherwise */
  units: [number, number, number];
  mode: Rounding;
  /** price ending within the unit (e.g. 80 for …80円); null = none */
  ending: number | null;
}

export interface LetterSettings {
  /** null = today */
  issueDate: IsoDate | null;
  basis: EffectiveBasis;
  /** reply by this many days after the issue date (null = no reply date) */
  replyDays: number | null;
  documentPrefix: string;
  topics: Record<EvidenceTopic, boolean>;
}

export interface ExportSettings {
  outcomeSource: 'logs' | 'file';
  currentPrice: 'system' | 'expected' | 'last_billed';
  encoding: 'utf-8' | 'shift_jis';
}

export interface AppSettings {
  version: 1;
  scenario: ScenarioSettings;
  guard: GuardSettings;
  letter: LetterSettings;
  exportOpts: ExportSettings;
  /** manual unit prices per customer × product (pairKey -> 円) */
  overrides: Record<string, number>;
  /** company profile for letters (null = from company.json, else blank) */
  company: Company | null;
  /** 改定日 per agreements file name */
  revisionDates: Record<string, IsoDate>;
  /** 粗利率の下限 for the diagnosis (%); null = from the data's settings (or 10%) */
  diagnosisFloorPct: number | null;
}

export const DEFAULT_SCENARIO: ScenarioSettings = {
  shock: { material: 8, labor: 5, energy: 10, other: 0 },
  categoryShocks: {},
  useNotices: true,
  method: 'pass_through_amount',
  passThroughPct: 100,
  effectiveDate: null,
  acceptancePct: 100,
};

export const DEFAULT_GUARD: GuardSettings = {
  capEnabled: true,
  maxIncreasePct: 20,
  minIncreasePct: 0,
  marginFloorPct: null,
  raiseToMarginFloor: true,
  specials: 'exclude',
  units: [10, 50, 100],
  mode: 'ceil',
  ending: null,
};

export const DEFAULT_LETTER: LetterSettings = {
  issueDate: null,
  basis: '出荷分',
  replyDays: 21,
  documentPrefix: '',
  topics: { material: true, energy: true, logistics: true, labor: true, general: true },
};

export const DEFAULT_EXPORT: ExportSettings = {
  outcomeSource: 'logs',
  currentPrice: 'system',
  encoding: 'utf-8',
};

export function defaultSettings(): AppSettings {
  return {
    version: 1,
    scenario: structuredClone(DEFAULT_SCENARIO),
    guard: structuredClone(DEFAULT_GUARD),
    letter: structuredClone(DEFAULT_LETTER),
    exportOpts: { ...DEFAULT_EXPORT },
    overrides: {},
    company: null,
    revisionDates: {},
    diagnosisFloorPct: null,
  };
}

/** Saved settings merged over the defaults (keys added in later versions get their default). */
export function restoreSettings(saved: unknown): AppSettings {
  const d = defaultSettings();
  if (typeof saved !== 'object' || saved === null) return d;
  const s = saved as Partial<AppSettings>;
  return {
    version: 1,
    scenario: { ...d.scenario, ...s.scenario, shock: { ...d.scenario.shock, ...s.scenario?.shock } },
    guard: { ...d.guard, ...s.guard },
    letter: { ...d.letter, ...s.letter, topics: { ...d.letter.topics, ...s.letter?.topics } },
    exportOpts: { ...d.exportOpts, ...s.exportOpts },
    overrides: { ...s.overrides },
    company: s.company ?? null,
    revisionDates: { ...s.revisionDates },
    diagnosisFloorPct: typeof s.diagnosisFloorPct === 'number' ? s.diagnosisFloorPct : null,
  };
}

export const toBp = (pct: number): number => pctToBp(pct);
