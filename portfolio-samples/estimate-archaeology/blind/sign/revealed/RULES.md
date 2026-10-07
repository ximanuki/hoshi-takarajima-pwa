# SEALED — Sign-shop blind test: hidden pricing rules, human quirks, truth format

Do not copy any part of this file into the repository. The public side (`blind/sign/`) holds
only `quotes.csv`, `SCHEMA.md`, `messy/*.xlsx` and `SEALED.sha256`.

- Fictional business: a small sign shop in Hamamatsu (shop sits in 浜松市中区, renamed 中央区 on 2024-01-01).
- Period: 2022-10-01 .. 2025-09-30. 2,378 rows in `quotes.csv` = 2,358 base quotes + 12 re-issued
  versions (`-2`) + 8 duplicate entries.
- Generator: `generator.py`, `SEED = 521031`, `numpy.random.SeedSequence(SEED).spawn(5)` gives independent
  streams for customers, quotes, quirks, numbering and the messy workbooks. No wall-clock values anywhere;
  xlsx zip entries and docProps timestamps are pinned, so reruns are byte-identical.
- All money is integer yen. "floor" means truncation of a positive value. Areas are handled in integer mm².

---------------------------------------------------------------------------------------------------

## 1. Which price table applies (effective version)

| version | in force from | what changed at that revision |
|---|---|---|
| v0 | 2022-10-01 | initial tables |
| v1 | **2023-05-01** (R1) | aluminium composite (ACM) sheet prices up; 袖看板 (projecting sign) base and LED prices up |
| v2 | **2024-04-01** (R2) | labour/logistics: installation, height surcharge, travel bands, removal, site survey, electrical, product minimum, カルプ文字 per-character prices and set-up, ACM processing |
| v3 | **2025-07-01** (R3) | ink-jet print / laminate / IJ media prices, grommets, design fees |

**Grace period (irregular):** customers in the *grace group* (classes `regular`, `chain`, `contractor`,
see §2) kept the v1 table until **2024-05-31**; R2 prices apply to them from 2024-06-01. R1 and R3 have no
grace period. Version is chosen by the quote's issue date (a re-issued `-2` quote uses its own date).

Each table below lists a value per version; a value stays in force until the next listed version.

## 2. Customers

Customer codes are 4-digit; `9999` = 諸口 (walk-ins / one-off customers). Multipliers are per mille and
apply **only to the product subtotal** (§3/§4), never to design, installation, surcharges or travel.
Product-after-multiplier = floor(product_raw × mult / 1000).

| class | multiplier | codes |
|---|---|---|
| general | 1000 | 1002 1004 1006 1008 1009 1011 1013 1014 1015 1021 1024 1025 1026 1029 1032 1033 1035 1037 1038 1039 1040 1044 1045 1046 1048 1049 1050 1054 1055 1056 1057 1059 1064 1066 1067 1068 1069 1072 1074 1075 1078 1082 1083 1085 1088 1090 1091 1094 1095 |
| regular (常連) | 950 | 1001 1007 1010 1020 1022 1027 1031 1042 1051 1053 1060 1065 1073 1077 1079 1080 1081 1086 1089 1092 1096 |
| trade (同業・代理店) | 800 | 1005 1012 1019 1030 1036 1047 1058 1063 1071 1084 |
| chain (1023, chain-store contract) | **880 until 2024-09-30, 850 from 2024-10-01** (contract renewal) | 1023 |
| contractor (1041, 工務店) | 900 | 1041 |
| walkin (諸口) | 1000 | 9999 |

Per-customer exceptions:
- **1077** (regular): travel fee always waived (partner contractor). Installation, height etc. still charged.
- **1088** (general, 個人事業主): every quote is tax-inclusive (written 税込).
- **9999**: each quote is either an individual (tax-inclusive, ~60%) or a one-off business (tax-exclusive).
- Grace group for R2 = regular + 1023 + 1041 (not trade, not general, not 9999).
- 1044 exists in the customer master but never quotes in the period.

## 3. Product pricing (per item)

### 3.1 アルミ複合板看板 (ACM, item code ACM)
Fields used: width_mm W, height_mm H, qty n, sides, laminate, remarks.

**Material — whole sheets with nesting (pack rounding):**
- Pieces per sheet = max(⌊SW/W⌋·⌊SH/H⌋, ⌊SW/H⌋·⌊SH/W⌋) (best of the two orientations, no kerf).
- If at least one piece fits a 3×6 sheet (910×1820): sheets = ⌈n / per_sheet⌉ × 3×6 price.
- else if it fits a 4×8 sheet (1220×2440): sheets = ⌈n / per_sheet⌉ × 4×8 price.
- else (oversize, joined panel): tiles = min(⌈W/1220⌉·⌈H/2440⌉, ⌈H/1220⌉·⌈W/2440⌉);
  material = n × tiles × 4×8 price, plus **joint processing ¥6,000 × n × (tiles−1)**.

| sheet price | v0 | v1+ |
|---|---|---|
| 3×6 (910×1820) | 5,200 | 6,400 |
| 4×8 (1220×2440) | 9,800 | 12,000 |

**Output (ink-jet print + laminate) per face:**
- Billed area per piece = max(0.3 m², area rounded **up** to 0.1 m²) → in 0.1 m² units: max(3, ⌈W·H/100,000⌉).
- Faces: 片面 ×1, 両面 ×2. Total billed tenths T = per-piece tenths × n × faces.
- Unit = print + laminate (laminate 0 when `なし`). Print: v0–v2 3,200 /m², v3 3,500. Laminate (グロス/マット same): v0–v2 1,200, v3 1,300.
- output_gross = floor(unit × T / 10).
- **Volume tier (all-units, output only):** T ≥ 300 (≥30 m²) → 20% off; T ≥ 100 (≥10 m²) → 10% off; discount = floor(gross × pct/100).

**Processing:** per panel v0–v1 ¥1,200, v2+ ¥1,500; remarks 角R/角丸/四隅R → +¥400 per panel;
remarks 穴あけ/ビス穴 → +¥300 per panel; plus joint processing above.

**Set-up:** ¥2,000 per quote, waived on repeat orders (remarks 前回同様 / リピート / 増刷 / 前回データ).

### 3.2 インクジェット出力 (IJ)
Fields: W, H, n, media, laminate, remarks.
- Short side s = min(W,H), long side l = max(W,H).
- **Roll-width billing (irregular):** if s ≤ 900 mm: billed per piece = max(0.2 m², area rounded up to 0.1 m²).
  If s > 900 mm: strips = ⌈s / 1340⌉; billed = strips × 1.37 m × (l rounded **up** to 0.1 m)
  (implemented as milli-m² = strips × 1370 × ⌈l/100⌉ / 10, floored). Note 900 is inclusive on the cheap side.
- Total billed = per-piece billed × n.
- Media price /m²:

| media | v0–v2 | v3 |
|---|---|---|
| 塩ビ | 2,800 | 3,100 |
| ターポリン | 3,000 | 3,300 |
| 合成紙 | 2,200 | 2,400 |
| 透過フィルム | 4,200 | 4,600 |

- Laminate /m² (グロス/マット): v0–v2 1,200, v3 1,300; `なし` = 0. media and laminate are each floor(price × billed m²).
- **Volume tier on media+laminate (all-units):** billed ≥ 50 m² → 20% off; ≥ 20 m² → 10% off.
- **Grommets (ターポリン only):** count per piece = 2 × (⌈W/500⌉ + ⌈H/500⌉); price per grommet v0–v2 ¥60, v3 ¥70;
  skipped when remarks say ハトメなし / ハトメ不要. Counted as processing.
- Set-up ¥2,000 per quote, waived on repeat.

### 3.3 カルプ文字 (CALP, foam letters)
Fields: qty n = number of characters, height_mm = character height h, thickness_mm, finish.
- Base per character by height band (h ≤ limit):

| h ≤ | 100 | 150 | 200 | 300 | 400 | 500 | 600 | > 600 |
|---|---|---|---|---|---|---|---|---|
| v0–v1 | 1,200 | 1,600 | 2,100 | 3,000 | 4,200 | 5,500 | 7,000 | 7,000 + ⌈(h−600)/100⌉ × 1,500 |
| v2+ | 1,300 | 1,750 | 2,300 | 3,300 | 4,600 | 6,000 | 7,600 | 7,600 + ⌈(h−600)/100⌉ × 1,650 |

- Thickness factor: t10 ×0.85, t20 ×1.00, t30 ×1.20, t50 ×1.50. Finish: シート貼り ×1.00, 塗装 ×1.35.
- Unit = base × thickness × finish, rounded **up** to ¥10.
- **Step discount beyond threshold (incremental, irregular):** characters 1–20 at unit; characters 21+ at floor(unit × 0.85) each.
- Set-up (版下データ) per quote: v0–v1 ¥3,000, v2+ ¥3,500; waived on repeat.

### 3.4 袖看板 (SODE, projecting sign, always double-sided)
Fields: W, H, n, lighting.
- Size class by (short side, long side) — first class that contains the face:

| class (short×long ≤) | v0 | v1+ |
|---|---|---|
| 450×900 | 85,000 | 95,000 |
| 600×1200 | 118,000 | 132,000 |
| 600×1800 | 152,000 | 170,000 |
| 750×1800 | 178,000 | 199,000 |
| 900×2400 | 236,000 | 264,000 |
| larger | 236,000 + ⌈(W·H − 2.16 m²)/0.5 m²⌉ × 28,000 | 264,000 + … × 31,000 |

- LED内照: + fixed + per-m² × (one face area rounded up to 0.1 m²): v0 38,000 + 15,000/m²; v1+ 42,000 + 16,000/m².
- Price × n. (Base counted as material, LED as processing in truth.csv.)

## 4. Product subtotal → multiplier → minimum → rush

1. product_raw = material + output (after volume tier) + processing + set-up.
2. product_after_mult = floor(product_raw × mult / 1000) (§2).
3. **Minimum product charge:** product_final = max(minimum, product_after_mult); minimum v0–v1 ¥5,000, v2+ ¥6,000.
4. **Rush (特急):** if remarks contain 特急 or 至急 → rush = max(¥3,000, floor(product_final × 30%)).
   Only these two words trigger it. Decoys that never trigger: 納期急ぎません, 急ぎではない, なるべく急ぎで,
   お急ぎとのこと, 早めの対応希望.

## 5. Design fee (not multiplied)

| design field | v0–v2 | v3 |
|---|---|---|
| 支給 | 0 | 0 |
| 修正 | 3,000 | 3,500 |
| 新規 ACM / CALP / IJ / SODE | 10,000 / 6,000 / 8,000 / 15,000 | 12,000 / 7,000 / 9,000 / 18,000 |

Repeat orders always carry 支給.

## 6. Installation and site work (only when install = 有; not multiplied)

- Base installation:
  - ACM: v0–v1 5,000 + 3,000/m², v2+ 6,000 + 3,500/m² of total panel area (W·H·n rounded up to 0.1 m², one face).
  - CALP: per character v0–v1 700, v2+ 800.
  - IJ (貼り施工): per m² of actual total area (rounded up to 0.1 m²) v0–v1 1,800, v2+ 2,000.
  - SODE: per sign v0–v1 38,000, v2+ 45,000.
- **Installation minimum:** install_base = max(minimum, raw); minimum v0–v1 ¥12,000, v2+ ¥15,000.
- **Night work:** remarks contain 夜間 → + floor(install_base × 50%).
- **Height surcharge (per job, by install_height_m, bands inclusive at the upper edge):**

| height | ≤ 2.0 m | ≤ 4.0 m | ≤ 9.0 m | > 9.0 m |
|---|---|---|---|---|
| v0–v1 | 0 | 8,000 (脚立・足場) | 28,000 (高所作業車) | 48,000 (大型) |
| v2+ | 0 | 10,000 | 33,000 | 55,000 |

- **Electrical work:** 袖看板 with LED内照 and installation → v0–v1 18,000, v2+ 22,000 (per job).
- **Removal (撤去):** remarks contain 撤去 (but not 撤去は別途) → v0–v1 15,000, v2+ 18,000.
- **Disposal (処分):** only with removal; remarks contain 処分 and none of 処分は先方 / 処分不要 / 処分なし → +5,000 (all versions).
- **Site survey:** remarks contain 現調 or 現地調査, and neither 現調不要 nor 現地調査不要 → v0–v1 5,000, v2+ 6,000.
  Charged with or without installation.

## 7. Travel (distance bands, irregular)

Charged once when installation = 有 **or** a site survey is charged, from the shop to the site's hidden distance;
waived for customer 1077.

| km ≤ | 10 | 25 | 50 | 80 | > 80 |
|---|---|---|---|---|---|
| v0–v1 | 0 | 4,000 | 9,000 | 16,000 | 16,000 + ⌈(km−80)/10⌉ × 2,000 |
| v2+ | 0 | 5,000 | 12,000 | 20,000 | 20,000 + ⌈(km−80)/10⌉ × 2,500 |

Site → km (old ward name / name from 2024-01-01):

| site | km | site | km |
|---|---|---|---|
| 浜松市中区鍛冶町 / 中央区鍛冶町 | 1 | 浜松市北区引佐町 / 浜名区引佐町 | 24 |
| 浜松市中区佐鳴台 / 中央区佐鳴台 | 5 | 浜松市天竜区二俣町 | 26 |
| 浜松市東区天王町 / 中央区天王町 | 6 | 袋井市 | 27 |
| 浜松市南区高塚町 / 中央区高塚町 | 8 | 周智郡森町 | 33 |
| 浜松市北区三方原町 / 中央区三方原町 | 10 | 豊橋市 | 35 |
| 浜松市西区雄踏町 / 中央区雄踏町 | 11 | 掛川市 | 38 |
| 浜松市浜北区貴布祢 / 浜名区貴布祢 | 13 | 菊川市 | 42 |
| 浜松市西区舞阪町 / 中央区舞阪町 | 14 | 豊川市 | 48 |
| 磐田市 | 18 | 新城市 | 52 |
| 浜松市北区細江町 / 浜名区細江町 | 19 | 御前崎市 | 55 |
| 湖西市 | 22 | 島田市 | 58 |
| 藤枝市 | 66 | 岡崎市 | 75 |
| 静岡市駿河区 | 80 | 静岡市葵区 | 84 |
| 名古屋市中区 | 108 | | |

Site names: the Hamamatsu ward reorganisation (2024-01-01) changes the written names; rep 田中 keeps
writing the old ward names until 2024-03-31. Prices depend only on the location, not on the name.

## 8. Total and rounding (rep-specific habit, irregular)

pre_round_total = product_final + rush + design + install_base + night + height + electrical + removal + disposal + survey + travel.

| rep | active | rounding of pre_round_total → net |
|---|---|---|
| 田中 (owner) | whole period | **floor to ¥1,000 if pre_round ≥ 30,000, else floor to ¥100** |
| 佐藤 | whole period | floor to ¥100 |
| 渡辺 | until 2023-12-28 | round half-up to ¥100 |
| 鈴木 | from 2023-04-03 | floor to ¥100 |
| 高橋 | from 2024-01-09 | **floor to ¥10 until 2024-06-30**, floor to ¥100 from 2024-07-01 |

Only 田中 writes quotes on Saturdays. A customer's main rep handles ~88% of its quotes; 渡辺's
accounts pass to 高橋 (to 佐藤 for the few days in between).

## 9. Tax handling and the written amount

Tax basis: tax-inclusive for 1088 and for 9999 individuals; tax-exclusive otherwise.

| period | tax-exclusive quotes | tax-inclusive quotes |
|---|---|---|
| before 2023-10-01 (pre-invoice) | amount = net; label 田中/佐藤 `税別`, 鈴木 `税抜`, 渡辺 blank | amount = floor(net × 1.10) **then floor to ¥100**; label `税込` |
| from 2023-10-01 (インボイス制度) | amount = net; label `税抜` (渡辺 still blank until he leaves) | amount = net + floor(net × 10%); label `税込` |

## 10. Remarks semantics (summary of triggers)

| effect | trigger substrings | negations / decoys that do NOT trigger |
|---|---|---|
| repeat (set-up waived, design 支給) | 前回同様, リピート, 増刷, 前回データ | |
| rush | 特急, 至急 | 急ぎ… phrases without 特急/至急 |
| night (install ×1.5) | 夜間 | |
| removal | 撤去 | 撤去は別途 |
| disposal (needs removal) | 処分 | 処分は先方, 処分不要, 処分なし |
| site survey (+ travel) | 現調, 現地調査 | 現調不要, 現地調査不要 |
| ACM corner rounding | 角R, 角丸, 四隅R | |
| ACM holes | 穴あけ, ビス穴 | |
| no grommets (ターポリン) | ハトメなし, ハトメ不要 | |

All other remark text (contact notes, store names such as `磐田店`, payment terms, 色校正あり, 概算, …) has no price effect.
Re-issued quotes append 再見積 / 数量変更 / 再見積（訂正）, which have no price effect themselves.

## 11. Human quirks (labelled in truth.csv `quirk`)

153 of 2,378 rows (6.43%) carry a non-`clean` label. Every clean row is reproducible exactly from the
`quotes.csv` fields plus §1–§10 (verified by the self-check).

| label | rows | definition | true_net / written |
|---|---|---|---|
| `stale_table` | 26 | Previous price table used just after a revision: 7 in 2023-05-01..07-14 (v0 instead of v1), 6 non-grace in 2024-04-01..06-14 and 3 grace-group in 2024-06-01..07-31 (v1 instead of v2), 7 in 2025-07-01..09-14 (v2 instead of v3); plus 3 quotes for 1023 in 2024-10-01..12-15 still using the old 880‰ contract rate. Reps 渡辺/田中 over-represented. | true_net = full re-price with old table/rate |
| `multiplier_copy` | 14 | Another customer's multiplier (one of 800/850/880/900/950/1000 ≠ own) applied to the product subtotal. | re-priced with wrong multiplier |
| `manager_discount` | 20 | Undocumented discount of 5–15% off rule_net, then floored to ¥1,000 (¥5,000 when rule_net ≥ 100,000). Mostly 田中. Nothing in remarks. | true_net = discounted value |
| `rush_unrecorded` | 12 | Rush surcharge charged but no 特急/至急 in remarks. | re-priced with rush |
| `rounding_inconsistent` | 15 | Pre-round total rounded with a different method than the rep's habit (none / ceil100 / halfup1000 / floor1000 / halfup100 / floor10). | true_net = that value |
| `travel_omitted` | 10 | Travel fee forgotten. | re-priced without travel |
| `tax_label_error` | 8 | 4 × tax-inclusive amount written under a 税別/税抜/blank label; 4 × pre-tax amount written under 税込. | true_net = rule_net; written wrong |
| `digit_typo` | 10 | Written amount has a keying error (adjacent swap, look-alike digit, dropped 0, extra 0). | true_net = rule_net; written = typo |
| `revision_v1` | 12 | Quote later re-issued as `<no>-2`. 10 are priced by the rules; 2 omitted the travel fee (fixed in v2). | see detail |
| `revision_v2` | 12 | Re-issued quote (2–13 business days later, same customer/rep): 5 quantity changes priced by rules at the v2 date; 5 negotiated prices (rule_net × 0.90–0.96 floored to ¥1,000, undocumented); 2 corrections (travel added, priced by rules). | |
| `duplicate` | 8 | The same quote keyed twice under a new number (same day, or next business day in ~40%). Amount identical to the original; consistent with the rules. | |
| `impossible` | 6 | Not reconcilable: amount of an unrelated quote (2), an unrelated round figure (2), a bundle with unrecorded other work (×2.2–3.5), or a partial amount (×0.30–0.45). | true_net = net implied by the written amount |

## 12. Messy workbooks (public `messy/`)

All three are alternative records of subsets of the same quotes; mapping per row is in `messy_map.csv`
and per quote in `truth.csv` `messy_refs` (`M1:`, `M2:`, `M3:` prefixes).

1. `messy/見積台帳_R5年度.xlsx` — monthly ledger for FY R5 (2023-04-01..2024-03-31), one sheet per month
   (`R5年4月` … `R6年3月`), 775 rows. Two-row merged header, monthly `月計` row with a SUM formula that silently
   skips text amounts. Per-rep styles: dates `令和5年4月3日` (田中), `R5.4.3` (佐藤), `R5/4/3` (渡辺), real date cells
   with 和暦 number format (鈴木), full-width `Ｒ６．１．１５` (高橋); amounts as numbers, `¥92,300` text (渡辺) or
   full-width text (高橋); customer `諸口` instead of 9999; quote numbers prefixed `No.` by 鈴木; sizes `W900×H1800`
   (田中) or full-width (高橋); tax column abbreviated 別/抜/込; remarks truncated to 22 characters for 佐藤/渡辺
   (18 rows actually cut); 3 amounts replaced by `別紙参照`. Duplicates and `-2` versions are included as in the ledger.
2. `messy/見積書控_2024下期.xlsx` — printed-quote copies (PDF-like blocks) for 田中 and 佐藤, 2024-10-01..2025-03-31,
   one sheet per month, 250 blocks. Each block shows line items built from the *as-quoted* components
   (product incl. multiplier/minimum; unrecorded rush is folded into the product line; documented rush is a separate
   line; design; installation incl. night; height; electrical; removal; disposal; survey; travel), then an
   `端数調整` line (rounding) or `お値引き` line (manager discount / negotiated v2), 小計, 消費税, 合計.
   Duplicate ledger entries have no printed copy. Digit typos and tax-label errors are ledger-only: the printed copy
   shows the correct figures.
3. `messy/得意先別見積一覧.xlsx` — per-customer lists for the six busiest non-諸口 accounts, 2024-04-01..2025-09-30
   (255 quote rows + 37 adjustment rows). Sheet styles rotate: `6/4/12` era-less 和暦 text dates, real date cells with
   numeric amounts and a SUM row, or `4月12日` dates under `【2024年】` year rows; full-width digits and `円` suffix in
   text sheets. For tax-exclusive quotes whose final net is ≥ ¥300 below the pre-round total, the row shows the
   pre-round total and the next row is a manual adjustment (`調整` / `端数調整・値引`) — the two sum to the quote.
   Amounts come from the original quotes (typos / tax-label errors in the ledger are not repeated), but 1 row has its
   own transcription error (see `messy_map.csv` note).

## 13. truth.csv columns

- `quote_id` (= quote_no), `issue_date`, `customer_code`, `rep`, `item` (ACM/IJ/CALP/SODE)
- `quirk`, `quirk_detail` — label (§11) and specifics
- `rule_net` — pre-tax net the hidden rules produce for the row as written
- `true_net` — pre-tax net the shop actually intended (includes stale tables, wrong multipliers, discounts, unrecorded
  rush, rounding slips, omitted travel; excludes keying errors and tax-label errors)
- `written_amount`, `written_tax_label` — as in quotes.csv; `tax_basis` — true basis (excl/incl)
- `flags_from_remarks` — triggers parsed from the remarks (§10)
- `rule_*` — clean component breakdown: table_version, material, output_gross, volume_discount, output, processing,
  setup, product_raw, mult, product_after_mult, min_charge_adj, product_final, rush, design_fee, install_base_raw,
  install_min_adj, install_base, night_extra, height_fee, electrical, removal, disposal, survey, travel_km, travel,
  pre_round_total, rounding_rule, rounding_adj
- `actual_table_version`, `actual_mult`, `actual_rush`, `actual_travel`, `actual_pre_round_total` — the components as
  actually quoted (differ from rule_* only for re-priced quirks)
- `post_rounding_adjustment` — true_net − actual_pre_round_total
- `related_quote` — `v1=` / `v2=` / `original=` link for revisions and duplicates
- `messy_refs` — locations in the messy workbooks (`M1:sheet!row`, `M2:sheet!first-last`, `M3:sheet!row`, `(adj)` for adjustment rows)

`messy_map.csv`: `file, sheet, rows, quote_id, kind (ledger_row | printed_block | list_row | adjustment_row), note`.
