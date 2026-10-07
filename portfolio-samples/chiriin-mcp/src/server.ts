import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { HAZARD_LAYERS } from './hazard-layers.js';
import type { Services } from './services.js';
import { registerCalcDistance } from './tools/calc-distance.js';
import { registerGeocodeAddress } from './tools/geocode-address.js';
import { registerGetElevation } from './tools/get-elevation.js';
import { registerGetGeoidHeight } from './tools/get-geoid-height.js';
import { registerGetHazardInfo } from './tools/get-hazard-info.js';
import { registerPlaneRectangular } from './tools/plane-rectangular.js';
import { PACKAGE_NAME, VERSION } from './version.js';
import { ZONES } from './zones.js';

export const SERVER_INSTRUCTIONS = [
  '国土地理院（GSI）の公開API・オープンデータを使うツール群です。APIキーは不要です。',
  '- 住所 → 座標: geocode_address。他のツールも address を直接受け付け、検索の先頭候補を使います（同名の地名が多い場合は geocode_address で確認して lat/lon を指定）。',
  '- 災害リスク（洪水・内水・高潮・津波・土砂災害）: get_hazard_info。標高も併せて返します。',
  '- 標高: get_elevation ／ 距離・方位: calc_distance ／ 平面直角座標: latlon_to_plane・plane_to_latlon ／ ジオイド高: get_geoid_height。',
  '回答に使うときは結果の attribution（出典）を併記してください。ハザード情報は宅建業の重要事項説明には使えず、「該当なし」はデータ未公開の地域を含みます。',
].join('\n');

export function createServer(services: Services): McpServer {
  const server = new McpServer(
    { name: PACKAGE_NAME, version: VERSION, title: '国土地理院 MCP（chiriin-mcp）' },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerGeocodeAddress(server, services);
  registerGetHazardInfo(server, services);
  registerGetElevation(server, services);
  registerCalcDistance(server, services);
  registerPlaneRectangular(server, services);
  registerGetGeoidHeight(server, services);

  server.registerResource(
    'hazard-layers',
    'chiriin://hazard-layers',
    {
      title: 'ハザードレイヤーと凡例',
      description: 'get_hazard_info が判定するレイヤーの一覧、タイルURL、凡例の色と区分',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(
            HAZARD_LAYERS.map((l) => ({
              id: l.id,
              nameJa: l.nameJa,
              nameEn: l.nameEn,
              tileTemplate: `https://disaportaldata.gsi.go.jp/raster/${l.path}/{z}/{x}/{y}.png`,
              source: l.sourceJa,
              note: l.noteJa,
              legend: l.legend.map((e) => ({ rgb: e.rgb, label: e.labelJa, min: e.min, max: e.max })),
            })),
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerResource(
    'plane-zones',
    'chiriin://plane-rectangular-zones',
    {
      title: '平面直角座標系の系番号と適用区域',
      description: '系番号 1〜19 の原点と適用区域（平成14年国土交通省告示第9号）',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(ZONES, null, 2) }],
    }),
  );

  return server;
}
