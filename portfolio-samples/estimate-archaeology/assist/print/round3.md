# Round 3 — tax-display convention for unlabelled amounts; candidates only where they apply

Extension: `assist/print/round3/`.
Run: `ea fit ... --extensions assist/print/round3 --out assist/print/runs/round3`.

## What the residuals showed (round 2, 344/2,400)

1. **Unlabelled amounts were read the wrong way round, and the error propagated.** 394 quotes have no tax label.
   Every labelled quote follows the customer's class:

   | class | 税抜 | 税込 | no label |
   |---|---|---|---|
   | C (companies) | 1,351 | 0 | 265 |
   | D (agencies) | 264 | 0 | 44 |
   | G (schools) | 92 | 15 | 17 |
   | K (private) | 0 | 61 | 15 |
   | 一般 (walk-in) | 0 | 223 | 53 |

   The engine reads an unlabelled amount by whichever reading is closer to its current prediction. In round 2 it read
   29% of the unlabelled walk-in and private card quotes as tax-exclusive. With that reading it estimated 一般 ×1.1
   and K ×1.1, and the card data say ×1.0 for both. In the card example Q2211-053 (1/0 ×200, picked up), 2,200 written
   with no label is 2,000 + 10% tax.
2. **Duplicate candidates inside a segment.** For cards, `a4eq` and `sheets` equal `total_qty`, and `persons_eff`
   equals `kinds` for orders of up to five names. For envelopes, `a4eq` equals `total_qty`. Near-identical columns let the
   card program split one price over several tables. In round 2 the per-card price sat in `persons_eff*quantity` (+15)
   and `total_qty` (−9), plus delivery-keyed tables.

## Proposed terms and settings

- `tax_label` (derived, overriding the written label only where it is blank): an unlabelled amount follows the class
  convention. 一般 and K are tax-inclusive and C and D are tax-exclusive. G is mixed and stays open, so the engine
  still chooses there (17 quotes). The rule is applied by class, not per quote.
- `a4eq` only for sheet-printed products (flyers, leaflets, booklets) and `sheets` only for flyers and leaflets.
  `persons_eff` only for name cards, since SCHEMA defines `kinds` as the number of people for cards and as the number
  of versions elsewhere. All are 0 elsewhere, so they are not candidates there.
- Search: the four default variants (the two start-from-empty variants of round 2 were the weakest) and
  `work_budget: 180` (variant 0 used 103 of 120 G units in round 2).

## Result

| | reproduced to the yen | ±100 yen | ±1% |
|---|---|---|---|
| before (round 2) | 344 / 2,400 (14.3%) | 407 | 454 |
| after round 3 | **313 / 2,400 (13.0%)** | 370 | 391 |

| segment | round 2 | round 3 |
|---|---|---|
| チラシ (835) | 84 | 78 |
| リーフレット (339) | 53 | 38 |
| 冊子 (258) | 42 | 29 |
| 名刺 (617) | 98 | **120** |
| 封筒 (351) | 67 | 48 |

- The class factors are now plausible: C 1.0, D 0.8, G 0.95, K 1.0 and 一般 1.0 (round 2: K 1.1, 一般 1.1, D 0.7).
  Cards gained 22. Among unlabelled quotes, 15 walk-in and 3 private quotes are now reproduced with the tax-inclusive
  reading (round 2: 7 and 1). The convention also matches what the engine chose freely in round 2: 38 of the 39
  unlabelled C/D quotes it reproduced used the tax-exclusive reading.
- Overall the round is worse. A different variant was chosen (`additive_test`, 294 before polishing), and the leaflet,
  booklet and envelope programs it found are weaker than round 2's. This is the path dependence the README warns
  about: the variants reproduced 289, 248, 294 and 266. The engine now finds revisions in flyers (2024-08-01), leaflets
  (2024-06-01) and booklets (2024-06-01). Rounding came out as 10-yen ceil.
- The residual ratio (observed ÷ predicted) by period is the clearest remaining signal:

  | product | –2023-03 | 2023-04 – 2024-06 | 2024-07 – 2025-03 | 2025-04 – |
  |---|---|---|---|---|
  | 名刺 | 1.000 (32/99) | 1.000 (48/242) | 1.000 (33/166) | **1.065** (7/110) |
  | 封筒 | 0.998 | **1.043** | **1.075** | **1.113** |
  | チラシ | 1.000 | 1.000 | **1.034** | **1.036** |

  Card prices rose on 2025-04-01, and the engine did not split the card tables there. Envelope prices rose at every
  step. Round 4 takes this up.
