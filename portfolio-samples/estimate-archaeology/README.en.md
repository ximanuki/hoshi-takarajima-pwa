# estimate-archaeology v0

A Python package that recovers a company's **deterministic pricing rules** (price tables, customer rates,
minimum charges, rounding, revision dates …) from its past quotes, and **detects and classifies** the quotes
that deviate from those rules.

- Input: a quote-register CSV plus a per-dataset config that only says what the columns mean (JSON; YAML if PyYAML is installed)
- Output: `rules.json` (machine-readable rules), `rules_ja.md` (readable Japanese spec), `predictions.csv`
  (per-quote status, class and evidence), `coverage.md` (match rates and breakdowns)
- Results are stated as "**M of N quotes reproduced to the yen**". What is recovered is the **smallest set of rules
  consistent with the history**.

> 日本語: [README.md](README.md)

## Stance: the LLM proposes, the deterministic engine verifies

- v0 makes no LLM calls at all. Price arithmetic, parameter estimation and deviation classification are
  deterministic numpy code.
- People or an LLM only touch the column-meaning config and optional extension candidates. Both are *proposals*:
  whether a candidate is used is decided mechanically by whether it reproduces more past quotes to the yen.
- Same environment and input, same output: fixed seeds, single-threaded BLAS, and the search is bounded by a work counter, not by
  wall-clock time. A wall-clock cap (1 hour by default) is only a safety net; if it fires, `rules.json` says so
  (`meta.search_variants`).

## How it works

```
CSV ─normalise─▶ candidate pre-tax nets ─MDL search─▶ approximate rules ─exact stage─▶ yen-exact rules ─▶ deviation classes / stop
```

1. **Normalisation** – amounts as written (`¥12,300-`, full-width digits, `1万2300円`, `一万二千三百円`), tax labels
   (税込 / 税抜 / 税別 / 内税 / 外税), missing labels (both readings stay open until the rules decide), a tax-amount column,
   Japanese era and Excel-serial dates. Tax rates switch by date; gross/net conversion uses exact rational arithmetic.
2. **Rule DSL** (JSON, rendered as a Japanese spec) – fixed fees, per-unit and per-area prices, tables keyed by
   categorical columns, thresholds/tiers, pack/sheet rounding, **per-level pack sizes (yield-based material: pieces per
   sheet depend on the size)**, minimum quantities, customer-class and per-customer rates, surcharges triggered by
   categories or by keywords in free-text notes, minimum charges (before/after the rates), rounding unit and mode
   (optionally per value of a column such as the rep), and **time-versioned tables with revision dates**.
3. **Search** – per segment (product), a rich main-effects model is fitted with robust IRLS (Cauchy loss) and pruned /
   extended by MDL (bits for parameters + bits for residuals), preferring short programs.
   - Factors (customer rates, rush …) are read off against an additive model fitted on *plain* quotes only (most common
     customer class, no keyword in the remarks, not a re-issue), i.e. against prices the factors did not distort.
   - Revision dates come from a direct scan of month starts; tier steps are proposed from cuts in the residuals, also on
     numeric columns the config did not list as thresholds.
   - Forward selection is scored coarse-to-fine: at the current error scale while the model is far off, at one rounding
     unit once it gets close.
   - The search is path-dependent, so **several search variants run in parallel**; per segment the variant that reproduces
     most quotes is taken, and single terms found by other variants are tried as well (each only if the whole dataset then
     reproduces more quotes). Every variant's own program is kept in `variants/`.
4. **Exact stage** – the deterministic evaluator (how many quotes are reproduced exactly) is the only judge: every
   parameter is moved to the roundest value that does not lose matches; rounding (each mode compared after re-snapping),
   tax rounding, minimum charge, pack sizes and revision dates are chosen the same way. The same judge moves threshold cut
   points (e.g. mounting height ≥ 3 m → ≥ 4 m), merges two tables into one two-column table (rate by thickness + by sides →
   by thickness × sides), adopts fees other segments share (delivery), and finds missing surcharges / factors (many
   unreproduced quotes pointing at the same round value). When two programs reproduce the same quotes, the shorter one wins
   (redundant revision dates, terms and factor tables are dropped). Values that history cannot pin down (e.g. a minimum
   charge that never triggered) are reported as **要聞き取り (to be asked)** with the consistent range, not guessed.
5. **Deviation classes** – re-run the evaluator with one thing changed and record what makes the quote match exactly.
6. **Stop rule** – if fewer than a threshold share of quotes (default 0.80) are reproduced to the yen, no per-quote
   deviation classes are emitted; quotes are `abstained` ("rules insufficient") and `coverage.md` lists where the
   unreproduced quotes concentrate (hints for the missing rules).

| class | meaning |
|---|---|
| `stale_table` | priced with the table that was valid before a revision |
| `copied_rate` | another customer's / class's rate |
| `undocumented_discount` | a discount with no recorded condition |
| `typo` | digit transposition, dropped/extra digit, one-digit slip |
| `unrecorded_surcharge` | a recurring uplift (or a known factor) without its recorded trigger |
| `rounding_inconsistency` | another rounding unit or mode |
| `revision_or_duplicate` | re-issued number or duplicate |
| `unexplained` | none of the above (the difference to the rule is shown) |

Per-quote `status`: `reproduced` / `deviation` / `unexplained` / `abstained`. Summaries group by table version,
period (quarter) and customer class; **they never group by rep**.

## Usage

```bash
make setup     # .venv with pinned deps (numpy; pytest and ruff for development)
make test      # tests (tens of seconds)
.venv/bin/ea fit --config configs/dev_print.json --quotes devdata/print/quotes.csv --out runs/dev_print
.venv/bin/ea check --rules runs/dev_print/rules.json --config configs/dev_print.json --quotes new.csv --out runs/check
```

Options: `--threshold 0.8` (stop threshold), `--stop-scope segment` (stop per segment), `--extensions DIR`.

Besides `rules.json` / `rules_ja.md` / `predictions.csv` / `coverage.md`, `fit` keeps each search variant's own program in
`variants/`. Search settings (the set of variants, the work budget …) go into the config's `search` block (defaults:
`DEFAULT_SEARCH` in `config.py`).

The config never contains prices. Expressions use a small sandboxed language (arithmetic, `ceil`, `regex`, `split`,
`days_between`, `if_` …; no attribute access or imports). `configs/blind_print.json` and `configs/blind_sign.json`
were written from the column definitions in `blind/*/SCHEMA.md` only.

**Extensions**: `--extensions DIR` loads `*.json` (config patches: derived columns, features, thresholds, keywords,
search settings) and `*.py` (modules with `register(registry)` adding expression functions or Python-computed columns)
without editing the core. `ea hash-core` prints the core's SHA-256; `rules.json` records `meta.core_sha256` and the
extension files with their hashes. Example: [`extensions/dev_print_assisted/`](extensions/dev_print_assisted/).

## Blind test results (2026-10-07)

**v0 does not work on the blind data.** The development numbers below come from our own generators; on the blind sets the solver does far worse.

| Data | Dev data (own generator) | Blind, frozen (single run) | Blind, assisted (tuned on the same data over 4 rounds; not blind) |
|---|---|---|---|
| Print | 88.8% | 9.4% (226 of 2,400) | 19.5% (469) |
| Sign | 56.9% | 4.6% (110 of 2,378) | 5.5% (131) |

- All four runs were below the 80% threshold, so the stop rule withheld every deviation class. Without it, 213 to 1,260 correct quotes would have been flagged.
- Why it fell short: the automatic search is weak (a hand-written formula matched more quotes than the search found), and rules that depend on the computed amount (free-delivery thresholds, amount-dependent rounding, a revised minimum charge) cannot be expressed in the current grammar.
- Details: [`BLIND_PROTOCOL.md`](BLIND_PROTOCOL.md) and [`reports/blind-week1.md`](reports/blind-week1.md) (Japanese).

## Development results (dev numbers)

Numbers on two fictional shops produced by the development generators in `devdata/` (unrelated to the blind data).
The generators and the solver were written by the same side, so these show that the machinery works; **they are not an
accuracy estimate on unseen data**. Full report: [`reports/dev_results.md`](reports/dev_results.md); an example of
recovered rules: [`reports/dev/print/rules_ja.md`](reports/dev/print/rules_ja.md).

| dataset | reproduced to the yen | ±1% | clean quotes (in grammar) reproduced | deviation detection (precision / recall) | stop |
|---|---|---|---|---|---|
| print (dev config) | 2,180 of 2,434 (89.6%) | 90.1% | 100.0% | 90.6% / 92.4% | no |
| print (blind config, written from SCHEMA only) | 2,162 of 2,434 (88.8%) | 89.9% | 98.9% | 84.4% / 96.2% | no |
| print + extension (day of month as a candidate) | 2,278 of 2,434 (93.6%) | 94.0% | 100.0% | 99.4% / 98.7% | no |
| print, heavy out-of-grammar share | 1,693 of 2,438 (69.4%) | 75.1% | 75.7% | — (stopped) | global |
| sign (dev config) | 1,839 of 2,410 (76.3%) | 84.5% | 82.0% | — (stopped) | global |
| sign (blind config) | 1,372 of 2,410 (56.9%) | 64.7% | 57.0% | — (stopped) | global |

- Print: revision dates (price tables 2024-04-01, out-of-prefecture delivery 2025-01-01), class and per-customer rates,
  delivery outside the rates, rush ×1.3 (recovered as "lead time under 5 days", which history cannot tell from "≤ 3 days"), one rep rounding to 10 yen, and the card minimum charge of
  3,000 yen are recovered. Minimum charges of segments where it never triggered are reported as 要聞き取り with an upper
  bound. Unreproduced quotes are mostly the injected quirks and the month-end flyer discount, which the config cannot
  express (no day-of-month column); `coverage.md` reports it as a rule candidate ("the same 3 % discount on 85 quotes,
  all quoted on day 28 or later") and those quotes are abstained, not attributed to anyone.
- With the extension (same core SHA-256) the engine finds "flyers quoted on day 28 or later × 0.97": 2,180 → 2,278.
- Sign: the area tiers of projecting signs (271 quotes) are not recovered, the overall rate stays below 80 % and the stop
  rule fires. Classifying anyway (threshold 0) gives 27 % precision, which is what the stop rule is for.
- With the blind config (written from SCHEMA only) the sign rate drops a lot: more candidate features make the search
  lose its way, i.e. results depend on how the config is written.
- Times are for 4 CPU cores with two datasets at once: 8-15 minutes per dataset.

## Limitations

Problems found in the post-test review (not fixed yet):
- An extension's `derived` entry can overwrite an input column, and the engine cannot refuse it. Python extensions can also change core behaviour, so the core hash alone does not prove the core ran as frozen.
- A numerical failure in one search variant (e.g. `SVD did not converge`) aborts the whole fit with no output.
- `work_budget` is not a hard cap, and search phases skipped when it runs out leave no trace.
- The stop rule is decided on the same data the program was fitted to maximise (no hold-out).


- **Rules outside the grammar are not reproduced**, e.g. a month-end discount when the config has no day-of-month column,
  a continuous formula such as a power of the area, a fee that depends on several line items added up. Such quotes end up
  `unexplained` or `abstained`, and `coverage.md` shows where they concentrate. They need an extension (extra candidates)
  or an interview.
- Values can only be pinned down where history exercises them: a minimum charge that never triggered, prices of rare
  levels, and the exact day of a revision (somewhere between two quotes) are reported as 要聞き取り or as ranges.
- Table keys are one column or a pair of columns. Three-way interactions are not searched (a derived column in the config can
  provide them).
- Tier boundaries come from candidate cut points (observed values, quantiles, cuts in the residuals); the true boundary
  is only known to lie between two observed values.
- Revisions are searched at month starts and then moved to the best day. Small revisions that differ by product, or several
  revisions in a short time, can be missed.
- Rounding is global plus exceptions per value of one column (e.g. the rep). Line-item rounding (other than pack/sheet
  rounding), per-line tax and mixed tax rates are not modelled.
- A deviation class is assigned when changing one thing makes the quote match exactly. Quotes with two quirks at once tend to
  end up `unexplained`; `typo` only looks at the digits written. Nothing is concluded about individual reps.
- The search is deterministic and bounded by a work budget, but not fast (8-15 minutes per 2,400-quote dev dataset, four
  search variants in parallel on 4 CPU cores).
- The search is path-dependent. Combining several variants mitigates this, but changing the config (candidate features)
  can still change the result a lot on the same data.
- Dev numbers come from data generated by the same author who wrote the solver; they are not an accuracy estimate on unseen data.
- v0 does not include the LLM step that drafts the column-meaning config; configs are written by hand.
- Messy Excel ledgers such as `blind/*/messy/` (monthly sheets, printed quote copies, personal notes) are not ingested in
  v0 (CSV only).
- Factors are one table for all segments (by customer / condition) or a "segment × condition" table; customer rates that
  differ by segment are not modelled.
