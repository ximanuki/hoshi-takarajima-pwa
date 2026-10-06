# Changelog

この形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に従い、バージョンは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

## [Unreleased]

## [0.1.0] - 2026-10-06

### Added
- 最初のリリース。国土地理院の公開API・オープンデータを使う 7 つのツール:
  - `get_hazard_info`: 重ねるハザードマップの 11 レイヤー（洪水・浸水継続時間・家屋倒壊等氾濫想定区域・内水・高潮・津波・土砂災害警戒区域）を地点ごとに判定し、標高も返す
  - `geocode_address`: 住所・地名から緯度経度の候補を返す（名称が一致する候補を先頭に並べ替え）
  - `get_elevation`: 標高とデータソース（1m / 5m / 10m メッシュ）
  - `calc_distance`: 測地線距離と方位角（GRS80）
  - `latlon_to_plane` / `plane_to_latlon`: 平面直角座標との相互換算（都道府県から系番号を自動選択）
  - `get_geoid_height`: ジオイド高（ジオイド2024）と基準面補正量、楕円体高から標高への換算
- リソース `chiriin://hazard-layers`、`chiriin://plane-rectangular-zones`
- stdio と Streamable HTTP（ステートレス、`/healthz`、DNS リバインディング対策）
- 依存ライブラリなしの PNG デコーダー（RGBA・パレット・グレースケール、1〜16 bit）
- タイムアウト・再試行（指数バックオフ、`Retry-After` 対応）、ホストごとのレート制限、応答サイズの上限、TTL つき LRU キャッシュ
- 日本語と英語のエラーメッセージ、すべての応答に出典と注意事項
- 記録済みの応答を使う Vitest テスト（ネットワーク接続なし）、実 API で確認する smoke スクリプト、記録を取り直すスクリプト
