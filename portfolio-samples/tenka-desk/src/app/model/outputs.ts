/**
 * The new price master (書き出し) and the files the 反映チェック reads, shared by
 * both screens so they always use the same rows.
 */

import { useMemo } from 'react';
import {
  AGREEMENT_KIND_JA,
  buildPriceMaster,
  classifyAgreement,
  type FileImport,
  type ImportIssue,
  importFile,
  isPlainAgreementStatus,
  type NegotiationOutcome,
  outcomesFromAgreements,
  type PriceMasterRow,
  type RevisionAgreement,
  type SalesLine,
} from '../../engine/index.ts';
import { useApp } from './AppState.tsx';
import type { SourceFile } from './load.ts';
import { outcomesFromLogs } from './negotiation.ts';

/** "next/sales_A_202612.csv" -> "sales_A_202612.csv" (the folder is an internal detail). */
const baseName = (name: string) => name.replace(/^.*\//, '');

/** "3行目「適用日」：日付として読めません（2026-13-01）", as the 読み込み screen lists them. */
function describeIssues(imp: FileImport, issues: readonly ImportIssue[]): string[] {
  const label = (field: string) => {
    const i = imp.mapping[field] ?? -1;
    return (
      (i >= 0 ? imp.table.header[i] : undefined) ||
      (imp.spec.columns.find((c) => c.field === field)?.headers[0] ?? field)
    );
  };
  return issues.map(
    (i) =>
      `${i.row}行目${i.field && i.field !== '*' ? `「${label(i.field)}」` : ''}：${i.message}` +
      (i.value ? `（${i.value}）` : ''),
  );
}

/**
 * A file with rows that could not be read. The rows would otherwise be left out
 * without a word (a customer missing from the new price master, or a 反映チェック
 * that looks clean), so the whole file is refused until it is fixed.
 */
export class FileRowsError extends Error {
  readonly fileName: string;
  /** every row that could not be read, with the reason */
  readonly problems: string[];
  constructor(imp: FileImport) {
    const issues = imp.data.result.issues;
    const rows = new Set(issues.map((i) => i.row)).size;
    super(`${baseName(imp.name)} に読めない行が${rows}行あります。`);
    this.name = 'FileRowsError';
    this.fileName = imp.name;
    this.problems = describeIssues(imp, issues);
  }
}

/** The 協議結果 file; refused when any row cannot be read. */
export function readOutcomesFile(file: SourceFile): RevisionAgreement[] {
  const imp = importFile(file.name, file.bytes, { kinds: ['agreements'] });
  if (imp.data.kind !== 'agreements') throw new Error(`${file.name} は協議結果のファイルではありません`);
  if (imp.data.result.issues.length > 0) throw new FileRowsError(imp);
  return imp.data.result.records;
}

export interface MasterBuild {
  rows: PriceMasterRow[];
  outcomes: Map<string, NegotiationOutcome>;
  source: 'logs' | 'file';
  error: string | null;
  /** rows of the 協議結果 file that could not be read (nothing is exported until they are fixed) */
  problems: string[];
  /** 協議結果 wording that had to be interpreted ("得意先 001001「合意に至らず」→ 見送り") */
  interpreted: string[];
}

/** New price master rows from the current proposal and the agreed outcomes. */
export function usePriceMaster(): MasterBuild {
  const { proposal, logs, settings, outcomesFile } = useApp();
  const source = settings.exportOpts.outcomeSource;
  const currentPrice = settings.exportOpts.currentPrice;
  return useMemo(() => {
    let outcomes = new Map<string, NegotiationOutcome>();
    let error: string | null = null;
    let problems: string[] = [];
    const interpreted: string[] = [];
    if (source === 'logs') outcomes = outcomesFromLogs(logs);
    else if (outcomesFile) {
      try {
        const records = readOutcomesFile(outcomesFile);
        outcomes = outcomesFromAgreements(records);
        for (const r of records)
          if (!isPlainAgreementStatus(r.status))
            interpreted.push(
              `得意先 ${r.cust}「${r.status}」→ ${AGREEMENT_KIND_JA[classifyAgreement(r.status)]}`,
            );
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        if (e instanceof FileRowsError) problems = e.problems;
      }
    }
    const rows =
      proposal?.ok && error === null ? buildPriceMaster(proposal.pairs, outcomes, { currentPrice }) : [];
    return { rows, outcomes, source, error, problems, interpreted };
  }, [proposal, logs, source, outcomesFile, currentPrice]);
}

/** A new price master for the 反映チェック; refused when any row cannot be read. */
export function readPriceMasterFile(file: SourceFile): PriceMasterRow[] {
  const imp = importFile(file.name, file.bytes, { kinds: ['priceMaster'] });
  if (imp.data.kind !== 'priceMaster') throw new Error(`${file.name} は単価マスタのファイルではありません`);
  if (imp.data.result.issues.length > 0) throw new FileRowsError(imp);
  return imp.data.result.records;
}

export interface SalesRead {
  lines: SalesLine[];
  /** rows that could not be read and are not checked */
  skippedRows: number;
  /** the reasons for those rows ("3行目「伝票日付」：日付として読めません（20261299）") */
  problems: string[];
}

/** The sales after the switch. Rows that cannot be read are left out and listed. */
export function readSalesFile(file: SourceFile): SalesRead {
  const imp = importFile(file.name, file.bytes, { kinds: ['sales'] });
  if (imp.data.kind !== 'sales') throw new Error(`${file.name} は売上明細のファイルではありません`);
  const { records, issues } = imp.data.result;
  // notes on rows that were still read (e.g. a blank 標準価格) do not leave anything out
  const kept = new Set(records.map((l) => l.sourceRow));
  return {
    lines: records,
    skippedRows: imp.table.rows.length - records.length,
    problems: describeIssues(
      imp,
      issues.filter((i) => !kept.has(i.row)),
    ),
  };
}
