import { describe, expect, it } from 'vitest';
import type { PairProposal } from './proposal.ts';
import { acceptedShareBp, simulatePassThrough } from './simulation.ts';

function pair(
  p: Partial<PairProposal> &
    Pick<
      PairProposal,
      'cust' | 'sku' | 'currentPrice' | 'newPrice' | 'qty' | 'costCurrentSen' | 'costNewSen'
    >,
): PairProposal {
  const proposed = p.newPrice > p.currentPrice;
  return {
    category: 'DB',
    status: proposed ? 'proposed' : 'excluded',
    excludedReason: proposed ? null : 'special_price',
    basis: 'list_rate',
    lastBilledPrice: p.currentPrice,
    ongoingLeak: null,
    systemPrice: p.currentPrice,
    changeYen: p.newPrice - p.currentPrice,
    changeBp: 0,
    currentList: 0,
    newList: 0,
    ratePm: 720,
    marginCurrentBp: null,
    marginNoActionBp: null,
    marginNewBp: null,
    salesYen: p.currentPrice * p.qty,
    guardrails: [],
    ...p,
  };
}

const pairs = [
  // cost +10円 per unit, price +12円: more than passed on
  pair({
    cust: 'A',
    sku: 'X',
    currentPrice: 100,
    newPrice: 112,
    qty: 100,
    costCurrentSen: 8000,
    costNewSen: 9000,
  }),
  // cost +20円, price +10円, category KG
  pair({
    cust: 'A',
    sku: 'Y',
    category: 'KG',
    currentPrice: 200,
    newPrice: 210,
    qty: 50,
    costCurrentSen: 15000,
    costNewSen: 17000,
  }),
  // 特値, left out: cost +5円, no price change
  pair({
    cust: 'B',
    sku: 'X',
    currentPrice: 90,
    newPrice: 90,
    qty: 40,
    costCurrentSen: 8000,
    costNewSen: 8500,
  }),
];

describe('simulatePassThrough', () => {
  it('computes 転嫁率 and 回復粗利 with full acceptance', () => {
    const r = simulatePassThrough(pairs);
    // cost increase: 10×100 + 20×50 + 5×40 = 2,200円; increase asked: 12×100 + 10×50 = 1,700円
    expect(r.total).toMatchObject({
      pairs: 3,
      proposedPairs: 2,
      costIncreaseYen: 2200,
      requestedIncreaseYen: 1700,
      expectedIncreaseYen: 1700,
      passThroughRequestedBp: 7727,
      passThroughExpectedBp: 7727,
      recoveredGrossProfitYen: 1700,
    });
    // gross profit before: (100−80)×100 + (200−150)×50 + (90−80)×40 = 4,900; no action: 4,900 − 2,200 = 2,700
    expect(r.total.grossProfitBeforeYen).toBe(4900);
    expect(r.total.grossProfitNoActionYen).toBe(2700);
    expect(r.total.grossProfitRequestedYen).toBe(4400);
    expect(r.assumptions.length).toBeGreaterThan(0);
  });

  it('breaks the result down by customer and category', () => {
    const r = simulatePassThrough(pairs);
    expect(r.byCustomer.map((x) => [x.key, x.costIncreaseYen, x.requestedIncreaseYen])).toEqual([
      ['A', 2000, 1700],
      ['B', 200, 0],
    ]);
    expect(r.byCategory.map((x) => x.key)).toEqual(['DB', 'KG']);
    expect(r.byCustomer.find((x) => x.key === 'B')?.passThroughRequestedBp).toBe(0);
  });

  it('applies acceptance per customer', () => {
    const partial = simulatePassThrough(pairs, {
      acceptance: new Map([['A', { kind: 'partial' as const, excludedCategories: ['KG'] }]]),
    });
    expect(partial.total.expectedIncreaseYen).toBe(1200);
    const share = simulatePassThrough(pairs, { defaultAcceptance: { kind: 'share', shareBp: 5000 } });
    expect(share.total.expectedIncreaseYen).toBe(850);
    expect(share.total.passThroughExpectedBp).toBe(3864);
    const none = simulatePassThrough(pairs, { defaultAcceptance: { kind: 'none' } });
    expect(none.total.recoveredGrossProfitYen).toBe(0);
    expect(none.total.grossProfitExpectedYen).toBe(2700);
  });

  it('has no 転嫁率 when costs do not rise', () => {
    const r = simulatePassThrough([
      pair({
        cust: 'A',
        sku: 'X',
        currentPrice: 100,
        newPrice: 110,
        qty: 1,
        costCurrentSen: 8000,
        costNewSen: 8000,
      }),
    ]);
    expect(r.total.passThroughRequestedBp).toBeNull();
  });

  it('clamps acceptance shares', () => {
    expect(acceptedShareBp({ kind: 'share', shareBp: 15000 }, 'DB')).toBe(10000);
    expect(acceptedShareBp({ kind: 'share', shareBp: -1 }, 'DB')).toBe(0);
  });
});
