import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ChiriinError } from '../errors.js';
import { ATTRIBUTION, okResult, runTool } from '../format.js';
import { gsiMapUrl, toDms } from '../geo.js';
import {
  describeLocation,
  locationInputShape,
  resolvedLocationOutput,
  resolveLocation,
} from '../location.js';
import type { Services } from '../services.js';
import { suggestZone, zoneInfo, zoneTableText } from '../zones.js';

const ZONE_HELP =
  '系番号は都道府県で決まります（例: 東京都・神奈川県・千葉県・埼玉県=9、大阪府・京都府=6、愛知県=7、福岡県=2、北海道=11/12/13）。';

const zoneInput = z.number().int().min(1).max(19);

export function registerPlaneRectangular(server: McpServer, services: Services): void {
  server.registerTool(
    'latlon_to_plane',
    {
      title: '緯度経度 → 平面直角座標',
      description: [
        '緯度経度（世界測地系 JGD2011）を平面直角座標系の X・Y（m）に換算します（国土地理院 測量計算サイト）。測量・設計図面・公共座標で使う形式です。',
        'X は北方向、Y は東方向の座標です（数学の xy とは逆）。真北方向角と縮尺係数も返します。',
        `zone（系番号 1〜19）を省略すると、address の都道府県から自動で選びます（北海道は市町村で異なるため要指定）。${ZONE_HELP}`,
        'Converts latitude/longitude (JGD2011) to Japan Plane Rectangular Coordinates (X northing / Y easting, metres).',
      ].join('\n'),
      inputSchema: {
        ...locationInputShape,
        zone: zoneInput
          .optional()
          .describe('平面直角座標系の系番号（1〜19）。省略時は住所の都道府県から推定'),
      },
      outputSchema: {
        location: resolvedLocationOutput,
        zone: z.number().int(),
        zoneSelection: z.enum(['specified', 'auto_by_prefecture', 'auto_by_position']),
        zoneArea: z.string(),
        x: z.number(),
        y: z.number(),
        gridConvergenceDeg: z.number(),
        scaleFactor: z.number(),
        attribution: z.string(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ zone, ...locationInput }) =>
      runTool(async () => {
        const location = await resolveLocation(locationInput, services.geocoder);
        let selected = zone;
        let selection: 'specified' | 'auto_by_prefecture' | 'auto_by_position' = 'specified';
        if (selected === undefined) {
          const suggestion = suggestZone(location.prefecture, location.lat, location.lon);
          if (!suggestion) {
            throw new ChiriinError({
              code: 'INVALID_INPUT',
              ja: location.prefecture
                ? `${location.prefecture}は市町村によって系番号が異なるため、zone を指定してください`
                : '都道府県が分からないため系番号を決められません。zone を指定するか、address に都道府県から住所を指定してください',
              en: 'Cannot determine the plane rectangular zone; please pass "zone" (1–19)',
              hint: `系番号と適用区域:\n${zoneTableText()}`,
            });
          }
          selected = suggestion.zone;
          selection = suggestion.basis === 'exact' ? 'auto_by_prefecture' : 'auto_by_position';
        }
        const r = await services.survey.toPlane(location.lat, location.lon, selected);
        const info = zoneInfo(selected);
        const how =
          selection === 'specified'
            ? '指定'
            : selection === 'auto_by_prefecture'
              ? `${location.prefecture}から自動選択`
              : `${location.prefecture}と位置から自動選択（境界付近は要確認）`;
        const text = [
          `平面直角座標（第${info?.roman ?? selected}系・${how}）`,
          `X = ${r.x.toFixed(3)} m（北方向）`,
          `Y = ${r.y.toFixed(3)} m（東方向）`,
          `真北方向角: ${r.gridConvergenceDeg.toFixed(6)}°　縮尺係数: ${r.scaleFactor}`,
          `地点: ${describeLocation(location)}`,
          `適用区域: ${info?.areaJa ?? '-'}`,
          '',
          ATTRIBUTION.survey,
        ].join('\n');
        return okResult(text, {
          location,
          zone: selected,
          zoneSelection: selection,
          zoneArea: info?.areaJa ?? '',
          x: r.x,
          y: r.y,
          gridConvergenceDeg: r.gridConvergenceDeg,
          scaleFactor: r.scaleFactor,
          attribution: ATTRIBUTION.survey,
        });
      }),
  );

  server.registerTool(
    'plane_to_latlon',
    {
      title: '平面直角座標 → 緯度経度',
      description: [
        '平面直角座標系の X・Y（m）と系番号から、緯度経度（世界測地系 JGD2011）に換算します（国土地理院 測量計算サイト）。',
        `X は北方向、Y は東方向の座標です。図面や測量成果の座標を地図上の位置にしたいときに使います。${ZONE_HELP}`,
        'Converts Japan Plane Rectangular Coordinates (X northing / Y easting, metres) to latitude/longitude (JGD2011).',
      ].join('\n'),
      inputSchema: {
        x: z.number().describe('X 座標（m、北方向が正）'),
        y: z.number().describe('Y 座標（m、東方向が正）'),
        zone: zoneInput.describe('平面直角座標系の系番号（1〜19）'),
      },
      outputSchema: {
        zone: z.number().int(),
        lat: z.number(),
        lon: z.number(),
        latDms: z.string(),
        lonDms: z.string(),
        gridConvergenceDeg: z.number(),
        scaleFactor: z.number(),
        gsiMapUrl: z.string(),
        attribution: z.string(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ x, y, zone }) =>
      runTool(async () => {
        const r = await services.survey.fromPlane(x, y, zone);
        const info = zoneInfo(zone);
        const map = gsiMapUrl(r.lat, r.lon);
        const text = [
          `緯度経度（第${info?.roman ?? zone}系 X=${x}, Y=${y} から換算）`,
          `緯度: ${r.lat.toFixed(8)}°（${toDms(r.lat)}）`,
          `経度: ${r.lon.toFixed(8)}°（${toDms(r.lon)}）`,
          `真北方向角: ${r.gridConvergenceDeg.toFixed(6)}°　縮尺係数: ${r.scaleFactor}`,
          `地図: ${map}`,
          '',
          ATTRIBUTION.survey,
        ].join('\n');
        return okResult(text, {
          zone,
          lat: r.lat,
          lon: r.lon,
          latDms: toDms(r.lat),
          lonDms: toDms(r.lon),
          gridConvergenceDeg: r.gridConvergenceDeg,
          scaleFactor: r.scaleFactor,
          gsiMapUrl: map,
          attribution: ATTRIBUTION.survey,
        });
      }),
  );
}
