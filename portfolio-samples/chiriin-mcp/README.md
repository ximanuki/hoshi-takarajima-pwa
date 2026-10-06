# chiriin-mcp — 国土地理院 MCP サーバー

[English](README.en.md)

国土地理院（GSI）の公開API・オープンデータを、Claude などの AI アシスタントから使えるようにする [MCP](https://modelcontextprotocol.io/) サーバーです。**APIキーは不要**です。

- **ハザード情報**: 指定した地点の浸水深（洪水・内水・高潮・津波）、浸水継続時間、家屋倒壊等氾濫想定区域、土砂災害警戒区域を「重ねるハザードマップ」のデータで判定します
- **住所検索**: 住所・地名から緯度経度を求めます
- **標高**: 1m・5m メッシュなど、その地点で最も精度の高いデータで標高を返します
- **測量計算**: 2地点間の距離と方位角、平面直角座標との相互換算（系番号の自動選択つき）、ジオイド高（ジオイド2024）

どのツールも、住所か緯度経度のどちらでも地点を指定できます。応答には出典と注意事項が付きます。

> 「重ねるハザードマップ」のデータは、宅地建物取引業の重要事項説明には使えません（国土地理院の利用規約による）。本ツールの結果は調査や検討の補助として使い、最終的には市町村のハザードマップで確認してください。

## 他の MCP サーバーとの違い

e-Gov 法令API などの MCP サーバーはすでに数多くありますが、国土地理院の測量計算API や、ハザードマップを地点ごとに判定する MCP サーバーで、オープンソースのものは見当たりませんでした（調査結果: [RESEARCH.md](RESEARCH.md)）。

- **11 レイヤーを判定**: 浸水深の区分（0.3m 未満〜20m 以上）、浸水継続時間（12 時間未満〜4 週間以上）、特別警戒区域／警戒区域、指定済／指定予定まで区別します
- **判定の根拠を示す**: 凡例の色は公式の凡例画像から 1 ピクセル単位で読み取っています。応答にはタイルの URL と画素の色を含めます。PNG デコーダーは自前で実装し、Pillow と全ピクセルが一致することをテストで確認しています
- **利用条件を守る**: 測量計算サイトの制限（10 秒に 10 回）を守るレート制限、タイムアウト・再試行・応答サイズの上限・キャッシュを備えています
- **日本語と英語でエラーを返す**: 原因と対処（ヒント）を返すので、AI が次の手を判断できます
- **stdio と Streamable HTTP の両方に対応**

## インストール

Node.js 22 以上が必要です。

### Claude Desktop

`claude_desktop_config.json` に次を追加します。

```json
{
  "mcpServers": {
    "chiriin": {
      "command": "npx",
      "args": ["-y", "chiriin-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add chiriin -- npx -y chiriin-mcp

# すべてのプロジェクトで使う場合
claude mcp add --scope user chiriin -- npx -y chiriin-mcp
```

### ソースから使う場合

```bash
git clone https://github.com/ximanuki/chiriin-mcp.git
cd chiriin-mcp
npm ci && npm run build
claude mcp add chiriin -- node "$(pwd)/dist/index.js"
```

### Streamable HTTP で起動する場合

```bash
npx -y chiriin-mcp --http --port 3000      # POST http://127.0.0.1:3000/mcp
claude mcp add --transport http chiriin http://127.0.0.1:3000/mcp
```

ステートレス構成です。既定では `127.0.0.1` だけで待ち受け、Host ヘッダーを検査して DNS リバインディングを防ぎます。外部に公開する場合は、前段に認証つきのリバースプロキシを置いてください。

### プロキシ環境で使う場合

Node.js の `fetch` は、標準では `HTTPS_PROXY` を参照しません。Node 22.21 以上なら、次のように `NODE_USE_ENV_PROXY=1` を設定します。

```json
"env": { "NODE_USE_ENV_PROXY": "1", "HTTPS_PROXY": "http://proxy.example:8080" }
```

## ツール一覧

地点を指定する引数は共通で、`address`（住所・地名）か `lat` と `lon`（世界測地系、10進度）のどちらかを渡します。住所を渡した場合は検索結果の先頭候補を使い、どの候補を使ったかを応答に書きます。

| ツール | 内容 | 主な引数 | 主な戻り値（structuredContent） |
|---|---|---|---|
| `get_hazard_info` | 地点のハザード情報（11 レイヤー）と標高 | 地点、`layers?`（レイヤーID の配列）、`include_elevation?`（既定 true） | `inZone`（該当したレイヤー）、`layers[]`（状態・区分・色・タイルURL）、`elevation`、`links`、`attribution`、`disclaimer` |
| `geocode_address` | 住所・地名 → 緯度経度の候補 | `query`、`limit?`（1〜50、既定 10） | `candidates[]`（名称・緯度経度・都道府県・市区町村コード・地理院地図URL）、`total`、`truncated` |
| `get_elevation` | 標高（東京湾平均海面基準） | 地点 | `elevationM`、`source`（例: `1m（レーザ）`）、`resolutionM` |
| `calc_distance` | 2地点間の測地線距離と方位角（GRS80） | `from`、`to`（それぞれ地点） | `distanceM`、`azimuthFromStartDeg`、`azimuthFromEndDeg`、`directionJa`（16 方位） |
| `latlon_to_plane` | 緯度経度 → 平面直角座標 X・Y | 地点、`zone?`（省略時は住所の都道府県から自動選択） | `x`（北方向）、`y`（東方向）、`zone`、`zoneSelection`、`gridConvergenceDeg`、`scaleFactor` |
| `plane_to_latlon` | 平面直角座標 → 緯度経度 | `x`、`y`、`zone` | `lat`、`lon`、`latDms`、`lonDms` |
| `get_geoid_height` | ジオイド高（ジオイド2024）、楕円体高 → 標高 | 地点、`ellipsoidal_height?` | `geoidHeightM`、`referenceCorrectionM`（基準面補正量）、`orthometricHeightM` |

### `get_hazard_info` のレイヤーID

| ID | レイヤー | 判定内容 |
|---|---|---|
| `flood_max` | 洪水浸水想定区域（想定最大規模） | 浸水深 |
| `flood_planned` | 洪水浸水想定区域（計画規模） | 浸水深 |
| `flood_duration` | 浸水継続時間（想定最大規模） | 継続時間 |
| `house_collapse_overflow` | 家屋倒壊等氾濫想定区域（氾濫流） | 区域内か |
| `house_collapse_erosion` | 家屋倒壊等氾濫想定区域（河岸侵食） | 区域内か |
| `inland_flood` | 内水（雨水出水）浸水想定区域 | 浸水深 |
| `storm_surge` | 高潮浸水想定区域 | 浸水深 |
| `tsunami` | 津波浸水想定 | 浸水深 |
| `debris_flow` | 土砂災害警戒区域（土石流） | 特別警戒区域／警戒区域、指定済／指定予定 |
| `steep_slope` | 土砂災害警戒区域（急傾斜地の崩壊） | 同上 |
| `landslide` | 土砂災害警戒区域（地すべり） | 同上 |

各レイヤーの状態は `in_zone`（区域内）、`not_in_zone`（区域外）、`unknown_color`（凡例にない色）、`error`（取得失敗）のいずれかです。一部のレイヤーで取得に失敗しても、他のレイヤーの結果は返します。

リソースとして、`chiriin://hazard-layers`（レイヤー・凡例・タイルURL）と `chiriin://plane-rectangular-zones`（平面直角座標系の系番号と適用区域）も公開しています。

## 会話例

実際の API 応答（2026-10-06）をもとにした例です。

> **ユーザー**: 東京都江東区東陽4-11-28 に事務所を借りるか検討しています。水害のリスクを教えてください。
>
> **Claude**（`get_hazard_info` を `{"address": "東京都江東区東陽4-11-28"}` で呼び出し）
>
> 国土地理院の「重ねるハザードマップ」で確認した結果です（地点: 東京都江東区東陽四丁目11番28号、標高 −1.2m）。
>
> - 洪水（想定最大規模）: 浸水深 **3〜5m**。2階の床上まで浸水する想定です
> - 高潮: 浸水深 **3〜5m**
> - 浸水継続時間: **2週間以上**
> - 洪水（計画規模）: 浸水深 0.5〜3m
> - 内水・津波・土砂災害警戒区域: 該当なし
>
> 標高が海面より低い地域で、浸水が長引く想定です。上の階を選ぶ、非常用電源や備蓄を確保する、といった対策を検討してください。正式な判断には江東区のハザードマップを確認してください（この結果は重要事項説明には使えません）。
>
> 出典: 「ハザードマップポータルサイト」（https://disaportal.gsi.go.jp/）のオープンデータを加工して作成

ツールの応答（テキスト部分の抜粋）:

```text
## ハザード情報（重ねるハザードマップ）
地点: 「東京都江東区東陽4-11-28」→ 東京都江東区東陽四丁目１１番２８号（緯度 35.672993, 経度 139.816360）
標高: -1.2 m（1m（レーザ））

### 該当あり（4件）
- 【要注意】浸水継続時間（想定最大規模）: 2週間以上（地域により4週間以上を含む）
- 【要注意】洪水浸水想定区域（想定最大規模）: 3m以上5m未満（目安: 2階の床上まで浸水）
- 【要注意】高潮浸水想定区域: 3m以上5m未満（目安: 2階の床上まで浸水）
- 洪水浸水想定区域（計画規模）: 0.5m以上3m未満（目安: 1階の床上浸水（1階の天井付近まで））

### 該当なし（7件）
家屋倒壊等氾濫想定区域（氾濫流）、家屋倒壊等氾濫想定区域（河岸侵食）、内水（雨水出水）浸水想定区域、津波浸水想定、土砂災害警戒区域（土石流）、土砂災害警戒区域（急傾斜地の崩壊）、土砂災害警戒区域（地すべり）
```

ほかの質問の例:

- 「熱海市伊豆山のこの地点（35.110623, 139.085562）は土砂災害警戒区域ですか？」→ 急傾斜地の崩壊で**特別警戒区域（指定済）**、土石流で警戒区域（指定済）
- 「茨城県つくば市北郷1 の平面直角座標は？」→ 第IX系（茨城県から自動選択）で X = 11674.641m、Y = 22663.526m
- 「GNSS で測った楕円体高 100m は、八丈島（33.1, 139.79）では標高何m？」→ ジオイド高 43.6072m と基準面補正量 0.387m を引いて 56.0058m

## ハザードの判定方法

1. 地点を含むズームレベル 17 のタイル（1画素あたり約 1m）の URL を計算します
2. `https://disaportaldata.gsi.go.jp/raster/{レイヤー}/17/{x}/{y}.png` を取得します。404 はそのタイルにデータがないこと（区域外）を表します
3. PNG を RGBA に展開し、地点の画素の色を凡例の色と照合します（RGB の距離 7 以内）
4. 地点の色が凡例にない場合（区域の境界線）、または円模様で描かれたレイヤーで模様の隙間に当たった場合は、周辺の画素で判定し、その旨を `noteJa` に書きます。区域外でも数m以内に区域があれば `nearbyWithinM` で伝えます

## 注意事項

- **「該当なし」は「安全」という意味ではありません。** 区域外の場合のほか、都道府県や市町村がデータを作成していない、または公開していない場合も含まれます
- ハザードマップのデータは、浸水深の区分や区域を判定するためのものです。精度や誤差は、作成した機関の資料で確認してください
- 住所検索は、地理院地図の検索機能が使っているエンドポイントを利用しています。第三者向けの仕様書や SLA はありません。精度は町丁目・街区程度で、施設名の検索は苦手です
- 逆ジオコーディング（座標 → 住所）には対応していません。国土地理院の逆ジオコーダは 2026-10 時点で使えなくなっています
- 平面直角座標の系番号は、北海道では市町村によって異なるため自動選択しません。`zone` を指定してください

## データの出典と利用条件

| データ | 提供元 | 利用条件 |
|---|---|---|
| 重ねるハザードマップ（オープンデータ） | 国土交通省 国土地理院 ハザードマップポータルサイト（元データは国土交通省、都道府県、市町村、国土数値情報） | [公共データ利用規約（PDL1.0）](https://www.digital.go.jp/resources/open_data/public_data_license_v1.0)。出典の記載が必要で、加工した場合はその旨も記載します。[利用規約](https://disaportal.gsi.go.jp/hazardmapportal/hazardmap/copyright/copyright.html) / [オープンデータ](https://disaportal.gsi.go.jp/hazardmapportal/hazardmap/copyright/opendata.html) |
| 標高API | 国土地理院 | [サーバサイドで経緯度から標高を求めるプログラム](https://maps.gsi.go.jp/development/elevation_s.html)。過度の負担をかけないこと |
| 測量計算サイト API | 国土地理院 | [API 使用法](https://vldb.gsi.go.jp/sokuchi/surveycalc/api_help.html)。同一 IP から 10 秒間に 10 回まで |
| 住所検索 | 国土地理院 地理院地図 | 地理院地図の機能を利用（外部向けの保証はありません） |

ツールの応答には、そのまま転記できる出典（例:「出典: 「ハザードマップポータルサイト」（https://disaportal.gsi.go.jp/）のオープンデータを加工して作成（2026-10-06に利用）」）が付きます。結果を公開する場合は、この出典を記載してください。

このソフトウェアは国土地理院が提供・推奨するものではありません。

## 設定（環境変数）

| 変数 | 既定値 | 内容 |
|---|---|---|
| `CHIRIIN_TIMEOUT_MS` | `10000` | API 1 回あたりのタイムアウト（本文の受信を含む） |
| `CHIRIIN_RETRIES` | `2` | タイムアウト・ネットワークエラー・429・5xx のときの再試行回数（指数バックオフ。`Retry-After` があればそれに従う） |
| `CHIRIIN_USER_AGENT` | `chiriin-mcp/<version> (+https://github.com/ximanuki/chiriin-mcp)` | User-Agent |
| `CHIRIIN_MAX_RESPONSE_BYTES` | `2097152` | 応答 1 件あたりのサイズ上限 |
| `MCP_TRANSPORT` | （未設定） | `http` にすると `--http` と同じ |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | HTTP で起動する場合の待ち受け先 |

## 開発

```bash
npm ci
npm run lint        # Biome（lint + フォーマット確認）
npm run typecheck   # tsc（strict、テストも含む）
npm test            # Vitest。記録済みの応答を使い、ネットワークには接続しない
npm run build       # dist/ に出力

# 実際の API を呼ぶ確認（任意）
npm run smoke                 # stdio で全ツールを実行
npm run smoke -- --http       # Streamable HTTP で同じ確認
npm run record-fixtures       # test/recorded/ の記録を取り直す（build 後に実行）
```

テストでは `fetch` を差し替えて外部へのアクセスを禁止し、`test/recorded/` に保存した実際の応答（JSON と PNG タイル 13 枚）を再生します。記録は `scripts/record-fixtures.mjs` が MCP サーバーを実際に動かして取得するため、記録される URL はコードが実際に要求するものと一致します。

```
src/
  index.ts            CLI（stdio / --http）
  server.ts           MCP サーバー（ツール・リソースの登録）
  http.ts             Streamable HTTP（ステートレス）
  tools/              ツールごとの入出力スキーマと整形
  api/                各 API のクライアント（geocode / elevation / surveycalc / hazard）
  hazard-layers.ts    レイヤー定義と凡例の色
  png.ts              依存ライブラリなしの PNG デコーダー
  http-client.ts      タイムアウト・再試行・レート制限・サイズ上限
  rate-limiter.ts, cache.ts, tiles.ts, zones.ts, geo.ts, location.ts, errors.ts
test/                 Vitest（記録済み応答を使用）
scripts/              smoke.mjs（実 API での確認）、record-fixtures.mjs
```

## ライセンス

[MIT](LICENSE)。取得するデータの利用条件は上記「データの出典と利用条件」に従います。
