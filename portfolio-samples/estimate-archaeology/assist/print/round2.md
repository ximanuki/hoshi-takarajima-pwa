# Round 2 — tiered per-person price for cards, less noise in the search space

Extension: `assist/print/round2/`, which is round 1 plus the changes below.
Run: `ea fit ... --extensions assist/print/round2 --out assist/print/runs/round2`.

## What the residuals showed (round 1, 286/2,400)

1. **Name cards with many names are cheaper per name.** Cards are priced per person (`kinds`). Round 1 reproduced 41 of
   278 one-name orders and 34 of 248 two-to-five-name orders, but only 11 of 63 orders with 6–10 names and 0 of 28 with
   more than 10. I fitted a per-person price on the cleanest card quotes: customers whose card quotes all agree with one
   rate, priced on the remark, delivery and finishing terms of round 1. The ratio of the quoted price to
   kinds × per-person price is exactly 1 up to five names (n = 133) and then drops:

   | names | quotes | median ratio | (5 + 0.9·min(k−5,5) + 0.8·max(k−10,0)) / k |
   |---|---|---|---|
   | 6 | 7 | 0.9831 | 0.9833 |
   | 8 | 1 | 0.9622 | 0.9625 |
   | 12 | 4 | 0.9247 | 0.9250 |
   | 13 | 3 | 0.9147 | 0.9154 |
   | 20 | 1 | 0.8750 | 0.8750 |

   That is a tiered per-name price: names 1–5 at full price, 6–10 at 90%, 11 and later at 80%. It covers the per-card
   part, the special-paper surcharge, the lamination (片面PP) and the corner rounding (角丸) alike.
2. **Lead-time thresholds are noise.** 105 quotes carry 特急. 86 of them have a lead time of 3 days or less, but so do
   85 quotes without the remark. I checked 27 of those 85: card quotes from customers whose rate is known. 22 are priced
   without any surcharge, 1 with ×1.25 and 4 match neither reading. The 12 `lead_days` threshold flags only gave the
   search more places to go wrong.
3. **Automatic products of numeric columns.** `quantity*total_qty` and `kinds*total_qty` have no pricing meaning and
   appeared as candidate quantities in every segment.

## Proposed terms and settings

- `persons_eff = min(kinds,5) + 0.9·min(max(kinds−5,0),5) + 0.8·max(kinds−10,0)` (derived). It is offered as the
  quantities `persons_eff` (per-person fixed part) and `persons_eff * quantity` (per-card part). The engine fits all
  coefficients and keys. The 90% and 80% tier rates are part of the proposed rule; the engine only keeps the rule if
  more quotes reproduce.
- `max_thresholds_per_column: 0` drops the pre-generated threshold flags. Tier discovery from residuals is still on.
- `max_feature_degree: 1` stops the automatic products of numeric columns.
- Two more search variants that start from the base fee (`start: empty`, with and without `plain_first`).

## Result

| | reproduced to the yen | ±100 yen | ±1% |
|---|---|---|---|
| before (round 1) | 286 / 2,400 (11.9%) | 332 | 367 |
| after round 2 | **344 / 2,400 (14.3%)** | 407 | 454 |

| segment | round 1 | round 2 |
|---|---|---|
| チラシ (835) | 77 | 84 |
| リーフレット (339) | 37 | 53 |
| 冊子 (258) | 34 | 42 |
| 名刺 (617) | 86 | 98 |
| 封筒 (351) | 52 | 67 |

- The variants reproduced 321, 246, 220 and 263 quotes; the two new start-from-empty variants reproduced 208 and 162.
  The rich-ordinal variant was chosen. Polishing added the flyer minimum charge of 5,000 (pre-rate) and the
  envelope minimum charge of 11,000. Rounding came out as 10-yen round, with 高橋 at 500.
- The card program uses `persons_eff`, `persons_eff*quantity[colors]`, `persons_eff*quantity[片面PP]`, `kinds[角丸]`
  (500), `#design` (2,680 + 150/name, after the rate) and `#fix`. It is still tangled: delivery appears in three
  tables, and there is no revision.
- The shared customer factors are still wrong. The class rates are 一般 1.1 and K 1.1, but the cards say 1.0. The
  overrides include C015 1.37 and C018 1.185, while the cards say 1.0 for both. The products whose structure is still
  outside the candidates (flyers, leaflets, booklets) set the per-customer medians, and the card and envelope
  programs bend to compensate.
- 41 walk-in and private card quotes have no tax label. For 29% of them the engine read the amount as tax-exclusive,
  which supports the 1.1 class rate (see round 3).
