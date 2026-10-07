# Round 1 — sign (看板): first proposal from residuals

Inputs used: `blind/sign/quotes.csv`, `blind/sign/SCHEMA.md`, `runs/frozen/sign/*`. `blind/sign/messy/` was not used.
Core unchanged (`meta.core_sha256` c4cff0df…, same as the frozen run); everything is in `assist/sign/round1/10_terms.json`
(loaded with `--extensions assist/sign/round1`).

## What the frozen run left unexplained

The frozen run reproduces **110 / 2,378 quotes (4.6 %)**; the median relative error of the prediction is 31 %, the
recovered tables are full of large signed values (e.g. `site_town` tables in every segment, `-400,000 × area`), i.e. the
search did not find the price structure. Reading the residuals and the quotes:

| pattern in the residuals (frozen run) | quotes | reproduced by frozen |
|---|---|---|
| inkjet: plain one-off quotes follow `2,000 + rate[media×laminate] × ceil(area per piece, 0.1 m²) × qty + design fee` (修正 3,000 / 新規 8,000) with a minimum of 5,000 (→ 6,000 from 2024-04) — reproduced to the yen by this hand formula | 86 of 130 narrow one-off inkjet quotes | 72 inkjet quotes in total |
| volume discount on the billed area (qty × area rounded up per piece): ratio to the formula 1.00 below ~20 m², 0.90 for 24–50 m², 0.80 from 50 m² | 231 / 10 / 11 quotes at exactly 1.00 / 0.90 / 0.80 | — |
| aluminium boards: per-piece price is not linear in area; adding "standard sheets needed" (3×6 = 910×1820, 4×8 = 1220×2440, pieces per sheet in either orientation) cuts the median absolute residual of a plain one-off fit from 2,678 to 451 yen | 57 plain one-off quotes 2023-05…2025-06 (892 aluminium quotes in all) | 12 |
| banners (ターポリン): ~60 yen per eyelet on top of the area price, eyelets every 500 mm of edge, none when the remarks say ハトメ不要/ハトメなし | 15 of 26 narrow one-off banner quotes exact with this term; 159 banner quotes carry eyelets | — |
| rush: 特急… / 至急… raise the price (≈ ×1.2–1.3), while お急ぎとのこと / 早めの対応希望 do not, and 急ぎではない / 納期急ぎません are negations — a substring keyword cannot separate them | 133 quotes with 特急/至急 | 3 |
| other conditions in the remarks with several wordings and negations: removal (撤去 but not 撤去は別途), disposal (処分/産廃 but not 処分不要/処分は先方), site survey (現調/現地調査 but not …不要), night work, delivery | 207 / 133 / 155 / 73 / 58 | 1 / – / 2 / 4 / 2 |
| site: Hamamatsu wards were renamed/merged in 2024, so the same town appears as 中区鍛冶町 and 中央区鍛冶町 etc.; installation residuals depend on the town (central towns ≈ +0, 貴布祢/細江 ≈ +5,000, 二俣 ≈ +10,000) | 319 quotes with a pre-2024 ward name | 6 |

Not expressible with the current core (reported, not proposed): rep 田中 rounds to 1,000 yen at about 30,000 yen and
above (438 quotes; the DSL has one rounding unit per rep); before 2024 the tax-included amount was rounded down to
100 yen after tax (84 quotes; the core derives net candidates from the exact gross); the inkjet minimum charge changed
5,000 → 6,000 (minimum charges are not versioned in the DSL).

## Terms proposed (generic, no quote ids, no per-row corrections)

- derived `billed_m2 = ceil(area_m2, 0.1) * qty` as a threshold column (volume tiers) and the feature `ceil(area_m2, 0.1) * qty`
- `media_lam = media/laminate` (categorical)
- standard-board yield for the rigid-board product: `board36`, `board48`, `board_over` (sheets needed) as features
- `eyelets` for banners (2 × (⌈w/500⌉ + ⌈h/500⌉) × qty unless "no eyelets") as a feature
- condition columns from the remarks: `rush` (特急/至急, multiplier key), `removal`, `disposal`, `survey`, `night`, `delivery` (0/1 features)
- `site_place` = site with the Hamamatsu ward dropped (categorical)
- search: `max_keywords` 20, `time_budget_s` 10,800 (wall-clock safety net only)

## Result

| | reproduced to the yen | rate |
|---|---|---|
| before (frozen) | 110 / 2,378 | 4.6 % |
| after round 1 | 66 / 2,378 | 2.8 % |

Worse. The log shows why: all four search variants ended with the *same* program (66 exact, 923 parameters) after
582 G work units (frozen: 158–190 G) in 5,749 s. The two new categorical keys and the ten new features all enter the
first "rich main-effects" model (every categorical key × every base feature: about 440 columns for 892 aluminium
quotes instead of 220), that single fit used up the deterministic work budget, and the pruning / forward / factor
phases were then skipped in every variant. The terms themselves were never really tried.

Lesson for round 2: offer yes/no conditions as threshold flags (they enter the forward phase, not the rich model),
do not add new categorical keys (redefine the existing `site_town` instead of adding `site_place`, use the engine's
media × laminate pair key instead of `media_lam`), keep only the quantity features that carry a price, and let some
variants start from a parsimonious forward model.

(This run's output directory was replaced when round 2 was launched; the numbers above are from its log:
`variants: #0 66 exact/923 params … polish after combining variants: 66 -> 66 exact`, `"seconds": 5748.8`,
`search_work_G` 582.54 for every variant.)
