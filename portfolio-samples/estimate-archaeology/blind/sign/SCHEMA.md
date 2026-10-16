# quotes.csv — 列定義 / Column definitions

看板製作会社の見積台帳から書き出した見積データです。1行が1枚の見積書に対応します。
Quotes exported from a signage shop's quote ledger. One row corresponds to one issued quote sheet.

- 文字コード / encoding: UTF-8 (no BOM), comma-separated, one header row
- 並び順 / order: issue_date, then quote number as issued
- 行数 / rows: 2378 (excluding header)
- 空欄 / blank: the field was not written on the quote or does not apply to the item

| column | 項目名 | 内容 | Description |
|---|---|---|---|
| quote_no | 見積番号 | 見積書に記載の番号 | Quote number as written (`YYMM-NNN`; some numbers carry an extra suffix such as `-2`) |
| issue_date | 見積日 | 見積書の発行日 (YYYY-MM-DD) | Issue date of the quote |
| customer_code | 得意先コード | 得意先コード。`9999` は諸口 | Customer account code. `9999` is the shared code for one-off customers (諸口) |
| rep | 担当者 | 営業担当者（姓） | Sales rep who wrote the quote (surname) |
| item | 品目 | アルミ複合板看板 / カルプ文字 / インクジェット出力 / 袖看板 | Product category |
| width_mm | 幅 (mm) | 製作物の幅 | Width of the piece, mm (blank for カルプ文字) |
| height_mm | 高さ (mm) | 製作物の高さ。カルプ文字は文字高 | Height of the piece, mm; for カルプ文字 it is the character height |
| qty | 数量 | 数量 | Quantity |
| unit | 単位 | 枚 / 文字 / 台 | Unit of the quantity (sheets / characters / units) |
| thickness_mm | 厚み (mm) | 板厚または文字の厚み | Board thickness (アルミ複合板) or letter thickness (カルプ文字), mm |
| sides | 面 | 片面 / 両面 | Single-sided / double-sided |
| media | メディア | 出力メディア（インクジェット出力のみ） | Print media (インクジェット出力 only) |
| laminate | ラミネート | グロス / マット / なし | Laminate finish |
| finish | 仕上げ | シート貼り / 塗装（カルプ文字のみ） | Face finish (カルプ文字 only) |
| lighting | 照明 | LED内照 / なし（袖看板のみ） | Illumination (袖看板 only) |
| design | デザイン | 支給 / 修正 / 新規 | Artwork: customer-supplied / adjustment of supplied artwork / new design |
| install | 施工 | 有 / 無 | Whether on-site installation is part of the quote |
| install_height_m | 取付高さ (m) | 取付位置の高さ | Mounting height in metres (blank when not installed) |
| site | 施工場所 | 現場の所在地（記載どおり） | Site location as written on the quote |
| remarks | 備考 | 備考欄の記載（原文のまま） | Free-text remarks, verbatim |
| amount | 金額 (円) | 見積書に記載の金額 | Quoted amount in JPY, exactly as written on the quote |
| tax_label | 税表示 | 金額欄の税表示（記載どおり） | Tax wording printed next to the amount (税別 / 税抜 / 税込 / blank), as written |

## messy/

同じ見積の一部を、社内で別途作成されていた台帳・控え・一覧の元の形式のまま収録しています。
Three workbooks kept in their original in-house layouts. Each holds an alternative record of a subset of
the quotes above; a quote may appear in none, one or several of them.

| file | 内容 | Contents |
|---|---|---|
| messy/見積台帳_R5年度.xlsx | 月別見積台帳（令和5年度） | Monthly quote ledger, fiscal year R5 (one sheet per month) |
| messy/見積書控_2024下期.xlsx | 発行した見積書の控え | File copies of printed quote sheets |
| messy/得意先別見積一覧.xlsx | 得意先別の見積一覧 | Per-customer quote lists |
