import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ChiriinError } from '../src/errors.js';
import { crc32, decodePng, pixelAt } from '../src/png.js';
import { encodePng } from './helpers/png-encode.js';
import { RECORDED_DIR, recordedBytes } from './helpers/recorded.js';

/**
 * SHA-256 of the RGBA pixel data of each recorded tile, as produced by Pillow
 * (`Image.open(f).convert('RGBA').tobytes()`), i.e. an independent decoder.
 */
const PILLOW_RGBA_SHA256: Record<string, { mode: string; sha256: string }> = {
  'tile-01_flood_l1_shinsuishin_newlegend_data-17-113769-52153.png': {
    mode: 'P',
    sha256: '1c02c21f367b4a86775cb1e9e48d001ed11528edeeb2f572b8811c756df306da',
  },
  'tile-01_flood_l1_shinsuishin_newlegend_data-17-116441-51616.png': {
    mode: 'RGBA',
    sha256: '978734208dd2ccda2f57886ed05abde0ad4e89fc56bed73b7f4e5c409cf50847',
  },
  'tile-01_flood_l2_kaokutoukai_hanran_data-17-113769-52153.png': {
    mode: 'RGBA',
    sha256: 'c9107f081cc51d1e19c96f972f2d9a2567f1f3c5c0d2cf186a91aa2c4a8596a9',
  },
  'tile-01_flood_l2_keizoku_data-17-113769-52153.png': {
    mode: 'RGBA',
    sha256: 'a814fc68f219cefc43916f4f41b11370926a9a89ba15cf9cdd3ac46ae9116b0a',
  },
  'tile-01_flood_l2_keizoku_data-17-116441-51616.png': {
    mode: 'RGBA',
    sha256: '00cef7211e6f3515a5e528905688af5e46f9488418d0e2d847e08ed0c376f6fd',
  },
  'tile-01_flood_l2_shinsuishin_data-17-113769-52153.png': {
    mode: 'RGBA',
    sha256: 'c592d679f7017cd96d037b89414897bd849f6cb495e15b0a95ed50cecd7b83fa',
  },
  'tile-01_flood_l2_shinsuishin_data-17-116441-51616.png': {
    mode: 'RGBA',
    sha256: 'caadcaee993fdeb3ef5838c7082fa544121ed911fda80c4ccf590b84799bf4cf',
  },
  'tile-03_hightide_l2_shinsuishin_data-17-116175-51868.png': {
    mode: 'P',
    sha256: 'acb9c86dc2c151246dd809bea2a2c4b832c0827d01ee06aae738854bda88dc53',
  },
  'tile-03_hightide_l2_shinsuishin_data-17-116441-51616.png': {
    mode: 'RGBA',
    sha256: 'fc97966bfecf87cc936ccdb790194a8276ed7b9cd7530ba913a40146758d3af3',
  },
  'tile-04_tsunami_newlegend_data-17-116172-51872.png': {
    mode: 'RGBA',
    sha256: 'da06eba673d7f6718aae7626eccd4b31e4f5be03105eff65c3747ed6207eab08',
  },
  'tile-04_tsunami_newlegend_data-17-116175-51868.png': {
    mode: 'RGBA',
    sha256: 'a7186554cd137476cf62a41d1a2b1e03bd22c7e980723a92a437a78bf6a63f46',
  },
  'tile-05_dosekiryukeikaikuiki-17-116175-51868.png': {
    mode: 'RGBA',
    sha256: '1be56e91122f2b67ad1b967a11d6d546e2b189ed5af861019291192d4f826f56',
  },
  'tile-05_kyukeishakeikaikuiki-17-116175-51868.png': {
    mode: 'RGBA',
    sha256: 'f771ab9d15bc6630fc365212f8321e29bf9d255effaa047d1a48fe868e3e6270',
  },
};

describe('decodePng on recorded hazard-map tiles', () => {
  it('covers every recorded tile, including indexed-colour ones', () => {
    const recorded = readdirSync(RECORDED_DIR).filter((f) => f.endsWith('.png'));
    expect(Object.keys(PILLOW_RGBA_SHA256).sort()).toEqual(recorded.sort());
    expect(Object.values(PILLOW_RGBA_SHA256).filter((v) => v.mode === 'P')).toHaveLength(2);
  });

  it.each(Object.entries(PILLOW_RGBA_SHA256))('%s matches Pillow pixel-for-pixel', (file, expected) => {
    const image = decodePng(recordedBytes(file));
    expect(image.width).toBe(256);
    expect(image.height).toBe(256);
    expect(createHash('sha256').update(image.data).digest('hex')).toBe(expected.sha256);
  });
});

describe('decodePng on synthetic images', () => {
  const rgbaRows = [
    Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0]),
    Uint8Array.from([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]),
    Uint8Array.from([200, 201, 202, 203, 1, 2, 3, 4, 250, 251, 252, 253]),
  ];

  it.each([0, 1, 2, 3, 4])('reverses filter type %i', (filter) => {
    const png = encodePng({ width: 3, height: 3, colorType: 6, bitDepth: 8, rows: rgbaRows, filter });
    const image = decodePng(png);
    expect(Array.from(image.data)).toEqual(rgbaRows.flatMap((r) => Array.from(r)));
  });

  it('handles a different filter on every row', () => {
    const png = encodePng({
      width: 3,
      height: 3,
      colorType: 6,
      bitDepth: 8,
      rows: rgbaRows,
      filter: [4, 3, 1],
    });
    expect(Array.from(decodePng(png).data)).toEqual(rgbaRows.flatMap((r) => Array.from(r)));
  });

  it('expands RGB with a tRNS colour key', () => {
    const rows = [Uint8Array.from([1, 2, 3, 9, 9, 9])];
    const png = encodePng({ width: 2, height: 1, colorType: 2, bitDepth: 8, rows, trns: [0, 9, 0, 9, 0, 9] });
    expect(Array.from(decodePng(png).data)).toEqual([1, 2, 3, 255, 9, 9, 9, 0]);
  });

  it('expands 2-bit palette images with per-entry alpha', () => {
    // indices 0,1,2,3 packed into one byte: 00 01 10 11
    const rows = [Uint8Array.from([0b00011011])];
    const palette = [10, 11, 12, 20, 21, 22, 30, 31, 32, 40, 41, 42];
    const png = encodePng({ width: 4, height: 1, colorType: 3, bitDepth: 2, rows, palette, trns: [0, 128] });
    expect(Array.from(decodePng(png).data)).toEqual([
      10, 11, 12, 0, 20, 21, 22, 128, 30, 31, 32, 255, 40, 41, 42, 255,
    ]);
  });

  it('scales 1-bit grayscale to 0/255', () => {
    const png = encodePng({
      width: 3,
      height: 1,
      colorType: 0,
      bitDepth: 1,
      rows: [Uint8Array.from([0b10100000])],
    });
    expect(Array.from(decodePng(png).data)).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it('reduces 16-bit gray+alpha to 8 bits', () => {
    const rows = [Uint8Array.from([0x12, 0x34, 0xff, 0xff])];
    const png = encodePng({ width: 1, height: 1, colorType: 4, bitDepth: 16, rows });
    expect(Array.from(decodePng(png).data)).toEqual([0x12, 0x12, 0x12, 0xff]);
  });

  it('pixelAt clamps out-of-range coordinates', () => {
    const png = encodePng({ width: 3, height: 3, colorType: 6, bitDepth: 8, rows: rgbaRows });
    const image = decodePng(png);
    expect(pixelAt(image, -5, -5)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(image, 99, 99)).toEqual([250, 251, 252, 253]);
  });
});

describe('decodePng error handling', () => {
  const ok = () =>
    encodePng({ width: 1, height: 1, colorType: 6, bitDepth: 8, rows: [Uint8Array.from([1, 2, 3, 4])] });

  it('rejects non-PNG data with a bilingual error', () => {
    const error = (() => {
      try {
        decodePng(new TextEncoder().encode('{"code":"ObjectNotFound"}'));
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(ChiriinError);
    expect((error as ChiriinError).code).toBe('UPSTREAM_BAD_RESPONSE');
    expect((error as ChiriinError).toUserText()).toMatch(/PNG の解析に失敗しました[\s\S]*Invalid PNG/);
  });

  it('detects CRC corruption', () => {
    const png = encodePng({
      width: 1,
      height: 1,
      colorType: 6,
      bitDepth: 8,
      rows: [Uint8Array.from([1, 2, 3, 4])],
      corruptCrc: true,
    });
    expect(() => decodePng(png)).toThrow(/CRC/);
  });

  it('detects truncation', () => {
    const png = ok();
    expect(() => decodePng(png.subarray(0, png.length - 20))).toThrow(ChiriinError);
  });

  it('refuses interlaced images explicitly', () => {
    const png = encodePng({
      width: 1,
      height: 1,
      colorType: 6,
      bitDepth: 8,
      rows: [Uint8Array.from([1, 2, 3, 4])],
      interlace: 1,
    });
    expect(() => decodePng(png)).toThrow(/Interlaced PNG is not supported/);
  });

  it('rejects invalid colour type / depth combinations', () => {
    const png = encodePng({
      width: 1,
      height: 1,
      colorType: 2,
      bitDepth: 4,
      rows: [Uint8Array.from([0, 0])],
    });
    expect(() => decodePng(png)).toThrow(/invalid color type 2 \/ depth 4/);
  });

  it('crc32 matches the reference value for "IEND"', () => {
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });
});
