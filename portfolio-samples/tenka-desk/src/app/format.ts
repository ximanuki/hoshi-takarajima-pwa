/**
 * Display helpers for the UI. Arithmetic stays in the engine; these only turn
 * integers into Japanese text (¥ with 3-digit commas, %, 和暦).
 */

import {
  formatBp,
  formatRatioPct,
  type IsoDate,
  jstDate,
  toJstTimestamp,
  toWareki,
  withCommas,
} from '../engine/index.ts';

const MINUS = '−';

/** 1234567 -> "¥1,234,567"; negative values keep a real minus sign. */
export function yen(n: number): string {
  return n < 0 ? `${MINUS}¥${withCommas(-n)}` : `¥${withCommas(n)}`;
}

/** Signed amount for changes: "+¥120" / "−¥40" / "¥0". */
export function yenDelta(n: number): string {
  return n > 0 ? `+¥${withCommas(n)}` : yen(n);
}

/** Plain integer with commas. */
export function num(n: number): string {
  return n < 0 ? `${MINUS}${withCommas(-n)}` : withCommas(n);
}

/** Rough size for headings: 4,598,211 -> "約460万円". */
export function manYen(n: number): string {
  const man = Math.round(Math.abs(n) / 10000);
  return `${n < 0 ? MINUS : ''}約${withCommas(man)}万円`;
}

/** Basis points as a percentage ("5.2%"); null -> "—". */
export function pct(bp: number | null, decimals: 0 | 1 | 2 = 1): string {
  return bp === null ? '—' : formatBp(bp, decimals).replace('-', MINUS);
}

/** Signed percentage for changes ("+5.2%"). */
export function pctDelta(bp: number | null, decimals: 0 | 1 | 2 = 1): string {
  if (bp === null) return '—';
  return bp > 0 ? `+${formatBp(bp, decimals)}` : pct(bp, decimals);
}

/** a / b as a percentage, rounded once. */
export function ratio(a: number, b: number, decimals: 0 | 1 | 2 = 1): string {
  return formatRatioPct(a, b, decimals).replace('-', MINUS);
}

export function wareki(iso: IsoDate | null | undefined): string {
  return iso ? toWareki(iso) : '—';
}

export function warekiRange(from: IsoDate, to: IsoDate): string {
  return `${toWareki(from)}〜${toWareki(to)}`;
}

/** Today in Japan (the app's business calendar). */
export function todayJst(): IsoDate {
  return jstDate(Date.now());
}

/** Now as "2026-10-16T14:05:00+09:00". */
export function nowJst(): string {
  return toJstTimestamp(Date.now());
}

/** First day of the month `months` after the month of `iso`. */
export function firstOfMonthAfter(iso: IsoDate, months: number): IsoDate {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + months;
  const yy = y + Math.floor(m / 12);
  const mm = (((m % 12) + 12) % 12) + 1;
  return `${yy}-${String(mm).padStart(2, '0')}-01`;
}

/** Encoding label for the file list. */
export function encodingLabel(encoding: string, bom: boolean): string {
  const name = encoding === 'shift_jis' ? 'Shift_JIS' : encoding.toUpperCase();
  return bom ? `${name}（BOM付き）` : name;
}
