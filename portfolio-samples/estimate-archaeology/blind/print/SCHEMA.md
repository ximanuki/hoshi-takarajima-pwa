# quotes.csv — 列定義 / Column definitions

見積台帳から書き出した見積の一覧です。1行が1通の見積書に対応します。
One row per quote document as recorded in the shop's quote register.

- 文字コード / Encoding: UTF-8, LF, comma-separated, header row
- 並び順 / Order: `quote_date`, then `quote_id`
- 行数 / Rows: 2400

| column | 日本語 | English |
|---|---|---|
| `quote_id` | 見積番号。再発行した見積は元番号の末尾に `-R2` が付く | Quote number; a re-issued quote keeps the original number with suffix `-R2` |
| `quote_date` | 見積日 (YYYY-MM-DD) | Date the quote was issued |
| `customer_code` | 得意先コード。C=法人、D=広告代理店・制作会社、G=学校・団体、K=個人、`一般`=口座のない都度客 | Customer account code. C = company, D = agency / design studio, G = school / association, K = private individual, `一般` = walk-in without an account |
| `rep` | 担当者 | Sales rep who issued the quote |
| `product` | 品目（チラシ／リーフレット／冊子／名刺／封筒） | Product category (flyer / folded leaflet / saddle-stitched booklet / business card / envelope) |
| `size` | 仕上りサイズ（名刺は 91x55 mm、封筒は封筒規格） | Finished size (cards: 91x55 mm; envelopes: envelope standard) |
| `paper` | 用紙（銘柄と連量／坪量） | Paper stock as written |
| `colors` | 色数 表/裏（例: 4/0 = 表4色・裏なし） | Ink colours front/back (e.g. 4/0 = four colours front, none on back) |
| `pages` | ページ数（冊子のみ。その他は空欄） | Page count (booklets only; blank otherwise) |
| `finishing` | 加工（記載どおり） | Finishing as written |
| `quantity` | 数量。1種類あたり（名刺は1名あたりの枚数、冊子は部数） | Quantity per kind (cards: cards per person; booklets: copies) |
| `kinds` | 種類数（名刺は人数、その他は刷り分けの版数） | Number of kinds (cards: number of people; others: number of versions) |
| `delivery` | 納品方法・地域（引取／市内／市外／県外） | Delivery method / area (customer pick-up, in-city, out-of-city, out-of-prefecture) |
| `due_date` | 希望納期（空欄は未定） | Requested delivery date (blank = not set) |
| `notes` | 備考（自由記述、記載どおり） | Free-text remarks as written |
| `amount` | 見積金額（円、記載どおり） | Quoted amount in JPY, as written |
| `tax_label` | 税表示（記載どおり。空欄は記載なし） | Tax label as written; blank = no label written |
| `tax_amount` | 消費税額（記載がある場合のみ） | Consumption-tax amount, only where written |

## messy/

同じ見積の一部を、社内の別の記録から取り出したものです。書式・表記はそれぞれの記録のままです。
`quotes.csv` との対応表は付属していません。

Alternative records of subsets of the same quotes, kept in their original layouts and notations.
No mapping to `quotes.csv` is provided.

| file | 内容 | Contents |
|---|---|---|
| `messy/見積台帳_R5年度_営業1課.xlsx` | 年度の見積台帳（月別シート） | Fiscal-year quote ledger, one sheet per month |
| `messy/見積書控え_2024下期.xlsx` | 発行した見積書の控え（印刷レイアウト） | File copies of issued quote documents (print layout) |
| `messy/見積メモ_高橋.xlsx` | 担当者個人の見積メモ | One rep's personal quote notes |
