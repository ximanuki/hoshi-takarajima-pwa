/**
 * Integer arithmetic for money and rates.
 *
 * Every amount in the engine is an integer: 円 for prices and amounts, 銭 (1/100 円)
 * for unit costs, 0.1% (permille) for 掛率 and 0.01% (basis points) for growth
 * rates and shares. Division always goes through these helpers, so each result
 * is decided by an explicit rounding rule, never by floating-point accident.
 */

export type Rounding = 'floor' | 'ceil' | 'round';

function assertSafe(n: number, what: string): void {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} is not a safe integer: ${n}`);
}

/** ⌊a / b⌋ for integers (b ≠ 0), also for negative values. */
export function divFloor(a: number, b: number): number {
  assertSafe(a, 'numerator');
  assertSafe(b, 'denominator');
  if (b === 0) throw new RangeError('division by zero');
  const q = Math.trunc(a / b);
  const r = a - q * b;
  return r !== 0 && (r < 0) !== (b < 0) ? q - 1 : q;
}

/** ⌈a / b⌉ for integers (b ≠ 0). */
export function divCeil(a: number, b: number): number {
  return -divFloor(-a, b);
}

/** a / b rounded half away from zero (四捨五入). */
export function divRound(a: number, b: number): number {
  if (b < 0) return divRound(-a, -b);
  if (a < 0) return -divRound(-a, b);
  return divFloor(2 * a + b, 2 * b);
}

export function divide(a: number, b: number, mode: Rounding): number {
  if (mode === 'floor') return divFloor(a, b);
  if (mode === 'ceil') return divCeil(a, b);
  return divRound(a, b);
}

/** 単価 = 定価 × 掛率 (permille), rounded to 円 with the given rule. */
export function priceAtRate(listYen: number, ratePm: number, mode: Rounding = 'floor'): number {
  return divide(listYen * ratePm, 1000, mode);
}

/** Percentage as basis points: 5.18 -> 518. Rounds to the nearest 0.01%. */
export function pctToBp(pct: number): number {
  if (!Number.isFinite(pct)) throw new RangeError(`not a percentage: ${pct}`);
  return Math.round(pct * 100);
}

/** (a − b) / b in basis points, rounded half away from zero. b must be > 0. */
export function changeBp(after: number, before: number): number {
  if (before <= 0) throw new RangeError('base must be positive');
  return divRound((after - before) * 10000, before);
}

/** Share a / b in basis points (b > 0). */
export function shareBp(a: number, b: number): number {
  if (b === 0) return 0;
  return divRound(a * 10000, b);
}

/**
 * Smallest 円 price whose gross margin rate is at least floorBp,
 * given a unit cost in 銭: price × (1 − f) ≥ cost.
 */
export function marginFloorPrice(costSen: number, floorBp: number): number {
  if (floorBp >= 10000) throw new RangeError('margin floor must be below 100%');
  return divCeil(costSen * 100, 10000 - floorBp);
}

/** Gross margin rate below the floor: price × (1 − f) < cost. */
export function isBelowMarginFloor(priceYen: number, costSen: number, floorBp: number): boolean {
  return priceYen * (10000 - floorBp) < costSen * 100;
}

/** Gross margin rate (price − cost) / price in basis points; null when the price is 0. */
export function marginBp(priceYen: number, costSen: number): number | null {
  if (priceYen === 0) return null;
  return divRound((priceYen * 100 - costSen) * 100, priceYen);
}

/** 銭 amount to 円, rounded with the given rule. */
export function senToYen(sen: number, mode: Rounding = 'round'): number {
  return divide(sen, 100, mode);
}

/** Sum that refuses to leave the safe integer range. */
export function sum(values: Iterable<number>): number {
  let s = 0;
  for (const v of values) {
    s += v;
    if (!Number.isSafeInteger(s)) throw new RangeError('sum overflow');
  }
  return s;
}
