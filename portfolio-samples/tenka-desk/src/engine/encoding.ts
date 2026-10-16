/**
 * Character encodings of CSV files from 販売管理 systems.
 *
 * Decoding uses the platform's TextDecoder (UTF-8, Shift_JIS/CP932, UTF-16).
 * Encoding to Shift_JIS has no built-in API, so the reverse table is built once
 * from TextDecoder itself: every 2-byte Shift_JIS sequence is decoded and the
 * mapping inverted. The result follows the WHATWG Shift_JIS index, which is
 * what browsers and Excel on Windows (CP932) use.
 */

export type TextEncodingName = 'utf-8' | 'shift_jis' | 'utf-16le' | 'utf-16be';

export interface DecodedText {
  text: string;
  encoding: TextEncodingName;
  /** A byte order mark was present (and removed). */
  bom: boolean;
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((b, i) => bytes[i] === b);
}

/**
 * Detect the encoding: a BOM wins; otherwise strict UTF-8 if the bytes are valid
 * UTF-8, and Shift_JIS if they are not.
 */
export function detectEncoding(bytes: Uint8Array): { encoding: TextEncodingName; bom: boolean } {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return { encoding: 'utf-8', bom: true };
  if (startsWith(bytes, [0xff, 0xfe])) return { encoding: 'utf-16le', bom: true };
  if (startsWith(bytes, [0xfe, 0xff])) return { encoding: 'utf-16be', bom: true };
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { encoding: 'utf-8', bom: false };
  } catch {
    return { encoding: 'shift_jis', bom: false };
  }
}

/** Decode a file's bytes. With encoding 'auto' (default) the encoding is detected. */
export function decodeBytes(bytes: Uint8Array, encoding: TextEncodingName | 'auto' = 'auto'): DecodedText {
  const det = encoding === 'auto' ? detectEncoding(bytes) : { encoding, bom: false };
  let body = bytes;
  let bom = det.bom;
  if (det.encoding === 'utf-8' && startsWith(bytes, [0xef, 0xbb, 0xbf])) {
    body = bytes.subarray(3);
    bom = true;
  } else if (
    det.encoding.startsWith('utf-16') &&
    (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff]))
  ) {
    body = bytes.subarray(2);
    bom = true;
  }
  const text = new TextDecoder(det.encoding, { ignoreBOM: true }).decode(body);
  return { text, encoding: det.encoding, bom };
}

/* ---------- Shift_JIS encoder ---------- */

let sjisTable: Map<string, number> | null = null;
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);

function buildSjisTable(): Map<string, number> {
  const dec = new TextDecoder('shift_jis');
  const table = new Map<string, number>();
  const pair = new Uint8Array(2);
  const leads: number[] = [];
  for (let b = 0x81; b <= 0x9f; b++) leads.push(b);
  for (let b = 0xe0; b <= 0xfc; b++) leads.push(b);
  // NEC-selected IBM extensions (lead bytes 0xED, 0xEE) duplicate characters that
  // also exist at 0xFA-0xFC; like the WHATWG encoder, prefer the other code.
  const deferred: [string, number][] = [];
  for (const lead of leads) {
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      pair[0] = lead;
      pair[1] = trail;
      const ch = dec.decode(pair);
      if (ch.length !== 1 || ch === REPLACEMENT_CHAR) continue;
      const code = (lead << 8) | trail;
      if (lead === 0xed || lead === 0xee) deferred.push([ch, code]);
      else if (!table.has(ch)) table.set(ch, code);
    }
  }
  for (const [ch, code] of deferred) if (!table.has(ch)) table.set(ch, code);
  return table;
}

/**
 * Characters that CP932 (Windows, Excel) writes with a code the WHATWG decoder
 * table does not give back, or that macOS and Japanese input methods type in
 * place of the CP932 character. Without these, ordinary names such as
 * "紙コップ 10〜20個入" (WAVE DASH) or "幅12−18mm" (MINUS SIGN) could not be saved.
 */
const SJIS_EXTRA: ReadonlyMap<number, number> = new Map([
  [0x2212, 0x817c], // − MINUS SIGN -> － (the WHATWG encoder maps it the same way)
  [0x301c, 0x8160], // 〜 WAVE DASH -> ～
  [0x2016, 0x8161], // ‖ DOUBLE VERTICAL LINE -> ∥
  [0x2014, 0x815c], // — EM DASH -> ―
  [0x00a2, 0x8191], // ¢ -> ￠
  [0x00a3, 0x8192], // £ -> ￡
  [0x00ac, 0x81ca], // ¬ -> ￢
  // ¥ as 全角 ￥: 0x5C would come back as a backslash when the file is read again
  [0x00a5, 0x818f],
]);

export class UnmappableCharacterError extends Error {
  readonly characters: string[];
  constructor(characters: string[]) {
    super(`Shift_JIS で表せない文字があります: ${characters.join(' ')}`);
    this.name = 'UnmappableCharacterError';
    this.characters = characters;
  }
}

/**
 * Encode text as Shift_JIS (CP932). Characters with no Shift_JIS code throw an
 * UnmappableCharacterError listing them, unless onUnmappable is 'replace' ('?').
 */
export function encodeShiftJis(text: string, onUnmappable: 'error' | 'replace' = 'error'): Uint8Array {
  if (sjisTable === null) sjisTable = buildSjisTable();
  const table = sjisTable;
  const out: number[] = [];
  const bad = new Set<string>();
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x80) {
      out.push(c);
    } else if (c >= 0xff61 && c <= 0xff9f) {
      out.push(c - 0xff61 + 0xa1); // 半角カナ
    } else if (SJIS_EXTRA.has(c)) {
      const code = SJIS_EXTRA.get(c) ?? 0x3f;
      out.push(code >> 8, code & 0xff);
    } else if (c === 0x203e) {
      out.push(0x7e); // ‾
    } else {
      const code = table.get(ch);
      if (code === undefined) {
        bad.add(ch);
        out.push(0x3f);
      } else {
        out.push(code >> 8, code & 0xff);
      }
    }
  }
  if (bad.size > 0 && onUnmappable === 'error') throw new UnmappableCharacterError([...bad]);
  return Uint8Array.from(out);
}

/** UTF-8 bytes, optionally with a BOM (Excel needs the BOM to read UTF-8 CSV). */
export function encodeUtf8(text: string, bom: boolean): Uint8Array {
  const body = new TextEncoder().encode(text);
  if (!bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf]);
  out.set(body, 3);
  return out;
}
