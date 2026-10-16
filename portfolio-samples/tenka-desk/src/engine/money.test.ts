import { describe, expect, it } from 'vitest';
import {
  changeBp,
  divCeil,
  divFloor,
  divide,
  divRound,
  isBelowMarginFloor,
  marginBp,
  marginFloorPrice,
  pctToBp,
  priceAtRate,
  senToYen,
  shareBp,
  sum,
} from './money.ts';

describe('integer division', () => {
  it('floors, ceils and rounds positive and negative values', () => {
    expect(divFloor(7, 2)).toBe(3);
    expect(divFloor(-7, 2)).toBe(-4);
    expect(divFloor(7, -2)).toBe(-4);
    expect(divCeil(7, 2)).toBe(4);
    expect(divCeil(-7, 2)).toBe(-3);
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(-5, 2)).toBe(-3);
    expect(divRound(4, 3)).toBe(1);
    expect(divide(10, 4, 'floor')).toBe(2);
    expect(divide(10, 4, 'ceil')).toBe(3);
    expect(divide(10, 4, 'round')).toBe(3);
  });

  it('refuses division by zero and unsafe integers', () => {
    expect(() => divFloor(1, 0)).toThrow(RangeError);
    expect(() => divFloor(2 ** 60, 3)).toThrow(RangeError);
  });
});

describe('prices and rates', () => {
  it('単価 = 定価 × 掛率, 円未満切り捨て by default', () => {
    expect(priceAtRate(770, 720)).toBe(554); // 554.4
    expect(priceAtRate(770, 725)).toBe(558); // 558.25
    expect(priceAtRate(770, 725, 'ceil')).toBe(559);
    expect(priceAtRate(1000, 700, 'round')).toBe(700);
  });

  it('converts percentages to basis points without float drift', () => {
    expect(pctToBp(5.18)).toBe(518);
    expect(pctToBp(0.1 + 0.2)).toBe(30);
    // rounded on the digits typed, not on the binary float (1.005 × 100 = 100.4999…)
    expect(pctToBp(1.005)).toBe(101);
    expect(pctToBp(0.145)).toBe(15);
    expect(pctToBp(99.996)).toBe(10000);
    expect(pctToBp(-1.005)).toBe(-101);
    expect(pctToBp(20)).toBe(2000);
    expect(pctToBp(1e-7)).toBe(0);
    expect(() => pctToBp(Number.NaN)).toThrow();
  });

  it('change and share in basis points', () => {
    expect(changeBp(840, 770)).toBe(909); // +9.09%
    expect(changeBp(700, 770)).toBe(-909);
    expect(shareBp(1, 3)).toBe(3333);
    expect(shareBp(5, 0)).toBe(0);
    expect(() => changeBp(1, 0)).toThrow();
  });

  it('senToYen and sum', () => {
    expect(senToYen(12350)).toBe(124);
    expect(senToYen(12349)).toBe(123);
    expect(senToYen(12399, 'floor')).toBe(123);
    expect(sum([1, 2, 3])).toBe(6);
  });
});

describe('margin floor', () => {
  it('floor price is the smallest price with margin ≥ floor', () => {
    // cost 311.41円, floor 10%: 311.41 / 0.9 = 346.01 → 347円
    expect(marginFloorPrice(31141, 1000)).toBe(347);
    expect(isBelowMarginFloor(346, 31141, 1000)).toBe(true);
    expect(isBelowMarginFloor(347, 31141, 1000)).toBe(false);
  });

  it('agrees with the margin rate for many prices and costs', () => {
    for (let cost = 1; cost < 50000; cost += 997) {
      const fp = marginFloorPrice(cost, 1000);
      expect(isBelowMarginFloor(fp, cost, 1000)).toBe(false);
      expect(isBelowMarginFloor(fp - 1, cost, 1000)).toBe(true);
    }
  });

  it('margin rate in basis points', () => {
    expect(marginBp(1000, 60000)).toBe(4000);
    expect(marginBp(0, 100)).toBeNull();
    expect(() => marginFloorPrice(100, 10000)).toThrow();
  });
});
