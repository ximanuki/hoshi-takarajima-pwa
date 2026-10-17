/**
 * The documents say the same thing as the app on the points the blind
 * evaluation found unclear: which 0-yen lines are free goods (無償品), that a bill
 * above the correct price is not a leak, how the 前回の改定日 is decided, and how
 * each ambiguous case is read.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSampleRemark } from '../engine/index.ts';

const PROJECT = join(import.meta.dirname, '..', '..');
const read = (rel: string) => readFileSync(join(PROJECT, rel), 'utf8');

/** The text of a `## heading` section, up to the next `## `. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`## ${heading}`);
  if (start < 0) return '';
  const next = text.indexOf('\n## ', start + 3);
  return text.slice(start, next < 0 ? undefined : next);
}

const FREE_WORDS = /見本.{0,4}サンプル.{0,4}無償.{0,4}試供/;

describe('documents', () => {
  it('name the same four words for free goods as the app', () => {
    for (const rel of ['README.md', 'data-gen/README.md', 'docs/evaluation.md', 'src/engine/diagnosis.ts']) {
      expect(read(rel), rel).toMatch(FREE_WORDS);
    }
    for (const w of ['見本', 'サンプル', '無償', '試供'])
      expect(isSampleRemark(`販促品(${w})`), w).toBe(true);
  });

  it('say that a bill above the correct price is not counted as a leak', () => {
    for (const rel of ['README.md', 'data-gen/README.md']) {
      const text = read(rel);
      expect(text, rel).toMatch(/正しい単価より高い請求[^。]*利益漏れに数え(ず|ない)/);
      expect(text, rel).toContain('基準より高い請求');
    }
  });

  it('explain how to enter the 前回の改定日 and when the app decides it', () => {
    const s = section(read('README.md'), '自社のデータで使うとき：前回の改定日');
    expect(s).toContain('前回の改定日');
    expect(s).toContain('改定として扱いました');
    expect(s).toContain('この日付で計算し直す');
    expect(s).toContain('previousRevisionDate');
  });

  it('list how the app reads each ambiguous case in one place', () => {
    const s = section(read('README.md'), '判断が分かれる場面での読み方');
    for (const k of [
      '協議中',
      '合意状況に行がない',
      '2回前',
      '値下げ',
      '特値の期間が重なる',
      '数量値引',
      '得意先マスタにない',
      '後の別の改定',
      '改定のあとに出た商品',
      '小数',
      '0円',
    ])
      expect(s, k).toContain(k);
  });
});
