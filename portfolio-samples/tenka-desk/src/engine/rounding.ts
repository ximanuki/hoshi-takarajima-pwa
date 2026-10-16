/**
 * Japanese price rounding for 定価: round to 10円 / 50円 / 100円 depending on the
 * price band, optionally to a fixed ending ("〜80円", "〜980円").
 */

import { divCeil, divFloor } from './money.ts';
import type { PriceRoundingRule, RoundingBand } from './types.ts';

/** The rounding unit (円) for a value in 銭. */
export function bandFor(valueSen: number, bands: readonly RoundingBand[]): RoundingBand {
  for (const b of bands) if (b.below === null || valueSen < b.below * 100) return b;
  const last = bands[bands.length - 1];
  if (!last) throw new RangeError('no rounding bands');
  return last;
}

/**
 * Round a price given in 銭 to a 円 price on the rule's grid: multiples of the
 * band's unit, plus `ending` if set (0 ≤ ending < unit). 'round' picks the
 * nearest grid price, the higher one on a tie.
 */
export function roundPrice(valueSen: number, rule: PriceRoundingRule): number {
  const band = bandFor(valueSen, rule.bands);
  const unitSen = band.unit * 100;
  const ending = rule.ending ?? 0;
  if (ending < 0 || ending >= band.unit)
    throw new RangeError(`ending ${ending} must be between 0 and ${band.unit - 1}`);
  const endSen = ending * 100;
  const lowK = divFloor(valueSen - endSen, unitSen);
  const low = lowK * unitSen + endSen;
  const high = low === valueSen ? low : low + unitSen;
  let resultSen: number;
  if (rule.mode === 'floor') resultSen = low;
  else if (rule.mode === 'ceil') resultSen = high;
  else resultSen = valueSen - low < high - valueSen ? low : high;
  return resultSen / 100;
}

/** Round a 円 price (integer) to the grid. */
export function roundYen(valueYen: number, rule: PriceRoundingRule): number {
  return roundPrice(valueYen * 100, rule);
}

/** A price × (1 + bp) in 銭, rounded up to the 銭. */
export function scaleSen(priceYen: number, bp: number): number {
  return divCeil(priceYen * (10000 + bp), 100);
}
