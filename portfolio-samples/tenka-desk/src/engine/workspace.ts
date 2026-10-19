/**
 * Builds a Dataset from the files a user loads: each file is decoded, its
 * layout detected and imported, and the masters are put together.
 */

import { Dataset, inferRevisionDates, listChangeDates } from './dataset.ts';
import { type IsoDate, isIsoDate, toWareki, yearMonth } from './dates.ts';
import {
  type FileImport,
  type ImportIssue,
  type ImportOptions,
  importFile,
  type SkippedRow,
} from './importers.ts';
import type {
  Category,
  Company,
  CostRow,
  Customer,
  ListPriceRow,
  NewListPrice,
  PriceMasterRow,
  Product,
  RateTier,
  Revision,
  RevisionAgreement,
  SalesLine,
  Settings,
  SpecialPrice,
  Supplier,
  SupplierNotice,
} from './types.ts';

export interface InputFile {
  name: string;
  data: Uint8Array | string;
  /** how to read this file (e.g. a layout and column names chosen by the user); default: detect */
  import?: ImportOptions;
}

export interface WorkspaceOptions {
  settings?: Partial<Settings>;
  company?: Company;
  /**
   * 改定日 the person entered for each agreements file (by file name). It always
   * wins. Without it, the file's revision is decided from the data when only one
   * answer is possible (see `chooseRevision`), else the file is not used.
   */
  revisionDates?: Record<string, IsoDate>;
  /**
   * 前回の改定日 from a settings file (demo_settings.json `previousRevisionDate`).
   * One of the signals for deciding the revision; it counts only when exactly one
   * agreements file is loaded, because it names a single revision.
   */
  previousRevisionDate?: IsoDate;
}

/** What pointed to the revision an agreements file answers. */
export type RevisionSignal = 'effective_dates' | 'file_name' | 'settings';

export const REVISION_SIGNAL_JA: Record<RevisionSignal, string> = {
  effective_dates: '合意状況の適用日（一番多い日付）',
  file_name: 'ファイル名の年月',
  settings: '設定ファイルの前回改定日',
};

/** How the revision of an agreements file was decided. */
export type RevisionSource = 'entered' | 'only_revision' | 'inferred';

/** Which 定価改定 an agreements file was taken to answer, and whether the diagnosis uses it. */
export interface AgreementFileUse {
  file: string;
  /** the 改定日 the file was assigned to (null: not decided) */
  date: IsoDate | null;
  /** entered by the person / the only revision in the history / inferred from the signals */
  source: RevisionSource | null;
  /** for an inferred date: the signals that pointed to it */
  signals: RevisionSignal[];
  /** some product's 定価 changed on `date` (else the file can do nothing) */
  inHistory: boolean;
  /** the diagnosis uses the file: date !== null && inHistory */
  used: boolean;
  /** the warning shown when the file is not used */
  warning: string | null;
}

export interface Workspace {
  dataset: Dataset;
  files: FileImport[];
  /** sales exports by file name, in load order */
  sales: Map<string, SalesLine[]>;
  priceMasters: Map<string, PriceMasterRow[]>;
  newListPrices: NewListPrice[];
  importIssues: { file: string; issue: ImportIssue }[];
  /** information for the person (e.g. which revision an agreements file was taken to answer) */
  notes: string[];
  /** problems that change the results (e.g. an agreements file that is not used); includes agreementWarnings */
  warnings: string[];
  /**
   * Rows of a used agreements file that the diagnosis cannot take as written, by
   * customer: a row left out (the customer is then treated as 合意), 合意 with a 適用日
   * of 「未定」 (the old 定価 is kept), a 対象外カテゴリ that matches no category, a
   * 合意状況 that cannot be classified. Shown as a warning on the import and diagnosis screens.
   */
  agreementWarnings: string[];
  /** every agreements file, in load order, with the revision it answers */
  agreementFiles: AgreementFileUse[];
  /** the 定価改定 dates found in the 定価の履歴 (inferRevisionDates) */
  revisionCandidates: IsoDate[];
}

export function loadWorkspace(inputs: readonly InputFile[], options: WorkspaceOptions = {}): Workspace {
  return workspaceFromImports(
    inputs.map((f) => importFile(f.name, f.data, f.import)),
    options,
  );
}

/**
 * Build a Workspace from files that were already imported (importFile), e.g.
 * when the caller imports each file itself to report unreadable files one by one.
 */
export function workspaceFromImports(
  files: readonly FileImport[],
  options: WorkspaceOptions = {},
): Workspace {
  const customers: Customer[] = [];
  const products: Product[] = [];
  const tiers: RateTier[] = [];
  const categories: Category[] = [];
  const suppliers: Supplier[] = [];
  const listHist: ListPriceRow[] = [];
  const costHist: CostRow[] = [];
  const specials: SpecialPrice[] = [];
  const notices: SupplierNotice[] = [];
  const newListPrices: NewListPrice[] = [];
  const agreementFiles: { name: string; rows: RevisionAgreement[]; skipped: SkippedRow[] }[] = [];
  const sales = new Map<string, SalesLine[]>();
  const priceMasters = new Map<string, PriceMasterRow[]>();
  const importIssues: { file: string; issue: ImportIssue }[] = [];
  const notes: string[] = [];

  for (const f of files) {
    for (const issue of f.data.result.issues) importIssues.push({ file: f.name, issue });
    const d = f.data;
    switch (d.kind) {
      case 'customers':
        customers.push(...d.result.records);
        break;
      case 'products':
        products.push(...d.result.records);
        break;
      case 'rateTiers':
        tiers.push(...d.result.records);
        break;
      case 'categories':
        categories.push(...d.result.records);
        break;
      case 'suppliers':
        suppliers.push(...d.result.records);
        break;
      case 'listPriceHistory':
        listHist.push(...d.result.records);
        break;
      case 'costHistory':
        costHist.push(...d.result.records);
        break;
      case 'specials':
        specials.push(...d.result.records);
        break;
      case 'supplierNotices':
        notices.push(...d.result.records);
        break;
      case 'newListPrices':
        newListPrices.push(...d.result.records);
        break;
      case 'agreements':
        agreementFiles.push({ name: f.name, rows: d.result.records, skipped: d.result.skipped ?? [] });
        break;
      case 'sales':
        sales.set(f.name, d.result.records);
        break;
      case 'priceMaster':
        priceMasters.set(f.name, d.result.records);
        break;
    }
  }

  const candidates = inferRevisionDates(listHist);
  const changeDates = new Set(listChangeDates(listHist));
  const prevSetting = agreementFiles.length === 1 ? (options.previousRevisionDate ?? null) : null;
  const candidateText =
    candidates.length > 0
      ? `定価の履歴にある改定日：${candidates.map(toWareki).join('、')}`
      : '定価の履歴から改定日を見つけられませんでした';
  const revisions: Revision[] = [];
  const uses: AgreementFileUse[] = [];
  const warnings: string[] = [];
  for (const af of agreementFiles) {
    const use = chooseRevision(af, {
      entered: options.revisionDates?.[af.name] ?? null,
      candidates,
      changeDates,
      single: agreementFiles.length === 1,
      previousRevisionDate: prevSetting,
    });
    const d = use.date;
    if (d !== null && use.source === 'only_revision')
      notes.push(`${af.name} を ${toWareki(d)} の定価改定の合意状況として扱いました（定価の履歴から判断）。`);
    if (d !== null && use.source === 'inferred')
      notes.push(
        `${af.name} を ${toWareki(d)} の改定として扱いました（${use.signals.map((x) => REVISION_SIGNAL_JA[x]).join('・')}から判断）。違う場合は改定日を入れ直してください。`,
      );
    if (d === null) {
      use.warning =
        listHist.length === 0
          ? `${af.name}：定価の履歴が読み込まれていないため、この合意状況は診断に使っていません。`
          : `${af.name}：どの定価改定（改定日）の合意状況か決められないため、診断に使っていません。見送り・据え置き・適用日前の正しい旧価格も「反映漏れ」に、その単価から数量値引をした正しい行も「掛率ランク外」に数えるので、反映漏れと掛率ランク外が多めに出ます。前回の改定日を入れてください（${candidateText}）。`;
    } else if (!use.inHistory) {
      use.warning = `${af.name}：入れた改定日（${toWareki(d)}）に定価が変わった商品が、定価の履歴にありません。この合意状況は診断に効いていません。前回の改定日を入れ直してください（${candidateText}）。`;
    }
    if (use.warning !== null) warnings.push(use.warning);
    uses.push(use);
    if (d === null) continue;
    revisions.push({ date: d, label: `${toWareki(d)} 定価改定`, agreements: af.rows });
  }

  const datasetInput = {
    customers,
    products,
    rateTiers: tiers,
    categories,
    suppliers,
    listPriceHistory: listHist,
    costHistory: costHist,
    specials,
    revisions,
    supplierNotices: notices,
    ...(options.settings ? { settings: options.settings } : {}),
    ...(options.company ? { company: options.company } : {}),
  };
  const dataset = new Dataset(datasetInput);
  const agreementWarnings = agreementRowWarnings(dataset, agreementFiles, uses);
  warnings.push(...agreementWarnings);
  for (const [name, lines] of sales) sales.set(name, dataset.resolveLines(lines));
  for (const [name, rows] of priceMasters) {
    priceMasters.set(
      name,
      rows.map((r) => ({ ...r, sku: dataset.resolveSku(r.skuKey) })),
    );
  }
  return {
    dataset,
    files: [...files],
    sales,
    priceMasters,
    newListPrices,
    importIssues,
    notes,
    warnings,
    agreementWarnings,
    agreementFiles: uses,
    revisionCandidates: candidates,
  };
}

/** Dataset issues about answers the diagnosis could not take as written. */
const AGREEMENT_ROW_ISSUES = new Set([
  'effective_undecided',
  'unknown_excluded_category',
  'unknown_agreement_status',
]);

/**
 * Warnings, by customer, for the rows of the used agreements files that the diagnosis
 * cannot take as written. A row left out of the file, or one whose 得意先コード is not in
 * the customer master, leaves the customer it was meant for without an answer, which
 * reads as 合意: that is never silent (unless another file answers for the customer).
 * Files that are not used have their own warning, so nothing is listed for them.
 * Each warning is listed once (two files for one revision may say the same thing).
 */
function agreementRowWarnings(
  dataset: Dataset,
  files: readonly { name: string; rows: readonly RevisionAgreement[]; skipped: readonly SkippedRow[] }[],
  uses: readonly AgreementFileUse[],
): string[] {
  const out: string[] = [];
  const usedDates = new Set<IsoDate>();
  files.forEach((af, i) => {
    const use = uses[i];
    if (!use?.used || use.date === null) return;
    usedDates.add(use.date);
    const answered = new Set(
      dataset.revisions.find((r) => r.date === use.date)?.agreements.map((a) => a.cust),
    );
    for (const s of af.skipped) {
      if (s.cust !== '' && answered.has(s.cust)) continue;
      const name = dataset.customers.get(s.cust)?.name;
      const who =
        s.cust === '' ? '得意先コード不明' : name ? `得意先 ${s.cust}（${name}）` : `得意先 ${s.cust}`;
      out.push(
        `${af.name}：${s.row}行目（${who}）を読めませんでした${s.reason ? `（${s.reason}）` : ''}。この得意先は合意状況に答えがないことになり、改定に合意したものとして扱っています（新しい定価を正しい単価とします）。行を直して読み込み直してください。`,
      );
    }
    if (dataset.customers.size === 0) return;
    for (const ag of af.rows) {
      if (dataset.customers.has(ag.cust)) continue;
      out.push(
        `${af.name}：得意先コード ${ag.cust}（「${ag.status}」）が得意先マスタにありません。この行はどの得意先の答えにもならないため、書こうとした得意先は合意状況に答えがないことになり、改定に合意したものとして扱っています（新しい定価を正しい単価とします）。得意先コードを直してください。`,
      );
    }
  });
  for (const issue of dataset.issues)
    if (AGREEMENT_ROW_ISSUES.has(issue.kind) && issue.revision !== undefined && usedDates.has(issue.revision))
      out.push(issue.message);
  return [...new Set(out)];
}

/**
 * Which 定価改定 an agreements file answers. The first rule that applies wins:
 *  1. a date the person entered;
 *  2. the only agreements file and the only 改定日 in the history (`candidates`);
 *  3. among the candidates, exactly one matches a signal (inferAgreementRevision).
 * Otherwise the file is not used and the person is asked for the date.
 */
function chooseRevision(
  af: { name: string; rows: readonly RevisionAgreement[] },
  ctx: {
    entered: IsoDate | null;
    candidates: readonly IsoDate[];
    changeDates: ReadonlySet<IsoDate>;
    single: boolean;
    previousRevisionDate: IsoDate | null;
  },
): AgreementFileUse {
  const base = { file: af.name, warning: null };
  const decided = (date: IsoDate, source: RevisionSource, signals: RevisionSignal[]): AgreementFileUse => {
    const inHistory = ctx.changeDates.has(date);
    return { ...base, date, source, signals, inHistory, used: inHistory };
  };
  if (ctx.entered !== null) return decided(ctx.entered, 'entered', []);
  const only = ctx.candidates[0];
  if (ctx.single && ctx.candidates.length === 1 && only !== undefined)
    return decided(only, 'only_revision', []);
  const inferred = inferAgreementRevision(af.name, af.rows, ctx.candidates, ctx.previousRevisionDate);
  if (inferred) return decided(inferred.date, 'inferred', inferred.signals);
  return { ...base, date: null, source: null, signals: [], inHistory: false, used: false };
}

const YEAR_MONTH_IN_NAME =
  /(?<!\d)((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])(?:[-_.]?(?:0[1-9]|[12]\d|3[01]))?(?!\d)/g;

/** Year-months ("2025-10") written in a file's base name: 2025-10, 2025_10, 202510, 20251001. */
export function yearMonthsInName(name: string): string[] {
  const base = name.split(/[\\/]/).pop() ?? '';
  const out: string[] = [];
  for (const m of base.matchAll(YEAR_MONTH_IN_NAME)) {
    const ym = `${m[1]}-${m[2]}`;
    if (!out.includes(ym)) out.push(ym);
  }
  return out;
}

/** The 適用日 written most often in the file (blank rows left out); null on a tie or when none. */
function mostCommonEffective(rows: readonly RevisionAgreement[]): IsoDate | null {
  const counts = new Map<IsoDate, number>();
  for (const r of rows) if (r.effective !== null) counts.set(r.effective, (counts.get(r.effective) ?? 0) + 1);
  let best: IsoDate | null = null;
  let bestN = 0;
  let tie = false;
  for (const [d, n] of counts) {
    if (n > bestN) {
      best = d;
      bestN = n;
      tie = false;
    } else if (n === bestN) tie = true;
  }
  return tie ? null : best;
}

/**
 * The revision an agreements file answers, from the data: among the 改定日 found in
 * the 定価の履歴 (`candidates`), the one matching any of (a) the most common 適用日
 * in the file, (b) the year-month in the file name — only when the name holds
 * exactly one (two or more, like agreements_202504-202603.csv, are a data period,
 * not a revision), (c) the settings' 前回改定日 — only when exactly one candidate
 * matches. A signal that points to no candidate is no match; it does not block the others.
 */
export function inferAgreementRevision(
  name: string,
  rows: readonly RevisionAgreement[],
  candidates: readonly IsoDate[],
  previousRevisionDate: IsoDate | null,
): { date: IsoDate; signals: RevisionSignal[] } | null {
  const effective = mostCommonEffective(rows);
  const months = yearMonthsInName(name);
  const nameMonth = months.length === 1 ? months[0] : undefined;
  const signalsOf = (d: IsoDate): RevisionSignal[] => [
    ...(d === effective ? (['effective_dates'] as const) : []),
    ...(yearMonth(d) === nameMonth ? (['file_name'] as const) : []),
    ...(d === previousRevisionDate ? (['settings'] as const) : []),
  ];
  const matched = candidates.filter((d) => signalsOf(d).length > 0);
  const date = matched[0];
  return matched.length === 1 && date !== undefined ? { date, signals: signalsOf(date) } : null;
}

/** `previousRevisionDate` of a settings JSON like demo_settings.json (null when absent or not a date). */
export function previousRevisionDateFromJson(json: unknown): IsoDate | null {
  if (typeof json !== 'object' || json === null) return null;
  const v = (json as Record<string, unknown>)['previousRevisionDate'];
  return typeof v === 'string' && isIsoDate(v) ? v : null;
}

function num(o: Record<string, unknown>, k: string): number | undefined {
  const v = o[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  return typeof v === 'string' ? v : '';
}

/** Settings from a JSON object like public/sample/demo_settings.json (unknown keys are ignored). */
export function settingsFromJson(json: unknown): Partial<Settings> {
  if (typeof json !== 'object' || json === null) return {};
  const o = json as Record<string, unknown>;
  const out: Partial<Settings> = {};
  const floor = num(o, 'marginFloorPct');
  if (floor !== undefined) out.marginFloorBp = Math.round(floor * 100);
  const r = o['unitPriceRounding'];
  if (r === 'floor' || r === 'ceil' || r === 'round') out.unitRounding = r;
  const lr = o['listPriceRounding'];
  if (typeof lr === 'object' && lr !== null) {
    const l = lr as Record<string, unknown>;
    const b1 = num(l, 'below1000');
    const b2 = num(l, 'below10000');
    const b3 = num(l, 'otherwise');
    if (b1 !== undefined && b2 !== undefined && b3 !== undefined) {
      out.listRounding = {
        bands: [
          { below: 1000, unit: b1 },
          { below: 10000, unit: b2 },
          { below: null, unit: b3 },
        ],
        mode: 'ceil',
      };
    }
  }
  return out;
}

/** Company profile from a JSON object like public/sample/company.json. */
export function companyFromJson(json: unknown): Company {
  const o = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
  const branches = Array.isArray(o['branches'])
    ? o['branches'].filter((b): b is string => typeof b === 'string')
    : [];
  return {
    name: str(o, 'name'),
    business: str(o, 'business'),
    address: str(o, 'address'),
    tel: str(o, 'tel'),
    representative: str(o, 'representative'),
    branches,
    ...(str(o, 'prefecture') ? { prefecture: str(o, 'prefecture') } : {}),
  };
}
