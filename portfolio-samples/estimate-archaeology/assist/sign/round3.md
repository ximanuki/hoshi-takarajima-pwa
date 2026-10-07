# Round 3 — sign: shrink the candidate set so the search phases run

Extension: `assist/sign/round3/10_terms.json`. Output: `runs/assisted/sign_round3/` (log `runs/assisted/sign_round3.log`).

## What round 2 showed

- 84 exact; every variant spent 326–385 G work units against a 120 G budget in the first fits, so pruning, the
  forward phase, the factor search and the customer-rate search (all gated by `budget_left(0.5…0.9)`) were skipped.
  Same pattern in the frozen run (158–190 G).
- Size of the first rich model (every categorical key × every base feature): aluminium ≈ 440 columns, inkjet ≈ 380.
  The biggest single block was `site_town` (27 levels after the ward fix) crossed with every feature; in round 2's
  program the inkjet segment still carried `site_town` tables on `1`, `area_m2 * qty`, `height_mm * qty`, `area_m2`
  and the rounded area (27 levels each, mostly zeros or ±40,000–150,000).
- `height_mm` (a config numeric column) is crossed with every key in every segment although it is only a price driver
  for channel letters (character height); for panels the size already enters through the area. Round 2's inkjet
  program had `height_mm * qty` terms keyed by media, design and site.
- No customer rate was found (0 customers), although of the 33 account customers with ≥ 2 plain inkjet quotes
  (no installation, below the volume tiers), the median ratio to the one-off price formula is 1.00 for 19, 0.95 for 4,
  0.80 for 6 and something else for 4.

## Terms proposed (changes against round 2)

- the site text itself is normalised (Hamamatsu: ward dropped, town kept; elsewhere city/town) and `site_town` is
  emptied, so towns enter as **keyword flags of the site text** in the forward phase (as keys of a travel fee or as
  factors) instead of as a 27-level key on every feature in the first model
- `height_mm` only for channel letters (NaN elsewhere)
- `work_budget` 240 G (deterministic) — with the smaller first model the phases fit in it
- price terms unchanged: billed area and its tiers, board yield, eyelets, condition flags (rush, removal, disposal,
  survey, night, delivery)

Rich-model size after the change: aluminium 108 columns, inkjet 98, letters 70, projecting signs 54 (frozen config:
220 / 236 / 164 / 188).

## Result

| | reproduced to the yen | rate | median relative error |
|---|---|---|---|
| before (round 2) | 84 / 2,378 | 3.5 % | 33 % |
| after round 3 | **135 / 2,378** | **5.7 %** | 18 % |
| (frozen, for reference) | 110 / 2,378 | 4.6 % | 31 % |

By segment (round 3 / frozen): aluminium 28 / 12, inkjet 76 / 72, letters 15 / 17, projecting signs 16 / 9. Search
work 124–151 G (budget 240 G, no cap hit), 717 s. Kept by the engine: board yield (`board36` 6,200 per 3×6 sheet,
`board48` 11,000 per 4×8 sheet, `board_over` 30,000), removal fee (aluminium 10,000, inkjet 20,000), the rush and
night flags as factors ×1.3, height tiers for installation (≥ 2.2 m / ≥ 4.5 m on aluminium, ≥ 4 m on letters), a
projecting-sign price table by size (area level), a few customer rates.

Still poor, and the residuals say why: the chosen variant's inkjet program has **no area price at all** (setup 3,000 +
design + installation), the other variants keep area terms but with signs that cancel (`area × qty` −12,000 next to
rounded area +13,000 on aluminium). A hand-written check with the core evaluator (the inkjet formula from round 1 as a
`Program`, no customer rates, no installation fees) reproduces 164 of 818 inkjet quotes, against 76 for the search —
so the terms are expressible and the search does not find them. Two causes visible in the variants: the variant that
measures the first model on all quotes (`plain_first: false`, 126 exact) beats the three that use the engine's "plain"
quotes (88–109) — the plain reference is the most common customer class, here the account customers whose prices
carry customer rates, not the one-off list price; and the explicit rounded-area feature is nearly collinear with the
config's `area_m2 * qty`.
