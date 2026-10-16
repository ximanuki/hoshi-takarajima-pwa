import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ElevationResult } from '../api/elevation.js';
import type { HazardLayerResult } from '../api/hazard.js';
import { ChiriinError, toChiriinError } from '../errors.js';
import { ATTRIBUTION, HAZARD_DISCLAIMER_JA, okResult, runTool } from '../format.js';
import { gsiMapUrl, hazardMapUrl, todayInJapan } from '../geo.js';
import { depthGuideJa, HAZARD_LAYER_IDS, HAZARD_LAYERS } from '../hazard-layers.js';
import {
  describeLocation,
  locationInputShape,
  resolvedLocationOutput,
  resolveLocation,
} from '../location.js';
import type { Services } from '../services.js';

const layerIdEnum = z.enum(HAZARD_LAYER_IDS);

const layerResultOutput = z.object({
  id: z.string(),
  group: z.string(),
  nameJa: z.string(),
  nameEn: z.string(),
  status: z.enum(['in_zone', 'not_in_zone', 'unknown_color', 'error']),
  hazardClass: z
    .object({
      labelJa: z.string(),
      labelEn: z.string(),
      min: z.number().optional(),
      max: z.number().nullable().optional(),
      unit: z.enum(['m', 'h']).optional(),
      level: z.number().int(),
    })
    .optional(),
  color: z.string().optional(),
  nearbyWithinM: z.number().optional(),
  noteJa: z.string().optional(),
  error: z.string().optional(),
  tileUrl: z.string(),
});

const LAYER_LIST_JA = HAZARD_LAYERS.map((l) => `${l.id}: ${l.nameJa}`).join('\n');

function layerLine(r: HazardLayerResult): string {
  const c = r.hazardClass;
  if (!c) return `- ${r.nameJa}`;
  const warn = c.level >= 3 ? '【要注意】' : '';
  const guide = c.unit === 'm' ? depthGuideJa(c.max) : undefined;
  const parts = [`- ${warn}${r.nameJa}: ${c.labelJa}`];
  if (guide) parts.push(`（${guide}）`);
  if (r.noteJa) parts.push(` ※${r.noteJa}`);
  return parts.join('');
}

export function registerGetHazardInfo(server: McpServer, services: Services): void {
  server.registerTool(
    'get_hazard_info',
    {
      title: 'ハザード情報（浸水・土砂災害など）を調べる',
      description: [
        '指定地点が「重ねるハザードマップ」（国土地理院ハザードマップポータルサイト）の各災害リスク区域に入っているかを判定し、浸水深・浸水継続時間・区域の種別を返します。',
        '対象: 洪水（想定最大規模・計画規模・浸水継続時間・家屋倒壊等氾濫想定区域）、内水、高潮、津波、土砂災害警戒区域（土石流・急傾斜地・地すべり）。既定で標高も併せて返します。',
        '地点は address（住所・地名）か lat/lon で指定します。layers で対象を絞れます:',
        LAYER_LIST_JA,
        '注意: 結果は宅建業の重要事項説明には使えません。「該当なし」はデータ未公開の地域を含みます。回答では出典と注意事項を併記してください。',
        'Checks whether a point in Japan falls inside flood / storm-surge / tsunami / landslide hazard zones published by the GSI Hazard Map Portal.',
      ].join('\n'),
      inputSchema: {
        ...locationInputShape,
        layers: z
          .array(layerIdEnum)
          .min(1)
          .max(HAZARD_LAYER_IDS.length)
          .optional()
          .describe('調べるレイヤーID（省略時は全レイヤー）'),
        include_elevation: z.boolean().default(true).describe('標高も取得するか（既定 true）'),
      },
      outputSchema: {
        location: resolvedLocationOutput,
        elevation: z
          .object({ elevationM: z.number(), source: z.string() })
          .nullable()
          .describe('標高（取得しなかった・できなかった場合は null）'),
        inZone: z.array(z.string()).describe('区域内と判定されたレイヤーID'),
        layers: z.array(layerResultOutput),
        links: z.object({ hazardMap: z.string(), gsiMap: z.string(), municipalHazardMaps: z.string() }),
        attribution: z.string(),
        disclaimer: z.array(z.string()),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ layers, include_elevation, ...locationInput }) =>
      runTool(async () => {
        const location = await resolveLocation(locationInput, services.geocoder);
        const [results, elevationOutcome] = await Promise.all([
          services.hazard.evaluate(location.lat, location.lon, layers),
          include_elevation
            ? services.elevation.get(location.lat, location.lon).then(
                (value): { value: ElevationResult } | { error: string } => ({ value }),
                (error: unknown) => ({ error: toChiriinError(error).messageJa }),
              )
            : Promise.resolve(undefined),
        ]);

        const failed = results.filter((r) => r.status === 'error');
        if (failed.length === results.length) {
          throw new ChiriinError({
            code: 'UPSTREAM_NETWORK',
            ja: `ハザードマップのタイルを1件も取得できませんでした（${failed[0]?.error ?? '不明なエラー'}）`,
            en: 'Could not fetch any hazard-map tile',
            hint: 'ネットワーク接続を確認して再実行してください。',
            retryable: true,
          });
        }
        const inZone = results
          .filter((r) => r.status === 'in_zone')
          .sort((a, b) => (b.hazardClass?.level ?? 0) - (a.hazardClass?.level ?? 0));
        const notInZone = results.filter((r) => r.status === 'not_in_zone');
        const problems = results.filter((r) => r.status === 'error' || r.status === 'unknown_color');
        const links = {
          hazardMap: hazardMapUrl(location.lat, location.lon),
          gsiMap: gsiMapUrl(location.lat, location.lon),
          municipalHazardMaps: 'https://disaportal.gsi.go.jp/hazardmap/',
        };
        const attribution = ATTRIBUTION.hazard(todayInJapan(services.now()));

        const lines = ['## ハザード情報（重ねるハザードマップ）', `地点: ${describeLocation(location)}`];
        if (elevationOutcome && 'value' in elevationOutcome) {
          lines.push(`標高: ${elevationOutcome.value.elevationM} m（${elevationOutcome.value.source}）`);
        } else if (elevationOutcome) {
          lines.push(`標高: 取得できませんでした（${elevationOutcome.error}）`);
        }
        lines.push('', `### 該当あり（${inZone.length}件）`);
        if (inZone.length === 0) lines.push('- なし');
        for (const r of inZone) lines.push(layerLine(r));
        lines.push('', `### 該当なし（${notInZone.length}件）`);
        if (notInZone.length > 0) lines.push(notInZone.map((r) => r.nameJa).join('、'));
        for (const r of notInZone) if (r.noteJa) lines.push(`- ${r.nameJa}: ${r.noteJa}`);
        if (problems.length > 0) {
          lines.push('', `### 判定できなかったレイヤー（${problems.length}件）`);
          for (const r of problems) lines.push(`- ${r.nameJa}: ${r.error ?? r.noteJa ?? '不明'}`);
        }
        lines.push('', `地図で確認: ${links.hazardMap}`, '', '注意:');
        for (const d of HAZARD_DISCLAIMER_JA) lines.push(`- ${d}`);
        lines.push('', attribution);

        return okResult(lines.join('\n'), {
          location,
          elevation:
            elevationOutcome && 'value' in elevationOutcome
              ? { elevationM: elevationOutcome.value.elevationM, source: elevationOutcome.value.source }
              : null,
          inZone: inZone.map((r) => r.id),
          layers: results,
          links,
          attribution,
          disclaimer: HAZARD_DISCLAIMER_JA,
        });
      }),
  );
}
