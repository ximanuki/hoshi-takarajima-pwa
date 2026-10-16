/** Minimal RFC 4180 CSV writer / reader (no dependencies). */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type CsvOptions = {
  bom: boolean;
  eol: '\r\n' | '\n';
  /** Quote every field (販売管理A style) instead of only when needed. */
  quoteAll: boolean;
};

export const STANDARD: CsvOptions = { bom: false, eol: '\n', quoteAll: false };

function field(v: string | number, quoteAll: boolean): string {
  const s = String(v);
  if (quoteAll || /[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: (string | number)[][], opt: CsvOptions): string {
  const parts: string[] = [];
  parts.push(header.map((h) => field(h, opt.quoteAll)).join(','));
  for (const r of rows) {
    if (r.length !== header.length) {
      throw new Error(`row has ${r.length} fields, header has ${header.length}: ${r.join('|')}`);
    }
    parts.push(r.map((v) => field(v, opt.quoteAll)).join(','));
  }
  return (opt.bom ? '﻿' : '') + parts.join(opt.eol) + opt.eol;
}

export function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

export function writeCsv(
  path: string,
  header: string[],
  rows: (string | number)[][],
  opt: CsvOptions = STANDARD,
): number {
  writeText(path, toCsv(header, rows, opt));
  return rows.length;
}

/** Parse CSV text (BOM, CRLF/LF and quoted fields with commas/newlines handled). */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur !== '' || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

/** Parse into objects keyed by header. */
export function parseCsvObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  const header = rows[0];
  return rows.slice(1).map((r) => {
    if (r.length !== header.length) throw new Error(`bad row width ${r.length}: ${r.join('|')}`);
    const o: Record<string, string> = {};
    header.forEach((h, i) => {
      o[h] = r[i];
    });
    return o;
  });
}
