import { describe, expect, it } from 'vitest';
import { bandFor, roundPrice, roundYen, scaleSen } from './rounding.ts';
import { DEFAULT_SETTINGS, type PriceRoundingRule } from './types.ts';

const rule = DEFAULT_SETTINGS.listRounding;

describe('定価 rounding', () => {
  it('uses 10円 below 1,000円, 50円 below 10,000円, 100円 above (切り上げ)', () => {
    expect(roundPrice(83501, rule)).toBe(840);
    expect(roundPrice(84000, rule)).toBe(840);
    expect(roundPrice(99501, rule)).toBe(1000);
    expect(roundPrice(160001, rule)).toBe(1650);
    expect(roundPrice(1590000, rule)).toBe(15900);
    expect(roundPrice(1590001, rule)).toBe(16000);
    expect(roundYen(14501, rule)).toBe(14600);
  });

  it('floors and rounds to the nearest grid price', () => {
    const floor: PriceRoundingRule = { ...rule, mode: 'floor' };
    const round: PriceRoundingRule = { ...rule, mode: 'round' };
    expect(roundPrice(83900, floor)).toBe(830);
    expect(roundPrice(83400, round)).toBe(830);
    expect(roundPrice(83500, round)).toBe(840);
    expect(roundPrice(162400, round)).toBe(1600);
    expect(roundPrice(162500, round)).toBe(1650);
  });

  it('supports price endings', () => {
    const ending: PriceRoundingRule = { bands: [{ below: null, unit: 100 }], mode: 'ceil', ending: 80 };
    expect(roundPrice(123400, ending)).toBe(1280);
    expect(roundPrice(128000, ending)).toBe(1280);
    expect(roundPrice(128100, ending)).toBe(1380);
    expect(roundPrice(123400, { ...ending, mode: 'floor' })).toBe(1180);
    const nine: PriceRoundingRule = { bands: [{ below: null, unit: 1000 }], mode: 'ceil', ending: 980 };
    expect(roundYen(1200, nine)).toBe(1980);
    expect(() => roundYen(1200, { ...ending, ending: 100 })).toThrow(RangeError);
  });

  it('picks the band from the unrounded value', () => {
    expect(bandFor(99999, rule.bands).unit).toBe(10);
    expect(bandFor(100000, rule.bands).unit).toBe(50);
    expect(() => bandFor(1, [])).toThrow();
  });

  it('scales a price by a rate in 銭', () => {
    expect(scaleSen(770, 909)).toBe(84000); // 770 × 1.0909 = 839.993円 → 83,999.3銭 → 84,000銭
    expect(scaleSen(770, 900)).toBe(83930);
    expect(scaleSen(1000, 1000)).toBe(110000);
  });
});
