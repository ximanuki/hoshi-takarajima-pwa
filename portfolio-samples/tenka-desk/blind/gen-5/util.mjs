// 共通の道具（乱数・日付・文字・CSV・Shift_JIS）。時計と Math.random は使わない。

// ---- 乱数（mulberry32、固定シード） ----
export function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle: (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    weighted: (items, weights) => {
      let tot = 0;
      for (const w of weights) tot += w;
      let x = next() * tot;
      for (let i = 0; i < items.length; i++) {
        x -= weights[i];
        if (x < 0) return items[i];
      }
      return items[items.length - 1];
    },
    poisson: (lam) => {
      const L = Math.exp(-lam);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= next();
      } while (p > L);
      return k - 1;
    },
  };
  return r;
}

// ---- 日付（UTC の通日） ----
const DAY = 86400000;
export function d(iso) {
  const [y, m, dd] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, dd) / DAY);
}
export function ymd(n) {
  const t = new Date(n * DAY);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: t.getUTCDay() };
}
const p2 = (n) => String(n).padStart(2, '0');
export function iso(n) {
  const t = ymd(n);
  return `${t.y}-${p2(t.m)}-${p2(t.d)}`;
}
export function slash(n) {
  const t = ymd(n);
  return `${t.y}/${p2(t.m)}/${p2(t.d)}`;
}
export function excelDate(n) {
  const t = ymd(n);
  return `${t.y}/${t.m}/${t.d}`;
}
export function compact(n) {
  const t = ymd(n);
  return `${t.y}${p2(t.m)}${p2(t.d)}`;
}
export function warekiShort(n) {
  const t = ymd(n);
  return `R${p2(t.y - 2018)}/${p2(t.m)}/${p2(t.d)}`;
}
export function warekiLong(n) {
  const t = ymd(n);
  return `令和${t.y - 2018}年${t.m}月${t.d}日`;
}
export function monthKey(n) {
  const t = ymd(n);
  return `${t.y}-${p2(t.m)}`;
}
export function addMonths(n, k) {
  const t = ymd(n);
  const mm = t.m - 1 + k;
  const y = t.y + Math.floor(mm / 12);
  const m = ((mm % 12) + 12) % 12;
  return Math.round(Date.UTC(y, m, t.d) / DAY);
}

// ---- 数値 ----
export function comma(n) {
  const neg = n < 0;
  const s = String(Math.abs(n));
  const out = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? `-${out}` : out;
}
// 銭（1/100円）→ "1,234.50"
export function senStr(sen, withComma) {
  const neg = sen < 0;
  const a = Math.abs(sen);
  const yen = Math.floor(a / 100);
  const s = `${withComma ? comma(yen) : String(yen)}.${p2(a % 100)}`;
  return neg ? `-${s}` : s;
}
// 四捨五入（0から遠い側）で割り算
export function divRound(a, b) {
  const s = a < 0 !== b < 0 ? -1 : 1;
  const q = Math.floor((Math.abs(a) + Math.floor(Math.abs(b) / 2)) / Math.abs(b));
  return s * q;
}
export function ceilDiv(a, b) {
  return Math.floor((a + b - 1) / b);
}
// 定価の丸め（改定時は切り上げ）
export function roundListUp(x) {
  const unit = x < 1000 ? 10 : x < 10000 ? 50 : 100;
  return Math.ceil(x / unit - 1e-9) * unit;
}

// ---- 文字 ----
export function zen(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c === 0x20) out += '　';
    else if (c >= 0x21 && c <= 0x7e) out += String.fromCodePoint(c + 0xfee0);
    else out += ch;
  }
  return out;
}

// ---- CSV ----
function needQuote(v) {
  return /[",\r\n]/.test(v);
}
export function csv(rows, { quoteAll = false, eol = '\r\n' } = {}) {
  const lines = rows.map((r) =>
    r
      .map((v) => {
        const s = v === null || v === undefined ? '' : String(v);
        if (quoteAll || needQuote(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      })
      .join(','),
  );
  return lines.join(eol) + eol;
}

// ---- Shift_JIS（Windows-31J）エンコーダ：TextDecoder の表を逆引きして作る ----
let sjisMap = null;
function buildSjis() {
  sjisMap = new Map();
  const dec = new TextDecoder('shift_jis', { fatal: false });
  for (let b = 0xa1; b <= 0xdf; b++) {
    const ch = dec.decode(Uint8Array.from([b]));
    if (!sjisMap.has(ch)) sjisMap.set(ch, [b]);
  }
  const leads = [];
  for (let b = 0x81; b <= 0x9f; b++) leads.push(b);
  for (let b = 0xe0; b <= 0xfc; b++) leads.push(b);
  for (const l of leads) {
    for (let t = 0x40; t <= 0xfc; t++) {
      if (t === 0x7f) continue;
      const ch = dec.decode(Uint8Array.from([l, t]));
      if (ch.length !== 1 || ch === '�') continue;
      if (!sjisMap.has(ch)) sjisMap.set(ch, [l, t]);
    }
  }
}
export function encodeSjis(str) {
  if (!sjisMap) buildSjis();
  const out = [];
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c < 0x80) {
      out.push(c);
      continue;
    }
    const b = sjisMap.get(ch);
    if (!b) throw new Error(`Shift_JIS にない文字: ${ch} (U+${c.toString(16)})`);
    out.push(...b);
  }
  return Buffer.from(out);
}
export function utf8Bom(str) {
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(str, 'utf8')]);
}
