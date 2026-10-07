# Round 1 — remark tags and sheet-count candidates

Inputs read: `blind/print/quotes.csv`, `blind/print/SCHEMA.md`, `runs/frozen/print/*`. `blind/print/messy/` was not used.
Extension: `assist/print/round1/` (`10_note_tags.py`, `20_candidates.json`). Core and `configs/` are unchanged.
Run: `ea fit --config configs/blind_print.json --quotes blind/print/quotes.csv --extensions assist/print/round1 --out assist/print/runs/round1`.

## What the residuals showed (frozen run, 231/2,400 reproduced)

1. **The remark keywords were mostly chatter.** The 40 mined keywords were led by `前回` (482 quotes), `入稿` (356),
   `見積` (337), `修正` (356, of which 192 are `修正なし`, "no correction"). Only 3 remark keywords were used
   (`DIC`, `特急`, `新規`). The requests that plausibly carry a charge were split over several substrings or
   not mined at all. Counts in the data, with how many of them the frozen run reproduced:

   | request kind | substrings | quotes | reproduced (frozen) |
   |---|---|---|---|
   | rush | 特急 | 105 | 6 |
   | new design (cards only) | 新規 | 101 | 8 |
   | correction work | データ修正, 文字修正, 修正あり | 164 | 11 |
   | spot colour | DIC, 特色 | 151 | 19 |
   | banding | 帯掛 (100枚ごと / 500枚ごと / 希望) | 40 | 1 |
   | colour proof | 色校, 校正あり | 39 | 2 |

   Examples that pointed to fees. Walk-in cards (`一般`, picked up) cost 1,600 for 1/0 ×100, and 2,600 when the remark says
   データ修正（電話番号変更）, 文字修正3箇所 or 修正あり（PDF校正2回）: +1,000 for any correction remark, 11 quotes.
   They cost +3,000 with 新規デザイン or 新規作成, 20+ quotes. The same flyer job with 本機色校正あり or 色校1回 costs
   +8,000 (C001, 2 pairs).
2. **Size equivalence in sheet products.** The same customer and period give the same price for A3 *q* and A4 2*q*:
   99,070 for A3 10,000 (C026) and A4 20,000 (C010), and 108,100 for both after mid-2024. They also give the same price
   for B4 *q* and B5 2*q*: 85,500. So the driver is the area in sheets, not the piece count. The frozen flyer model
   used `total_qty[size]` and reproduced 37 of 835 flyers (4.4%).

## Proposed terms

- `note_tags` (Python column): one tag per request kind (`#rush #design #fix #spot #band #proof`), as a text column.
  Keyword hints are the tags plus the finishing words (`片面PP 角丸 三つ折 二つ折 Z折 中綴じ`). `max_keywords: 0`
  drops the mined chatter, so only these can become flags. The engine still decides whether each one is a fee, a
  factor or nothing.
- `bundles` (Python column): the bundle count for banding requests, `ceil(quantity×kinds / N)` with N taken from
  "N枚ごと" (100 if none is written). It is offered as a per-bundle feature.
- `a4eq` (derived): pieces × kinds × area ratio to A4 (A3 2, B4 1.5, A4 1, B5 0.75, A5 0.5; ISO/JIS sheet areas).
  It is offered as a feature and as a threshold column.
- `sheets` (derived): full press sheets, `ceil(quantity / yield) × kinds`. The yield is the standard number of pieces per
  full sheet: A3 4, A4/B4 8, A5/B5 16.

No prices, quote ids or per-row corrections are in the extension.

## Result

| | reproduced to the yen | ±100 yen | ±1% |
|---|---|---|---|
| before (frozen) | 231 / 2,400 (9.6%) | 299 | 313 |
| after round 1 | **286 / 2,400 (11.9%)** | 332 | 367 |

| segment | before | after |
|---|---|---|
| チラシ (835) | 37 | 77 |
| リーフレット (339) | 26 | 37 |
| 冊子 (258) | 56 | 34 |
| 名刺 (617) | 68 | 86 |
| 封筒 (351) | 44 | 52 |

What the engine kept: the flags `#rush #design #fix #spot #proof`, `片面PP`, `角丸`, and `a4eq>=375`/`a4eq>=750`.
Flyers now use `a4eq[paper]` with a 5,500 minimum charge. Leaflets use `sheets[size]` with one revision on
2024-04-01. Rounding is 10 yen floor, with 高橋 at 500 floor. `bundles` was not used.

The gain is small, and the variant programs disagree a lot: class rates on the chosen variant are 一般 0.5 and K 0.6,
while the card data says 1.0 for both. Products that cannot be modelled distort the shared customer factors, and those
distorted factors then cost the products that can be modelled (cards, envelopes).

Disclosure: before this round I made one diagnostic engine run on the 617 card rows only. It used the base config, no
extensions, and wrote its output to the scratchpad. It reproduced 224 of 617 cards and showed that the card structure is
within the grammar. It is not one of the reported rounds.
