# Round 2 — sign: same price terms, offered so that the search can afford them

Extension: `assist/sign/round2/10_terms.json`. Output: `runs/assisted/sign_round2/` (log `runs/assisted/sign_round2.log`).

## What round 1 showed

Round 1 lost quotes (110 → 66) without the new terms ever being tried: every search variant ended with the same
first "rich" model (923 parameters) after 582 G work units, because each new categorical key (`media_lam`,
`site_place`) and each new feature was crossed with every other in that first fit. Counts that motivated the
reshaping: the rich model for aluminium had ≈ 440 columns for 892 quotes (frozen config: ≈ 220); `site_place`
alone added 27 levels × every base feature.

## Terms proposed (changes against round 1)

- yes/no conditions (`rush` = 特急/至急, `removal`, `disposal`, `survey`, `night`, `delivery`) are 0/1 columns offered as
  **threshold flags** (they become keys and factor candidates in the forward phase; the engine leaves flags out of
  the rich model on purpose) instead of features/categoricals
- no new categorical keys: `site_town` itself is redefined with the Hamamatsu ward dropped (same key, 27 instead of
  17 levels), `media_lam` dropped (the engine's own media × laminate pair key covers it)
- features kept: `ceil(area_m2, 0.1) * qty`, `board36`, `board48`, `board_over`, `eyelets`
- search: two of the four variants start from a forward (parsimonious) model; `max_keywords` 20; wall-clock cap 10,800 s

## Result

| | reproduced to the yen | rate |
|---|---|---|
| before (round 1) | 66 / 2,378 | 2.8 % |
| after round 2 | 84 / 2,378 | 3.5 % |
| (frozen, for reference) | 110 / 2,378 | 4.6 % |

Variants: forward 46 and 80 exact, rich 78 and 79 exact; 567–820 parameters; search work 326–385 G against a budget
of 120 G; 3,100 s. The engine did pick up some of the proposals — the rush flag as a factor (`rush>=1` ×1.2), the
billed-area feature, the eyelet feature (110 yen per eyelet, mixed with other per-unit terms), design fees 5,000 /
9,000 — but the programs are still the unpruned rich model (e.g. `height_mm * qty` and `site_town` tables on every
inkjet feature) and **no customer rate at all** was found, although roughly half of the account customers are visibly
at 0.95 / 0.90 / 0.80 of the one-off price.

Reading `search.py` explains it: every later phase (pruning, forward, factor and customer-rate discovery, revision
scan) runs only while `budget_left(0.5…0.9)` of `work_budget`; the frozen run (158–190 G) and both rounds blew the
120 G budget in the first fits, so those phases were skipped. That is the main residual pattern for round 3: not a
missing price term but a candidate set too large for the deterministic budget.
