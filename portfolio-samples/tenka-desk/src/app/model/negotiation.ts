/**
 * Helpers around the engine's 協議記録 (append-only, hash-chained log):
 * the expected acceptance for the simulation, outcomes for the price master,
 * and the demo entries made from the fictional sample outcomes file.
 */

import {
  type Acceptance,
  acceptedShareBp,
  appendEvent,
  createLog,
  currentStatus,
  currentTerms,
  type NegotiationEventDraft,
  type NegotiationLog,
  type NegotiationOutcome,
  type NegotiationStatus,
  outcomeFromLog,
  type PairProposal,
  type RevisionAgreement,
  toJstTimestamp,
} from '../../engine/index.ts';

export type Logs = Readonly<Record<string, NegotiationLog>>;

export function logOf(logs: Logs, cust: string): NegotiationLog {
  return logs[cust] ?? createLog(cust);
}

export function statusOf(logs: Logs, cust: string): NegotiationStatus {
  const log = logs[cust];
  return log ? currentStatus(log) : '申入れ前';
}

/** Acceptance per customer from the answers recorded so far (合意 / 一部合意 / 見送り). */
export function acceptanceFromLogs(logs: Logs): Map<string, Acceptance> {
  const out = new Map<string, Acceptance>();
  for (const [cust, log] of Object.entries(logs)) {
    const s = currentStatus(log);
    if (s === '見送り') out.set(cust, { kind: 'none' });
    else if (s === '合意' || s === '一部合意') {
      const t = currentTerms(log);
      out.set(
        cust,
        t && t.excludedCategories.length > 0
          ? { kind: 'partial', excludedCategories: [...t.excludedCategories] }
          : { kind: 'full' },
      );
    }
  }
  return out;
}

/**
 * Yearly increase agreed so far (年間, at the last 12 months' quantities): the
 * requested increase of customers at 合意, and of 一部合意 without the kept categories.
 */
export function agreedIncreaseYen(logs: Logs, pairs: readonly PairProposal[]): number {
  const acc = acceptanceFromLogs(logs);
  let sum = 0;
  for (const p of pairs) {
    if (p.status !== 'proposed') continue;
    const a = acc.get(p.cust);
    if (a && (a.kind === 'full' || a.kind === 'partial') && acceptedShareBp(a, p.category) === 10000)
      sum += p.changeYen * p.qty;
  }
  return sum;
}

/** Outcomes of every customer whose current status is 合意 or 一部合意. */
export function outcomesFromLogs(logs: Logs): Map<string, NegotiationOutcome> {
  const out = new Map<string, NegotiationOutcome>();
  for (const log of Object.values(logs)) {
    const o = outcomeFromLog(log);
    if (o) out.set(o.cust, o);
  }
  return out;
}

export interface DemoFillResult {
  logs: Record<string, NegotiationLog>;
  filled: number;
  skipped: number;
}

const DAY = 86400000;

/** Midnight-based JST timestamp `daysAgo` days before `now`, at `hour`:00. */
function jstAt(now: number, daysAgo: number, hour: number): string {
  const date = toJstTimestamp(now - daysAgo * DAY).slice(0, 10);
  return `${date}T${String(hour).padStart(2, '0')}:00:00+09:00`;
}

/**
 * Entries made from the fictional outcomes file (協議結果) for the demo:
 * 申入書送付 two weeks ago, then the answer three days ago. Only customers whose
 * log is still empty and who have proposed items are filled.
 */
export function fillDemoOutcomes(
  logs: Logs,
  rows: readonly RevisionAgreement[],
  customersWithItems: ReadonlySet<string>,
  now: number,
): DemoFillResult {
  const next: Record<string, NegotiationLog> = { ...logs };
  let filled = 0;
  let skipped = 0;
  const sent = jstAt(now, 15, 10);
  const answered = jstAt(now, 3, 15);
  const note = 'サンプルの協議結果（架空）から作成したデモ用の記録です。';
  for (const r of rows) {
    if (!customersWithItems.has(r.cust)) continue;
    const existing = logs[r.cust];
    if (existing && existing.events.length > 0) {
      skipped++;
      continue;
    }
    let log = createLog(r.cust);
    log = appendEvent(log, {
      at: sent,
      kind: 'letter_sent',
      author: 'デモ',
      summary: '価格改定のお願い（申入書）を送付',
      detail: note,
      status: '申入れ済',
    });
    const answer: NegotiationEventDraft | null = (() => {
      const base = { at: answered, kind: 'customer_reply' as const, author: 'デモ', detail: note };
      switch (r.kind) {
        case 'agreed':
        case 'agreed_later_date':
          return r.effective
            ? {
                ...base,
                summary: r.kind === 'agreed_later_date' ? '適用日を変更して合意' : '申入れどおり合意',
                status: '合意' as const,
                terms: { effective: r.effective, excludedCategories: [], itemPrices: [] },
              }
            : null;
        case 'partial':
          return r.effective
            ? {
                ...base,
                summary: `一部合意${r.note ? `（${r.note}）` : ''}`,
                status: '一部合意' as const,
                terms: {
                  effective: r.effective,
                  excludedCategories: [...r.excludedCategories],
                  itemPrices: [],
                },
              }
            : null;
        case 'declined':
          return {
            ...base,
            summary: `今回は見送り${r.note ? `（${r.note}）` : ''}`,
            status: '見送り' as const,
          };
        case 'negotiating':
          return { ...base, summary: `協議中${r.note ? `（${r.note}）` : ''}`, status: '協議中' as const };
        default:
          return null;
      }
    })();
    if (answer) log = appendEvent(log, answer);
    next[r.cust] = log;
    filled++;
  }
  return { logs: next, filled, skipped };
}
