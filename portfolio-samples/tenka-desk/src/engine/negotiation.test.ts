import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.ts';
import {
  allowedNextStatuses,
  appendEvent,
  createLog,
  currentStatus,
  currentTerms,
  logToCsv,
  NegotiationError,
  type NegotiationEvent,
  type NegotiationEventDraft,
  type NegotiationLog,
  parseLog,
  recordRows,
  serializeLog,
  statusCounts,
  verifyLog,
} from './negotiation.ts';

const DRAFTS: NegotiationEventDraft[] = [
  {
    at: '2026-10-16T10:00:00+09:00',
    kind: 'letter_sent',
    author: '佐藤',
    summary: '申入書を郵送',
    status: '申入れ済',
  },
  {
    at: '2026-10-28T15:30:00+09:00',
    kind: 'meeting',
    author: '佐藤',
    counterpart: '購買部 田中様',
    summary: '値上げ幅について協議',
    detail: '工具・金物は据え置きの希望あり',
    status: '協議中',
  },
  {
    at: '2026-11-10T09:00:00+09:00',
    kind: 'customer_reply',
    author: '佐藤',
    summary: '工具・金物以外で合意',
    status: '一部合意',
    terms: {
      effective: '2026-12-01',
      excludedCategories: ['KG'],
      itemPrices: [{ sku: 'DB-1001', price: 605 }],
    },
  },
];

function sampleLog(): NegotiationLog {
  return DRAFTS.reduce(appendEvent, createLog('000001'));
}

describe('appendEvent', () => {
  it('builds the status from the entries', () => {
    const log = sampleLog();
    expect(log.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(log.events[0]?.id).toBe('000001-0001');
    expect(currentStatus(log)).toBe('一部合意');
    expect(currentTerms(log)).toEqual({
      effective: '2026-12-01',
      excludedCategories: ['KG'],
      itemPrices: [{ sku: 'DB-1001', price: 605 }],
    });
    expect(currentStatus(createLog('x'))).toBe('申入れ前');
  });

  it('never changes the log it was given', () => {
    const log = sampleLog();
    const before = serializeLog(log);
    appendEvent(log, { at: '2026-11-11T09:00:00+09:00', kind: 'note', author: '佐藤', summary: 'メモ' });
    expect(serializeLog(log)).toBe(before);
    expect(Object.isFrozen(log.events)).toBe(true);
    expect(Object.isFrozen(log.events[0])).toBe(true);
  });

  it('enforces the status flow', () => {
    const log = createLog('000001');
    expect(() =>
      appendEvent(log, {
        at: '2026-10-16T10:00:00+09:00',
        kind: 'status',
        author: '佐藤',
        summary: 'x',
        status: '合意',
      }),
    ).toThrow(/「申入れ前」から「合意」には進めません/);
    expect(allowedNextStatuses('協議中')).toEqual(['合意', '一部合意', '見送り']);
    expect(allowedNextStatuses('見送り')).toEqual(['協議中']);
  });

  it('requires terms for an agreement and nowhere else', () => {
    let log = createLog('000001');
    log = appendEvent(log, {
      at: '2026-10-16T10:00:00+09:00',
      kind: 'letter_sent',
      author: '佐藤',
      summary: '送付',
      status: '申入れ済',
    });
    expect(() =>
      appendEvent(log, {
        at: '2026-10-17T10:00:00+09:00',
        kind: 'status',
        author: '佐藤',
        summary: '合意',
        status: '合意',
      }),
    ).toThrow(NegotiationError);
    expect(() =>
      appendEvent(log, {
        at: '2026-10-17T10:00:00+09:00',
        kind: 'status',
        author: '佐藤',
        summary: '一部合意',
        status: '一部合意',
        terms: { effective: '2026-12-01', excludedCategories: [], itemPrices: [] },
      }),
    ).toThrow(/据え置くカテゴリ/);
    expect(() =>
      appendEvent(log, {
        at: '2026-10-17T10:00:00+09:00',
        kind: 'note',
        author: '佐藤',
        summary: 'x',
        terms: { effective: '2026-12-01', excludedCategories: [], itemPrices: [] },
      }),
    ).toThrow(NegotiationError);
    expect(() =>
      appendEvent(log, {
        at: '2026-10-17T10:00:00+09:00',
        kind: 'status',
        author: '佐藤',
        summary: '合意',
        status: '合意',
        terms: { effective: '2026-13-01', excludedCategories: [], itemPrices: [] },
      }),
    ).toThrow(/適用日/);
  });

  it('requires time order, an offset, an author and a summary', () => {
    const log = sampleLog();
    expect(() =>
      appendEvent(log, { at: '2026-11-09T09:00:00+09:00', kind: 'note', author: '佐藤', summary: 'x' }),
    ).toThrow(/時刻順/);
    expect(() =>
      appendEvent(log, { at: '2026-11-11T09:00:00', kind: 'note', author: '佐藤', summary: 'x' }),
    ).toThrow(/時差/);
    expect(() =>
      appendEvent(log, { at: '2026-11-11T09:00:00Z', kind: 'note', author: ' ', summary: 'x' }),
    ).toThrow(/記録者/);
    expect(() =>
      appendEvent(log, { at: '2026-11-11T09:00:00Z', kind: 'note', author: '佐藤', summary: '' }),
    ).toThrow(/内容/);
  });

  it('fixes mistakes with a correction that points at the entry', () => {
    const log = sampleLog();
    expect(() =>
      appendEvent(log, { at: '2026-11-11T09:00:00+09:00', kind: 'correction', author: '佐藤', summary: 'x' }),
    ).toThrow(/訂正する記録/);
    expect(() =>
      appendEvent(log, {
        at: '2026-11-11T09:00:00+09:00',
        kind: 'note',
        author: '佐藤',
        summary: 'x',
        corrects: '000001-0001',
      }),
    ).toThrow();
    const fixed = appendEvent(log, {
      at: '2026-11-11T09:00:00+09:00',
      kind: 'correction',
      author: '佐藤',
      summary: '一部合意ではなく見送りだった',
      corrects: '000001-0003',
      status: '見送り',
    });
    expect(currentStatus(fixed)).toBe('見送り');
    expect(currentTerms(fixed)).toBeNull();
    expect(verifyLog(fixed)).toEqual({ ok: true });
  });
});

describe('verifyLog', () => {
  const log = sampleLog();

  it('accepts an untouched log and a saved copy', () => {
    expect(verifyLog(log)).toEqual({ ok: true });
    expect(parseLog(serializeLog(log))).toEqual(log);
  });

  it('detects an edited entry', () => {
    const events = log.events.map((e) => ({ ...e }));
    (events[1] as NegotiationEvent).summary = '書き換え';
    expect(verifyLog({ cust: log.cust, events })).toMatchObject({ ok: false, seq: 2 });
  });

  it('detects a removed or reordered entry', () => {
    expect(
      verifyLog({ cust: log.cust, events: [log.events[0], log.events[2]] as NegotiationEvent[] }),
    ).toMatchObject({ ok: false });
    const swapped = [log.events[1], log.events[0], log.events[2]] as NegotiationEvent[];
    expect(verifyLog({ cust: log.cust, events: swapped }).ok).toBe(false);
  });

  it('detects an edit even when the edited entry was hashed again', () => {
    const [first, second] = DRAFTS;
    if (!first || !second) throw new Error('fixture');
    const forged = [first, { ...second, summary: '合意済みと説明' }].reduce(appendEvent, createLog('000001'));
    const events = [...forged.events, log.events[2] as NegotiationEvent];
    expect(verifyLog({ cust: log.cust, events })).toMatchObject({ ok: false, seq: 3 });
  });

  it('refuses to load an edited or malformed file', () => {
    const json = serializeLog(log).replace('値上げ幅について協議', '合意済みと説明');
    expect(() => parseLog(json)).toThrow(/2件目/);
    expect(() => parseLog('{"x":1}')).toThrow(NegotiationError);
  });
});

describe('records for printing', () => {
  it('shows 日本時間・和暦 and the status changes', () => {
    const rows = recordRows(sampleLog());
    expect(rows[0]).toMatchObject({
      when: '令和8年10月16日 10:00',
      kind: '申入書送付',
      statusChange: '申入れ前 → 申入れ済',
    });
    expect(rows[1]).toMatchObject({ counterpart: '購買部 田中様', statusChange: '申入れ済 → 協議中' });
    expect(rows[2]?.terms).toBe('適用日 令和8年12月1日／据え置き KG／個別単価 1品目');
    expect(rows[2]?.hash).toHaveLength(12);
  });

  it('exports CSV with a BOM for Excel', () => {
    const csv = logToCsv(sampleLog());
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const rows = parseCsv(csv);
    expect(rows[0]?.[0]).toBe('No');
    expect(rows).toHaveLength(4);
  });

  it('counts customers by status', () => {
    const counts = statusCounts([sampleLog(), createLog('000002')]);
    expect(counts).toMatchObject({ 一部合意: 1, 申入れ前: 1, 合意: 0 });
  });
});
