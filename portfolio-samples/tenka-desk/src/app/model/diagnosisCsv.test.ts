/** The diagnosis CSV marks the amounts that depend on the agreements as 仮 while the file is not used. All data is fictional (架空). */

import { describe, expect, it } from 'vitest';
import { diagnose, type IsoDate, loadWorkspace, parseCsv } from '../../engine/index.ts';
import { DECLINED_VOLUME_DISCOUNT_LINE, twoRevisionFiles } from '../../engine/testing/twoRevisions.ts';
import { diagnosisCsv } from './diagnosisCsv.ts';

function result(revisionDates?: Record<string, IsoDate>) {
  // the 反映漏れ of the fixture, the declined customer's correct 数量値引 (掛率ランク外 only
  // while the file is not used), and a 粗利下限割れ: 下限 32% makes the correct 864円 (原単価 600円) too low
  const files = twoRevisionFiles({ extraSales: [DECLINED_VOLUME_DISCOUNT_LINE] });
  const ws = loadWorkspace(
    files.map((f) => ({ name: f.name, data: f.text })),
    { settings: { marginFloorBp: 3200 }, ...(revisionDates ? { revisionDates } : {}) },
  );
  return diagnose(ws.dataset, ws.sales.get('sales.csv') ?? []);
}

const rowsOf = (text: string) => parseCsv(text.replace(/^﻿/, ''));
const note = (r: string[]) => r[r.length - 1] ?? '';

describe('diagnosisCsv', () => {
  it('adds a 注記 column and marks 反映漏れ and 掛率ランク外 rows as 仮 when the agreements file is not used', () => {
    const { name, text } = diagnosisCsv(result(), { provisional: true });
    expect(name).toBe('利益漏れ診断_20251130_仮.csv');
    const [header = [], ...rows] = rowsOf(text);
    expect(header[header.length - 1]).toBe('注記');
    const ofType = (t: string) => rows.filter((r) => r[1] === t);
    expect(ofType('反映漏れ（旧価格のまま）').length).toBeGreaterThan(0);
    for (const r of ofType('反映漏れ（旧価格のまま）'))
      expect(note(r)).toMatch(/^仮：合意状況のファイルを使っていないため/);
    // the declined customer's correct volume discount looks out of the rank range: also 仮
    const tier = ofType('掛率ランク外');
    expect(tier.map((r) => [r[2], r[4], r[11]])).toEqual([['000002', 'DB-2005', '960']]);
    expect(note(tier[0] ?? [])).toMatch(/^仮：/);
    // 粗利下限割れ compares the bill with the cost only: not 仮
    const floor = ofType('粗利下限割れ');
    expect(floor.length).toBeGreaterThan(0);
    for (const r of floor) expect(note(r)).toBe('');
  });

  it('has no 仮 anywhere, and no 掛率ランク外, once the agreements file is used', () => {
    const { name, text } = diagnosisCsv(result({ 'agreements.csv': '2025-10-01' }), { provisional: false });
    expect(name).toBe('利益漏れ診断_20251130.csv');
    expect(text).not.toContain('仮');
    const [header = [], ...rows] = rowsOf(text);
    expect(header[header.length - 1]).toBe('注記');
    expect(rows.filter((r) => r[1] === '掛率ランク外')).toEqual([]);
  });
});
