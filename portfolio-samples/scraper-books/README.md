# 書籍一覧スクレイパー（Python → Excel）

Webサイトの商品一覧を自動で集め、Excel にまとめるツールのサンプルです。
対象はスクレイピング練習用に公開されている [Books to Scrape](https://books.toscrape.com/) です。

## できること
- 一覧ページを「次へ」でたどり、タイトル・価格・評価・在庫・URL を収集
- Excel に「一覧」シート（フィルター・見出し固定つき）と「評価別集計」シートを出力
- 1リクエストごとに待ち時間を入れ、通信エラーは2回まで再試行

## 使い方
```bash
pip install -r requirements.txt
python scraper.py --pages 3 --out books.xlsx
```

| オプション | 意味 | 初期値 |
|---|---|---|
| `--pages` | たどる一覧ページ数（最大50） | 3 |
| `--delay` | リクエスト間の待ち秒数 | 1.0 |
| `--out` | 出力ファイル | books.xlsx |

出力例: [`sample-output.xlsx`](sample-output.xlsx)（3ページ・60件）

## テスト
保存済みの HTML を使うので、ネットにつながなくても動きます。
```bash
python -m unittest discover -s tests -v
```

## 実案件への流用
- サイトごとの違いは `parse_list_page()` のセレクタに集めてあります
- 利用規約で自動収集が禁止されているサイト、ログインが必要なページ、個人情報は扱いません
