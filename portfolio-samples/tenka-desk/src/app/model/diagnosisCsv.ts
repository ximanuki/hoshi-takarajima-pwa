/** The 診断 screen's CSV of findings (one row per customer × product × leak type). */

import { type DiagnosisResult, LEAK_LABEL_JA, toCompactDate, toCsv } from '../../engine/index.ts';
import { isAgreementDependent } from './load.ts';

export const PROVISIONAL_NOTE = '仮：合意状況のファイルを使っていないため、多めに出ている可能性があります';

/**
 * `provisional`: the agreements file is loaded but not used (no 改定日), so the rows
 * measured against the 基準単価 (反映漏れ・特値の期限切れ・掛率ランク外, see
 * AGREEMENT_DEPENDENT_TYPES) can be too high; they get a 仮 note and the file name
 * ends with _仮.
 */
export function diagnosisCsv(
  d: DiagnosisResult,
  opts: { provisional: boolean },
): { name: string; text: string } {
  const rows = d.findings.map((f) => [
    f.id,
    LEAK_LABEL_JA[f.type],
    f.cust,
    f.custName,
    f.sku,
    f.itemName,
    f.firstDate,
    f.lastDate,
    f.ongoing ? '続いている' : '解消済み',
    f.lines,
    f.linesInWindow,
    f.annualImpactYen,
    f.shortfallTotalYen,
    f.explanation.join(' '),
    opts.provisional && isAgreementDependent(f.type) ? PROVISIONAL_NOTE : '',
  ]);
  const text = toCsv(
    [
      'ID',
      '種類',
      '得意先コード',
      '得意先名',
      '商品コード',
      '商品名',
      '最初の日付',
      '最後の日付',
      '状態',
      '行数',
      '直近12か月の行数',
      '直近12か月の影響額(円)',
      '全期間の不足額(円)',
      '説明',
      '注記',
    ],
    rows,
    { bom: true, eol: '\r\n', quoteAll: false },
  );
  const name = `利益漏れ診断_${toCompactDate(d.window.end)}${opts.provisional ? '_仮' : ''}.csv`;
  return { name, text };
}
