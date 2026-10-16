import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ATTRIBUTION, okResult, runTool } from '../format.js';
import { gsiMapUrl } from '../geo.js';
import {
  describeLocation,
  locationInputShape,
  resolvedLocationOutput,
  resolveLocation,
} from '../location.js';
import type { Services } from '../services.js';

export function registerGetElevation(server: McpServer, services: Services): void {
  server.registerTool(
    'get_elevation',
    {
      title: '標高を調べる',
      description: [
        '指定地点の標高（m、東京湾平均海面基準）を国土地理院の標高APIで取得します。',
        'その地点で最も精度の高いデータ（1m・5mレーザ、5m写真測量、10m等高線由来）が使われ、どのデータかも返します。',
        '地点は address（住所・地名）か lat/lon のどちらかで指定します。海上や国外では取得できません。',
        'Returns the ground elevation (m above Tokyo Bay mean sea level) at a point in Japan from the GSI elevation API.',
      ].join('\n'),
      inputSchema: locationInputShape,
      outputSchema: {
        location: resolvedLocationOutput,
        elevationM: z.number(),
        source: z.string(),
        sourceDescription: z.string(),
        resolutionM: z.number(),
        gsiMapUrl: z.string(),
        attribution: z.string(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (input) =>
      runTool(async () => {
        const location = await resolveLocation(input, services.geocoder);
        const result = await services.elevation.get(location.lat, location.lon);
        const digits = result.resolutionM < 1 ? 1 : 0;
        const text = [
          `標高: ${result.elevationM.toFixed(digits)} m（東京湾平均海面からの高さ）`,
          `データ: ${result.source} — ${result.sourceDescriptionJa}`,
          `地点: ${describeLocation(location)}`,
          `地図: ${gsiMapUrl(location.lat, location.lon)}`,
          '',
          ATTRIBUTION.elevation,
        ].join('\n');
        return okResult(text, {
          location,
          elevationM: result.elevationM,
          source: result.source,
          sourceDescription: result.sourceDescriptionJa,
          resolutionM: result.resolutionM,
          gsiMapUrl: gsiMapUrl(location.lat, location.lon),
          attribution: ATTRIBUTION.elevation,
        });
      }),
  );
}
