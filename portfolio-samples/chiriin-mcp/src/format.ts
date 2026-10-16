import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toChiriinError } from './errors.js';

/** Hard cap for the human-readable part of a tool result. */
export const MAX_TEXT_CHARS = 8_000;

export const ATTRIBUTION = {
  geocode: '住所検索: 国土地理院「地理院地図」の住所検索機能を利用（https://maps.gsi.go.jp/）',
  elevation: '出典: 国土地理院 標高API（https://maps.gsi.go.jp/development/elevation_s.html）',
  survey: '出典: 国土地理院 測量計算サイト（https://vldb.gsi.go.jp/sokuchi/surveycalc/）',
  hazard: (date: string) =>
    `出典: 「ハザードマップポータルサイト」（https://disaportal.gsi.go.jp/）のオープンデータを加工して作成（${date}に利用）`,
} as const;

export const HAZARD_DISCLAIMER_JA = [
  '「重ねるハザードマップ」の公開タイルを地点ごとに機械判定した結果です。最新・詳細な情報は市町村のハザードマップで確認してください（わがまちハザードマップ: https://disaportal.gsi.go.jp/hazardmap/ ）。',
  '水防法・土砂災害防止法に基づき市町村が作成したハザードマップではないため、宅地建物取引業の重要事項説明には使用できません。',
  '「該当なし」には、区域外のほか、データが未整備・未公開の地域も含まれます。',
];

/** Truncates long text and says how to get the rest. */
export function limitText(
  text: string,
  max = MAX_TEXT_CHARS,
  hint = '対象を絞って再実行してください。',
): string {
  if (text.length <= max) return text;
  const omitted = text.length - max;
  return `${text.slice(0, max)}\n…（${omitted} 文字を省略しました。${hint}）`;
}

export function okResult(text: string, structured: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: limitText(text) }], structuredContent: structured };
}

export function errorResult(error: unknown): CallToolResult {
  const e = toChiriinError(error);
  if (e.code === 'INTERNAL') console.error('[chiriin-mcp] internal error:', error);
  return { isError: true, content: [{ type: 'text', text: e.toUserText() }] };
}

/** Wraps a tool body so that every failure becomes a bilingual isError result. */
export async function runTool(body: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await body();
  } catch (error) {
    return errorResult(error);
  }
}

const COMPASS_JA = [
  '北',
  '北北東',
  '北東',
  '東北東',
  '東',
  '東南東',
  '南東',
  '南南東',
  '南',
  '南南西',
  '南西',
  '西南西',
  '西',
  '西北西',
  '北西',
  '北北西',
] as const;

/** Azimuth (deg, clockwise from north) -> 16-point compass direction in Japanese. */
export function compassJa(azimuthDeg: number): string {
  const normalized = ((azimuthDeg % 360) + 360) % 360;
  return COMPASS_JA[Math.round(normalized / 22.5) % 16] ?? '北';
}

export function formatNumber(value: number, digits: number): string {
  return value.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
