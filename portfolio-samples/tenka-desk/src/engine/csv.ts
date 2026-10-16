/** RFC 4180 CSV reader and writer, without dependencies. */

/** U+FEFF byte order mark (written as a code point so it stays visible in the source). */
export const BOM = String.fromCharCode(0xfeff);

export interface CsvWarning {
  /** 1-based physical line in the file */
  line: number;
  message: string;
}

export interface CsvTable {
  header: string[];
  rows: string[][];
  /** 1-based physical line where each row of `rows` starts (blank rows and line breaks inside quotes counted) */
  rowLines: number[];
  delimiter: ',' | '\t';
  /** problems the parser recovered from (e.g. a quote that is never closed) */
  warnings: CsvWarning[];
}

export interface CsvParse {
  rows: string[][];
  /** 1-based physical line where each row starts */
  lines: number[];
  warnings: CsvWarning[];
}

/** More unclosed quotes than this: the file is not CSV the parser can repair. */
const MAX_QUOTE_REPAIRS = 100;

export class CsvError extends Error {
  readonly line: number;
  constructor(line: number, message: string) {
    super(message);
    this.name = 'CsvError';
    this.line = line;
  }
}

/**
 * Parse delimited text into rows, with the physical line each row starts on.
 * Handles a leading BOM, CRLF / LF / CR line ends, quoted fields with
 * delimiters, doubled quotes and line breaks inside quotes. A final line break
 * does not create an empty row.
 *
 * A quote that opens a field and is never closed would swallow the rest of the
 * file into one field. Instead the parser goes back, reads that quote as an
 * ordinary character and continues, and reports the line in `warnings`.
 */
export function parseCsvLines(text: string, delimiter: ',' | '\t' = ','): CsvParse {
  const s = text.startsWith(BOM) ? text.slice(1) : text;
  const literalQuotes = new Set<number>();
  const warnings: CsvWarning[] = [];
  const rows: string[][] = [];
  const lines: number[] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  let fieldStarted = false;
  let line = 1;
  let rowLine = 1;
  /** state where the open quote started, to go back to if it is never closed */
  let open: { i: number; line: number; rowLine: number; rows: number; row: string[] } | null = null;
  let i = 0;
  for (;;) {
    for (; i < s.length; i++) {
      const ch = s[i];
      if (inQuotes) {
        if (ch === '"') {
          if (s[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
            open = null;
          }
        } else {
          if (ch === '\n' || (ch === '\r' && s[i + 1] !== '\n')) line++;
          cur += ch;
        }
        continue;
      }
      if (ch === '"' && cur === '' && !literalQuotes.has(i)) {
        inQuotes = true;
        fieldStarted = true;
        open = { i, line, rowLine, rows: rows.length, row: [...row] };
      } else if (ch === delimiter) {
        row.push(cur);
        cur = '';
        fieldStarted = true;
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(cur);
        rows.push(row);
        lines.push(rowLine);
        line++;
        rowLine = line;
        row = [];
        cur = '';
        fieldStarted = false;
      } else {
        cur += ch;
        fieldStarted = true;
      }
    }
    if (!inQuotes || open === null) break;
    // the text ended inside quotes: read the opening quote as a character and parse again from it
    if (literalQuotes.size >= MAX_QUOTE_REPAIRS)
      throw new CsvError(open.line, `${open.line}行目などで「"」が閉じられていません。CSVとして読めません`);
    warnings.push({
      line: open.line,
      message: `${open.line}行目の「"」が閉じられていないため、ふつうの文字として読みました`,
    });
    literalQuotes.add(open.i);
    i = open.i;
    line = open.line;
    rowLine = open.rowLine;
    rows.length = open.rows;
    lines.length = open.rows;
    row = open.row;
    cur = '';
    inQuotes = false;
    fieldStarted = true;
    open = null;
  }
  if (fieldStarted || cur !== '' || row.length > 0) {
    row.push(cur);
    rows.push(row);
    lines.push(rowLine);
  }
  return { rows, lines, warnings };
}

/** Rows only (see parseCsvLines). */
export function parseCsv(text: string, delimiter: ',' | '\t' = ','): string[][] {
  return parseCsvLines(text, delimiter).rows;
}

/** Tab-separated if the first line has tabs and no commas; comma otherwise. */
export function sniffDelimiter(text: string): ',' | '\t' {
  const nl = text.search(/[\r\n]/);
  const first = nl < 0 ? text : text.slice(0, nl);
  return first.includes('\t') && !first.includes(',') ? '\t' : ',';
}

/**
 * Parse into a header plus rows. Rows whose cells are all blank (empty lines,
 * and the ",,,," rows Excel leaves at the end) are dropped; header cells are
 * trimmed. Rows keep their original width (importers report width mismatches)
 * and their physical line in the file.
 */
export function readTable(text: string): CsvTable {
  const delimiter = sniffDelimiter(text);
  const parsed = parseCsvLines(text, delimiter);
  const keep: number[] = [];
  parsed.rows.forEach((r, i) => {
    if (!r.every((c) => c.trim() === '')) keep.push(i);
  });
  const [headerIdx, ...rowIdx] = keep;
  const header = headerIdx === undefined ? [] : (parsed.rows[headerIdx] ?? []);
  return {
    header: header.map((h) => h.trim()),
    rows: rowIdx.map((i) => parsed.rows[i] ?? []),
    rowLines: rowIdx.map((i) => parsed.lines[i] ?? i + 1),
    delimiter,
    warnings: parsed.warnings,
  };
}

export interface CsvWriteOptions {
  bom: boolean;
  eol: '\r\n' | '\n';
  /** Quote every field (販売管理A style) instead of only where needed. */
  quoteAll: boolean;
}

function field(v: string | number, quoteAll: boolean): string {
  const s = String(v);
  if (quoteAll || /[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Serialise a table. The text includes U+FEFF when bom is true. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number)[])[],
  opt: CsvWriteOptions,
): string {
  const lines = [header.map((h) => field(h, opt.quoteAll)).join(',')];
  for (const r of rows) {
    if (r.length !== header.length) {
      throw new RangeError(`row has ${r.length} fields but the header has ${header.length}`);
    }
    lines.push(r.map((v) => field(v, opt.quoteAll)).join(','));
  }
  return (opt.bom ? BOM : '') + lines.join(opt.eol) + opt.eol;
}
