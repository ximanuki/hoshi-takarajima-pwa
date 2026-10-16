import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  formatJstWareki,
  isIsoDate,
  isoToUtcDate,
  jstDate,
  monthEnd,
  parseDateLoose,
  parseDateToUtc,
  parseTimestamp,
  toCompactDate,
  toJstTimestamp,
  toWareki,
  toWarekiFiscalYear,
  toWarekiMonth,
  toWarekiShort,
  trailingMonths,
} from './dates.ts';

describe('parseDateLoose', () => {
  it('reads 和暦 as printed by sales systems', () => {
    expect(parseDateLoose('R07/04/01')).toBe('2025-04-01');
    expect(parseDateLoose('R7.4.1')).toBe('2025-04-01');
    expect(parseDateLoose('Ｒ０７／０４／０１')).toBe('2025-04-01');
    expect(parseDateLoose('令和7年4月1日')).toBe('2025-04-01');
    expect(parseDateLoose('令和元年5月1日')).toBe('2019-05-01');
    expect(parseDateLoose('H31/04/30')).toBe('2019-04-30');
    expect(parseDateLoose('平成31年4月30日')).toBe('2019-04-30');
    expect(parseDateLoose('S60/01/15')).toBe('1985-01-15');
    expect(parseDateLoose('令8.12.1')).toBe('2026-12-01');
  });

  it('reads a 和暦 date outside its era the way systems around 改元 print it (same calendar day)', () => {
    // 改元に追いついていないシステムは 2019-05 以降も「H31」「H32」と出し、
    // 更新したシステムは 2019 年の日付をすべて「R01」で出し直すことがある。どちらも西暦は一意に決まる
    expect(parseDateLoose('H31/05/01')).toBe('2019-05-01');
    expect(parseDateLoose('H32/01/15')).toBe('2020-01-15');
    expect(parseDateLoose('R01/01/01')).toBe('2019-01-01');
    expect(parseDateLoose('R01/01/01')).toBe(parseDateLoose('H31/01/01'));
    expect(parseDateLoose('S64/01/07')).toBe('1989-01-07');
    expect(parseDateLoose('R00/05/01')).toBeNull();
  });

  it('reads 西暦', () => {
    expect(parseDateLoose('20250401')).toBe('2025-04-01');
    expect(parseDateLoose('2025/4/1')).toBe('2025-04-01');
    expect(parseDateLoose('2025-04-01')).toBe('2025-04-01');
    expect(parseDateLoose('2025年4月1日')).toBe('2025-04-01');
  });

  it('rejects dates that do not exist and junk', () => {
    expect(parseDateLoose('R07/02/29')).toBeNull();
    expect(parseDateLoose('R08/02/29')).toBeNull();
    expect(parseDateLoose('20240229')).toBe('2024-02-29');
    expect(parseDateLoose('20251301')).toBeNull();
    expect(parseDateLoose('X07/04/01')).toBeNull();
    expect(parseDateLoose('')).toBeNull();
    expect(parseDateLoose('明日')).toBeNull();
  });

  it('gives a UTC Date for a 和暦 string', () => {
    expect(parseDateToUtc('R07/04/01')?.toISOString()).toBe('2025-04-01T00:00:00.000Z');
    expect(parseDateToUtc('?')).toBeNull();
    expect(isoToUtcDate('2026-12-01').getUTCDate()).toBe(1);
  });
});

describe('和暦 formatting', () => {
  it('handles the era boundary and 元年', () => {
    expect(toWareki('2019-04-30')).toBe('平成31年4月30日');
    expect(toWareki('2019-05-01')).toBe('令和元年5月1日');
    expect(toWareki('2026-12-01')).toBe('令和8年12月1日');
    expect(toWareki('1989-01-07')).toBe('昭和64年1月7日');
    expect(toWarekiShort('2026-12-01')).toBe('R08/12/01');
    expect(toWarekiMonth('2026-09')).toBe('令和8年9月');
    expect(toWarekiFiscalYear(2026)).toBe('令和8年度');
    expect(toWarekiFiscalYear(2019)).toBe('令和元年度');
    expect(toCompactDate('2026-12-01')).toBe('20261201');
  });

  it('round-trips through the short form', () => {
    for (const d of ['2019-05-01', '2024-02-29', '2025-04-01', '2026-12-31']) {
      expect(parseDateLoose(toWarekiShort(d))).toBe(d);
      expect(parseDateLoose(toWareki(d))).toBe(d);
    }
  });
});

describe('calendar arithmetic', () => {
  it('adds days and months', () => {
    expect(addDays('2025-03-31', 1)).toBe('2025-04-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addMonths('2025-01-31', 1)).toBe('2025-02-28');
    expect(addMonths('2025-10-01', -11)).toBe('2024-11-01');
    expect(addMonths('2025-12-15', 1)).toBe('2026-01-15');
    expect(monthEnd('2026-02-10')).toBe('2026-02-28');
    expect(daysBetween('2025-04-01', '2026-04-01')).toBe(365);
    expect(isIsoDate('2025-02-29')).toBe(false);
  });

  it('builds the 直近12か月 window', () => {
    expect(trailingMonths('2026-09-30', 12)).toEqual({ start: '2025-10-01', end: '2026-09-30' });
    expect(trailingMonths('2026-09-17', 12)).toEqual({ start: '2025-10-01', end: '2026-09-30' });
  });
});

describe('timestamps', () => {
  it('requires an offset and shows 日本時間', () => {
    const t = parseTimestamp('2026-10-16T05:05:00Z');
    expect(t).not.toBeNull();
    expect(toJstTimestamp(t as number)).toBe('2026-10-16T14:05:00+09:00');
    expect(parseTimestamp('2026-10-16T14:05:00+09:00')).toBe(t);
    expect(parseTimestamp('2026-10-16T14:05:00')).toBeNull();
    expect(parseTimestamp('2026-02-30T00:00:00Z')).toBeNull();
    // An impossible offset is rejected instead of shifting the event by days
    expect(parseTimestamp('2026-10-16T14:05:00+99:99')).toBeNull();
    expect(parseTimestamp('2026-10-16T14:05:00+09:60')).toBeNull();
    expect(parseTimestamp('2026-10-16T14:05:00+14:30')).toBeNull();
    expect(parseTimestamp('2026-10-16T19:05:00+14:00')).toBe(parseTimestamp('2026-10-16T05:05:00Z'));
    expect(parseTimestamp('2026-10-15T17:05:00-12:00')).toBe(parseTimestamp('2026-10-16T05:05:00Z'));
    expect(parseTimestamp('2026-10-16T10:50:00+05:45')).toBe(parseTimestamp('2026-10-16T05:05:00Z'));
    expect(formatJstWareki(t as number)).toBe('令和8年10月16日 14:05');
    expect(jstDate(Date.UTC(2026, 9, 16, 16, 0))).toBe('2026-10-17');
  });
});
