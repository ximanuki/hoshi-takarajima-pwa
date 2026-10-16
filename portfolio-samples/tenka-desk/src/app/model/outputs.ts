/**
 * The new price master (書き出し) and the files the 反映チェック reads, shared by
 * both screens so they always use the same rows.
 */

import { useMemo } from 'react';
import {
  AGREEMENT_KIND_JA,
  buildPriceMaster,
  classifyAgreement,
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

export function readOutcomesFile(file: SourceFile): RevisionAgreement[] {
  const imp = importFile(file.name, file.bytes, { kinds: ['agreements'] });
  if (imp.data.kind !== 'agreements') throw new Error(`${file.name} は協議結果のファイルではありません`);
  return imp.data.result.records;
}

export interface MasterBuild {
  rows: PriceMasterRow[];
  outcomes: Map<string, NegotiationOutcome>;
  source: 'logs' | 'file';
  error: string | null;
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
      }
    }
    const rows = proposal?.ok ? buildPriceMaster(proposal.pairs, outcomes, { currentPrice }) : [];
    return { rows, outcomes, source, error, interpreted };
  }, [proposal, logs, source, outcomesFile, currentPrice]);
}

export function readPriceMasterFile(file: SourceFile): PriceMasterRow[] {
  const imp = importFile(file.name, file.bytes, { kinds: ['priceMaster'] });
  if (imp.data.kind !== 'priceMaster') throw new Error(`${file.name} は単価マスタのファイルではありません`);
  return imp.data.result.records;
}

export function readSalesFile(file: SourceFile): { lines: SalesLine[]; issues: number } {
  const imp = importFile(file.name, file.bytes, { kinds: ['sales'] });
  if (imp.data.kind !== 'sales') throw new Error(`${file.name} は売上明細のファイルではありません`);
  return { lines: imp.data.result.records, issues: imp.data.result.issues.length };
}
