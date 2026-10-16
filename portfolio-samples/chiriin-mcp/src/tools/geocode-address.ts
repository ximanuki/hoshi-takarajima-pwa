import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { normalizeQuery } from '../api/geocode.js';
import { ATTRIBUTION, okResult, runTool } from '../format.js';
import { gsiMapUrl } from '../geo.js';
import type { Services } from '../services.js';

const candidateOutput = z.object({
  title: z.string(),
  lat: z.number(),
  lon: z.number(),
  prefecture: z.string().nullable(),
  municipalityCode: z.string().nullable(),
  gsiMapUrl: z.string(),
});

export function registerGeocodeAddress(server: McpServer, services: Services): void {
  server.registerTool(
    'geocode_address',
    {
      title: '住所・地名から緯度経度を検索',
      description: [
        '住所や地名から緯度・経度の候補を返します（国土地理院「地理院地図」の住所検索）。',
        '住所は町丁目・街区（○番）程度の精度です。地名・施設名は同名や部分一致の候補が多く返るため、名称が一致・包含する候補を先頭に並べ替えています。',
        '他のツールは address を直接受け付けて先頭候補を使うため、候補が複数ありそうな場合にだけ、このツールで確認してから lat/lon を渡してください。',
        'Geocodes a Japanese address or place name to candidate coordinates using GSI Maps address search.',
      ].join('\n'),
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(200)
          .describe(
            '住所または地名（例: "東京都千代田区永田町1-7-1", "大阪駅"）。都道府県から書くと精度が上がります。',
          ),
        limit: z.number().int().min(1).max(50).default(10).describe('返す候補の最大数（1〜50、既定 10）'),
      },
      outputSchema: {
        query: z.string(),
        total: z.number().int(),
        returned: z.number().int(),
        truncated: z.boolean(),
        candidates: z.array(candidateOutput),
        attribution: z.string(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ query, limit }) =>
      runTool(async () => {
        const all = await services.geocoder.search(query);
        const shown = all.slice(0, limit);
        const candidates = shown.map((c) => ({ ...c, gsiMapUrl: gsiMapUrl(c.lat, c.lon) }));
        const truncated = all.length > shown.length;
        const lines: string[] = [];
        if (all.length === 0) {
          lines.push(`「${normalizeQuery(query)}」に一致する住所・地名は見つかりませんでした。`);
          lines.push(
            'ヒント: 都道府県名から書く、番地を省いて町丁目までにする、表記（丁目・番・号）を変えるなどを試してください。',
          );
        } else {
          lines.push(
            `「${normalizeQuery(query)}」の検索結果: ${all.length} 件${truncated ? `（先頭 ${shown.length} 件を表示）` : ''}`,
          );
          candidates.forEach((c, i) => {
            lines.push(
              `${i + 1}. ${c.title} — 緯度 ${c.lat.toFixed(6)}, 経度 ${c.lon.toFixed(6)}  ${c.gsiMapUrl}`,
            );
          });
          if (truncated) {
            lines.push(
              `…ほか ${all.length - shown.length} 件。limit を増やすか、より詳しい住所で再検索してください。`,
            );
          }
        }
        lines.push('', ATTRIBUTION.geocode);
        return okResult(lines.join('\n'), {
          query: normalizeQuery(query),
          total: all.length,
          returned: shown.length,
          truncated,
          candidates,
          attribution: ATTRIBUTION.geocode,
        });
      }),
  );
}
