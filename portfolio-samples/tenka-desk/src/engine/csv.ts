/** RFC 4180 CSV reader and writer, without dependencies. */

/** U+FEFF byte order mark (written as a code point so it stays visible in the source). */
export const BOM = String.fromCharCode(0xfeff);

export interface CsvTable {
  header: string[];
  rows: string[][];
  delimiter: ',' | '\t';
}

/**
 * Parse delimited text into rows. Handles a leading BOM, CRLF / LF / CR line
 * ends, quoted fields with delimiters, doubled quotes and line breaks inside
 * quotes. A final line break does not create an empty row.
 */
export function parseCsv(text: string, delimiter: ',' | '\t' = ','): string[][] {
  const s = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  let fieldStarted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' && cur === '') {
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === delimiter) {
      row.push(cur);
      cur = '';
      fieldStarted = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
      fieldStarted = false;
    } else {
      cur += ch;
      fieldStarted = true;
    }
  }
  if (fieldStarted || cur !== '' || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

/** Tab-separated if the first line has tabs and no commas; comma otherwise. */
export function sniffDelimiter(text: string): ',' | '\t' {
  const nl = text.search(/[\r\n]/);
  const first = nl < 0 ? text : text.slice(0, nl);
  return first.includes('\t') && !first.includes(',') ? '\t' : ',';
}

/**
 * Parse into a header plus rows. Blank lines are dropped; header cells are
 * trimmed. Rows keep their original width (importers report width mismatches).
 */
export function readTable(text: string): CsvTable {
  const delimiter = sniffDelimiter(text);
  const all = parseCsv(text, delimiter).filter((r) => !(r.length === 1 && r[0]?.trim() === ''));
  const [header = [], ...rows] = all;
  return { header: header.map((h) => h.trim()), rows, delimiter };
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
