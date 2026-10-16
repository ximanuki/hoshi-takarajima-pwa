/**
 * 全角/半角 conversion used to render the two 販売管理 layouts, plus the code
 * normalisation that the verifier (and the app) use to match 品番ゆれ.
 *
 * Canonical text in the generator is NFKC-stable: ASCII letters, digits and
 * punctuation, half-width spaces, full-width kana/kanji. Layout A renders it with
 * toZenkaku, layout B with toHankaku; NFKC brings both back to the canonical form.
 */

/** ASCII -> full-width (space -> U+3000). Kana and kanji are left as is. */
export function toZenkaku(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c === 0x20) out += '　';
    else if (c >= 0x21 && c <= 0x7e) out += String.fromCharCode(c + 0xfee0);
    else out += ch;
  }
  return out;
}

const HALF_KANA: Record<string, string> = {
  'ァ': 'ｧ', 'ア': 'ｱ', 'ィ': 'ｨ', 'イ': 'ｲ', 'ゥ': 'ｩ', 'ウ': 'ｳ', 'ェ': 'ｪ', 'エ': 'ｴ', 'ォ': 'ｫ', 'オ': 'ｵ',
  'カ': 'ｶ', 'キ': 'ｷ', 'ク': 'ｸ', 'ケ': 'ｹ', 'コ': 'ｺ', 'サ': 'ｻ', 'シ': 'ｼ', 'ス': 'ｽ', 'セ': 'ｾ', 'ソ': 'ｿ',
  'タ': 'ﾀ', 'チ': 'ﾁ', 'ッ': 'ｯ', 'ツ': 'ﾂ', 'テ': 'ﾃ', 'ト': 'ﾄ', 'ナ': 'ﾅ', 'ニ': 'ﾆ', 'ヌ': 'ﾇ', 'ネ': 'ﾈ',
  'ノ': 'ﾉ', 'ハ': 'ﾊ', 'ヒ': 'ﾋ', 'フ': 'ﾌ', 'ヘ': 'ﾍ', 'ホ': 'ﾎ', 'マ': 'ﾏ', 'ミ': 'ﾐ', 'ム': 'ﾑ', 'メ': 'ﾒ',
  'モ': 'ﾓ', 'ャ': 'ｬ', 'ヤ': 'ﾔ', 'ュ': 'ｭ', 'ユ': 'ﾕ', 'ョ': 'ｮ', 'ヨ': 'ﾖ', 'ラ': 'ﾗ', 'リ': 'ﾘ', 'ル': 'ﾙ',
  'レ': 'ﾚ', 'ロ': 'ﾛ', 'ワ': 'ﾜ', 'ヲ': 'ｦ', 'ン': 'ﾝ', 'ー': 'ｰ', '・': '･', '「': '｢', '」': '｣',
  '、': '､', '。': '｡', '゙': 'ﾞ', '゚': 'ﾟ',
};

/** Full-width ASCII -> ASCII, katakana -> half-width katakana (old 販売管理 style). */
export function toHankaku(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c === 0x3000) {
      out += ' ';
    } else if (c >= 0xff01 && c <= 0xff5e) {
      out += String.fromCharCode(c - 0xfee0);
    } else if ((c >= 0x30a1 && c <= 0x30fc) || HALF_KANA[ch] !== undefined) {
      for (const part of ch.normalize('NFD')) {
        out += HALF_KANA[part] ?? part;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

/** Hyphen-like characters that show up inside 品番 (incl. the long vowel mark typed by mistake). */
export const HYPHEN_LIKE = /[\s\-‐-―−ー－ｰ]/g;

/**
 * Matching key for 商品コード / 品番: NFKC, upper case, without spaces and hyphen-likes.
 * "ＤＢ－１００１", "DB1001", "db-1001 ", "ＤＢー１００１" -> "DB1001".
 */
export function codeKey(raw: string): string {
  return raw.normalize('NFKC').toUpperCase().replace(HYPHEN_LIKE, '');
}

/** 得意先コード: NFKC, digits only, zero-padded to 6. "００１００１" / "1001" -> "001001". */
export function customerKey(raw: string): string {
  const digits = raw.normalize('NFKC').replace(/[^0-9]/g, '');
  return digits.padStart(6, '0');
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

/** Money in 1/100 yen (sen) -> "1234.50" / "1,234.50". */
export function senToYen(sen: number, commas: boolean): string {
  const neg = sen < 0;
  const a = Math.abs(sen);
  const yen = Math.floor(a / 100);
  const frac = String(a % 100).padStart(2, '0');
  const y = commas ? withCommas(yen) : String(yen);
  return `${neg ? '-' : ''}${y}.${frac}`;
}

/** "1,234.50" / "１，２３４．５" / "-12" -> sen (integer). Throws on garbage. */
export function parseSen(raw: string): number {
  const s = raw.normalize('NFKC').replace(/,/g, '').trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`not a money value: ${JSON.stringify(raw)}`);
  const v = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -v : v;
}

/** "1,234" / "△1,234" / "-12" -> integer. */
export function parseIntLoose(raw: string): number {
  const s = raw.normalize('NFKC').replace(/,/g, '').replace(/^[△▲]/, '-').trim();
  if (!/^-?\d+$/.test(s)) throw new Error(`not an integer: ${JSON.stringify(raw)}`);
  return Number(s);
}
