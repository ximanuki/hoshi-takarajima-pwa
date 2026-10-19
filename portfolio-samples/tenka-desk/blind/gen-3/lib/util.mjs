// 共通ユーティリティ（乱数・日付・文字コード・CSV）。時計・Math.random は使わない。
import fs from 'node:fs';
import path from 'node:path';

// ---------- 乱数 ----------
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// Math.exp を使わない（四則演算のみ。環境差が出ない）
export function expo(x) {
  const n = Math.round(x);
  const f = x - n;
  let r = 1;
  let t = 1;
  for (let i = 1; i <= 16; i++) {
    t = (t * f) / i;
    r += t;
  }
  const E = 2.718281828459045;
  const base = n >= 0 ? E : 1 / E;
  let e = 1;
  for (let i = 0; i < Math.abs(n); i++) e *= base;
  return e * r;
}

export class RNG {
  constructor(seed) {
    this.s = seed >>> 0;
  }
  next() {
    let t = (this.s += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  range(a, b) {
    return a + this.next() * (b - a);
  }
  chance(p) {
    return this.next() < p;
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  weightedIndex(ws) {
    let tot = 0;
    for (const w of ws) tot += w;
    let r = this.next() * tot;
    for (let i = 0; i < ws.length; i++) {
      r -= ws[i];
      if (r < 0) return i;
    }
    return ws.length - 1;
  }
  normal() {
    let s = 0;
    for (let i = 0; i < 12; i++) s += this.next();
    return s - 6;
  }
  lognormal(sigma) {
    return expo(sigma * this.normal());
  }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

// ---------- 日付（日番号 = 1970-01-01 からの日数） ----------
const MS = 86400000;
export const dn = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / MS);
export function ymd(n) {
  const t = new Date(n * MS);
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}
export const pad2 = (n) => String(n).padStart(2, '0');
export const iso = (n) => {
  const [y, m, d] = ymd(n);
  return `${y}-${pad2(m)}-${pad2(d)}`;
};
export const d8 = (n) => {
  const [y, m, d] = ymd(n);
  return `${y}${pad2(m)}${pad2(d)}`;
};
export const slash = (n) => {
  const [y, m, d] = ymd(n);
  return `${y}/${m}/${d}`;
};
export const dow = (n) => (((n + 4) % 7) + 7) % 7; // 0=日
export const monthKey = (n) => {
  const [y, m] = ymd(n);
  return y * 12 + (m - 1);
};

// 日本の祝日・社休（2025〜2026）
const HOLI = [
  [2025, 1, 1], [2025, 1, 13], [2025, 2, 11], [2025, 2, 24], [2025, 3, 20], [2025, 4, 29],
  [2025, 5, 5], [2025, 5, 6], [2025, 7, 21], [2025, 8, 11], [2025, 9, 15], [2025, 9, 23],
  [2025, 10, 13], [2025, 11, 3], [2025, 11, 24],
  [2026, 1, 1], [2026, 1, 12], [2026, 2, 11], [2026, 2, 23], [2026, 3, 20], [2026, 4, 29],
  [2026, 5, 4], [2026, 5, 5], [2026, 5, 6], [2026, 7, 20], [2026, 8, 11], [2026, 9, 21],
  [2026, 9, 22], [2026, 9, 23], [2026, 10, 12], [2026, 11, 3], [2026, 11, 23],
];
const HOLI_SET = new Set(HOLI.map(([y, m, d]) => dn(y, m, d)));
export function isBiz(n) {
  const w = dow(n);
  if (w === 0 || w === 6) return false;
  if (HOLI_SET.has(n)) return false;
  const [, m, d] = ymd(n);
  if (m === 12 && d >= 29) return false;
  if (m === 1 && d <= 3) return false;
  if (m === 8 && d >= 13 && d <= 15) return false;
  return true;
}
export function bizDays(from, to) {
  const out = [];
  for (let n = from; n <= to; n++) if (isBiz(n)) out.push(n);
  return out;
}

// ---------- 金額 ----------
export const mulRate = (list, rate1000) => Math.floor((list * rate1000) / 1000);

// ---------- 半角カナ ----------
const HW_MAP = new Map();
for (let cp = 0xff66; cp <= 0xff9d; cp++) {
  const hw = String.fromCodePoint(cp);
  HW_MAP.set(hw.normalize('NFKC'), hw);
}
export function toHalfKana(s) {
  let out = '';
  for (const ch of s) {
    if (HW_MAP.has(ch)) {
      out += HW_MAP.get(ch);
      continue;
    }
    const nfd = ch.normalize('NFD');
    if (nfd.length === 2 && HW_MAP.has(nfd[0])) {
      if (nfd[1] === '゙') {
        out += HW_MAP.get(nfd[0]) + 'ﾞ';
        continue;
      }
      if (nfd[1] === '゚') {
        out += HW_MAP.get(nfd[0]) + 'ﾟ';
        continue;
      }
    }
    out += ch;
  }
  return out;
}

// ---------- Shift_JIS (Windows-31J) エンコーダ ----------
let SJIS_MAP = null;
function buildSjis() {
  const dec = new TextDecoder('shift_jis');
  const map = new Map();
  const leads = [];
  for (let b = 0x81; b <= 0x9f; b++) leads.push(b);
  for (let b = 0xe0; b <= 0xfc; b++) leads.push(b);
  for (const lead of leads) {
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      const s = dec.decode(Uint8Array.of(lead, trail));
      if ([...s].length === 1 && s !== '�' && !map.has(s)) map.set(s, [lead, trail]);
    }
  }
  return map;
}
export function encodeSjis(str) {
  if (!SJIS_MAP) SJIS_MAP = buildSjis();
  const bytes = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) bytes.push(cp);
    else if (cp >= 0xff61 && cp <= 0xff9f) bytes.push(cp - 0xff61 + 0xa1);
    else {
      const b = SJIS_MAP.get(ch);
      if (!b) throw new Error(`Shift_JIS に変換できない文字: ${ch} (U+${cp.toString(16)})`);
      bytes.push(b[0], b[1]);
    }
  }
  return Buffer.from(bytes);
}

// ---------- CSV ----------
export function csvField(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function csvText(rows, eol = '\r\n') {
  return rows.map((r) => r.map(csvField).join(',')).join(eol) + eol;
}
export function writeBuf(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}
export const BOM = '﻿';
