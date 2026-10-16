import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileRowsError, readOutcomesFile, readPriceMasterFile, readSalesFile } from './outputs.ts';

const file = (name: string, text: string) => ({ name, bytes: new TextEncoder().encode(text) });

/** The rows the error lists, or the value returned when nothing was thrown. */
function problemsOf(read: () => unknown): string[] | 'no error' {
  try {
    read();
    return 'no error';
  } catch (e) {
    if (e instanceof FileRowsError) return e.problems;
    throw e;
  }
}

const OUTCOMES_HEADER = '得意先コード,得意先名,協議結果,適用日,対象外カテゴリ,備考';

describe('readOutcomesFile', () => {
  it('reads a file whose rows are all readable', () => {
    const records = readOutcomesFile(
      file('outcomes.csv', `${OUTCOMES_HEADER}\n001001,甲商店,合意,2026-12-01,,\n001002,乙商店,見送り,,,\n`),
    );
    expect(records.map((r) => r.cust)).toEqual(['001001', '001002']);
  });

  it('refuses the file when a row cannot be read, listing the row and the reason', () => {
    // 001002 agreed, but its 適用日 is not a date: it would be left out of the new price master
    const f = file(
      'next/outcomes.csv',
      `${OUTCOMES_HEADER}\n001001,甲商店,合意,2026-12-01,,\n001002,乙商店,合意,2026-13-01,,\n001003,丙商店,見送り,,,\n`,
    );
    expect(problemsOf(() => readOutcomesFile(f))).toEqual([
      '3行目「適用日」：日付として読めません（2026-13-01）',
    ]);
    expect(() => readOutcomesFile(f)).toThrow(/outcomes\.csv に読めない行が1行あります/);
  });

  it('refuses a 一部合意 row without 対象外カテゴリ', () => {
    const f = file('outcomes.csv', `${OUTCOMES_HEADER}\n001001,甲商店,一部合意,2026-12-01,,\n`);
    expect(problemsOf(() => readOutcomesFile(f))).toEqual([
      '2行目「対象外カテゴリ」：一部合意ですが対象外カテゴリが空です。据え置くカテゴリを書いてください',
    ]);
  });
});

const MASTER_B = '得意先CD,品番,適用開始日,売単価,旧売単価';

describe('readPriceMasterFile', () => {
  it('reads a file whose rows are all readable', () => {
    const rows = readPriceMasterFile(
      file('master.csv', `${MASTER_B}\n1001,BT-1098,20261201,3825,3555\n1002,BT-1134,20261201,2025,1890\n`),
    );
    expect(rows).toHaveLength(2);
  });

  it('refuses the file when a row cannot be read, so the 反映チェック is not run without it', () => {
    const f = file(
      'master.csv',
      `${MASTER_B}\n1001,BT-1098,20261201,3825,3555\n1002,BT-1134,20261201,２千円,1890\n1003,BT-1134,2026/12/32,2025,1890\n`,
    );
    expect(problemsOf(() => readPriceMasterFile(f))).toEqual([
      '3行目「売単価」：整数として読めません（２千円）',
      '4行目「適用開始日」：日付として読めません（2026/12/32）',
    ]);
  });

  it('refuses the file when a row has the wrong number of columns', () => {
    const f = file('master.csv', `${MASTER_B}\n1001,BT-1098,20261201,3825\n`);
    expect(problemsOf(() => readPriceMasterFile(f))).toEqual([
      '2行目：列の数が見出しと違います（4列／見出し5列）',
    ]);
  });
});

const SALES_B =
  '伝票日付,伝票No,明細No,得意先CD,得意先略称,品番,品名,売上区分,数量,単位,標準価格,掛率,売単価,売上金額,原価単価,原価金額,単価種別,摘要';
const sale = (date: string, slip: string, listPrice = '1650') =>
  `${date},${slip},1,1011,木漏日商店(株),DB1002,段ボール箱,1,15,ケース,${listPrice},0.650,1072,16080,699.91,10499,1,`;

describe('readSalesFile', () => {
  it('reports the rows it left out, with the reasons', () => {
    const f = file(
      'sales.csv',
      [SALES_B, sale('20261201', '1'), sale('20261299', '2'), sale('20261202', '3', '千六百')].join('\n'),
    );
    const read = readSalesFile(f);
    expect(read.lines.map((l) => l.slip)).toEqual(['1', '3']);
    // row 4 is kept (an unreadable 標準価格 is read as blank), so only row 3 is reported as left out
    expect(read.skippedRows).toBe(1);
    expect(read.problems).toEqual(['3行目「伝票日付」：日付として読めません（20261299）']);
  });

  it('reports nothing when every row is read', () => {
    const read = readSalesFile(file('sales.csv', [SALES_B, sale('20261201', '1')].join('\n')));
    expect(read).toMatchObject({ skippedRows: 0, problems: [] });
  });
});

const NEXT = join(import.meta.dirname, '..', '..', '..', 'public', 'sample', 'next');
const sample = (name: string) => ({ name, bytes: new Uint8Array(readFileSync(join(NEXT, name))) });

describe.skipIf(!existsSync(join(NEXT, 'revision_2026-12_outcomes.csv')))('sample files (架空)', () => {
  it('are read without refusals', () => {
    expect(readOutcomesFile(sample('revision_2026-12_outcomes.csv')).length).toBeGreaterThan(0);
    for (const layout of ['A', 'B']) {
      expect(readPriceMasterFile(sample(`price_master_${layout}_20261201.csv`)).length).toBeGreaterThan(0);
      expect(readSalesFile(sample(`sales_${layout}_202612.csv`)).skippedRows).toBe(0);
    }
  });
});
