# 調査メモ: 題材の選定（2026-10-06）

最初の候補は e-Gov 法令API（v2）の MCP サーバーでしたが、既存実装を調べた結果、十分な品質のものがすでにあるため題材を変更しました。変更後の題材は **国土地理院の公開API・オープンデータ（住所検索・標高・測量計算・重ねるハザードマップ）** です。

調査方法: npm レジストリ検索API（`registry.npmjs.org/-/v1/search`）と各パッケージの README、Web 検索（Glama / LobeHub / mcp.so などの MCP カタログを含む）。GitHub 検索 API はこの環境から使えなかったため、GitHub にしかないものは Web 検索で見つかった範囲に限られます。

---

## 1. e-Gov 法令API の既存 MCP サーバー

e-Gov 法令API v2（`https://laws.e-gov.go.jp/api/2/`、認証不要）はこの環境から使えることを確認しました。仕様書は `https://laws.e-gov.go.jp/api/2/swagger-ui/lawapi-v2.yaml` にあり、エンドポイントは `/laws`・`/law_revisions/{id}`・`/law_data/{id}`（`asof` で時点を指定可）・`/keyword`・`/attachment`・`/law_file` です。

| パッケージ | 最新版（日付） | API | 主なツール | 備考 |
|---|---|---|---|---|
| `@shuji-bonji/houki-egov-mcp` | 0.20.0（2026-10-04）。2026-04 以降に 32 回リリース | v2 | 14 ツール: `search_law`、`get_law`（条・項・号）、`get_toc`、`get_law_range`、`get_law_revisions`、`search_fulltext`、`resolve_abbreviation`、`verify_citations`、`get_related_laws`、`get_article_references`、添付ファイル系など | 時点指定、改正履歴、法令番号と e-Gov URL つきの出力、略称辞書（174 件）、日本語の説明、CI あり。全文検索だけはローカルの SQLite（約 290MB の一括 zip から構築）が必要 |
| `japan-law-mcp`（COREkin） | 1.0.2（2026-05-12） | v2 | `search_laws`、`search_by_keyword`、`find_article`（条・項・号）、`get_law_content`、`batch_find_articles`、`verify_citations`、`action_plan` など 10 ツール | e-Gov へのリンクつき。説明文に「time travel diff」とある |
| `@innovation-samurai/hourei-mcp` | 1.0.0（2026-04-06）。リポジトリなし | v2 | `search_law`、`keyword_search`、`get_law_fulltext`、`get_law_revision`、`get_law_article`（時点指定） | リリースは 1 回のみ |
| `@codeagentjp/egov-law-mcp` | 0.1.1（2026-09-24） | laws.e-gov.go.jp | `search_laws`、`get_article`、`get_law`、`find_related_laws` | すべての応答に e-Gov URL |
| `@pipeworx/mcp-japan-law` | 0.1.2（2026-09-26） | e-Gov | 未確認 | 同じ作者が国・分野ごとに大量生成しているシリーズの一つ |
| `hourei-mcp-server`（groundcobra009）とフォーク（`@fastmcp-me/…`、`@iflow-mcp/…`） | 1.0.6（2025-10-28） | v2（README の記載） | 検索・本文・改正履歴 | |
| `@gonuts555/e-gov-mcp` | 1.2.1（2025-11-02） | e-Gov | 未確認 | |
| `egov-law-mcp` | 0.1.0（2026-02-05） | e-Gov | 未確認 | 提案されていたパッケージ名はすでに使われている |
| `law-mcp-server` | 0.3.1（2026-02-14） | e-Gov | 整合性チェック | |
| 分野別: `tax-law-mcp`、`labor-law-mcp`、`kaigo-law-mcp`、`disability-law-mcp`、`social-welfare-mcp`、`building-standards-act-mcp`（1.7.0）、`real-estate-brokerage-act-mcp` | 2026-03〜04 | e-Gov v2 | 分野の条文 + 通達など | |
| Python（GitHub / Glama）: `ryoooo/e-gov-law-mcp`（FastMCP、v2）、`kannkyo/e-gov-law-mcp`（v2 ラッパー） | | v2 | | |

### 判断

「明確に良いものを作る」ための候補だった差別化点（v2 対応、条・項・号の指定、時点指定・改正履歴、e-Gov URL つきの引用、日本語の説明）は、`@shuji-bonji/houki-egov-mcp` がすべて満たしており、更新も活発です。キーワード検索（スニペットつき）も `japan-law-mcp` と `@innovation-samurai/hourei-mcp` が API を直接呼んで提供しています。15 番目の e-Gov MCP を作っても明確な差は出せないため、指示どおり、まだ良い MCP サーバーがない題材に切り替えました。

---

## 2. ほかの候補（国・公共の API）

| 題材 | 見つかった既存 MCP | 判定 |
|---|---|---|
| 国会会議録検索API | `kokkai-meeting-mcp-server`、`kokkai-lib-mcp-server`、`@pipeworx/mcp-kokkai-diet`、`@codeagentjp/houan-mcp` | 既存あり |
| 官公需情報ポータル（入札） | `jp-bids-mcp` 0.9.0、`@pipeworx/mcp-japan-procurement` | 既存あり |
| jGrants（補助金） | `jgrants-mcp`、`@ishidad2/jgrants-mcp-server`、`@akiojin/jgrants-mcp-server`、`hojometo-mcp`、`hojokin-navi-mcp` ほか | 既存あり |
| e-Stat | `@nyuta/estat-mcp`、`@pipeworx/mcp-estat-japan` | 既存あり（appId が必要） |
| gBizINFO | `gbizinfo-mcp`、`mcp-gbiz-info`、`@pipeworx/mcp-gbizinfo` ほか | 既存あり（トークンが必要） |
| 法人番号 | `@sugukuru/mcp-houjin-bangou`、`mcp-jp-corporate-id` | 既存あり（appId が必要） |
| 日本銀行 時系列統計 | `boj-jstat-mcp`、`@explorrrr/boj-mcp-server`、`@pipeworx/mcp-boj` | 既存あり |
| 気象庁 | `@pipeworx/mcp-jma`、`japan-seasons-mcp` | 既存あり |
| J-STAGE | `jstage-mcp`（Python、Glama に掲載） | 既存あり |
| e-Gov パブリックコメント | 見つからず | **不採用**。機械向けに提供されているのは RSS（意見募集中・結果公示とも最新 8 件ほど）だけで、一覧・詳細の HTML は通常のクライアントからは 403「アクセスがブロックされています」になる。ブラウザを装って取得するのは不適切と判断 |
| 国土地理院 逆ジオコーダ（`mreversegeo.gsi.go.jp`） | — | 2026-10-06 時点で DNS 応答が NXDOMAIN（dns.google の Status 3）。提供が終了したとみられる |
| **国土地理院の住所検索・標高API・測量計算サイト + ハザードマップポータルのオープンデータ** | 下記のとおり、同等のものなし | **採用** |

### 採用した題材の既存実装

| 実装 | 内容 | 本プロジェクトとの違い |
|---|---|---|
| `toshihikoyanase/geo-mcp-server`（GitHub のみ） | 国土地理院の標高APIを呼ぶ `getElevation` 1 ツール | 標高のみ |
| `geojp-mcp` 0.1.0（2026-08） | 民間の有料API（ChibanJP / ReverseGeoJP）で地番と逆ジオコーディング。APIキーが必要 | 国のデータではない。キーが必要 |
| `com.mamoie/hazard`（Glama のホスト型コネクタ） | `check_home_disaster_risk` 1 ツール（重ねるハザードマップ + J-SHIS） | ソース非公開のホスト型。地点・レイヤーごとの判定根拠（色・凡例・タイル）は不明 |
| `gachi-data`（eng213035） | 駅単位のハザード区分（不動産情報ライブラリ経由）ほか | 地点の判定ではない。Glama 上で「Unresponsive」 |
| MLIT DPF MCP（国土交通省） | 国交省データプラットフォームのデータセット検索・ダウンロード | APIキーが必要。地点の浸水深の判定はしない |

国土地理院の測量計算サイトAPI（平面直角座標・距離と方位角・ジオイド高）の MCP サーバーは見つかりませんでした。

---

## 3. 採用した題材: `chiriin-mcp`

**ねらい**: 不動産・建設・物流・防災の実務で、「この住所の浸水深は？」「標高は？」「この座標を平面直角座標で」といった問いに、国の一次データから出典つきで答える。APIキーは不要です。

**既存実装との違い**
- 重ねるハザードマップの **11 レイヤー**を地点ごとに判定します。洪水（想定最大規模・計画規模・浸水継続時間・家屋倒壊等氾濫想定区域 2 種）、内水、高潮、津波、土砂災害警戒区域 3 種で、浸水深・継続時間・特別警戒区域／警戒区域、指定済／指定予定まで区別します。凡例の色は公式の凡例画像から 1 ピクセル単位で読み取り、実際のタイルと照合しました。
- 依存ライブラリなしの PNG デコーダーで判定します。Pillow と全ピクセルが一致することをテストで確認しています（RGBA・パレット形式の両方）。
- 測量計算サイトの換算に対応します（平面直角座標の往復換算と系番号の自動選択、測地線距離と方位角、ジオイド2024 と基準面補正量）。
- 出典・利用条件・注意事項（**宅建業の重要事項説明には使えない**こと、「該当なし」には未公開地域も含まれること）を毎回の応答に含めます。
- 公式の利用制限を守ります（測量計算は 10 秒に 10 回まで）。タイムアウト・再試行・応答サイズの上限・キャッシュを備え、エラーは日本語と英語の両方で返します。
- stdio と Streamable HTTP の両方に対応しています。

### 使用するエンドポイント（2026-10-06 にこの環境から動作を確認）

| 用途 | URL | 公開状況と利用条件 |
|---|---|---|
| 住所検索 | `https://msearch.gsi.go.jp/address-search/AddressSearch?q=` | 地理院地図の検索機能が使っているエンドポイント。第三者向けの仕様書や SLA はない。ハザードマップポータルの規約でも、住所検索結果は外部 API 連携（地理院地図、協力: 東大CSIS）として扱われている |
| 標高 | `https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php` | 公開ページ: https://maps.gsi.go.jp/development/elevation_s.html 。「サーバに過度の負担を与えないでください」「予告なく遮断・変更・停止する場合があります」 |
| 測量計算 | `https://vldb.gsi.go.jp/sokuchi/surveycalc/...`（`bl2st_calc.pl`、`bl2xy.pl`、`xy2bl.pl`、`geoid/calcgh/cgi/geoidcalc.pl`） | 公開ページ: https://vldb.gsi.go.jp/sokuchi/surveycalc/api_help.html 。**同一 IP から 10 秒間に 10 回まで**（TKY2JGD・PatchJGD は 3 回） |
| ハザードタイル | `https://disaportaldata.gsi.go.jp/raster/{layer}/{z}/{x}/{y}.png`（z ≤ 17） | オープンデータ: https://disaportal.gsi.go.jp/hazardmapportal/hazardmap/copyright/opendata.html 。商用・非商用を問わず利用可。公共データ利用規約（PDL1.0）。加工した場合はその旨を書いて出典を明記する。重要事項説明には使えない |

### 実データで確かめたこと
- タイルは RGBA とパレット形式の両方が配信されています。`application/octet-stream` で返るものもあるため、Content-Type ではなく先頭のバイト列で PNG かどうかを判定しています。データのないタイルは 404（JSON 本文）です。
- 浸水深の凡例は、細分された色（0.3m 未満、0.5〜1m）を含めて 8 色あります。隣り合う色の差は RGB の距離で 16 以上あるため、許容差 7 で一意に判定できます。
- 家屋倒壊等氾濫想定区域（氾濫流）は直径約 16px の円模様で描かれており、円の中心は線から約 8px 離れています。そのため周囲 9px（z17 で約 9m）まで見て判定します。
- 測量計算サイトはエラー時に `{"ExportData":{"ErrMsg":"100:..."}}` を返します。
- 八丈島（33.1, 139.79）では基準面補正量が 0.387m になります（2025 年 4 月の標高体系改定による）。

### 既知の制約
- 住所検索の精度は町丁目・街区程度です。施設名の検索は弱く、たとえば「東京駅」では「○○市東」のような候補が先に返ります。このため、名称が一致する・含む候補を先頭に並べ替えています。
- 逆ジオコーディング（座標 → 住所）は、国土地理院のエンドポイントが使えなくなっているため対応していません。
- 平面直角座標の系番号は、北海道では市町村によって異なるため自動選択しません。
