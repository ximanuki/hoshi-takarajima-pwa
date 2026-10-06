import { readFileSync } from 'node:fs';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HAZARD_LAYER_IDS } from '../src/hazard-layers.js';
import { VERSION } from '../src/version.js';
import { call, connectClient, recordedFetch, recordedServices, textOf } from './helpers/recorded.js';

const EXPECTED_TOOLS = [
  'geocode_address',
  'get_hazard_info',
  'get_elevation',
  'calc_distance',
  'latlon_to_plane',
  'plane_to_latlon',
  'get_geoid_height',
];

let client: Client;
beforeAll(async () => {
  client = await connectClient();
});
afterAll(async () => {
  await client.close();
});

describe('server metadata', () => {
  it('identifies itself and gives Japanese usage instructions', () => {
    expect(client.getServerVersion()).toMatchObject({ name: 'chiriin-mcp', version: VERSION });
    expect(client.getInstructions()).toContain('重要事項説明には使えず');
  });

  it('lists every tool with Japanese titles, descriptions, schemas and read-only annotations', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(EXPECTED_TOOLS);
    for (const tool of tools) {
      expect(tool.title, tool.name).toMatch(/[ぁ-んァ-ヶ一-龠]/);
      expect(tool.description, tool.name).toMatch(/[ぁ-んァ-ヶ一-龠]/);
      expect(tool.description, tool.name).toMatch(/[A-Za-z]{4,}/); // plus an English summary
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema?.type, tool.name).toBe('object');
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      });
    }
  });

  it('exposes the hazard layer legend and zone table as resources', async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([
      'chiriin://hazard-layers',
      'chiriin://plane-rectangular-zones',
    ]);
    const layers = await client.readResource({ uri: 'chiriin://hazard-layers' });
    const first = layers.contents[0];
    const parsed = JSON.parse(first && 'text' in first ? first.text : '[]') as {
      id: string;
      legend: unknown[];
    }[];
    expect(parsed.map((l) => l.id)).toEqual([...HAZARD_LAYER_IDS]);
    expect(parsed[0]?.legend.length).toBeGreaterThan(5);
  });
});

describe('geocode_address', () => {
  it('returns candidates with map links and attribution', async () => {
    const r = await call(client, 'geocode_address', { query: '東京都千代田区永田町1-7-1' });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({
      total: 1,
      truncated: false,
      candidates: [
        {
          title: '東京都千代田区永田町一丁目７番',
          gsiMapUrl: 'https://maps.gsi.go.jp/#16/35.677414/139.744385/',
        },
      ],
    });
    expect(textOf(r)).toContain('地理院地図');
  });

  it('truncates long candidate lists and says how to see more', async () => {
    const r = await call(client, 'geocode_address', { query: '富士山', limit: 3 });
    const s = r.structuredContent as { total: number; returned: number; truncated: boolean };
    expect(s.returned).toBe(3);
    expect(s.total).toBeGreaterThan(3);
    expect(s.truncated).toBe(true);
    expect(textOf(r)).toContain(`ほか ${s.total - 3} 件。limit を増やすか`);
  });

  it('reports no match as a normal (non-error) result with hints', async () => {
    const r = await call(client, 'geocode_address', { query: 'あいうえおかきくけこ' });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ total: 0, candidates: [] });
    expect(textOf(r)).toContain('見つかりませんでした');
  });

  it('rejects invalid arguments through schema validation', async () => {
    const r = await call(client, 'geocode_address', { query: '', limit: 999 });
    expect(r.isError).toBe(true);
  });
});

describe('get_elevation', () => {
  it('returns the elevation with its data source', async () => {
    const r = await call(client, 'get_elevation', { lat: 35.3606, lon: 138.7274 });
    expect(r.structuredContent).toMatchObject({
      elevationM: 3770.6,
      source: '1m（レーザ）',
      resolutionM: 0.1,
    });
    expect(textOf(r)).toMatch(/^標高: 3770\.6 m/);
  });

  it('returns a bilingual error at sea', async () => {
    const r = await call(client, 'get_elevation', { lat: 34.0, lon: 141.5 });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(
      /エラー \[NOT_FOUND\]: .*標高データがありません[\s\S]*Error \[NOT_FOUND\]: No elevation data/,
    );
  });

  it('rejects coordinates outside Japan before calling any API', async () => {
    const requested: string[] = [];
    const isolated = await connectClient(recordedServices(recordedFetch(requested)));
    const r = await call(isolated, 'get_elevation', { lat: 51.5, lon: -0.12 });
    await isolated.close();
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('OUT_OF_RANGE');
    expect(requested).toEqual([]);
  });
});

describe('get_hazard_info', () => {
  it('summarises every layer for an address in a zero-metre area', async () => {
    const r = await call(client, 'get_hazard_info', { address: '東京都江東区東陽4-11-28' });
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent as {
      location: { matchedTitle: string };
      elevation: { elevationM: number };
      inZone: string[];
      layers: unknown[];
      links: { hazardMap: string };
      attribution: string;
      disclaimer: string[];
    };
    expect(s.location.matchedTitle).toBe('東京都江東区東陽四丁目１１番２８号');
    expect(s.elevation.elevationM).toBeLessThan(0);
    expect(s.inZone).toEqual(['flood_duration', 'flood_max', 'storm_surge', 'flood_planned']);
    expect(s.layers).toHaveLength(HAZARD_LAYER_IDS.length);
    expect(s.links.hazardMap).toBe(
      'https://disaportal.gsi.go.jp/maps/?ll=35.672993,139.81636&z=16&base=pale',
    );
    expect(s.attribution).toBe(
      '出典: 「ハザードマップポータルサイト」（https://disaportal.gsi.go.jp/）のオープンデータを加工して作成（2026-10-06に利用）',
    );
    expect(s.disclaimer.join()).toContain('重要事項説明には使用できません');

    const text = textOf(r);
    expect(text).toContain('### 該当あり（4件）');
    expect(text).toContain(
      '【要注意】洪水浸水想定区域（想定最大規模）: 3m以上5m未満（目安: 2階の床上まで浸水）',
    );
    expect(text).toContain('### 該当なし（7件）');
    expect(text).toContain('「該当なし」には、区域外のほか');
  });

  it('honours layers / include_elevation and orders by severity', async () => {
    const r = await call(client, 'get_hazard_info', {
      lat: 35.100091,
      lon: 139.077752,
      layers: ['tsunami'],
      include_elevation: false,
    });
    expect(r.structuredContent).toMatchObject({
      elevation: null,
      inZone: ['tsunami'],
      layers: [
        { id: 'tsunami', status: 'in_zone', hazardClass: { labelJa: '3m以上5m未満', min: 3, max: 5 } },
      ],
    });
    expect(textOf(r)).not.toContain('標高:');
  });

  it('rejects unknown layer ids via the schema', async () => {
    const r = await call(client, 'get_hazard_info', { lat: 35, lon: 139, layers: ['volcano'] });
    expect(r.isError).toBe(true);
  });

  it('fails as a whole (isError) only when no tile at all could be fetched', async () => {
    const offline = await connectClient(
      recordedServices(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const r = await call(offline, 'get_hazard_info', { lat: 35.1, lon: 139.08, layers: ['tsunami'] });
    await offline.close();
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('タイルを1件も取得できませんでした');
  });
});

describe('calc_distance', () => {
  it('computes the geodesic distance and compass direction', async () => {
    const r = await call(client, 'calc_distance', {
      from: { lat: 36.10377477, lon: 140.08785502 },
      to: { lat: 35.65502847, lon: 139.74475044 },
    });
    expect(r.structuredContent).toMatchObject({
      distanceM: 58643.804,
      distanceKm: 58.644,
      directionJa: '南南西',
    });
    expect(textOf(r)).toContain('距離: 58,643.804 m（約 58.64 km');
  });

  it('labels which endpoint is invalid', async () => {
    const r = await call(client, 'calc_distance', { from: { lat: 36, lon: 140 }, to: {} });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('到着点');
  });
});

describe('plane rectangular coordinates', () => {
  it('converts lat/lon with an explicit zone', async () => {
    const r = await call(client, 'latlon_to_plane', { lat: 36.103774791, lon: 140.087855041, zone: 9 });
    expect(r.structuredContent).toMatchObject({
      zone: 9,
      zoneSelection: 'specified',
      x: 11543.688,
      y: 22916.2433,
    });
    expect(textOf(r)).toContain('第IX系');
  });

  it('picks the zone from the prefecture of an address', async () => {
    const r = await call(client, 'latlon_to_plane', { address: '茨城県つくば市北郷1' });
    expect(r.structuredContent).toMatchObject({
      zone: 9,
      zoneSelection: 'auto_by_prefecture',
      location: { prefecture: '茨城県' },
    });
    expect(textOf(r)).toContain('茨城県から自動選択');
  });

  it('asks for the zone when it cannot be inferred, listing all zones', async () => {
    const r = await call(client, 'latlon_to_plane', { lat: 36.1, lon: 140.1 });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('zone を指定するか');
    expect(textOf(r)).toContain('19（XIX系）');
  });

  it('converts back to lat/lon with DMS', async () => {
    const r = await call(client, 'plane_to_latlon', { x: 11543.6883, y: 22916.2436, zone: 9 });
    expect(r.structuredContent).toMatchObject({ zone: 9, latDms: `36°06'13.59"`, lonDms: `140°05'16.28"` });
  });
});

describe('get_geoid_height', () => {
  it('converts a GNSS ellipsoidal height including the island correction', async () => {
    const r = await call(client, 'get_geoid_height', { lat: 33.1, lon: 139.79, ellipsoidal_height: 100 });
    expect(r.structuredContent).toMatchObject({
      model: 'ジオイド2024日本とその周辺',
      geoidHeightM: 43.6072,
      referenceCorrectionM: 0.387,
      totalCorrectionM: 43.9942,
      orthometricHeightM: 56.0058,
    });
  });

  it('works without an ellipsoidal height', async () => {
    const r = await call(client, 'get_geoid_height', { lat: 36.103774791, lon: 140.087855041 });
    expect(r.structuredContent).toMatchObject({ geoidHeightM: 40.2826, referenceCorrectionM: 0 });
    expect(r.structuredContent).not.toHaveProperty('orthometricHeightM');
    expect(textOf(r)).toContain('この地点では補正なし');
  });
});

describe('package metadata', () => {
  it('keeps VERSION in sync with package.json and ships only built files', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
      bin: Record<string, string>;
      files: string[];
      engines: { node: string };
    };
    expect(pkg.version).toBe(VERSION);
    expect(pkg.bin['chiriin-mcp']).toBe('dist/index.js');
    expect(pkg.files).toContain('dist/**/*.js');
    expect(pkg.engines.node).toBe('>=22');
  });
});
