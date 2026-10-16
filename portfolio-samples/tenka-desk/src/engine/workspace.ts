/**
 * Builds a Dataset from the files a user loads: each file is decoded, its
 * layout detected and imported, and the masters are put together.
 */

import { Dataset, inferRevisionDates } from './dataset.ts';
import { type IsoDate, toWareki } from './dates.ts';
import { type FileImport, type ImportIssue, type ImportOptions, importFile } from './importers.ts';
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
   * 改定日 for each agreements file (by file name). Without it, a single
   * agreements file is assigned to the single 定価改定 date found in the history.
   */
  revisionDates?: Record<string, IsoDate>;
}

export interface Workspace {
  dataset: Dataset;
  files: FileImport[];
  /** sales exports by file name, in load order */
  sales: Map<string, SalesLine[]>;
  priceMasters: Map<string, PriceMasterRow[]>;
  newListPrices: NewListPrice[];
  importIssues: { file: string; issue: ImportIssue }[];
  notes: string[];
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
  const agreementFiles: { name: string; rows: RevisionAgreement[] }[] = [];
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
        agreementFiles.push({ name: f.name, rows: d.result.records });
        break;
      case 'sales':
        sales.set(f.name, d.result.records);
        break;
      case 'priceMaster':
        priceMasters.set(f.name, d.result.records);
        break;
    }
  }

  const inferred = inferRevisionDates(listHist);
  const revisions: Revision[] = [];
  for (const af of agreementFiles) {
    let date = options.revisionDates?.[af.name];
    if (date === undefined) {
      if (agreementFiles.length === 1 && inferred.length === 1) {
        date = inferred[0];
        if (date !== undefined)
          notes.push(
            `${af.name} を ${toWareki(date)} の定価改定の合意状況として扱いました（定価の履歴から判断）。`,
          );
      }
    }
    if (date === undefined) {
      notes.push(
        `${af.name}: どの定価改定の合意状況か決められないため、使っていません。改定日を指定してください。`,
      );
      continue;
    }
    revisions.push({ date, label: `${toWareki(date)} 定価改定`, agreements: af.rows });
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
  for (const [name, lines] of sales) sales.set(name, dataset.resolveLines(lines));
  for (const [name, rows] of priceMasters) {
    priceMasters.set(
      name,
      rows.map((r) => ({ ...r, sku: dataset.resolveSku(r.skuKey) })),
    );
  }
  return { dataset, files: [...files], sales, priceMasters, newListPrices, importIssues, notes };
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
