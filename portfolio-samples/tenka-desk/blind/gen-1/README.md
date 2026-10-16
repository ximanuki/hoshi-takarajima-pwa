# 独立ブラインド検証データ gen-1（架空）

転嫁デスクの漏れ検出を、エンジンとサンプル生成器のコードを見ずに作ったデータで確かめるための生成器です。作るときに読んだのは `README.md`・`README.en.md`・`data-gen/README.md` と、`public/sample/`・`public/sample/next/` の各ファイルの先頭3行（見出し）だけです。

> **すべて架空のデータです。** 会社名（架空みなと食品株式会社）・得意先名・仕入先名・商品・価格・取引は作り物で、実在の企業・団体・人物・取引とは関係ありません。

## 作るもの

- 食品・飲料の卸という想定。得意先80社・商品400点（9カテゴリ）・仕入先12社。
- 売上明細は販売管理B形式だけで、2025年1月〜2026年6月の18か月・22,200行（`sales_B_202501-202606.csv`、Shift_JIS・CRLF）。
- ほかに `customers.csv`・`products.csv`・`list_price_history.csv`・`cost_history.csv`・`rate_tiers.csv`・`categories.csv`・`suppliers.csv`・`supplier_notices.csv`・`special_prices_B.csv`・`revision_2025-10_agreements.csv`・`company.json`・`demo_settings.json`。列は文書の形式どおりです。
- `demo_settings.json` と `company.json` は先頭3行しか見ていないので、キー名の一部は推測です。

## 動かし方

```bash
node portfolio-samples/tenka-desk/blind/gen-1/generate.mjs --data <入力ファイルの出力先> --sealed <正解の出力先>
```

- Node.js 22 以上。依存パッケージはありません。固定シードで、時計・`Math.random` を使わないので、何度作っても同じバイト列になります。
- `--sealed` には**リポジトリの外**を指定してください。`<正解の出力先>/truth/`（`lines.csv`・`summary.json`）と `<正解の出力先>/notes.md` ができます。
- `--utf8` を付けると売上明細を UTF-8・LF で書きます（中身は同じ。`summary.json` の文字コードの記載だけ変わります）。
- 生成の最後に、書いた売上明細を読み直して、文書の正規化（NFKC・品番のハイフン除去・得意先コードの6桁化・日付）で元の値に戻ることを確かめています。

## 封印

`SEALED.sha256` は、既定の設定（`--utf8` なし）で作った正解ファイルの SHA-256 です。正解を開ける前に、作り直したものと同じかを確かめられます。

```bash
cd <正解の出力先> && sha256sum -c <このフォルダ>/SEALED.sha256
```

`generate.mjs` には正解の判定そのものが入っています。評価が終わるまで、エンジンを直す側には見せないでください。
