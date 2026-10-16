/**
 * Dates as ISO strings ("2025-04-01"). Arithmetic goes through UTC day numbers,
 * so the user's time zone and locale never change a result.
 *
 * 和暦: parses the forms 販売管理 systems print ("R07/04/01", "R7.4.1",
 * "令和7年4月1日", "令和元年5月1日", "H31/04/30") and formats dates for letters
 * ("令和8年12月1日"). Timestamps for the 協議記録 are shown in 日本時間 (UTC+9,
 * Japan has no daylight saving time).
 */

export type IsoDate = string;

type Era = { kanji: string; mark: string; start: IsoDate; base: number };

/** Newest first. base = 西暦 of 元年 − 1. */
const ERAS: readonly Era[] = [
  { kanji: '令和', mark: 'R', start: '2019-05-01', base: 2018 },
  { kanji: '平成', mark: 'H', start: '1989-01-08', base: 1988 },
  { kanji: '昭和', mark: 'S', start: '1926-12-25', base: 1925 },
  { kanji: '大正', mark: 'T', start: '1912-07-30', base: 1911 },
  { kanji: '明治', mark: 'M', start: '1873-01-01', base: 1867 },
];

const ERA_BY_NAME = new Map<string, Era>();
for (const e of ERAS) {
  ERA_BY_NAME.set(e.kanji, e);
  ERA_BY_NAME.set(e.mark, e);
  ERA_BY_NAME.set(e.kanji[0] ?? '', e);
}

export function isValidYmd(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function isoDate(y: number, m: number, d: number): IsoDate {
  if (!isValidYmd(y, m, d)) throw new RangeError(`invalid date ${y}-${m}-${d}`);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m !== null && isValidYmd(Number(m[1]), Number(m[2]), Number(m[3]));
}

function ymdOrNull(y: number, m: number, d: number): IsoDate | null {
  return isValidYmd(y, m, d) ? isoDate(y, m, d) : null;
}

/**
 * Loose date parser. Returns null for blank input and for values that are not
 * a real calendar date. Accepts:
 *  - 和暦 "R07/04/01", "R7.4.1", "H31-04-30", "令和7年4月1日", "令和元年5月1日", "令7.4.1"
 *  - 西暦 "20250401", "2025/4/1", "2025-04-01", "2025.4.1", "2025年4月1日"
 */
export function parseDateLoose(raw: string): IsoDate | null {
  const s = raw.normalize('NFKC').replace(/\s/g, '');
  if (s === '') return null;
  let m =
    /^(令和|平成|昭和|大正|明治|[RHSTMrhstm令平昭大明])\.?(元|\d{1,2})[./-](\d{1,2})[./-](\d{1,2})$/.exec(s);
  if (!m) m = /^(令和|平成|昭和|大正|明治|[令平昭大明])(元|\d{1,2})年(\d{1,2})月(\d{1,2})日$/.exec(s);
  if (m) {
    const era = ERA_BY_NAME.get((m[1] ?? '').toUpperCase());
    if (!era) return null;
    const ey = m[2] === '元' ? 1 : Number(m[2]);
    return ymdOrNull(era.base + ey, Number(m[3]), Number(m[4]));
  }
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return ymdOrNull(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(s);
  if (m) return ymdOrNull(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(s);
  if (m) return ymdOrNull(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

/** 和暦 → Date at 00:00 UTC of that calendar day (null if unparseable). */
export function parseDateToUtc(raw: string): Date | null {
  const iso = parseDateLoose(raw);
  return iso === null ? null : isoToUtcDate(iso);
}

export function isoToUtcDate(iso: IsoDate): Date {
  return new Date(dayNumber(iso) * 86400000);
}

export function dayNumber(iso: IsoDate): number {
  return Math.round(
    Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000,
  );
}

export function fromDayNumber(n: number): IsoDate {
  const dt = new Date(n * 86400000);
  return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(iso: IsoDate, n: number): IsoDate {
  return fromDayNumber(dayNumber(iso) + n);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return dayNumber(to) - dayNumber(from);
}

export function monthStart(iso: IsoDate): IsoDate {
  return `${iso.slice(0, 7)}-01`;
}

export function monthEnd(iso: IsoDate): IsoDate {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return isoDate(y, m, daysInMonth(y, m));
}

/** Add calendar months; the day is clamped to the end of the target month. */
export function addMonths(iso: IsoDate, n: number): IsoDate {
  const y = Number(iso.slice(0, 4));
  const m0 = Number(iso.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m0 / 12);
  const mm = (((m0 % 12) + 12) % 12) + 1;
  const d = Math.min(Number(iso.slice(8, 10)), daysInMonth(yy, mm));
  return isoDate(yy, mm, d);
}

/** "2025-04" for a date. */
export function yearMonth(iso: IsoDate): string {
  return iso.slice(0, 7);
}

/** The window of the last `months` calendar months ending with the month of `asOf`. */
export function trailingMonths(asOf: IsoDate, months: number): { start: IsoDate; end: IsoDate } {
  return { start: addMonths(monthStart(asOf), -(months - 1)), end: monthEnd(asOf) };
}

function eraOf(iso: IsoDate): Era {
  for (const e of ERAS) if (iso >= e.start) return e;
  throw new RangeError(`date before 明治6年 is not supported: ${iso}`);
}

/** "2026-12-01" -> "令和8年12月1日"; 元年 for the first year. */
export function toWareki(iso: IsoDate): string {
  const e = eraOf(iso);
  const ey = Number(iso.slice(0, 4)) - e.base;
  return `${e.kanji}${ey === 1 ? '元' : ey}年${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
}

/** "2026-12-01" -> "R08/12/01" (販売管理A style). */
export function toWarekiShort(iso: IsoDate): string {
  const e = eraOf(iso);
  const ey = Number(iso.slice(0, 4)) - e.base;
  return `${e.mark}${String(ey).padStart(2, '0')}/${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
}

/** "2026-12" -> "令和8年12月". */
export function toWarekiMonth(ym: string): string {
  const full = toWareki(`${ym}-01`);
  return full.replace(/1日$/, '');
}

/** Fiscal year label: 2026 -> "令和8年度" (fiscal year starting in April). */
export function toWarekiFiscalYear(fy: number): string {
  return `${toWareki(isoDate(fy, 4, 1)).replace(/年.*$/, '')}年度`;
}

/** "2026-12-01" -> "20261201". */
export function toCompactDate(iso: IsoDate): string {
  return iso.replace(/-/g, '');
}

/* ---------- timestamps (協議記録) ---------- */

const JST_OFFSET_MIN = 9 * 60;

/**
 * Parse an ISO 8601 timestamp with an explicit offset ("2026-10-16T14:05:00+09:00"
 * or "...Z"). A timestamp without an offset is rejected: the engine never guesses
 * the time zone.
 */
export function parseTimestamp(ts: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(
    ts,
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '0', ms = '0', tz = 'Z'] = m;
  if (!isValidYmd(Number(y), Number(mo), Number(d))) return null;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  let offsetMin = 0;
  if (tz !== 'Z') {
    const sign = tz.startsWith('-') ? -1 : 1;
    offsetMin = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(4, 6)));
  }
  const utc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
    Number(ms.padEnd(3, '0')),
  );
  return utc - offsetMin * 60000;
}

/** Epoch milliseconds -> "2026-10-16T14:05:00+09:00". */
export function toJstTimestamp(epochMs: number): string {
  const dt = new Date(epochMs + JST_OFFSET_MIN * 60000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}T${p(dt.getUTCHours())}:${p(
    dt.getUTCMinutes(),
  )}:${p(dt.getUTCSeconds())}+09:00`;
}

/** Epoch milliseconds -> 日本時間の日付 "2026-10-16". */
export function jstDate(epochMs: number): IsoDate {
  return toJstTimestamp(epochMs).slice(0, 10);
}

/** Epoch milliseconds -> "令和8年10月16日 14:05". */
export function formatJstWareki(epochMs: number): string {
  const ts = toJstTimestamp(epochMs);
  return `${toWareki(ts.slice(0, 10))} ${ts.slice(11, 16)}`;
}
