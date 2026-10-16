import { inflateSync } from 'node:zlib';
import { ChiriinError } from './errors.js';

/**
 * Minimal, dependency-free PNG decoder (non-interlaced images).
 *
 * The hazard-map tiles served by GSI are 256x256 PNGs in either RGBA (color type 6)
 * or indexed color with a tRNS chunk (color type 3), so this supports every
 * non-interlaced combination of color type and bit depth allowed by the PNG spec
 * and outputs straight (non-premultiplied) RGBA.
 */
export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const MAX_DIMENSION = 4096;
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ALLOWED_DEPTHS: Record<number, readonly number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = (CRC_TABLE[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function fail(ja: string, en: string): never {
  throw new ChiriinError({
    code: 'UPSTREAM_BAD_RESPONSE',
    ja: `PNG の解析に失敗しました: ${ja}`,
    en: `Invalid PNG: ${en}`,
  });
}

interface Header {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
}

export function decodePng(input: Uint8Array): DecodedImage {
  const bytes = input;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b))
    fail('シグネチャが不正です', 'bad signature');

  let header: Header | undefined;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  let offset = 8;
  let sawEnd = false;

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) fail('チャンクが途中で切れています', 'truncated chunk');
    const type = String.fromCharCode(...bytes.subarray(typeStart, dataStart));
    const expectedCrc = view.getUint32(dataEnd);
    if (crc32(bytes, typeStart, dataEnd) !== expectedCrc)
      fail(`${type} チャンクの CRC が一致しません`, `CRC mismatch in ${type}`);
    const data = bytes.subarray(dataStart, dataEnd);

    switch (type) {
      case 'IHDR': {
        if (length !== 13) fail('IHDR の長さが不正です', 'bad IHDR length');
        const width = view.getUint32(dataStart);
        const height = view.getUint32(dataStart + 4);
        const bitDepth = data[8] ?? 0;
        const colorType = data[9] ?? 0;
        const interlace = data[12] ?? 0;
        if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
          fail(`画像サイズ ${width}x${height} は対象外です`, `unsupported size ${width}x${height}`);
        }
        if (!ALLOWED_DEPTHS[colorType]?.includes(bitDepth)) {
          fail(
            `色タイプ ${colorType} / ビット深度 ${bitDepth} は不正です`,
            `invalid color type ${colorType} / depth ${bitDepth}`,
          );
        }
        if ((data[10] ?? 0) !== 0 || (data[11] ?? 0) !== 0)
          fail('未知の圧縮・フィルタ方式です', 'unknown compression/filter method');
        if (interlace !== 0) {
          throw new ChiriinError({
            code: 'UNSUPPORTED',
            ja: 'インターレース PNG には対応していません',
            en: 'Interlaced PNG is not supported',
          });
        }
        header = { width, height, bitDepth, colorType };
        break;
      }
      case 'PLTE':
        palette = data;
        break;
      case 'tRNS':
        transparency = data;
        break;
      case 'IDAT':
        idat.push(data);
        break;
      case 'IEND':
        sawEnd = true;
        break;
      default:
        break; // ancillary chunks are ignored
    }
    offset = dataEnd + 4;
    if (sawEnd) break;
  }

  if (!header) fail('IHDR がありません', 'missing IHDR');
  if (idat.length === 0) fail('IDAT がありません', 'missing IDAT');
  if (header.colorType === 3 && !palette) fail('パレットがありません', 'missing PLTE');

  const channels = CHANNELS[header.colorType] ?? 0;
  const bitsPerPixel = channels * header.bitDepth;
  const bytesPerPixel = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((header.width * bitsPerPixel) / 8);
  const expected = (stride + 1) * header.height;

  let raw: Uint8Array;
  try {
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1024 });
  } catch (error) {
    throw new ChiriinError({
      code: 'UPSTREAM_BAD_RESPONSE',
      ja: 'PNG の解析に失敗しました: 圧縮データを展開できません',
      en: 'Invalid PNG: could not inflate image data',
      cause: error,
    });
  }
  if (raw.length < expected) fail('画像データが不足しています', 'image data too short');

  const pixels = unfilter(raw, header.height, stride, bytesPerPixel);
  return {
    width: header.width,
    height: header.height,
    data: toRgba(pixels, header, stride, palette, transparency),
  };
}

function unfilter(raw: Uint8Array, height: number, stride: number, bpp: number): Uint8Array {
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[src + x] ?? 0;
      const left = x >= bpp ? (out[row + x - bpp] ?? 0) : 0;
      const up = y > 0 ? (out[prev + x] ?? 0) : 0;
      const upLeft = y > 0 && x >= bpp ? (out[prev + x - bpp] ?? 0) : 0;
      let predictor: number;
      switch (filter) {
        case 0:
          predictor = 0;
          break;
        case 1:
          predictor = left;
          break;
        case 2:
          predictor = up;
          break;
        case 3:
          predictor = (left + up) >> 1;
          break;
        case 4:
          predictor = paeth(left, up, upLeft);
          break;
        default:
          fail(`未知のフィルタ種別 ${filter} です`, `unknown filter type ${filter}`);
      }
      out[row + x] = (value + predictor) & 0xff;
    }
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function toRgba(
  pixels: Uint8Array,
  header: Header,
  stride: number,
  palette: Uint8Array | undefined,
  transparency: Uint8Array | undefined,
): Uint8Array {
  const { width, height, bitDepth, colorType } = header;
  const channels = CHANNELS[colorType] ?? 0;
  const out = new Uint8Array(width * height * 4);
  const maxSample = (1 << Math.min(bitDepth, 8)) - 1;

  /** Raw sample value (full precision, up to 16 bits). */
  const sample = (row: number, index: number): number => {
    if (bitDepth === 8) return pixels[row + index] ?? 0;
    if (bitDepth === 16) return ((pixels[row + index * 2] ?? 0) << 8) | (pixels[row + index * 2 + 1] ?? 0);
    const bitOffset = index * bitDepth;
    const byte = pixels[row + (bitOffset >> 3)] ?? 0;
    return (byte >> (8 - bitDepth - (bitOffset & 7))) & ((1 << bitDepth) - 1);
  };
  /** Scale a sample to 0..255. */
  const to8 = (v: number): number =>
    bitDepth === 16 ? v >> 8 : bitDepth === 8 ? v : Math.round((v * 255) / maxSample);
  const u16 = (data: Uint8Array, at: number): number => ((data[at] ?? 0) << 8) | (data[at + 1] ?? 0);

  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const base = x * channels;
      switch (colorType) {
        case 0: {
          const g = sample(row, base);
          const v = to8(g);
          out[o] = v;
          out[o + 1] = v;
          out[o + 2] = v;
          out[o + 3] = transparency && transparency.length >= 2 && g === u16(transparency, 0) ? 0 : 255;
          break;
        }
        case 2: {
          const r = sample(row, base);
          const g = sample(row, base + 1);
          const b = sample(row, base + 2);
          out[o] = to8(r);
          out[o + 1] = to8(g);
          out[o + 2] = to8(b);
          const isKey =
            transparency !== undefined &&
            transparency.length >= 6 &&
            r === u16(transparency, 0) &&
            g === u16(transparency, 2) &&
            b === u16(transparency, 4);
          out[o + 3] = isKey ? 0 : 255;
          break;
        }
        case 3: {
          const index = sample(row, x);
          const p = index * 3;
          if (!palette || p + 2 >= palette.length)
            fail(`パレット番号 ${index} が範囲外です`, `palette index ${index} out of range`);
          out[o] = palette[p] ?? 0;
          out[o + 1] = palette[p + 1] ?? 0;
          out[o + 2] = palette[p + 2] ?? 0;
          out[o + 3] = transparency && index < transparency.length ? (transparency[index] ?? 255) : 255;
          break;
        }
        case 4: {
          const v = to8(sample(row, base));
          out[o] = v;
          out[o + 1] = v;
          out[o + 2] = v;
          out[o + 3] = to8(sample(row, base + 1));
          break;
        }
        default: {
          out[o] = to8(sample(row, base));
          out[o + 1] = to8(sample(row, base + 1));
          out[o + 2] = to8(sample(row, base + 2));
          out[o + 3] = to8(sample(row, base + 3));
        }
      }
    }
  }
  return out;
}

export function pixelAt(image: DecodedImage, x: number, y: number): [number, number, number, number] {
  const cx = Math.min(image.width - 1, Math.max(0, Math.floor(x)));
  const cy = Math.min(image.height - 1, Math.max(0, Math.floor(y)));
  const o = (cy * image.width + cx) * 4;
  const d = image.data;
  return [d[o] ?? 0, d[o + 1] ?? 0, d[o + 2] ?? 0, d[o + 3] ?? 0];
}
