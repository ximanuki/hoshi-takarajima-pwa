/**
 * Calendar helpers. Dates are ISO strings ("2025-04-01"); arithmetic goes through
 * UTC day numbers so the local time zone never matters.
 */

export function dayNum(iso: string): number {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function isoFromDay(n: number): string {
  const dt = new Date(n * 86400000);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + 1;
  const d = dt.getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function addDays(iso: string, n: number): string {
  return isoFromDay(dayNum(iso) + n);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(iso: string): number {
  return new Date(dayNum(iso) * 86400000).getUTCDay();
}

export function monthStart(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

export function monthEnd(y: number, m: number): string {
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return addDays(monthStart(nextY, nextM), -1);
}

/** Add months to the first day of a month. */
export function addMonths(iso: string, n: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${iso.slice(8, 10)}`;
}

/** Months [start, end] as {y, m}. */
export function monthsBetween(startIso: string, endIso: string): { y: number; m: number }[] {
  const out: { y: number; m: number }[] = [];
  let y = Number(startIso.slice(0, 4));
  let m = Number(startIso.slice(5, 7));
  const ey = Number(endIso.slice(0, 4));
  const em = Number(endIso.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push({ y, m });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * National holidays (incl. substitute holidays) plus the fictional company's
 * own closing days (年末年始 12/29-1/3, お盆 8/13-8/15), Oct 2024 - Jan 2027.
 */
const HOLIDAY_LIST = [
  // 2024
  '2024-10-14', '2024-11-04', '2024-11-23', '2024-12-29', '2024-12-30', '2024-12-31',
  // 2025
  '2025-01-01', '2025-01-02', '2025-01-03', '2025-01-13', '2025-02-11', '2025-02-24',
  '2025-03-20', '2025-04-29', '2025-05-05', '2025-05-06', '2025-07-21', '2025-08-11',
  '2025-08-13', '2025-08-14', '2025-08-15', '2025-09-15', '2025-09-23', '2025-10-13',
  '2025-11-03', '2025-11-24', '2025-12-29', '2025-12-30', '2025-12-31',
  // 2026
  '2026-01-01', '2026-01-02', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20',
  '2026-04-29', '2026-05-04', '2026-05-05', '2026-05-06', '2026-07-20', '2026-08-11',
  '2026-08-13', '2026-08-14', '2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12',
  '2026-11-03', '2026-11-23', '2026-12-29', '2026-12-30', '2026-12-31',
  // 2027
  '2027-01-01', '2027-01-11',
];
export const HOLIDAYS = new Set(HOLIDAY_LIST);

export function isBusinessDay(iso: string): boolean {
  const w = weekday(iso);
  return w !== 0 && w !== 6 && !HOLIDAYS.has(iso);
}

export function businessDays(y: number, m: number): string[] {
  const out: string[] = [];
  const end = monthEnd(y, m);
  for (let d = monthStart(y, m); d <= end; d = addDays(d, 1)) {
    if (isBusinessDay(d)) out.push(d);
  }
  return out;
}

/** n business days after iso. */
export function addBusinessDays(iso: string, n: number): string {
  let d = iso;
  let k = 0;
  while (k < n) {
    d = addDays(d, 1);
    if (isBusinessDay(d)) k++;
  }
  return d;
}

function era(iso: string): { mark: string; kanji: string; year: number } {
  const y = Number(iso.slice(0, 4));
  if (iso >= '2019-05-01') return { mark: 'R', kanji: '令和', year: y - 2018 };
  if (iso >= '1989-01-08') return { mark: 'H', kanji: '平成', year: y - 1988 };
  throw new Error(`date before 平成 not supported: ${iso}`);
}

/** "2025-04-01" -> "R07/04/01" (販売管理A の売上明細) */
export function warekiShort(iso: string): string {
  const e = era(iso);
  return `${e.mark}${String(e.year).padStart(2, '0')}/${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
}

/** "2025-04-01" -> "令和7年4月1日" (販売管理A の特値一覧) */
export function warekiLong(iso: string): string {
  const e = era(iso);
  const y = e.year === 1 ? '元' : String(e.year);
  return `${e.kanji}${y}年${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
}

/** "2025-04-01" -> "20250401" (販売管理B) */
export function compactDate(iso: string): string {
  return iso.replace(/-/g, '');
}
