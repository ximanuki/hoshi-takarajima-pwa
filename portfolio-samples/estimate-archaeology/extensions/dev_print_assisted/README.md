# 拡張の例: dev_print_assisted

`ea fit --extensions extensions/dev_print_assisted` で読み込む拡張の例です（開発用データ `devdata/print` 向け）。

- `10_calendar.py`: 式に `day_of_month(日付)` を追加（Python の拡張モジュール）
- `20_candidates.json`: 候補の追加（派生列・しきい値・特徴量）。設定ファイルに足し込まれます

コア（`src/estimate_archaeology/`）は変更しません。`ea hash-core` の値は拡張の有無で変わらず、
`rules.json` の `meta.core_sha256` と `meta.extensions`（ファイル名と SHA-256）に記録されます。

候補を足しても、採用されるかどうかは決定的な評価（過去の見積を1円単位で再現できる件数が増えるか）で決まります。

開発用データ（`devdata/print`）では、この拡張で足した「見積日の日」の候補から、エンジンが
「チラシで見積日が28日以降なら ×0.97」という掛率を見つけます（区分 × 条件の掛率。再現件数が増えたので採用）。
数字は `reports/dev_results.md` の `print_assisted` を見てください。
