# Round 4 — sign: reference = all quotes, drop the collinear area feature (run crashed)

Extension: `assist/sign/round4/10_terms.json`. Log: `runs/assisted/sign_round4.log` (no output directory).

## What round 3 showed (residual patterns, with counts)

- 135 / 2,378 exact. The variant that measures the first model on all quotes (`plain_first: false`) reproduced 126,
  the three variants that use the engine's "plain" quotes 88–109. The engine's plain reference is the most common
  customer class: here the account customers (1,784 quotes, 口座), whose prices carry customer rates (of 33 account
  customers with ≥ 2 plain inkjet quotes, 4 at 0.95 and 6 at 0.80 of the one-off price), while the list price is
  the one-off customers' (594 quotes, 諸口).
- The chosen inkjet program has no area price at all; the aluminium program has `area_m2 * qty` at −12,000 next to the
  rounded billed area at +13,000 — two nearly collinear features (the config's `area_m2 * qty` and round 1's
  `ceil(area_m2, 0.1) * qty`) fitted against each other. The engine already tries rounding-up steps of `area_m2` per
  piece (`variant_pass` / exact stage) on its own.

## Terms proposed (changes against round 3)

- every search variant with `plain_first: false` (diversity kept through `ordinal_keys_in_rich`, `additive_test`,
  `init: forward`)
- explicit feature `ceil(area_m2, 0.1) * qty` withdrawn (the billed-area tiers `billed_m2>=…` stay)
- everything else as in round 3

## Result

| | reproduced to the yen | rate |
|---|---|---|
| before (round 3) | 135 / 2,378 | 5.7 % |
| after round 4 | — (run aborted) | — |

One search variant aborted in the core during the revision scan
(`search.scan_revisions → fit_terms → robust_fit → numpy.linalg.lstsq: LinAlgError: SVD did not converge`), which
ends the whole `fit` (the variants run in a process pool). A non-finite value reached the least-squares solve on that
variant's search path; this is a numerical-robustness gap in the frozen core, not something an extension can catch
(extensions cannot wrap the search), and the core may not be edited in this step.

This was the fourth and last round, so it is not retried with other settings.

## Final

The final extension is round 3's term set, copied unchanged to `assist/sign/10_terms.json` (SHA-256 77fa68ce…, same as
`assist/sign/round3/10_terms.json`) and run with `--extensions assist/sign`; output in `runs/assisted/sign/`
(log `runs/assisted/sign.log`, 669 s). Core SHA-256 in `rules.json`: c4cff0df…, the same as the frozen run. The run
reproduced round 3 exactly (same variant results, identical `predictions.csv`), i.e. the result is set by the
deterministic work budget, not by the machine load.

| | to the yen | ±100 yen | ±1 % | stop rule |
|---|---|---|---|---|
| frozen (no extension) | 110 / 2,378 (4.6 %) | 117 (4.9 %) | 133 (5.6 %) | fires (global) |
| final, assisted (`assist/sign`) | **135 / 2,378 (5.7 %)** | 151 (6.3 %) | 187 (7.9 %) | fires (global) |

By segment (final): aluminium 3.1 %, inkjet 9.3 %, letters 3.5 %, projecting signs 6.6 %. No quote is classified
(all non-reproduced quotes stay "abstained").

What still blocks the sign data, from the four rounds:

- the search does not recover price terms that are expressible in the DSL: the round-1 inkjet formula written by hand as
  a `Program` reproduces 164 inkjet quotes with the core evaluator, the search 76; customer rates (0.95 / 0.90 / 0.80 for
  many account customers) are almost never found, and the "plain" reference of the first model is the account class;
- not expressible without a core change: rep-specific rounding to 1,000 yen above ≈ 30,000 yen (438 quotes of one rep),
  tax-included amounts rounded down to 100 yen before 2024 (84 quotes), a minimum charge that changed in 2024-04;
- a numerical abort (`LinAlgError` in the revision scan) on one search path (round 4).
