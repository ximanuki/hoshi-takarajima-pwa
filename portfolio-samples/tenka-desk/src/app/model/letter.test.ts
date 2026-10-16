import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type PairProposal,
  parseIndexDataset,
  parseMinimumWage,
  parseShunto,
  type StatsBundle,
} from '../../engine/index.ts';
import { fixtureDataset, fixtureInput } from '../../engine/testing/fixtures.ts';
import { allowedTopics, letterEvidence, passThroughOf, scenarioCauses } from './letter.ts';
import { DEFAULT_LETTER, DEFAULT_SCENARIO } from './settings.ts';

const STATS = join(import.meta.dirname, '..', '..', '..', 'public', 'stats');
const json = (name: string): unknown => JSON.parse(readFileSync(join(STATS, name), 'utf8'));
const stats: StatsBundle = {
  cgpi: parseIndexDataset(json('cgpi.json')),
  sppi: parseIndexDataset(json('sppi.json')),
  minimumWage: parseMinimumWage(json('minimum-wage.json')),
  shunto: parseShunto(json('shunto.json')),
};

const ds = fixtureDataset();
const company = fixtureInput().company;
if (!company) throw new Error('fixture');

function pair(cust: string, sku: string, current: number, next: number, qty: number): PairProposal {
  return {
    cust,
    sku,
    category: sku.slice(0, 2),
    status: 'proposed',
    excludedReason: null,
    basis: 'list_rate',
    currentPrice: current,
    lastBilledPrice: current,
    ongoingLeak: null,
    systemPrice: current,
    newPrice: next,
    changeYen: next - current,
    changeBp: 0,
    currentList: 0,
    newList: 0,
    ratePm: 720,
    costCurrentSen: 30000,
    costNewSen: 32000,
    marginCurrentBp: null,
    marginNoActionBp: null,
    marginNewBp: null,
    qty,
    salesYen: current * qty,
    guardrails: [],
  };
}

const pairs = [pair('000001', 'DB-1001', 554, 612, 100), pair('000001', 'KG-1001', 792, 864, 10)];

describe('reasons and evidence for the letter', () => {
  it('names only the cost components the scenario raises', () => {
    expect(scenarioCauses(DEFAULT_SCENARIO, true)).toEqual(['material', 'purchase', 'energy', 'labor']);
    const noLabour = { ...DEFAULT_SCENARIO, shock: { material: 8, labor: 0, energy: 0, other: 0 } };
    expect(scenarioCauses(noLabour, false)).toEqual(['material']);
    expect(scenarioCauses({ ...noLabour, categoryShocks: { KG: { labor: 3 } } }, false)).toEqual([
      'material',
      'labor',
    ]);
    expect([...allowedTopics(['material'])].sort()).toEqual(['general', 'material']);
  });

  it('attaches only evidence matching the reasons, and only statistics that rose', () => {
    const ev = letterEvidence(
      stats,
      ds,
      '000001',
      pairs,
      company,
      DEFAULT_LETTER,
      ['material'],
      '2026-10-16',
    );
    expect(new Set(ev.items.map((e) => e.topic))).toEqual(new Set(['material', 'general']));
    expect(ev.items.every((e) => e.trend === 'up')).toBe(true);
  });

  it('never quotes the customer’s prefecture; quotes the sender’s when it is set', () => {
    const customerPref = ds.customers.get('000001')?.prefecture ?? '';
    expect(customerPref).toBe('大阪府');
    const all = ['material', 'energy', 'labor'] as const;
    const without = letterEvidence(stats, ds, '000001', pairs, company, DEFAULT_LETTER, all, '2026-10-16');
    const text = without.items.map((e) => `${e.statement}${e.figures.map((f) => f.label).join('')}`).join('');
    expect(text).not.toContain('大阪');
    const withSender = letterEvidence(
      stats,
      ds,
      '000001',
      pairs,
      { ...company, prefecture: '岩手県' },
      DEFAULT_LETTER,
      all,
      '2026-10-16',
    );
    const mw = withSender.items.find((e) => e.id === 'minimum-wage');
    expect(mw?.statement).toContain('弊社の事業所がある岩手県');
    expect(mw?.statement).not.toContain('大阪');
  });

  it('gives a customer’s 転嫁率 over the same items', () => {
    // requested (612−554)×100 + (864−792)×10 = 6,520円; cost up 20円 × 110 = 2,200円
    expect(passThroughOf(pairs, '000001')).toEqual({ requestedYen: 6520, costIncreaseYen: 2200, bp: 29636 });
    expect(passThroughOf(pairs, '000009').bp).toBeNull();
  });
});
