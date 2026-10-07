# データの出典と利用条件 / Sources and licences

## 1. モデル就業規則（令和7年12月版）— 厚生労働省

| 項目 | 内容 |
|---|---|
| ファイル | `data/raw/mhlw_model_shugyo_kisoku_r0712.pdf`（94ページ、1,043,604 bytes） |
| SHA-256 | `794710c53cfd25be7127c065725252683a4d00357f93acf3579fa7cdfcca632a` |
| 取得元 URL | https://www.mhlw.go.jp/content/001620507.pdf |
| 掲載ページ | https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/zigyonushi/model/index.html（「モデル就業規則（令和７年12月）全体版［PDF形式］」） |
| 取得日 | 2026-10-06（サーバーの Last-Modified: 2025-12-24） |
| 利用条件 | 厚生労働省ホームページの利用規約により、権利表記のないコンテンツは「公共データ利用規約（第1.0版）」（PDL1.0）に準拠して利用可能。PDL1.0 は CC BY 4.0 と互換で、商用利用・翻案（加工）も可。 |
| 確認した規約 | 厚生労働省「利用規約・リンク・著作権等」 https://www.mhlw.go.jp/chosakuken/index.html ／ PDL1.0 本文 https://www.digital.go.jp/resources/open_data/public_data_license_v1.0 ／ 別の利用ルールが適用されるコンテンツの一覧（別紙） https://www.mhlw.go.jp/chosakuken/exhibit.html — 2026-10-06 時点で、別紙に挙がっているのはシンボルマーク類と労働委員会関係のデータベース等のみで、モデル就業規則は含まれていない。 |
| 条件として守ること | (1) 出典の記載、(2) 編集・加工した場合はその旨の記載、(3) 加工したものを国が作成したかのように見せないこと、(4) 第三者の権利がある部分に注意（本資料中で第三者の著作物と明示された部分は確認できなかった） |

**表示する出典（アプリの画面フッターと `/documents` API にも表示）:**

> 出典：厚生労働省「モデル就業規則」（令和7年12月版）（https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/zigyonushi/model/index.html）、PDL1.0（https://www.digital.go.jp/resources/open_data/public_data_license_v1.0）。本アプリはこれを加工（テキスト抽出・分割）して利用しています。

**加工の内容:** pypdf によるテキスト抽出、ページ番号行の除去、条文・解説単位への分割、検索用の索引化。回答画面で示す引用は抽出テキストからの引用であり、表の体裁など原本と異なる場合がある（原本 PDF へのリンクを併記）。本アプリの回答は厚生労働省の見解ではない。

> 注: PDF 内の目次（p.6–9）は本文と一部食い違う（例: 目次の第51条［例１］は「定年を満６５歳とする例」、本文は「満７０歳」）。目次は索引対象から除外している。

## 2. 経費精算・出張旅費規程（架空のサンプル）

| 項目 | 内容 |
|---|---|
| ファイル | `data/raw/sample_keihi_kitei.md` |
| 由来 | 本リポジトリのために新規に作成した**架空の**社内規程（実在の会社・制度とは無関係）。Markdown 取り込みと、具体的な金額・期限を含む社内文書のデモ用。 |
| ライセンス | 本リポジトリのコードと同じ条件（作者が作成した文書。公開時に LICENSE を決めること） |

## 3. 評価データ `data/eval/qa.jsonl`

本リポジトリの作者が上記 2 文書を読んで作成した質問・正解・根拠引用（97問）。根拠引用（`evidence`）は資料本文からの逐語引用で、評価スクリプトが毎回、本文中に実在することを検証する。ライセンスは本リポジトリと同じ条件。引用部分の出典は上記 1・2 のとおり。

## 4. 埋め込みモデル（リポジトリには含めない）

`intfloat/multilingual-e5-small`（MIT License）, commit `614241f622f53c4eeff9890bdc4f31cfecc418b3` の `onnx/model.onnx`。`make setup` / Docker ビルド時に Hugging Face から取得する（約 470 MB）。
