/**
 * 協議記録: an append-only, timestamped log of the price negotiation with one
 * customer, and the status derived from it
 * (申入れ前 → 申入れ済 → 協議中 → 合意 / 一部合意 / 見送り).
 *
 * Entries are never edited or removed. A mistake is fixed by appending a
 * correction that points at the earlier entry. Each entry stores the SHA-256 of
 * the previous one, so verifyLog() detects an entry that was changed, removed or
 * reordered after the fact. Timestamps come from the caller (the engine has no
 * clock) and must carry a time zone offset; they are shown in 日本時間.
 */

import { toCsv } from './csv.ts';
import { formatJstWareki, type IsoDate, isIsoDate, parseTimestamp, toWareki } from './dates.ts';
import { sha256Hex } from './hash.ts';

export const NEGOTIATION_STATUSES = ['申入れ前', '申入れ済', '協議中', '合意', '一部合意', '見送り'] as const;
export type NegotiationStatus = (typeof NEGOTIATION_STATUSES)[number];

const TRANSITIONS: Record<NegotiationStatus, readonly NegotiationStatus[]> = {
  申入れ前: ['申入れ済'],
  申入れ済: ['協議中', '合意', '一部合意', '見送り'],
  協議中: ['合意', '一部合意', '見送り'],
  合意: ['協議中'],
  一部合意: ['協議中'],
  見送り: ['協議中'],
};

export function allowedNextStatuses(s: NegotiationStatus): readonly NegotiationStatus[] {
  return TRANSITIONS[s];
}

export type NegotiationEventKind =
  | 'letter_sent'
  | 'meeting'
  | 'call'
  | 'email'
  | 'customer_reply'
  | 'note'
  | 'status'
  | 'correction';

export const EVENT_KIND_JA: Record<NegotiationEventKind, string> = {
  letter_sent: '申入書送付',
  meeting: '面談',
  call: '電話',
  email: 'メール',
  customer_reply: '先方回答',
  note: 'メモ',
  status: '状況変更',
  correction: '訂正',
};

/** What was agreed (合意 / 一部合意). */
export interface AgreementTerms {
  effective: IsoDate;
  /** categories kept at the current price */
  excludedCategories: string[];
  /** unit prices agreed per product that differ from the proposal */
  itemPrices: { sku: string; price: number }[];
}

export interface NegotiationEventDraft {
  /** ISO 8601 with offset, e.g. "2026-10-20T15:30:00+09:00" */
  at: string;
  kind: NegotiationEventKind;
  author: string;
  summary: string;
  detail?: string;
  /** 先方の出席者・担当者 */
  counterpart?: string;
  /** new status, when this entry changes it */
  status?: NegotiationStatus;
  terms?: AgreementTerms;
  /** id of the entry a correction refers to */
  corrects?: string;
}

export interface NegotiationEvent extends NegotiationEventDraft {
  seq: number;
  id: string;
  cust: string;
  prevHash: string;
  hash: string;
}

export interface NegotiationLog {
  cust: string;
  events: readonly NegotiationEvent[];
}

export class NegotiationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NegotiationError';
  }
}

const GENESIS = '0'.repeat(64);

export function createLog(cust: string): NegotiationLog {
  return { cust, events: [] };
}

/** Canonical text of an entry (fixed key order, no hash) for hashing. */
function canonical(e: Omit<NegotiationEvent, 'hash'>): string {
  const t = e.terms;
  return JSON.stringify([
    e.seq,
    e.id,
    e.cust,
    e.at,
    e.kind,
    e.author,
    e.summary,
    e.detail ?? null,
    e.counterpart ?? null,
    e.status ?? null,
    t ? [t.effective, [...t.excludedCategories], t.itemPrices.map((x) => [x.sku, x.price])] : null,
    e.corrects ?? null,
    e.prevHash,
  ]);
}

function hashOf(e: Omit<NegotiationEvent, 'hash'>): string {
  return sha256Hex(canonical(e));
}

export function currentStatus(log: NegotiationLog): NegotiationStatus {
  let s: NegotiationStatus = '申入れ前';
  for (const e of log.events) if (e.status) s = e.status;
  return s;
}

/** Terms of the latest 合意 / 一部合意 that is still the current status. */
export function currentTerms(log: NegotiationLog): AgreementTerms | null {
  const s = currentStatus(log);
  if (s !== '合意' && s !== '一部合意') return null;
  for (let i = log.events.length - 1; i >= 0; i--) {
    const e = log.events[i];
    if (e?.status && e.terms) return e.terms;
    if (e?.status) return null;
  }
  return null;
}

function validateTerms(t: AgreementTerms, status: NegotiationStatus): void {
  if (!isIsoDate(t.effective)) throw new NegotiationError(`適用日が日付ではありません: ${t.effective}`);
  for (const p of t.itemPrices) {
    if (!Number.isSafeInteger(p.price) || p.price <= 0)
      throw new NegotiationError(`合意単価が正しくありません: ${p.sku}`);
  }
  if (status === '一部合意' && t.excludedCategories.length === 0 && t.itemPrices.length === 0) {
    throw new NegotiationError('一部合意には、据え置くカテゴリか品目ごとの合意単価が必要です');
  }
}

/**
 * Append an entry and return the new log (the given log is not modified).
 * Rules: timestamps with an offset and not earlier than the previous entry;
 * status changes follow the allowed transitions (a correction may set any
 * status); 合意 / 一部合意 need the agreed terms.
 */
export function appendEvent(log: NegotiationLog, draft: NegotiationEventDraft): NegotiationLog {
  const at = parseTimestamp(draft.at);
  if (at === null) throw new NegotiationError(`日時は時差つきの ISO 8601 で指定してください: ${draft.at}`);
  const last = log.events[log.events.length - 1];
  if (last) {
    const lastAt = parseTimestamp(last.at) ?? 0;
    if (at < lastAt) throw new NegotiationError('記録は時刻順に追加してください（前の記録より前の日時です）');
  }
  if (draft.summary.trim() === '') throw new NegotiationError('内容（要旨）を入力してください');
  if (draft.author.trim() === '') throw new NegotiationError('記録者を入力してください');
  if (draft.kind === 'correction') {
    if (!draft.corrects || !log.events.some((e) => e.id === draft.corrects))
      throw new NegotiationError('訂正する記録を指定してください');
  } else if (draft.corrects !== undefined) {
    throw new NegotiationError('訂正以外の記録には corrects を指定できません');
  }
  if (draft.status) {
    const from = currentStatus(log);
    if (draft.kind !== 'correction' && !TRANSITIONS[from].includes(draft.status)) {
      throw new NegotiationError(`「${from}」から「${draft.status}」には進めません`);
    }
    if (draft.status === '合意' || draft.status === '一部合意') {
      if (!draft.terms) throw new NegotiationError('合意内容（適用日など）を入力してください');
      validateTerms(draft.terms, draft.status);
    } else if (draft.terms) {
      throw new NegotiationError('合意内容は合意・一部合意のときだけ記録できます');
    }
  } else if (draft.terms) {
    throw new NegotiationError('合意内容は状況の変更と一緒に記録してください');
  }
  const seq = log.events.length + 1;
  const body: Omit<NegotiationEvent, 'hash'> = {
    ...draft,
    seq,
    id: `${log.cust}-${String(seq).padStart(4, '0')}`,
    cust: log.cust,
    prevHash: last ? last.hash : GENESIS,
  };
  if (draft.terms) {
    body.terms = {
      effective: draft.terms.effective,
      excludedCategories: [...draft.terms.excludedCategories],
      itemPrices: draft.terms.itemPrices.map((x) => ({ ...x })),
    };
  }
  const event = Object.freeze({ ...body, hash: hashOf(body) }) as NegotiationEvent;
  return { cust: log.cust, events: Object.freeze([...log.events, event]) };
}

export type VerifyResult = { ok: true } | { ok: false; seq: number; reason: string };

/** Check the chain: sequence numbers, links, hashes and time order. */
export function verifyLog(log: NegotiationLog): VerifyResult {
  let prev = GENESIS;
  let prevAt = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < log.events.length; i++) {
    const e = log.events[i] as NegotiationEvent;
    if (e.seq !== i + 1)
      return { ok: false, seq: i + 1, reason: '記録の番号が連続していません（削除または並べ替えの可能性）' };
    if (e.cust !== log.cust) return { ok: false, seq: e.seq, reason: '別の得意先の記録が混ざっています' };
    if (e.prevHash !== prev)
      return {
        ok: false,
        seq: e.seq,
        reason: '前の記録とのつながりが切れています（削除または変更の可能性）',
      };
    const { hash, ...rest } = e;
    if (hashOf(rest) !== hash) return { ok: false, seq: e.seq, reason: '記録の内容が後から変更されています' };
    const at = parseTimestamp(e.at);
    if (at === null || at < prevAt) return { ok: false, seq: e.seq, reason: '日時の順序が正しくありません' };
    prev = hash;
    prevAt = at;
  }
  return { ok: true };
}

/** JSON for saving (e.g. to a file the user keeps). */
export function serializeLog(log: NegotiationLog): string {
  return JSON.stringify(log);
}

/** Read a saved log back; throws when the chain does not verify. */
export function parseLog(json: string): NegotiationLog {
  const raw = JSON.parse(json) as unknown;
  if (typeof raw !== 'object' || raw === null) throw new NegotiationError('協議記録の形式が正しくありません');
  const o = raw as { cust?: unknown; events?: unknown };
  if (typeof o.cust !== 'string' || !Array.isArray(o.events))
    throw new NegotiationError('協議記録の形式が正しくありません');
  const log: NegotiationLog = { cust: o.cust, events: o.events as NegotiationEvent[] };
  const v = verifyLog(log);
  if (!v.ok) throw new NegotiationError(`協議記録の${v.seq}件目: ${v.reason}`);
  return log;
}

export interface RecordRow {
  seq: number;
  when: string;
  kind: string;
  author: string;
  counterpart: string;
  summary: string;
  detail: string;
  statusChange: string;
  terms: string;
  corrects: string;
  hash: string;
}

/** Rows for the printable 協議記録 (日本時間・和暦). */
export function recordRows(log: NegotiationLog): RecordRow[] {
  let status: NegotiationStatus = '申入れ前';
  return log.events.map((e) => {
    let statusChange = '';
    if (e.status) {
      statusChange = `${status} → ${e.status}`;
      status = e.status;
    }
    const t = e.terms;
    const terms = t
      ? [
          `適用日 ${toWareki(t.effective)}`,
          t.excludedCategories.length ? `据え置き ${t.excludedCategories.join('・')}` : '',
          t.itemPrices.length ? `個別単価 ${t.itemPrices.length}品目` : '',
        ]
          .filter((x) => x !== '')
          .join('／')
      : '';
    return {
      seq: e.seq,
      when: formatJstWareki(parseTimestamp(e.at) ?? 0),
      kind: EVENT_KIND_JA[e.kind],
      author: e.author,
      counterpart: e.counterpart ?? '',
      summary: e.summary,
      detail: e.detail ?? '',
      statusChange,
      terms,
      corrects: e.corrects ?? '',
      hash: e.hash.slice(0, 12),
    };
  });
}

export function logToCsv(log: NegotiationLog): string {
  const rows = recordRows(log).map((r) => [
    r.seq,
    r.when,
    r.kind,
    r.author,
    r.counterpart,
    r.summary,
    r.detail,
    r.statusChange,
    r.terms,
    r.corrects,
    r.hash,
  ]);
  return toCsv(
    ['No', '日時', '種類', '記録者', '先方', '内容', '詳細', '状況', '合意内容', '訂正対象', '確認コード'],
    rows,
    {
      bom: true,
      eol: '\r\n',
      quoteAll: false,
    },
  );
}

/** Number of customers in each status. */
export function statusCounts(logs: readonly NegotiationLog[]): Record<NegotiationStatus, number> {
  const out = Object.fromEntries(NEGOTIATION_STATUSES.map((s) => [s, 0])) as Record<
    NegotiationStatus,
    number
  >;
  for (const l of logs) out[currentStatus(l)]++;
  return out;
}
