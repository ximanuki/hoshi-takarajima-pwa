import { describe, expect, it } from 'vitest';
import {
  appendEvent,
  classifyAgreement,
  createLog,
  currentStatus,
  type RevisionAgreement,
  verifyLog,
} from '../../engine/index.ts';
import { acceptanceFromLogs, fillDemoOutcomes, outcomesFromLogs } from './negotiation.ts';

function row(
  cust: string,
  status: string,
  effective: string | null,
  excluded: string[] = [],
): RevisionAgreement {
  return {
    cust,
    status,
    kind: classifyAgreement(status),
    effective,
    excludedCategories: excluded,
    requestedOn: null,
    answeredOn: null,
    note: '',
  };
}

const NOW = Date.parse('2026-10-16T01:00:00Z'); // 10:00 JST

describe('fillDemoOutcomes', () => {
  const rows = [
    row('000001', '合意', '2026-12-01'),
    row('000002', '一部合意', '2026-12-01', ['KG']),
    row('000003', '見送り', null),
    row('000004', '協議中', null),
    row('000005', '合意(適用日変更)', '2027-01-01'),
    row('000006', '合意', '2026-12-01'),
  ];
  const withItems = new Set(['000001', '000002', '000003', '000004', '000005', '000007']);

  it('adds a letter and the answer for customers with items and an empty log', () => {
    const existing = appendEvent(createLog('000007'), {
      at: '2026-10-10T09:00:00+09:00',
      kind: 'note',
      author: '佐藤',
      summary: '事前に電話',
    });
    const r = fillDemoOutcomes(
      { '000007': existing },
      [...rows, row('000007', '合意', '2026-12-01')],
      withItems,
      NOW,
    );
    expect(r.filled).toBe(5);
    expect(r.skipped).toBe(1);
    expect(r.logs['000006']).toBeUndefined();
    expect(r.logs['000007']).toBe(existing);
    const statuses = Object.fromEntries(Object.entries(r.logs).map(([c, l]) => [c, currentStatus(l)]));
    expect(statuses).toMatchObject({
      '000001': '合意',
      '000002': '一部合意',
      '000003': '見送り',
      '000004': '協議中',
      '000005': '合意',
    });
    for (const l of Object.values(r.logs)) expect(verifyLog(l)).toEqual({ ok: true });
    const first = r.logs['000001']?.events[0];
    expect(first?.kind).toBe('letter_sent');
    expect(first?.at).toBe('2026-10-01T10:00:00+09:00');
    expect(r.logs['000001']?.events[1]?.at).toBe('2026-10-13T15:00:00+09:00');

    const acc = acceptanceFromLogs(r.logs);
    expect(acc.get('000001')).toEqual({ kind: 'full' });
    expect(acc.get('000002')).toEqual({ kind: 'partial', excludedCategories: ['KG'] });
    expect(acc.get('000003')).toEqual({ kind: 'none' });
    expect(acc.has('000004')).toBe(false);

    const outcomes = outcomesFromLogs(r.logs);
    expect([...outcomes.keys()].sort()).toEqual(['000001', '000002', '000005']);
    expect(outcomes.get('000005')?.effective).toBe('2027-01-01');
    expect(outcomes.get('000002')?.excludedCategories).toEqual(['KG']);
  });
});
