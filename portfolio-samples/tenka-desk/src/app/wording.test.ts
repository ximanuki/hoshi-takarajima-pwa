/**
 * Wording rules for the UI (public portfolio): no "AI-optimal price", no
 * guarantee of legal compliance, no "first in the industry".
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const FORBIDDEN: readonly [RegExp, string][] = [
  [/AI\s*最適/i, 'AI最適価格のような表現'],
  [/最適価格/, '最適価格'],
  [/業界初/, '業界初'],
  [/(取適法|下請法|独占禁止法|独禁法)[^。\n]{0,12}(対応|準拠|遵守)[^。\n]{0,8}保証/, '法令対応の保証'],
  [/保証します/, '保証の表現'],
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx|css)$/.test(name) && !name.endsWith('.test.ts') ? [p] : [];
  });
}

describe('UI wording', () => {
  const project = join(import.meta.dirname, '..', '..');
  const sources = [...files(import.meta.dirname), join(project, 'index.html')].map((p) =>
    relative(project, p),
  );

  it.each(sources)('%s has no forbidden claims', (rel) => {
    const text = readFileSync(join(project, rel), 'utf8');
    for (const [re, what] of FORBIDDEN) expect(re.test(text), `${rel}: ${what}`).toBe(false);
  });
});
