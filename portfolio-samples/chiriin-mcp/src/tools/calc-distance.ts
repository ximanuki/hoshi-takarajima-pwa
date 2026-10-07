import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ATTRIBUTION, compassJa, formatNumber, okResult, runTool } from '../format.js';
import { describeLocation, locationSchema, resolvedLocationOutput, resolveLocation } from '../location.js';
import type { Services } from '../services.js';

export function registerCalcDistance(server: McpServer, services: Services): void {
  server.registerTool(
    'calc_distance',
    {
      title: '2地点間の距離と方位角',
      description: [
        '2地点間の測地線距離（GRS80楕円体上の最短距離）と方位角を、国土地理院の測量計算サイトで計算します。',
        'from / to はそれぞれ address（住所・地名）か lat/lon で指定します。方位角は真北から時計回りの角度です。',
        'Computes the geodesic distance and azimuths between two points in Japan (GRS80) using the GSI survey calculation API.',
      ].join('\n'),
      inputSchema: {
        from: locationSchema.describe('出発点（address または lat/lon）'),
        to: locationSchema.describe('到着点（address または lat/lon）'),
      },
      outputSchema: {
        from: resolvedLocationOutput,
        to: resolvedLocationOutput,
        distanceM: z.number(),
        distanceKm: z.number(),
        azimuthFromStartDeg: z.number(),
        azimuthFromEndDeg: z.number(),
        directionJa: z.string().describe('出発点から見た到着点の16方位'),
        attribution: z.string(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ from, to }) =>
      runTool(async () => {
        const [a, b] = await Promise.all([
          resolveLocation(from, services.geocoder, '出発点'),
          resolveLocation(to, services.geocoder, '到着点'),
        ]);
        const r = await services.survey.distance(a.lat, a.lon, b.lat, b.lon);
        const direction = compassJa(r.azimuthFromStartDeg);
        const text = [
          `距離: ${formatNumber(r.distanceM, 3)} m（約 ${formatNumber(r.distanceM / 1000, 2)} km、GRS80楕円体上の測地線長）`,
          `方位角: 出発点→到着点 ${r.azimuthFromStartDeg.toFixed(4)}°（${direction}）／到着点→出発点 ${r.azimuthFromEndDeg.toFixed(4)}°`,
          `出発点: ${describeLocation(a)}`,
          `到着点: ${describeLocation(b)}`,
          '',
          ATTRIBUTION.survey,
        ].join('\n');
        return okResult(text, {
          from: a,
          to: b,
          distanceM: r.distanceM,
          distanceKm: Math.round(r.distanceM) / 1000,
          azimuthFromStartDeg: r.azimuthFromStartDeg,
          azimuthFromEndDeg: r.azimuthFromEndDeg,
          directionJa: direction,
          attribution: ATTRIBUTION.survey,
        });
      }),
  );
}
