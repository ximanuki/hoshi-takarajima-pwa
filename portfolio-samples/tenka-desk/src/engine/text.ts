/**
 * Text normalisation for data exported by 販売管理 systems:
 * 全角/半角, 半角カナ, 品番ゆれ, 得意先コードのゼロ埋め, and loose number parsing.
 *
 * NFKC turns 全角英数字 into ASCII and 半角カナ into 全角カナ, so data exported in
 * either style ends up in one canonical form.
 */

import { divRound } from './money.ts';

/** NFKC and trim. "ＤＢ－１００１ " -> "DB-1001", "ｻﾝﾌﾟﾙ" -> "サンプル". */
export function normalizeText(raw: string): string {
  return raw.normalize('NFKC').trim();
}

/**
 * Hyphen-like characters and spaces that appear inside product codes, including
 * the long vowel mark (ー/ｰ) that gets typed instead of a hyphen.
 */
const CODE_NOISE = /[\s\-‐‑‒–—―−ー－ｰ_]/g;

/**
 * Matching key for 商品コード / 品番: NFKC, upper case, without spaces, hyphens
 * and hyphen look-alikes. "ＤＢ－１００１", "db-1001 ", "ＤＢー１００１" -> "DB1001".
 * The product master's own codes go through the same function, so a sales line
 * matches its product whichever spelling the system printed.
 */
export function codeKey(raw: string): string {
  return raw.normalize('NFKC').toUpperCase().replace(CODE_NOISE, '');
}

/** 得意先コード: digits only, zero-padded. "００１００１" / "1001" -> "001001". Empty input -> "". */
export function customerKey(raw: string, width = 6): string {
  const digits = raw.normalize('NFKC').replace(/[^0-9]/g, '');
  if (digits === '') return '';
  return digits.padStart(width, '0');
}

const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);

/** ASCII -> 全角 (space -> U+3000). Kana and kanji are left as they are. */
export function toFullWidth(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c === 0x20) out += IDEOGRAPHIC_SPACE;
    else if (c >= 0x21 && c <= 0x7e) out += String.fromCharCode(c + 0xfee0);
    else out += ch;
  }
  return out;
}

/**
 * Integer as sales systems and Excel print it: "1,234" / "１，２３４" / "¥1,234" /
 * "￥700" / "1,234円" / "△1,234" / "▲12" / "-12" / "(12)" / "1234-" (trailing minus) /
 * "10.00" (zero decimals). Returns null on anything else, e.g. "10.5".
 * (A yen sign read from a Shift_JIS file can arrive as a backslash; it is dropped too.)
 */
export function parseIntLoose(raw: string): number | null {
  let s = raw.normalize('NFKC').replace(/[,\s円¥\\]/g, '');
  let neg = false;
  if (/^[△▲-]/.test(s)) {
    neg = true;
    s = s.slice(1);
  } else if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  } else if (/[△▲-]$/.test(s)) {
    neg = true;
    s = s.slice(0, -1);
  }
  if (/^\d+\.0*$/.test(s)) s = s.slice(0, s.indexOf('.'));
  if (!/^\d+$/.test(s)) return null;
  const v = Number(s);
  if (!Number.isSafeInteger(v)) return null;
  return neg ? -v : v;
}

/**
 * Decimal number to an integer count of 1/scale units, exactly (no float maths).
 * parseScaled("1,234.5", 100) -> 123450; parseScaled("72.0", 10) -> 720.
 * More decimals than the scale allows are rejected rather than silently rounded.
 */
export function parseScaled(raw: string, scale: 1 | 10 | 100 | 1000 | 10000): number | null {
  const s = raw.normalize('NFKC').replace(/[,\s円%％¥\\]/g, '');
  const m = /^([△▲-]?)(\d*)(?:\.(\d*))?([△▲-]?)$/.exec(s);
  if (!m) return null;
  const [, lead = '', intPart = '', frac = '', trail = ''] = m;
  if (lead && trail) return null;
  const sign = lead || trail;
  if (intPart === '' && frac === '') return null;
  const digits = String(scale).length - 1;
  if (frac.replace(/0+$/, '').length > digits) return null;
  const v = Number(intPart || '0') * scale + Number(frac.padEnd(digits, '0').slice(0, digits) || '0');
  if (!Number.isSafeInteger(v)) return null;
  return sign ? -v : v;
}

/** 原単価 "1,234.50" -> 123450 (銭). */
export function parseSen(raw: string): number | null {
  return parseScaled(raw, 100);
}

/** 掛率 written as a percentage ("72.0", "72.5%") -> permille (720, 725). */
export function parsePercentPm(raw: string): number | null {
  return parseScaled(raw, 10);
}

/** 1234567 -> "1,234,567" (no locale dependency). */
export function withCommas(n: number): string {
  const neg = n < 0;
  const s = String(Math.abs(n));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return neg ? `-${out}` : out;
}

/** 123450 銭 -> "1,234.50". */
export function formatSen(sen: number, commas = true): string {
  const neg = sen < 0;
  const a = Math.abs(sen);
  const yen = Math.floor(a / 100);
  const frac = String(a % 100).padStart(2, '0');
  return `${neg ? '-' : ''}${commas ? withCommas(yen) : String(yen)}.${frac}`;
}

/** 518 bp -> "5.18%", with a fixed number of decimals (default 1: "5.2%"). Half away from zero. */
export function formatBp(bp: number, decimals: 0 | 1 | 2 = 1): string {
  const neg = bp < 0;
  const a = Math.abs(bp);
  const unit = 10 ** (2 - decimals);
  const q = Math.floor((2 * a + unit) / (2 * unit));
  const whole = Math.floor(q / 10 ** decimals);
  const frac = decimals === 0 ? '' : `.${String(q % 10 ** decimals).padStart(decimals, '0')}`;
  return `${neg && q !== 0 ? '-' : ''}${whole}${frac}%`;
}

/**
 * num / den as a percentage with a fixed number of decimals, rounded once
 * (half away from zero). Use it instead of formatBp on a value that was
 * already rounded to basis points, to avoid rounding twice.
 * formatRatioPct(-20, 580) -> "-3.4%".
 */
export function formatRatioPct(num: number, den: number, decimals: 0 | 1 | 2 = 1): string {
  if (den === 0) return '-';
  const scaled = divRound(num * 100 * 10 ** decimals, den);
  const neg = scaled < 0;
  const a = Math.abs(scaled);
  const whole = Math.floor(a / 10 ** decimals);
  const frac = decimals === 0 ? '' : `.${String(a % 10 ** decimals).padStart(decimals, '0')}`;
  return `${neg ? '-' : ''}${whole}${frac}%`;
}

/** 725 ‰ -> "72.5%". */
export function formatPm(pm: number): string {
  return formatBp(pm * 10, 1);
}

/** "12,800円". */
export function formatYen(yen: number): string {
  return `${withCommas(yen)}円`;
}

/**
 * Volume discount written in a remark, e.g. "数量値引3%", "数量値引き 3%",
 * "まとめ買い5%引", "大口数量割引(5%)", "1割引". The rate must stand next to the
 * discount word, so "送料5%引き当て" is not a discount; a remark that says there is
 * none ("値引なし(5%は来期)") is not one either. Returns the discount in basis
 * points, or null when the remark does not state one.
 */
export function parseRemarkDiscount(remark: string): number | null {
  const r = remark.normalize('NFKC').replace(/\s/g, '');
  if (/(なし|無し|ナシ|不可|対象外)/.test(r)) return null;
  const pct =
    /(?:値引き?|割引き?)[(（:：]?(\d+(?:\.\d+)?)(?:%|パーセント)/.exec(r) ??
    /(\d+(?:\.\d+)?)(?:%|パーセント)(?:の)?(?:値引|割引|引(?!き?当)|OFF|オフ)/i.exec(r);
  if (pct?.[1]) {
    const bp = parseScaled(pct[1], 100);
    return bp !== null && bp > 0 && bp < 10000 ? bp : null;
  }
  const wari = /(\d+)割引/.exec(r);
  if (wari?.[1]) {
    const bp = Number(wari[1]) * 1000;
    return bp > 0 && bp < 10000 ? bp : null;
  }
  return null;
}

/** Free goods: remark mentions 見本 / サンプル / 無償 / 試供. */
export function isSampleRemark(remark: string): boolean {
  return /(見本|サンプル|無償|試供)/.test(remark.normalize('NFKC'));
}
