/**
 * Guards for the engine's principles: no network, no DOM or browser storage,
 * no clock and no randomness, so results depend only on the input files.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as engine from './index.ts';

const DIR = import.meta.dirname;
const sources = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => ({ f, text: readFileSync(join(DIR, f), 'utf8') }));

const FORBIDDEN: [string, RegExp][] = [
  ['network', /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/],
  ['DOM / browser storage', /\bdocument\.|\bwindow\.|localStorage|sessionStorage|indexedDB/],
  ['clock', /Date\.now\s*\(|new Date\(\s*\)|performance\.now/],
  ['randomness', /Math\.random|crypto\.getRandomValues|randomUUID/],
  ['node-only modules', /from ['"]node:/],
];

describe('engine purity', () => {
  it('has engine sources to check', () => {
    expect(sources.length).toBeGreaterThan(15);
  });

  for (const [what, re] of FORBIDDEN) {
    it(`uses no ${what}`, () => {
      const offenders = sources.filter((s) => re.test(s.text)).map((s) => s.f);
      expect(offenders).toEqual([]);
    });
  }

  it('exposes the main entry points from index.ts', () => {
    for (const name of [
      'importFile',
      'loadWorkspace',
      'diagnose',
      'runScenario',
      'proposeListPrices',
      'proposePairs',
      'simulatePassThrough',
      'buildEvidence',
      'buildLetter',
      'appendEvent',
      'buildPriceMaster',
      'exportPriceMaster',
      'checkFollowup',
    ]) {
      expect(typeof (engine as Record<string, unknown>)[name], name).toBe('function');
    }
  });
});
