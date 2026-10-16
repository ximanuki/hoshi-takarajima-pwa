import { describe, expect, it } from 'vitest';
import { BOM, parseCsv, parseCsvLines, readTable, sniffDelimiter, toCsv } from './csv.ts';

describe('parseCsv', () => {
  it('handles quotes, commas, doubled quotes and line breaks in fields', () => {
    const text = 'a,b,c\r\n"1,234","say ""hi""","line1\nline2"\r\n,,\r\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['1,234', 'say "hi"', 'line1\nline2'],
      ['', '', ''],
    ]);
  });

  it('strips a BOM and accepts LF, CRLF and CR', () => {
    expect(parseCsv(`${BOM}x,y\ny,z`)).toEqual([
      ['x', 'y'],
      ['y', 'z'],
    ]);
    expect(parseCsv('x\ry\r\nz')).toEqual([['x'], ['y'], ['z']]);
  });

  it('keeps a last line without a line break and an empty quoted field', () => {
    expect(parseCsv('a,""')).toEqual([['a', '']]);
    expect(parseCsv('')).toEqual([]);
  });

  it('reads tab-separated text', () => {
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(sniffDelimiter('a,b\tc')).toBe(',');
    expect(readTable('a\tb\n1\t2\n').rows).toEqual([['1', '2']]);
  });
});

describe('readTable', () => {
  it('trims header cells and drops blank lines', () => {
    const t = readTable(' 得意先コード , 商品コード \n001001,DB-1001\n\n001002,DB-1002\n');
    expect(t.header).toEqual(['得意先コード', '商品コード']);
    expect(t.rows).toHaveLength(2);
  });
});

describe('toCsv', () => {
  it('writes 販売管理A style (BOM, CRLF, all quoted)', () => {
    const s = toCsv(['a', 'b'], [['1', 'x"y']], { bom: true, eol: '\r\n', quoteAll: true });
    expect(s).toBe(`${BOM}"a","b"\r\n"1","x""y"\r\n`);
  });

  it('writes plain style and round-trips', () => {
    const rows = [
      ['1,234', 'a\nb', 'plain'],
      ['', '"', '全角　スペース'],
    ];
    const s = toCsv(['x', 'y', 'z'], rows, { bom: false, eol: '\n', quoteAll: false });
    expect(s.startsWith('x,y,z\n"1,234"')).toBe(true);
    expect(parseCsv(s)).toEqual([['x', 'y', 'z'], ...rows]);
  });

  it('refuses rows of the wrong width', () => {
    expect(() => toCsv(['a'], [['1', '2']], { bom: false, eol: '\n', quoteAll: false })).toThrow(RangeError);
  });
});

describe('parseCsvLines: physical lines and unclosed quotes', () => {
  it('gives the line each row starts on, counting blank lines and line breaks in quotes', () => {
    const p = parseCsvLines('a,b\n\n\n1,2\n"x\ny",3\n4,5\n');
    expect(p.lines).toEqual([1, 2, 3, 4, 5, 7]);
  });

  it('reads an unclosed quote as a character and says where it was', () => {
    const text = `a,b\n"x,1\n${'1,2\n'.repeat(1000)}`;
    const t = readTable(text);
    expect(t.rows).toHaveLength(1001);
    expect(t.rows[0]).toEqual(['"x', '1']);
    expect(t.warnings).toEqual([
      { line: 2, message: '2行目の「"」が閉じられていないため、ふつうの文字として読みました' },
    ]);
    expect(t.rowLines.slice(0, 3)).toEqual([2, 3, 4]);
  });

  it('drops rows whose cells are all blank (Excel leaves ",,,," rows)', () => {
    const t = readTable('a,b\n1,2\n,\n , \n3,4\n,,\n');
    expect(t.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(t.rowLines).toEqual([2, 5]);
  });
});
