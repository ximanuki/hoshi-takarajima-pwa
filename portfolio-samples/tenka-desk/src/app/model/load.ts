/**
 * Reading the user's files into the engine's workspace and running the
 * diagnosis. Each file is imported on its own so a file the app cannot read is
 * listed (with its header, for manual column mapping) instead of stopping the rest.
 */

import {
  type Company,
  collectPairVolumes,
  companyFromJson,
  type DiagnosisResult,
  diagnose,
  type FileImport,
  type FileKind,
  type ImportIssue,
  type IsoDate,
  importFile,
  LayoutNotRecognisedError,
  type LineDiagnosis,
  layoutById,
  type PairVolume,
  pctToBp,
  type SalesLine,
  type Settings,
  settingsFromJson,
  type Workspace,
  workspaceFromImports,
} from '../../engine/index.ts';
import { encodingLabel } from '../format.ts';

/** The user's choice of layout and header names for a file the app did not recognise. */
export interface ColumnChoice {
  specId: string;
  /** field -> header name in the file */
  overrides: Record<string, string>;
}

export interface SourceFile {
  name: string;
  bytes: Uint8Array;
  mapping?: ColumnChoice;
}

export type FileStatus = 'ok' | 'unrecognised' | 'error' | 'json';

export interface FileInfo {
  name: string;
  status: FileStatus;
  label: string;
  kind: FileKind | null;
  encoding: string;
  rows: number;
  records: number;
  /** rows that could not be read and were left out (rows − records) */
  skippedRows: number;
  issues: ImportIssue[];
  issueCount: number;
  /** field key -> the column header it was read from (for messages) */
  fieldLabels: Record<string, string>;
  header: string[];
  error: string | null;
  mapped: boolean;
}

export interface FileCheck {
  kind: FileKind;
  label: string;
  need: 'required' | 'recommended' | 'optional';
  why: string;
}

/** What each kind of file is for, and what happens without it. */
export const FILE_CHECKS: readonly FileCheck[] = [
  { kind: 'sales', label: '売上明細', need: 'required', why: '診断の対象です。' },
  {
    kind: 'customers',
    label: '得意先マスタ',
    need: 'required',
    why: '得意先の掛率ランクと掛率、申入書の宛先に使います。',
  },
  {
    kind: 'products',
    label: '商品マスタ',
    need: 'required',
    why: '品番ゆれを吸収した商品コードの突き合わせと、原価に使います。',
  },
  {
    kind: 'agreements',
    label: '前回改定の合意状況',
    need: 'recommended',
    why: 'ないと、見送り・据え置き・適用日前の正しい旧価格も「反映漏れ」に見えます。架空データで試すと、反映漏れとして出た行の半分以上がこの誤検出でした。',
  },
  {
    kind: 'specials',
    label: '特値一覧',
    need: 'recommended',
    why: 'ないと、期間内の特値が「掛率ランク外」に見え、期限切れの特値は見つけられません。架空データで試すと、掛率ランク外として出た行の約9割がこの誤検出でした。',
  },
  {
    kind: 'listPriceHistory',
    label: '定価の履歴',
    need: 'recommended',
    why: 'ないと、定価改定の前後を比べられないため「反映漏れ」を判定できません。',
  },
  {
    kind: 'rateTiers',
    label: '掛率ランク',
    need: 'recommended',
    why: 'ないと「掛率ランク外」を判定できず、提案でもランクの範囲を確かめられません。',
  },
  {
    kind: 'costHistory',
    label: '原単価の履歴',
    need: 'optional',
    why: 'ないときは、売上明細の原単価、それもなければ商品マスタの原単価を使います。',
  },
  {
    kind: 'categories',
    label: 'カテゴリ',
    need: 'optional',
    why: '原価構成比のない商品にカテゴリの構成比を使います。申入書の参考資料（原材料）の選択にも使います。',
  },
  {
    kind: 'supplierNotices',
    label: '仕入先の値上げ通知',
    need: 'optional',
    why: 'シナリオで、通知のある商品は通知の改定率を使えます。',
  },
  {
    kind: 'newListPrices',
    label: '新定価表',
    need: 'optional',
    why: '提案の方法「新定価表を使う」で使います。',
  },
  { kind: 'suppliers', label: '仕入先', need: 'optional', why: '仕入先名の表示に使います。' },
];

export interface Loaded {
  ws: Workspace;
  files: FileInfo[];
  kinds: Set<FileKind>;
  lines: SalesLine[];
  duplicateLines: number;
  diagnosis: DiagnosisResult | null;
  lineById: Map<string, LineDiagnosis>;
  volumes: Map<string, PairVolume>;
  /** last day used for current prices and costs (end of the last month of the sales data) */
  asOf: IsoDate | null;
  period: { first: IsoDate; last: IsoDate } | null;
  company: Company | null;
  dataSettings: Partial<Settings>;
  /** 次回改定日 from demo_settings.json, if any */
  demoNextRevision: IsoDate | null;
  /** the data is the bundled fictional sample */
  isSample: boolean;
}

export interface LoadOptions {
  revisionDates: Record<string, IsoDate>;
  diagnosisFloorPct: number | null;
  isSample: boolean;
  onProgress?: (message: string) => void;
}

const yieldToBrowser = () => new Promise<void>((r) => setTimeout(r, 0));

function fieldLabelsOf(f: FileImport): Record<string, string> {
  const out: Record<string, string> = {};
  for (const col of f.spec.columns) {
    const i = f.mapping[col.field] ?? -1;
    out[col.field] = (i >= 0 ? f.table.header[i] : undefined) || (col.headers[0] ?? col.field);
  }
  return out;
}

function fileInfoFromImport(f: FileImport, mapped: boolean): FileInfo {
  const issues = f.data.result.issues;
  return {
    name: f.name,
    status: 'ok',
    label: f.spec.label,
    kind: f.spec.kind,
    encoding: encodingLabel(f.decoded.encoding, f.decoded.bom),
    rows: f.table.rows.length,
    records: f.data.result.records.length,
    skippedRows: f.table.rows.length - f.data.result.records.length,
    issues: issues.slice(0, 50),
    issueCount: issues.length,
    fieldLabels: fieldLabelsOf(f),
    header: f.table.header,
    error: null,
    mapped,
  };
}

function emptyInfo(name: string, status: FileStatus, label: string, error: string | null): FileInfo {
  return {
    name,
    status,
    label,
    kind: null,
    encoding: '',
    rows: 0,
    records: 0,
    skippedRows: 0,
    issues: [],
    issueCount: 0,
    fieldLabels: {},
    header: [],
    error,
    mapped: false,
  };
}

/** Import one file on its own (used to check a manual column mapping before applying it). */
export function importSource(src: SourceFile): FileImport {
  return src.mapping
    ? importFile(src.name, src.bytes, {
        spec: layoutById(src.mapping.specId),
        columnOverrides: src.mapping.overrides,
      })
    : importFile(src.name, src.bytes);
}

export async function buildLoaded(sources: readonly SourceFile[], opts: LoadOptions): Promise<Loaded> {
  const progress = opts.onProgress ?? (() => {});
  const files: FileInfo[] = [];
  const imports: FileImport[] = [];
  let company: Company | null = null;
  let dataSettings: Partial<Settings> = {};
  let demoNextRevision: IsoDate | null = null;

  for (const src of sources) {
    progress(`${src.name} を読み込んでいます…`);
    await yieldToBrowser();
    if (/\.json$/i.test(src.name)) {
      try {
        const json = JSON.parse(new TextDecoder().decode(src.bytes)) as Record<string, unknown>;
        if ('marginFloorPct' in json || 'listPriceRounding' in json) {
          dataSettings = settingsFromJson(json);
          const next = json['demoNextRevisionDate'];
          if (typeof next === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(next)) demoNextRevision = next;
          files.push(emptyInfo(src.name, 'json', '設定（JSON）', null));
        } else if ('name' in json) {
          company = companyFromJson(json);
          files.push(emptyInfo(src.name, 'json', '自社情報（JSON）', null));
        } else {
          files.push(emptyInfo(src.name, 'error', 'JSON', 'このJSONの内容は使いません。'));
        }
      } catch {
        files.push(emptyInfo(src.name, 'error', 'JSON', 'JSONとして読めません。'));
      }
      continue;
    }
    try {
      const imp = importSource(src);
      imports.push(imp);
      files.push(fileInfoFromImport(imp, src.mapping !== undefined));
    } catch (e) {
      if (e instanceof LayoutNotRecognisedError) {
        const info = emptyInfo(src.name, 'unrecognised', '形式を判別できません', e.message);
        info.header = e.header;
        files.push(info);
      } else {
        files.push(
          emptyInfo(src.name, 'error', '読み込めません', e instanceof Error ? e.message : String(e)),
        );
      }
    }
  }

  progress('マスタと履歴をまとめています…');
  await yieldToBrowser();
  const settings: Partial<Settings> = { ...dataSettings };
  if (opts.diagnosisFloorPct !== null) {
    const bp = pctToBp(opts.diagnosisFloorPct);
    // a floor of 100% or more has no price that meets it: keep the data's own setting
    if (bp >= 0 && bp < 10000) settings.marginFloorBp = bp;
  }
  const ws = workspaceFromImports(imports, {
    settings,
    ...(company ? { company } : {}),
    revisionDates: opts.revisionDates,
  });
  // keep only what the screens use (the decoded text of large files is not needed any more)
  const slim: Workspace = { ...ws, files: [] };
  const kinds = new Set<FileKind>(imports.map((f) => f.spec.kind));

  const byId = new Map<string, SalesLine>();
  let duplicateLines = 0;
  for (const lines of ws.sales.values()) {
    for (const l of lines) {
      if (byId.has(l.id)) duplicateLines++;
      else byId.set(l.id, l);
    }
  }
  const lines = [...byId.values()];
  let period: Loaded['period'] = null;
  for (const l of lines) {
    if (!period) period = { first: l.date, last: l.date };
    else {
      if (l.date < period.first) period.first = l.date;
      if (l.date > period.last) period.last = l.date;
    }
  }

  let diagnosis: DiagnosisResult | null = null;
  const lineById = new Map<string, LineDiagnosis>();
  let volumes = new Map<string, PairVolume>();
  let asOf: IsoDate | null = null;
  if (lines.length > 0 && ws.dataset.customers.size > 0 && ws.dataset.products.size > 0) {
    progress(`売上明細 ${lines.length.toLocaleString('ja-JP')}行を診断しています…`);
    await yieldToBrowser();
    diagnosis = diagnose(ws.dataset, lines);
    for (const d of diagnosis.lines) lineById.set(d.line.id, d);
    asOf = diagnosis.window.end;
    volumes = collectPairVolumes(ws.dataset.resolveLines(lines), diagnosis.window);
  }

  return {
    ws: slim,
    files,
    kinds,
    lines,
    duplicateLines,
    diagnosis,
    lineById,
    volumes,
    asOf,
    period,
    company,
    dataSettings,
    demoNextRevision,
    isSample: opts.isSample,
  };
}
