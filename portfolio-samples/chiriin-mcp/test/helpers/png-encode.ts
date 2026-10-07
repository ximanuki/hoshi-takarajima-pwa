import { deflateSync } from 'node:zlib';
import { crc32 } from '../../src/png.js';

/** Tiny PNG encoder used to build synthetic test images. */
export interface EncodeOptions {
  width: number;
  height: number;
  colorType: 0 | 2 | 3 | 4 | 6;
  bitDepth: number;
  /** Raw (unfiltered) scanline bytes per row, without the filter byte. */
  rows: Uint8Array[];
  /** Filter type to apply to each row (0–4). */
  filter?: number | number[];
  palette?: number[];
  trns?: number[];
  interlace?: 0 | 1;
  corruptCrc?: boolean;
}

function chunk(type: string, data: Uint8Array, corrupt = false): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out, 4, 8 + data.length);
  view.setUint32(8 + data.length, corrupt ? crc ^ 1 : crc);
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as const;

export function encodePng(o: EncodeOptions): Uint8Array {
  const bpp = Math.max(1, (CHANNELS[o.colorType] * o.bitDepth) >> 3);
  const parts: number[] = [];
  o.rows.forEach((row, y) => {
    const filter = Array.isArray(o.filter) ? (o.filter[y] ?? 0) : (o.filter ?? 0);
    parts.push(filter);
    const prev = y > 0 ? o.rows[y - 1] : undefined;
    for (let x = 0; x < row.length; x++) {
      const v = row[x] ?? 0;
      const a = x >= bpp ? (row[x - bpp] ?? 0) : 0;
      const b = prev ? (prev[x] ?? 0) : 0;
      const c = prev && x >= bpp ? (prev[x - bpp] ?? 0) : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter] ?? 0;
      parts.push((v - pred) & 0xff);
    }
  });
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, o.width);
  v.setUint32(4, o.height);
  ihdr[8] = o.bitDepth;
  ihdr[9] = o.colorType;
  ihdr[12] = o.interlace ?? 0;
  const chunks = [chunk('IHDR', ihdr)];
  if (o.palette) chunks.push(chunk('PLTE', Uint8Array.from(o.palette)));
  if (o.trns) chunks.push(chunk('tRNS', Uint8Array.from(o.trns)));
  chunks.push(chunk('IDAT', new Uint8Array(deflateSync(Uint8Array.from(parts))), o.corruptCrc));
  chunks.push(chunk('IEND', new Uint8Array(0)));
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const total = signature.length + chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  out.set(signature, 0);
  let offset = signature.length;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
