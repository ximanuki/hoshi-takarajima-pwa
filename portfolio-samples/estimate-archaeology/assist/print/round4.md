# Round 4 (final) — price-list periods as a key, more search variants

Extension: `assist/print/round4/` (final). Run: `ea fit --config configs/blind_print.json --quotes blind/print/quotes.csv
--extensions assist/print/round4 --out assist/print/runs/round4`. The output is copied unchanged to
`runs/assisted/print/`, and the log to `runs/assisted/print.log`.

## What the residuals showed (round 3, 313/2,400)

The residual ratio (observed ÷ predicted) by period was flat before each revision date and stepped up after it.
Same-customer, same-spec repeats confirm the steps:

| evidence | old → new | dates |
|---|---|---|
| C026 flyer A3 4/4 コート90 ×10,000 | 93,850 → 99,070 → 108,100 | 2023-03-03 / 2023-05-22, 2024-01-30 / 2024-07-29 |
| C017 leaflet A4 三つ折 ×2,000 | 46,120 → 50,500 | 2024-03-08 / 2024-07-17 |
| D05 leaflet A3 二つ折 ×5,000 | 69,910 → 75,900 | 2024-06-04 / 2024-09-12 |
| 一般 cards 1/0 ×200, 2 names | 4,000 → 4,600 | 2025-03 / 2025-04 |
| C017 envelope 長3 1 pack | 5,580 → 5,840 → 6,300 → 6,400 (pre-delivery) | each period |

Cards changed only on 2025-04-01: +100 per name and +1 yen per card. The flyer, leaflet and booklet tables changed on
2023-04-01 and 2024-07-01. Envelopes changed on all three dates. The engine's own revision scan found 2024-06/08 in
round 3 for some products, but not the card or envelope steps.

## Proposed terms and settings

- `price_period` (derived categorical): `〜2023-03`, `2023-04〜`, `2024-07〜`, `2025-04〜`, added to the
  categorical keys. Any table can then take per-period values. The engine decides which tables change and by how
  much.
- Eight search variants: the four defaults plus `init: forward`, `init: forward + additive_test`,
  `ordinal_keys_in_rich + plain_first: false` and `additive_test + plain_first: false`. Rounds 2 and 3 showed
  that the result depends heavily on which variant wins.

## Result

| | reproduced to the yen | ±100 yen | ±1% |
|---|---|---|---|
| before (round 3) | 313 / 2,400 (13.0%) | 370 | 391 |
| after round 4 | **467 / 2,400 (19.5%)** | 532 | 579 |

| segment | frozen | round 1 | round 2 | round 3 | **round 4** |
|---|---|---|---|---|---|
| チラシ (835) | 37 | 77 | 84 | 78 | **123** |
| リーフレット (339) | 26 | 37 | 53 | 38 | **59** |
| 冊子 (258) | 56 | 34 | 42 | 29 | **53** |
| 名刺 (617) | 68 | 86 | 98 | 120 | **172** |
| 封筒 (351) | 44 | 52 | 67 | 48 | **60** |
| total | 231 | 286 | 344 | 313 | **467** |

- The variants reproduced 340, 363, 320, 379, 235, 337, **461** and 285 quotes. The new variant
  `ordinal_keys_in_rich + plain_first: false` won, and polishing took it to 467. No variant hit the wall-clock cap,
  so the result is deterministic for this input; `rules.json` → `meta.search_variants` has the details.
- `price_period` is used by 18 terms across all five segments. The residual ratio by period is now within 2% of
  1.000 for every product and period except envelopes in 2024-07〜 (1.069). In round 3, cards in 2025-04〜 were at
  1.065 and envelopes were at 1.043, 1.075 and 1.113.
- Rush comes out as ×1.25, which matches the cards. The class factors are all 1.0, with per-customer overrides on top.
- **Caveat: the program is large.** It has 480 parameters, against 85 in round 3 and 119 in the frozen run. The card
  tables use near-collinear pairs: `kinds` and `persons_eff` are equal for orders of up to five names, and they carry
  cancelling coefficients of about ±400,000. So the card part of `rules_ja.md` is not readable as a price list, even
  though it reproduces the quotes. As a check, 154 of the 172 card quotes it reproduces are also reproduced by an
  explicit structural card model fitted outside the engine. That model covers 463 of 617 card quotes. The matches are
  mostly rule-conforming quotes, not lookup-table hits on quirks.

## What still cannot be expressed through `--extensions`

These all depend on the computed amount or on a structure I could not identify, so no candidate column can carry them:

1. **Delivery fee waived above an order value.** Card and envelope quotes show 市内 800 below about 10,000 and free
   above it, and 市外 1,500 below about 30,000 and free above it. The grammar has no conditional on the computed
   amount.
2. **高橋 rounds to 500 yen only for amounts of 10,000 and over.** Below that, amounts are 10-yen multiples (税抜: 99%
   of amounts over 10,000 are multiples of 500, and only 32% of those between 5,000 and 10,000). Rounding groups are
   per rep, not per amount.
3. **Flyer minimum charge 5,000 → 5,500 at the 2024-07 revision.** The minimum charge has no versions, so the engine
   keeps 5,000.
4. **Flyer, leaflet and booklet base prices.** A3 *q* is priced like A4 2*q*, and B4 *q* like B5 2*q*. Small runs and
   large runs behave differently. Increments between quantity steps are irregular, which suggests a lookup table I
   could not reconstruct. Candidates were offered as `a4eq` and `sheets`.
5. **Out-of-prefecture delivery for cards** (520 → 600 → 525, with exceptions). I found no consistent rule.
