# 開発用データでの結果（dev numbers）

**注意: これは開発用の数字です。** 生成器（`devdata/gen_*.py`）とソルバーは同じ側が書いたもので、ルールの形を作者が知っているデータでの動作確認です。未知のデータでの精度を示すものではありません。目隠し試験（`BLIND_PROTOCOL.md`）の数字は封印を開けた後に別途記録します。

コア（`src/estimate_archaeology/`）の SHA-256: `c4cff0df0b072a20d7221267921da3f906b71933662dbd5b3089d36322337906`

## 再現率

| データ | 件数 | 円単位で再現 | ±100円 | ±1% | 正常見積（文法内）の再現 | 正常見積（文法外）の再現 | 判定停止 | 秒 |
|---|---|---|---|---|---|---|---|---|
| print | 2,434 | 2,434件中2,180件（89.6%） | 89.9% | 90.1% | 100.0% | 42.0% | なし | 628 |
| sign | 2,410 | 2,410件中1,839件（76.3%） | 80.4% | 84.5% | 82.0% | 75.7% | 全体停止 | 770 |
| print_heavy | 2,438 | 2,438件中1,693件（69.4%） | 72.1% | 75.1% | 75.7% | 71.5% | 全体停止 | 487 |
| print_assisted | 2,434 | 2,434件中2,278件（93.6%） | 93.9% | 94.0% | 100.0% | 100.0% | なし | 559 |
| print_schema_cfg | 2,434 | 2,434件中2,162件（88.8%） | 89.9% | 89.9% | 98.9% | 45.0% | なし | 621 |
| sign_schema_cfg | 2,410 | 2,410件中1,372件（56.9%） | 58.8% | 64.7% | 57.0% | 77.9% | 全体停止 | 888 |

## ルール逸脱の検出と分類

「出力」は実際の出力（判定停止が働いたデータでは分類を出していません）。「停止なし（参考）」は、同じルールでしきい値を 0 にして判定し直したもので、判定停止がなぜ必要かを示します。

| データ | 出力: 検出数 | 適合率 | 再現率 | 分類の正解率 | 正常を癖と誤判定 | 判定保留 | 停止なし: 検出数 | 適合率 | 再現率 | 分類の正解率 | 正常を癖と誤判定 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| print | 160 | 90.6% | 92.4% | 83.4% | 12 | 94 | 160 | 90.6% | 92.4% | 83.4% | 12 |
| sign | 0 | — | 0.0% | — | 0 | 571 | 462 | 26.8% | 81.6% | 71.0% | 226 |
| print_heavy | 0 | — | 0.0% | — | 0 | 745 | 462 | 32.9% | 92.7% | 73.0% | 182 |
| print_assisted | 156 | 99.4% | 98.7% | 87.1% | 1 | 0 | 156 | 99.4% | 98.7% | 87.1% | 1 |
| print_schema_cfg | 179 | 84.4% | 96.2% | 83.4% | 27 | 93 | 179 | 84.4% | 96.2% | 83.4% | 27 |
| sign_schema_cfg | 0 | — | 0.0% | — | 0 | 1038 | 871 | 14.9% | 85.5% | 66.2% | 528 |

- 検出: 「deviation / unexplained」と出した見積を陽性、生成器で癖を入れた見積を正解として数えています。
- 正常を癖と誤判定: 生成器では規則どおり（文法外の規則を含む）なのに、逸脱の分類（deviation）を付けた件数。
- 文法外: 生成器で「部品の外」のつもりで入れた規則が効く見積（`devdata/README.md`）。実際に部品で表せないのはチラシの月末3%引きだけで、残りは表引き・しきい値で表せるため再現されることがあります。

## print

- print-like shop; 7% of clean quotes carry a rule meant to be outside the grammar (only the month-end flyer discount really is)
- 設定: `configs/dev_print.json` / データ: `devdata/print/quotes.csv`
- 出力: [`reports/dev/print/`](dev/print/)（rules_ja.md, coverage.md, rules.json）
- 正常見積の再現: 全体 95.7%、文法内 100.0%（2,108件）、文法外 42.0%（169件）
- 見つかった改定日: チラシ 2024-04-01、チラシ 2025-01-01、リーフレット 2024-04-01、リーフレット 2025-01-01、冊子 2024-04-01、冊子 2025-01-01、名刺 2024-04-01、名刺 2025-01-01、封筒 2024-04-04、封筒 2024-11-01

| 正解ラベル | 件数 | 検出 | 分類一致 | 再現扱い | 保留 |
|---|---|---|---|---|---|
| clean | 2277 | 15 | 0 | 2178 | 84 |
| copied_rate | 11 | 11 | 11 | 0 | 0 |
| revision_or_duplicate | 18 | 9 | 9 | 0 | 9 |
| rounding_inconsistency | 7 | 6 | 6 | 0 | 1 |
| stale_table | 65 | 64 | 57 | 1 | 0 |
| typo | 8 | 8 | 8 | 0 | 0 |
| undocumented_discount | 28 | 27 | 11 | 1 | 0 |
| unexplained | 6 | 6 | 6 | 0 | 0 |
| unrecorded_surcharge | 14 | 14 | 13 | 0 | 0 |

## sign

- sign-like shop; 16% of clean quotes carry a rule meant to be outside the grammar (both turn out expressible)
- 設定: `configs/dev_sign.json` / データ: `devdata/sign/quotes.csv`
- 出力: [`reports/dev/sign/`](dev/sign/)（rules_ja.md, coverage.md, rules.json）
- 正常見積の再現: 全体 81.0%、文法内 82.0%（1,891件）、文法外 75.7%（367件）
- 見つかった改定日: アルミ複合板看板 2024-10-01、インクジェット出力 2024-10-01、カルプ文字 2024-10-01

| 正解ラベル | 件数 | 検出 | 分類一致 | 再現扱い | 保留 |
|---|---|---|---|---|---|
| clean | 2258 | 0 | 0 | 1828 | 430 |
| copied_rate | 19 | 0 | 0 | 1 | 18 |
| revision_or_duplicate | 20 | 0 | 0 | 0 | 20 |
| rounding_inconsistency | 8 | 0 | 0 | 1 | 7 |
| stale_table | 35 | 0 | 0 | 8 | 27 |
| typo | 9 | 0 | 0 | 0 | 9 |
| undocumented_discount | 35 | 0 | 0 | 1 | 34 |
| unexplained | 12 | 0 | 0 | 0 | 12 |
| unrecorded_surcharge | 14 | 0 | 0 | 0 | 14 |

## print_heavy

- same shop, 33% of clean quotes carry such rules (month-end discount from day 15): the stop rule should fire
- 設定: `configs/dev_print.json` / データ: `devdata/print_heavy/quotes.csv`
- 出力: [`reports/dev/print_heavy/`](dev/print_heavy/)（rules_ja.md, coverage.md, rules.json）
- 正常見積の再現: 全体 74.3%、文法内 75.7%（1,517件）、文法外 71.5%（757件）
- 見つかった改定日: チラシ 2024-04-01、リーフレット 2024-04-01、リーフレット 2025-01-01、冊子 2024-04-01、名刺 2024-04-01、名刺 2025-01-01、封筒 2024-04-04、封筒 2024-11-01

| 正解ラベル | 件数 | 検出 | 分類一致 | 再現扱い | 保留 |
|---|---|---|---|---|---|
| clean | 2274 | 0 | 0 | 1690 | 584 |
| copied_rate | 13 | 0 | 0 | 0 | 13 |
| revision_or_duplicate | 22 | 0 | 0 | 0 | 22 |
| rounding_inconsistency | 13 | 0 | 0 | 1 | 12 |
| stale_table | 64 | 0 | 0 | 1 | 63 |
| typo | 8 | 0 | 0 | 0 | 8 |
| undocumented_discount | 26 | 0 | 0 | 1 | 25 |
| unexplained | 5 | 0 | 0 | 0 | 5 |
| unrecorded_surcharge | 13 | 0 | 0 | 0 | 13 |

## print_assisted

- same as print + extensions/dev_print_assisted (day of month, signatures; added without touching the core)
- 設定: `configs/dev_print.json` / データ: `devdata/print/quotes.csv` / 拡張: `extensions/dev_print_assisted`
- 出力: [`reports/dev/print_assisted/`](dev/print_assisted/)（rules_ja.md, coverage.md, rules.json）
- 正常見積の再現: 全体 100.0%、文法内 100.0%（2,108件）、文法外 100.0%（169件）
- 見つかった改定日: チラシ 2024-04-01、チラシ 2025-01-01、リーフレット 2024-04-01、リーフレット 2025-01-01、冊子 2024-04-01、冊子 2025-01-01、名刺 2024-04-01、名刺 2025-01-01、封筒 2024-04-04、封筒 2024-11-01

| 正解ラベル | 件数 | 検出 | 分類一致 | 再現扱い | 保留 |
|---|---|---|---|---|---|
| clean | 2277 | 1 | 0 | 2276 | 0 |
| copied_rate | 11 | 11 | 11 | 0 | 0 |
| revision_or_duplicate | 18 | 18 | 18 | 0 | 0 |
| rounding_inconsistency | 7 | 7 | 7 | 0 | 0 |
| stale_table | 65 | 64 | 60 | 1 | 0 |
| typo | 8 | 8 | 8 | 0 | 0 |
| undocumented_discount | 28 | 27 | 11 | 1 | 0 |
| unexplained | 6 | 6 | 6 | 0 | 0 |
| unrecorded_surcharge | 14 | 14 | 14 | 0 | 0 |

## print_schema_cfg

- dev print data with the schema-only blind config (checks that config runs; no blind data)
- 設定: `configs/blind_print.json` / データ: `devdata/print/quotes.csv`
- 出力: [`reports/dev/print_schema_cfg/`](dev/print_schema_cfg/)（rules_ja.md, coverage.md, rules.json）
- 正常見積の再現: 全体 94.9%、文法内 98.9%（2,108件）、文法外 45.0%（169件）
- 見つかった改定日: チラシ 2024-04-01、チラシ 2025-01-01、リーフレット 2024-04-01、リーフレット 2025-01-01、冊子 2024-04-01、冊子 2025-01-01、名刺 2024-04-01、名刺 2025-01-01、封筒 2024-04-04、封筒 2024-11-01

| 正解ラベル | 件数 | 検出 | 分類一致 | 再現扱い | 保留 |
|---|---|---|---|---|---|
| clean | 2277 | 28 | 0 | 2160 | 89 |
| copied_rate | 11 | 10 | 10 | 0 | 1 |
| revision_or_duplicate | 18 | 18 | 18 | 0 | 0 |
| rounding_inconsistency | 7 | 6 | 6 | 0 | 1 |
| stale_table | 65 | 62 | 54 | 1 | 2 |
| typo | 8 | 8 | 8 | 0 | 0 |
| undocumented_discount | 28 | 27 | 11 | 1 | 0 |
| unexplained | 6 | 6 | 6 | 0 | 0 |
| unrecorded_surcharge | 14 | 14 | 13 | 0 | 0 |

## sign_schema_cfg

- dev sign data with the schema-only blind config (checks that config runs; no blind data)
- 設定: `configs/blind_sign.json` / データ: `devdata/sign/quotes.csv`
- 出力: [`reports/dev/sign_schema_cfg/`](dev/sign_schema_cfg/)（rules_ja.md, coverage.md, rules.json）
- 正常見積の再現: 全体 60.4%、文法内 57.0%（1,891件）、文法外 77.9%（367件）
- 見つかった改定日: アルミ複合板看板 2024-10-01、インクジェット出力 2024-10-01、カルプ文字 2024-10-08、袖看板 2024-11-01

| 正解ラベル | 件数 | 検出 | 分類一致 | 再現扱い | 保留 |
|---|---|---|---|---|---|
| clean | 2258 | 0 | 0 | 1364 | 894 |
| copied_rate | 19 | 0 | 0 | 1 | 18 |
| revision_or_duplicate | 20 | 0 | 0 | 1 | 19 |
| rounding_inconsistency | 8 | 0 | 0 | 0 | 8 |
| stale_table | 35 | 0 | 0 | 6 | 29 |
| typo | 9 | 0 | 0 | 0 | 9 |
| undocumented_discount | 35 | 0 | 0 | 0 | 35 |
| unexplained | 12 | 0 | 0 | 0 | 12 |
| unrecorded_surcharge | 14 | 0 | 0 | 0 | 14 |

