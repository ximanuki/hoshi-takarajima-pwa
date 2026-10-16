/**
 * Wording rules for everything that leaves the app or the repository (public
 * portfolio): the screens, the letter and evidence templates in the engine, the
 * READMEs, and the notes shipped with the statistics. No "AI-optimal price", no
 * claim or guarantee of legal compliance, no "first / only / No.1".
 *
 * Lines that list these expressions as ones the project does not use (「使わない表現」,
 * "Never used"), or that describe this test, are skipped.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const LAWS = '(?:取適法|中小受託取引適正化法|下請法|下請代金支払遅延等防止法|独占禁止法|独禁法)';

const FORBIDDEN: readonly [RegExp, string][] = [
  [/AI\s*最適/i, 'AI最適価格のような表現'],
  [/最適価格/, '最適価格'],
  [/AI[-\s]?optimal/i, 'AI-optimal price'],
  [/(?:業界|日本|世界)(?:初|唯一)|No\.?\s*1(?!\d)|ナンバーワン/i, '業界初・唯一・No.1'],
  [new RegExp(`${LAWS}[^。\\n]{0,12}(?:に)?(?:対応|準拠|適合|遵守)`), '法令への対応・準拠をうたう表現'],
  [/(?<!取)適法(?!性の判断)/, '「適法」'],
  [/違反(?:しない|を防|になりません|の心配)/, '法令違反を防ぐとうたう表現'],
  [/保証します|保証いたします/, '保証の表現'],
  [/compliant with|guarantee(?:s|d)? (?:legal )?compliance/i, 'compliance claim (English)'],
];

const SKIP_LINE = /使わない表現|Never used|FORBIDDEN|wording\.test\.ts/;

const PROJECT = join(import.meta.dirname, '..', '..');

function files(dir: string, ext: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p, ext);
    return ext.test(name) && !name.endsWith('.test.ts') ? [p] : [];
  });
}

function sourcesToCheck(): string[] {
  return [
    ...files(join(PROJECT, 'src'), /\.(ts|tsx|css)$/),
    join(PROJECT, 'index.html'),
    join(PROJECT, 'README.md'),
    join(PROJECT, 'README.en.md'),
    ...files(join(PROJECT, 'docs'), /\.md$/),
    ...files(join(PROJECT, 'public', 'stats'), /\.(md|json)$/),
  ]
    .filter((p) => existsSync(p))
    .map((p) => relative(PROJECT, p));
}

function violations(text: string): string[] {
  const out: string[] = [];
  text.split('\n').forEach((line, i) => {
    if (SKIP_LINE.test(line)) return;
    for (const [re, what] of FORBIDDEN) if (re.test(line)) out.push(`${i + 1}行目: ${what}: ${line.trim()}`);
  });
  return out;
}

describe('wording', () => {
  const sources = sourcesToCheck();

  it('covers the letter templates, the READMEs and the statistics notes', () => {
    for (const f of [
      'src/engine/letter.ts',
      'src/engine/evidence.ts',
      'README.md',
      'README.en.md',
      'public/stats/SOURCES.md',
      'public/stats/index.json',
    ])
      expect(sources).toContain(f);
  });

  it.each(sources)('%s has no forbidden claims', (rel) => {
    expect(violations(readFileSync(join(PROJECT, rel), 'utf8'))).toEqual([]);
  });

  it('catches the expressions it is meant to catch', () => {
    for (const bad of [
      '取適法に対応',
      '下請法準拠',
      '独占禁止法に適合した価格',
      'この価格は適法です',
      '業界唯一の機能',
      '日本初',
      'No.1の実績',
      '中小受託取引適正化法を遵守',
      '法令違反を防ぎます',
      'AI最適価格',
    ])
      expect(violations(bad), bad).not.toEqual([]);
    for (const ok of [
      '中小受託取引適正化法（取適法）などの判断は、相談窓口で確認してください',
      '適合率（行）',
      'PDL1.0に準拠した条件で利用できます',
      'No.12 面談',
    ])
      expect(violations(ok), ok).toEqual([]);
  });
});
