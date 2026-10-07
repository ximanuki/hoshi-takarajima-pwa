import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ATTRIBUTION, okResult, runTool } from '../format.js';
import {
  describeLocation,
  locationInputShape,
  resolvedLocationOutput,
  resolveLocation,
} from '../location.js';
import type { Services } from '../services.js';

const MODEL = 'ジオイド2024日本とその周辺';

export function registerGetGeoidHeight(server: McpServer, services: Services): void {
  server.registerTool(
    'get_geoid_height',
    {
      title: 'ジオイド高（GNSS の楕円体高 → 標高）',
      description: [
        `指定地点のジオイド高を国土地理院の測量計算サイトで求めます（モデル: ${MODEL}、2025年4月からの標高体系）。`,
        '離島など一部地域では「基準面補正量」も返します。標高 = 楕円体高 − ジオイド高 − 基準面補正量。',
        'ellipsoidal_height（GNSS/GPS で得た楕円体高, m）を渡すと標高に換算します。',
        'Returns the geoid height (JGEOID2024) at a point and optionally converts a GNSS ellipsoidal height to orthometric height.',
      ].join('\n'),
      inputSchema: {
        ...locationInputShape,
        ellipsoidal_height: z
          .number()
          .min(-1000)
          .max(10000)
          .optional()
          .describe('楕円体高（m）。指定すると標高に換算します'),
      },
      outputSchema: {
        location: resolvedLocationOutput,
        model: z.string(),
        geoidHeightM: z.number(),
        referenceCorrectionM: z.number(),
        totalCorrectionM: z.number().describe('ジオイド高 + 基準面補正量'),
        ellipsoidalHeightM: z.number().optional(),
        orthometricHeightM: z.number().optional().describe('換算した標高（ellipsoidal_height 指定時）'),
        attribution: z.string(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ ellipsoidal_height, ...locationInput }) =>
      runTool(async () => {
        const location = await resolveLocation(locationInput, services.geocoder);
        const r = await services.survey.geoid(location.lat, location.lon);
        const lines = [
          `ジオイド高: ${r.geoidHeightM.toFixed(4)} m（${MODEL}）`,
          `基準面補正量: ${r.referenceCorrectionM.toFixed(4)} m${r.referenceCorrectionM === 0 ? '（この地点では補正なし）' : '（独自の標高基準を持つ離島など）'}`,
          `合計（ジオイド高 + 基準面補正量）: ${r.totalM.toFixed(4)} m`,
        ];
        const structured: Record<string, unknown> = {
          location,
          model: MODEL,
          geoidHeightM: r.geoidHeightM,
          referenceCorrectionM: r.referenceCorrectionM,
          totalCorrectionM: r.totalM,
          attribution: ATTRIBUTION.survey,
        };
        if (ellipsoidal_height !== undefined) {
          const orthometric = Math.round((ellipsoidal_height - r.totalM) * 10_000) / 10_000;
          lines.push(
            `標高（換算）: ${ellipsoidal_height} − ${r.totalM.toFixed(4)} = ${orthometric.toFixed(4)} m`,
          );
          structured.ellipsoidalHeightM = ellipsoidal_height;
          structured.orthometricHeightM = orthometric;
        } else {
          lines.push(`標高 = 楕円体高 − ${r.totalM.toFixed(4)} m`);
        }
        lines.push(`地点: ${describeLocation(location)}`, '', ATTRIBUTION.survey);
        return okResult(lines.join('\n'), structured);
      }),
  );
}
