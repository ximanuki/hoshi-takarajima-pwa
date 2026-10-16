/**
 * The fictional (架空) sample data and the public statistics are static files
 * shipped next to the app (public/sample, public/stats). They are read from
 * the same place the app was loaded from; nothing else is fetched.
 */

import {
  type IndexDataset,
  type MinimumWageDataset,
  parseIndexDataset,
  parseMinimumWage,
  parseShunto,
  type ShuntoDataset,
  type StatsBundle,
} from '../engine/index.ts';

export type SampleLayout = 'A' | 'B';

const MASTER_FILES = [
  'company.json',
  'demo_settings.json',
  'customers.csv',
  'products.csv',
  'rate_tiers.csv',
  'categories.csv',
  'suppliers.csv',
  'list_price_history.csv',
  'cost_history.csv',
  'supplier_notices.csv',
  'revision_2025-04_agreements.csv',
  'next/list_prices_20261201.csv',
];

export function sampleFileNames(layout: SampleLayout): string[] {
  return [...MASTER_FILES, `special_prices_${layout}.csv`, `sales_${layout}_202410-202609.csv`];
}

export const SAMPLE_OUTCOMES = 'next/revision_2026-12_outcomes.csv';

export function sampleFollowupNames(layout: SampleLayout): { master: string; sales: string } {
  return {
    master: `next/price_master_${layout}_20261201.csv`,
    sales: `next/sales_${layout}_202612.csv`,
  };
}

export class SampleMissingError extends Error {
  constructor(name: string) {
    super(
      `サンプルデータ（${name}）が見つかりません。リポジトリには入っていないため、先に \`npm run sample\` で作成してください。`,
    );
    this.name = 'SampleMissingError';
  }
}

function assetUrl(path: string): string {
  return new URL(path, document.baseURI).toString();
}

/** Bytes of one sample file. A dev server answers unknown paths with index.html, which counts as missing. */
export async function fetchSample(name: string): Promise<Uint8Array> {
  const res = await fetch(assetUrl(`sample/${name}`));
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || type.includes('text/html')) throw new SampleMissingError(name);
  return new Uint8Array(await res.arrayBuffer());
}

export async function fetchSampleFiles(names: readonly string[]): Promise<{ name: string; bytes: Uint8Array }[]> {
  return Promise.all(names.map(async (name) => ({ name, bytes: await fetchSample(name) })));
}

export interface GuidelineInfo {
  title: string;
  url: string;
  summary: string[];
}

export interface StatsLoad {
  bundle: StatsBundle;
  guideline: GuidelineInfo | null;
  errors: string[];
}

let statsPromise: Promise<StatsLoad> | null = null;

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(assetUrl(path));
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || type.includes('text/html')) throw new Error(`${path} を読み込めません`);
  return res.json();
}

/** The bundled snapshots of public statistics (read once). */
export function loadStats(): Promise<StatsLoad> {
  if (statsPromise) return statsPromise;
  statsPromise = (async () => {
    const errors: string[] = [];
    const bundle: StatsBundle = {};
    const tryLoad = async <T>(path: string, parse: (j: unknown) => T): Promise<T | undefined> => {
      try {
        return parse(await getJson(path));
      } catch (e) {
        errors.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
        return undefined;
      }
    };
    const [cgpi, sppi, mw, shunto, index] = await Promise.all([
      tryLoad<IndexDataset>('stats/cgpi.json', parseIndexDataset),
      tryLoad<IndexDataset>('stats/sppi.json', parseIndexDataset),
      tryLoad<MinimumWageDataset>('stats/minimum-wage.json', parseMinimumWage),
      tryLoad<ShuntoDataset>('stats/shunto.json', parseShunto),
      tryLoad<unknown>('stats/index.json', (j) => j),
    ]);
    if (cgpi) bundle.cgpi = cgpi;
    if (sppi) bundle.sppi = sppi;
    if (mw) bundle.minimumWage = mw;
    if (shunto) bundle.shunto = shunto;
    let guideline: GuidelineInfo | null = null;
    const g = (index as { guideline?: { title_ja?: unknown; url?: unknown; summary_ja?: unknown } } | undefined)
      ?.guideline;
    if (g && typeof g.title_ja === 'string' && typeof g.url === 'string' && Array.isArray(g.summary_ja)) {
      guideline = {
        title: g.title_ja,
        url: g.url,
        summary: g.summary_ja.filter((x): x is string => typeof x === 'string'),
      };
    }
    return { bundle, guideline, errors };
  })();
  statsPromise.catch(() => {
    statsPromise = null;
  });
  return statsPromise;
}
