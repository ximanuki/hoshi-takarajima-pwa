/**
 * Blind run of the engine on one dataset folder: read every file the way the app
 * does (src/app/model/load.ts, buildLoaded) through the engine's public API, run
 * the diagnosis with the app's default settings and write the engine's label for
 * every sales line. No ground truth is read here; scoring is a separate step.
 *
 *   node scripts/blind-score.ts <dataset-dir> [--out <dir>]
 *        [--revision-date <agreements-file>=<YYYY-MM-DD>]... [--tag <name>]
 *
 * Writes <out>/engine-labels.csv, <out>/engine-followup.csv and
 * <out>/import-issues.json (default out: the dataset folder). With --revision-date
 * the run is no longer the app's default (the user typed a 改定日 on the import
 * screen); pass --tag so the files are written as engine-labels.<tag>.csv,
 * engine-followup.<tag>.csv and import-issues.<tag>.json instead.
 *
 * What "the app's default" means here, as in buildLoaded with fresh settings:
 *  - every top-level file of the folder, in name order; *.json files are read as
 *    settings (marginFloorPct / listPriceRounding / previousRevisionDate) or
 *    company (name), others go through importFile with layout detection, and a
 *    file that cannot be read is recorded and left out;
 *  - no 改定日 typed for agreements files (revisionDates: {}): the app decides the
 *    revision itself when the data allows only one answer (workspace.ts
 *    chooseRevision, including previousRevisionDate from the settings JSON);
 *    no 粗利率の下限 override;
 *  - sales lines whose 伝票番号-行 repeats are dropped only when the whole sale
 *    matches, otherwise kept under a new id (the app's rule);
 *  - diagnose(dataset, lines) with no options.
 * Files in sub-folders (e.g. next/ for the 反映チェック) are not part of the
 * diagnosis. Each new price master there is checked against each sales export in
 * the same sub-folder with checkFollowup, as on the 反映チェック screen (a master
 * with an unreadable row is refused, as readPriceMasterFile does).
 */

import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  type Company,
  checkFollowup,
  companyFromJson,
  type DiagnosisResult,
  diagnose,
  type FileImport,
  type FollowupStatus,
  type IsoDate,
  importFile,
  LayoutNotRecognisedError,
  type LineDiagnosis,
  previousRevisionDateFromJson,
  type SalesLine,
  type Settings,
  settingsFromJson,
  toCsv,
  workspaceFromImports,
} from '../src/engine/index.ts';

/* ---------- arguments ---------- */

const args = process.argv.slice(2);
let dir = '';
let outDir = '';
let tag = '';
const revisionDates: Record<string, IsoDate> = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i] ?? '';
  if (a === '--out') outDir = args[++i] ?? '';
  else if (a === '--tag') tag = args[++i] ?? '';
  else if (a === '--revision-date') {
    const v = args[++i] ?? '';
    const m = /^(.+)=(\d{4}-\d{2}-\d{2})$/.exec(v);
    if (!m) throw new Error(`--revision-date expects <file>=<YYYY-MM-DD>, got "${v}"`);
    revisionDates[m[1] ?? ''] = m[2] ?? '';
  } else if (!dir) dir = a;
  else throw new Error(`unexpected argument: ${a}`);
}
if (!dir) {
  console.error(
    'usage: node scripts/blind-score.ts <dataset-dir> [--out <dir>] [--revision-date <file>=<date>]... [--tag <name>]',
  );
  process.exit(1);
}
if (Object.keys(revisionDates).length > 0 && !tag) {
  throw new Error('--revision-date changes the run from the app default: give it a --tag');
}
outDir ||= dir;
const suffix = tag ? `.${tag}` : '';
const OUTPUTS = new Set(['engine-labels.csv', 'engine-followup.csv', 'import-issues.json']);
const isOwnOutput = (name: string) =>
  OUTPUTS.has(name) ||
  /^engine-labels\..+\.csv$/.test(name) ||
  /^engine-followup\..+\.csv$/.test(name) ||
  /^import-issues\..+\.json$/.test(name);

/* ---------- files ---------- */

function listFiles(root: string, sub = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, sub)).sort()) {
    const rel = sub ? `${sub}/${name}` : name;
    if (statSync(join(root, rel)).isDirectory()) out.push(...listFiles(root, rel));
    else if (sub || !isOwnOutput(name)) out.push(rel);
  }
  return out;
}

const allFiles = listFiles(dir);
const topLevel = allFiles.filter((f) => !f.includes('/'));
const nested = allFiles.filter((f) => f.includes('/'));

interface FileRecord {
  file: string;
  usedInDiagnosis: boolean;
  status: 'ok' | 'json_settings' | 'json_company' | 'json_unused' | 'unrecognised' | 'error';
  kind: string | null;
  layout: string | null;
  encoding: string | null;
  rows: number;
  records: number;
  skippedRows: number;
  issueCount: number;
  error: string | null;
  header?: string[];
  /** issues with the data row (1-based, header not counted) next to the physical line */
  issues: { line: number; dataRow: number | null; field?: string; message: string; value?: string }[];
}

function importRecord(name: string, bytes: Uint8Array, used: boolean): { rec: FileRecord; imp?: FileImport } {
  const base: FileRecord = {
    file: name,
    usedInDiagnosis: used,
    status: 'ok',
    kind: null,
    layout: null,
    encoding: null,
    rows: 0,
    records: 0,
    skippedRows: 0,
    issueCount: 0,
    error: null,
    issues: [],
  };
  try {
    const imp = importFile(name, bytes);
    const dataRowOf = new Map(imp.table.rowLines.map((line, i) => [line, i + 1]));
    const issues = imp.data.result.issues;
    return {
      imp,
      rec: {
        ...base,
        kind: imp.spec.kind,
        layout: imp.spec.id,
        encoding: `${imp.decoded.encoding}${imp.decoded.bom ? '+bom' : ''}`,
        rows: imp.table.rows.length,
        records: imp.data.result.records.length,
        skippedRows: imp.table.rows.length - imp.data.result.records.length,
        issueCount: issues.length,
        issues: issues.map((i) => ({
          line: i.row,
          dataRow: dataRowOf.get(i.row) ?? null,
          ...(i.field !== undefined ? { field: i.field } : {}),
          message: i.message,
          ...(i.value !== undefined ? { value: i.value } : {}),
        })),
      },
    };
  } catch (e) {
    if (e instanceof LayoutNotRecognisedError)
      return { rec: { ...base, status: 'unrecognised', error: e.message, header: e.header } };
    return { rec: { ...base, status: 'error', error: e instanceof Error ? e.message : String(e) } };
  }
}

const records: FileRecord[] = [];
const imports: FileImport[] = [];
let company: Company | null = null;
let dataSettings: Partial<Settings> = {};
let previousRevisionDate: IsoDate | null = null;

for (const name of topLevel) {
  const bytes = new Uint8Array(readFileSync(join(dir, name)));
  if (/\.json$/i.test(name)) {
    const rec: FileRecord = {
      file: name,
      usedInDiagnosis: true,
      status: 'json_unused',
      kind: null,
      layout: null,
      encoding: null,
      rows: 0,
      records: 0,
      skippedRows: 0,
      issueCount: 0,
      error: null,
      issues: [],
    };
    try {
      const json = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
      if ('marginFloorPct' in json || 'listPriceRounding' in json || 'previousRevisionDate' in json) {
        dataSettings = settingsFromJson(json);
        previousRevisionDate = previousRevisionDateFromJson(json);
        rec.status = 'json_settings';
      } else if ('name' in json) {
        company = companyFromJson(json);
        rec.status = 'json_company';
      } else {
        rec.usedInDiagnosis = false;
        rec.error = 'このJSONの内容は使いません。';
      }
    } catch {
      rec.status = 'error';
      rec.usedInDiagnosis = false;
      rec.error = 'JSONとして読めません。';
    }
    records.push(rec);
    continue;
  }
  const { rec, imp } = importRecord(name, bytes, true);
  if (imp) imports.push(imp);
  else rec.usedInDiagnosis = false;
  records.push(rec);
}
const nestedImports: FileImport[] = [];
for (const name of nested) {
  const { rec, imp } = importRecord(name, new Uint8Array(readFileSync(join(dir, name))), false);
  if (imp) nestedImports.push(imp);
  records.push(rec);
}

/* ---------- workspace and diagnosis (as buildLoaded) ---------- */

const ws = workspaceFromImports(imports, {
  settings: { ...dataSettings },
  ...(company ? { company } : {}),
  revisionDates,
  ...(previousRevisionDate ? { previousRevisionDate } : {}),
});

function sameSale(a: SalesLine, b: SalesLine): boolean {
  return (
    a.date === b.date &&
    a.cust === b.cust &&
    a.skuKey === b.skuKey &&
    a.qty === b.qty &&
    a.unitPrice === b.unitPrice &&
    a.isReturn === b.isReturn &&
    (a.amount === null || b.amount === null || a.amount === b.amount)
  );
}

const byId = new Map<string, { file: string; line: SalesLine }[]>();
const lines: SalesLine[] = [];
const fileOfId = new Map<string, string>();
const duplicates: { file: string; line: number; id: string }[] = [];
let slipCollisions = 0;
for (const [file, fileLines] of ws.sales) {
  for (const l of fileLines) {
    const same = byId.get(l.id);
    if (!same) {
      byId.set(l.id, [{ file, line: l }]);
      lines.push(l);
      fileOfId.set(l.id, file);
    } else if (same.some((s) => sameSale(s.line, l))) {
      duplicates.push({ file, line: l.sourceRow, id: l.id });
    } else {
      const kept: SalesLine = { ...l, id: `${l.id}（${file} ${l.sourceRow}行目）` };
      same.push({ file, line: kept });
      lines.push(kept);
      fileOfId.set(kept.id, file);
      slipCollisions++;
    }
  }
}

let result: DiagnosisResult | null = null;
if (lines.length > 0 && ws.dataset.customers.size > 0 && ws.dataset.products.size > 0) {
  result = diagnose(ws.dataset, lines);
}

/* ---------- labels ---------- */

const LEAK_LABEL: Record<string, string> = {
  old_price: 'leak_old_price',
  expired_special: 'leak_expired_special',
  rate_out_of_tier: 'leak_rate_out_of_tier',
  below_margin_floor: 'leak_below_margin_floor',
};

/** The engine's status in a fixed label vocabulary (decided before any truth was read). */
function engineLabel(d: LineDiagnosis): string {
  switch (d.status) {
    case 'leak':
      return d.leak ? (LEAK_LABEL[d.leak] ?? `leak_${d.leak}`) : 'unexplained';
    case 'price_mismatch':
      return 'unexplained';
    case 'ok_kept_price':
      switch (d.expected?.list.basis) {
        case 'kept_before_agreed_date':
          return 'ok_deferred';
        case 'kept_negotiating':
          return 'ok_negotiating';
        case 'kept_excluded_category':
          return 'ok_kept_excluded_category';
        default:
          return 'ok_declined';
      }
    case 'excluded_return':
      return 'ok_return';
    case 'excluded_sample':
      return 'ok_sample';
    case 'excluded_non_product':
      return 'ok_non_product';
    case 'excluded_unknown_customer':
      return 'excluded_unknown_customer';
    case 'excluded_no_list_price':
      return 'excluded_no_list_price';
    default:
      return d.status;
  }
}

const dataRowByFile = new Map<string, Map<number, number>>();
for (const f of imports) {
  if (f.data.kind === 'sales')
    dataRowByFile.set(f.name, new Map(f.table.rowLines.map((line, i) => [line, i + 1])));
}

const HEADER = [
  'file',
  'data_row',
  'source_line',
  'line_id',
  'date',
  'cust',
  'raw_sku',
  'sku',
  'qty',
  'unit_price',
  'label',
  'status',
  'leak',
  'flags',
  'expected_price',
  'expected_kind',
  'list_basis',
  'list_price',
  'previous_list_price',
  'old_price',
  'tier_min_price',
  'tier_max_price',
  'cost_sen',
  'floor_price',
  'shortfall_yen',
  'in_window',
  'overcharge',
  'mismatch',
  'remark',
];

const rows: (string | number)[][] = [];
const labelCounts: Record<string, number> = {};
if (result) {
  const { start, end } = result.window;
  const ordered = [...result.lines].sort((a, b) => {
    const fa = fileOfId.get(a.line.id) ?? '';
    const fb = fileOfId.get(b.line.id) ?? '';
    return fa !== fb ? (fa < fb ? -1 : 1) : a.line.sourceRow - b.line.sourceRow;
  });
  for (const d of ordered) {
    const file = fileOfId.get(d.line.id) ?? '';
    const label = engineLabel(d);
    labelCounts[label] = (labelCounts[label] ?? 0) + 1;
    const l = d.line;
    const e = d.expected;
    rows.push([
      file,
      dataRowByFile.get(file)?.get(l.sourceRow) ?? '',
      l.sourceRow,
      l.id,
      l.date,
      l.cust,
      l.rawSku,
      l.sku ?? '',
      l.qty,
      l.unitPrice,
      label,
      d.status,
      d.leak ?? '',
      d.flags.join(';'),
      e?.price ?? '',
      e?.kind ?? '',
      e?.list.basis ?? '',
      e?.list.price ?? '',
      e?.list.previousPrice ?? '',
      d.oldPrice ?? '',
      d.tier?.minPrice ?? '',
      d.tier?.maxPrice ?? '',
      d.costSen ?? '',
      d.floorPrice ?? '',
      d.shortfallYen,
      l.date >= start && l.date <= end ? 1 : 0,
      d.overcharge ? 1 : 0,
      d.mismatch ? 1 : 0,
      l.remark,
    ]);
  }
}

const labelsPath = join(outDir, `engine-labels${suffix}.csv`);
writeFileSync(labelsPath, toCsv(HEADER, rows, { bom: false, eol: '\n', quoteAll: false }));

/* ---------- 反映チェック (sub-folders: each new price master × each sales export) ---------- */

const folderOf = (name: string) => name.slice(0, name.lastIndexOf('/'));
/** the follow-up status in the truth's vocabulary (as scripts/evaluate.ts) */
const FOLLOW_LABEL: Partial<Record<FollowupStatus, string>> = {
  excluded_return: 'ok_return',
  excluded_sample: 'ok_sample',
  excluded_non_product: 'ok_non_product',
};
const FOLLOW_HEADER = [
  'master',
  'file',
  'data_row',
  'source_line',
  'line_id',
  'date',
  'cust',
  'sku',
  'qty',
  'unit_price',
  'label',
  'status',
  'expected',
  'shortfall_yen',
  'remark',
];
const followRows: (string | number)[][] = [];
type FollowupReport =
  | {
      master: string;
      sales: string;
      counts: Record<string, number>;
      stillOld: { lines: number; pairs: number; customers: number; shortfallYen: number };
    }
  | { master: string; sales?: string; error: string };
const followup: FollowupReport[] = [];
for (const m of nestedImports) {
  if (m.data.kind !== 'priceMaster') continue;
  const salesFiles = nestedImports.filter(
    (f) => f.data.kind === 'sales' && folderOf(f.name) === folderOf(m.name),
  );
  if (m.data.result.issues.length > 0) {
    followup.push({
      master: m.name,
      error: `refused: ${m.data.result.issues.length} unreadable row(s), as readPriceMasterFile`,
    });
    continue;
  }
  for (const s of salesFiles) {
    if (s.data.kind !== 'sales') continue;
    const dataRow = new Map(s.table.rowLines.map((line, i) => [line, i + 1]));
    const r = checkFollowup(
      ws.dataset,
      m.data.result.records,
      ws.dataset.resolveLines(s.data.result.records),
    );
    for (const x of r.lines) {
      const l = x.line;
      followRows.push([
        m.name,
        s.name,
        dataRow.get(l.sourceRow) ?? '',
        l.sourceRow,
        l.id,
        l.date,
        l.cust,
        l.sku ?? '',
        l.qty,
        l.unitPrice,
        FOLLOW_LABEL[x.status] ?? x.status,
        x.status,
        x.expected ?? '',
        x.shortfallYen,
        l.remark,
      ]);
    }
    followup.push({
      master: m.name,
      sales: s.name,
      counts: Object.fromEntries(Object.entries(r.counts).filter(([, n]) => n > 0)),
      stillOld: r.stillOld,
    });
  }
}
const followupPath = join(outDir, `engine-followup${suffix}.csv`);
// no follow-up in this run: remove an earlier run's file so blind-compare cannot score stale output
if (followup.length > 0)
  writeFileSync(followupPath, toCsv(FOLLOW_HEADER, followRows, { bom: false, eol: '\n', quoteAll: false }));
else rmSync(followupPath, { force: true });

const salesRowsInFiles = records
  .filter((r) => r.usedInDiagnosis && r.kind === 'sales')
  .reduce((s, r) => s + r.rows, 0);
const report = {
  note: 'Blind engine run (no ground truth read). App defaults unless revisionDates is non-empty.',
  dataset: relative(process.cwd(), dir) || dir,
  appDefault: Object.keys(revisionDates).length === 0,
  revisionDatesGiven: revisionDates,
  settingsUsed: ws.dataset.settings,
  previousRevisionDateInSettings: previousRevisionDate,
  revisionCandidates: ws.revisionCandidates,
  revisionsAssigned: ws.dataset.revisions.map((r) => ({ date: r.date, customers: r.agreements.length })),
  agreementFiles: ws.agreementFiles,
  workspaceNotes: ws.notes,
  workspaceWarnings: ws.warnings,
  window: result?.window ?? null,
  files: records,
  sales: {
    rowsInFiles: salesRowsInFiles,
    linesImported: [...ws.sales.values()].reduce((s, x) => s + x.length, 0),
    rowsNotImported: salesRowsInFiles - [...ws.sales.values()].reduce((s, x) => s + x.length, 0),
    duplicateLinesDropped: duplicates.length,
    duplicateExamples: duplicates.slice(0, 20),
    slipCollisionsKept: slipCollisions,
    linesDiagnosed: result?.lines.length ?? 0,
  },
  engineLabelCounts: Object.fromEntries(Object.entries(labelCounts).sort()),
  statusCounts: result?.statusCounts ?? null,
  summary: result?.summary ?? null,
  overcharges: result?.overcharges ?? null,
  freeGoods: result?.freeGoods ?? null,
  followup,
  datasetIssues: {
    count: ws.dataset.issues.length,
    byKind: ws.dataset.issues.reduce<Record<string, number>>((acc, i) => {
      acc[i.kind] = (acc[i.kind] ?? 0) + 1;
      return acc;
    }, {}),
    items: ws.dataset.issues,
  },
};
const issuesPath = join(outDir, `import-issues${suffix}.json`);
writeFileSync(issuesPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  `${dir}: ${result?.lines.length ?? 0} lines diagnosed, window ${result?.window.start ?? '-'}..${result?.window.end ?? '-'}`,
);
console.log(`  revisions assigned: ${JSON.stringify(report.revisionsAssigned)}`);
for (const n of ws.notes) console.log(`  note: ${n}`);
for (const n of ws.warnings) console.log(`  warning: ${n}`);
for (const r of records)
  console.log(
    `  ${r.file}: ${r.status}${r.kind ? ` ${r.kind}/${r.layout} ${r.encoding}` : ''} rows ${r.rows} records ${r.records} issues ${r.issueCount}${r.error ? ` (${r.error})` : ''}${r.usedInDiagnosis ? '' : ' [not in diagnosis]'}`,
  );
console.log(`  labels: ${JSON.stringify(report.engineLabelCounts)}`);
for (const f of followup)
  console.log(
    `  followup ${f.master}${f.sales ? ` × ${f.sales}` : ''}: ${'error' in f ? f.error : JSON.stringify(f.stillOld)}`,
  );
console.log(`  wrote ${labelsPath}${followup.length > 0 ? `, ${followupPath}` : ''} and ${issuesPath}`);
