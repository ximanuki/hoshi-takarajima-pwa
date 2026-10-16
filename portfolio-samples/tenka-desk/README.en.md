# Tenka Desk (working name)

A web app demo that **helps prepare the supporting material for price negotiations** (価格協議の根拠資料づくりを支援). It is aimed at mid-size Japanese wholesalers, trading companies and B2B manufacturers with hundreds of customers and thousands of products.

It reads the sales history exported from a sales-management system (販売管理), finds "profit leaks" where invoices do not follow what was agreed, builds a price-increase proposal from a cost scenario, drafts a formal request letter (申入書) per customer, keeps an append-only negotiation log, exports the new price master, and finally checks that later invoices use the new prices. Everything runs inside the browser.

> 日本語: [README.md](README.md)

> **All sample data is fictional (架空).** The company (架空商事株式会社), customers, products, prices and transactions are made up and unrelated to any real company or person. Only the public statistics used as evidence in the letters (Bank of Japan, Ministry of Health, Labour and Welfare) are copies of real statistics, shown with their sources.

![Diagnosis screen (fictional sample data)](docs/screenshots/02-diagnosis.png)

The UI is in Japanese.

## What it does

| | Screen | What it does |
|---|---|---|
| 1 | 取り込み (Import) | Drag and drop CSV files, or press "try the sample data". Handles UTF-8 and Shift_JIS, full-width/half-width characters, Japanese era dates and product-code variants (`ＤＢ－１００１`, `db-1001`, `DBー1001`). File types are detected from the header; for an unknown header the user maps the columns on screen. Missing files and their effect are listed. |
| 2 | 診断 (Diagnosis) | Compares every line with the agreed unit price (a valid special price, else list price × the customer's rate) and finds **unreflected increases** (still billed at the old price), **expired special prices**, **prices outside the customer's rate tier** and **margins below the floor**. The summary comes first (yearly impact in yen by type); each customer × product finding drills down to a plain-Japanese explanation and the sales lines behind it. Customer-wide problems (e.g. a wrong customer master) are called out. |
| 3 | シナリオ (Scenario) | Sliders for raw material, labour, energy and other cost increases, applied through each product's cost structure; supplier price notices can replace the model. Guardrails: maximum increase, minimum increase, margin floor, special-price handling, list-price rounding (10/50/100 yen, endings). Simulates the pass-through rate and the recovered gross profit. |
| 4 | 提案 (Proposal) | New unit price per customer × product, computed as new list price × the customer's rate, so rate tiers stay consistent. Prices can be edited, but values below the current price, above the cap or outside the rate tier are refused (below the margin floor is allowed with a warning). |
| 5 | 申入書 (Letter) | A formal "request for a price revision" per customer: Japanese era dates, 拝啓〜敬具, 記〜以上, an appendix with the customer's items, and an evidence section with charts of public statistics. Prints to A4 PDF from the browser. The company's own cost breakdown is never shown. |
| 6 | 交渉 (Negotiation) | Kanban by status (before request → requested → negotiating → agreed / partly agreed / declined) and a per-customer log. The log is **append-only**: entries cannot be edited or deleted (mistakes are fixed by appending a correction). Each entry carries a SHA-256 chained to the previous one, so later changes are detected. Print to PDF, CSV and JSON export. |
| 7 | 書き出し (Export) | The agreed new prices as an effective-dated price master CSV in layout A or B (UTF-8 or Shift_JIS). |
| 8 | 反映チェック (Follow-up) | Reads a later sales export and lists lines still billed at the old price after the effective date. |

## The demo story (fictional sample data)

1. On 取り込み press **サンプルデータで試す（A形式）**. 300 customers, 2,000 products and 56,328 sales lines (Oct 2024–Sep 2026) are read and diagnosed in about 3 seconds (headless Chromium in the development environment).
2. 診断: profit leaks over the last 12 months total **¥4,598,211** (unreflected increases ¥2,204,568 / expired special prices ¥983,733 / outside the rate tier ¥1,211,016 / below the margin floor ¥198,894). Four customers with a customer-wide problem are flagged.
3. シナリオ: set the cost increases and guardrails. With the defaults (material 8%, labour 5%, energy 10%, supplier notices on, cap 20%) the requested pass-through rate is about 112%.
4. 提案: review and adjust the increase per customer and item.
5. 申入書: pick a customer, check the letter, print it to PDF, and record "letter sent" in the negotiation log.
6. 交渉: **サンプルの協議結果（架空）で埋める** fills the log with fictional answers (agreed, partly agreed, declined, negotiating); append meeting and call notes.
7. 書き出し: save the price master of the agreed customers in layout A or B.
8. 反映チェック: **サンプル（令和8年12月分・架空）で試す** finds **79 lines (53 pairs, 29 customers) still at the old price, ¥343,144 short**.

All screenshots in `docs/screenshots/` are written by `npm run e2e`.

| | |
|---|---|
| ![Evidence of a finding](docs/screenshots/03-diagnosis-evidence.png) | ![Scenario](docs/screenshots/04-scenario.png) |
| ![Proposal](docs/screenshots/05-proposal.png) | ![Letter](docs/screenshots/06-letter-sheet.png) |
| ![Negotiation](docs/screenshots/07-negotiation.png) | ![Follow-up](docs/screenshots/09-followup.png) |

## How to run

Requires Node.js 22.18 or later.

```bash
npm install
npm run sample     # generate the fictional sample data into public/sample/ (about 30 MB, not in git)
npm run dev        # development server
```

| Command | What it does |
|---|---|
| `npm run build` | Type-checks and writes `dist/`. Paths are relative (`base: './'`), so the build works from any folder or subpath. If the sample data exists, it is copied to `dist/sample/`. |
| `npm test` | Unit tests (Vitest): 209 tests for the engine and the app logic |
| `npm run lint` / `npm run typecheck` | Biome / TypeScript |
| `npm run e2e` | Builds, then walks the demo story with Playwright and saves screenshots to `docs/screenshots/`. `dist/` is served under the subpath `/tenka-desk/`. Needs the sample data and Playwright's Chromium (`npx playwright install chromium` if missing). |
| `npm run evaluate` | Scores the leak detection against the sample data's ground truth ([docs/evaluation.md](docs/evaluation.md), Japanese). |

## Data and privacy

- **All data stays in the browser.** There is no server, and nothing sends file contents anywhere. The UI says so on every screen.
- The built page carries a Content Security Policy (`connect-src 'self'` and more), so the browser itself blocks requests to any other origin. The app only loads static files from its own location (the app, the sample data and the statistics snapshot). No web fonts, analytics or third-party CDNs. The E2E test checks that not a single request goes to another origin.
- Data is kept in the browser's IndexedDB (loaded files, settings, manual prices, negotiation logs). **データを消す** (delete data) in the header removes all of it. The sample data is not stored; it is read again on each visit.
- Single-company data only: there is no feature to load or compare other companies' prices (a competition-law precaution).
- Exported files (CSV, JSON) are created in the browser and saved directly.

## How the numbers are computed

- **Every calculation is a fixed formula; no LLM is used.** Amounts are integers (yen; costs in 1/100 yen; rates in 0.1% and 0.01% steps) with explicit rounding for every division, so the same input always gives the same result.
- **Diagnosis**: the correct price is a valid special price, else list price × rate (rounded down to the yen), where the list price follows the customer's answer to the previous revision (later effective date, categories kept, declined). Returns, free samples and freight are excluded. A line with several problems counts once, in the order unreflected increase → expired special → outside the tier → below the margin floor. The yearly impact is the **actual shortfall of the last 12 months**, not a forecast.
- **Scenario**: unit cost × cost share × increase, summed over the components; a supplier's notice can replace it.
- **Proposal**: three ways to set the new list price — keep the gross profit amount (default: the cost increase divided by the buyers' average rate is added to the list price), keep the margin rate (list price raised by the cost increase rate), or use a new list price table. List prices are rounded to 10 yen below 1,000, 50 yen below 10,000 and 100 yen above (configurable).
- **Pass-through rate** = price increase ÷ cost increase. Rounding list prices up and raising prices to the margin floor can push it above 100%; keeping the margin rate pushes it well above (sample defaults: about 112% keep amount, 159% keep rate, 107% new list table). The UI explains this. Quantities are assumed equal to the last 12 months.
- **Letter evidence**: snapshots of public statistics (corporate goods price index, services producer price index, regional minimum wages, spring wage settlements) with source and retrieval date. Rates of change the source does not publish are marked 「本ツールで計算」 (computed by this tool).
- **Negotiation log**: each entry's check code is a SHA-256 that includes the previous entry's code, so a changed or removed entry breaks the chain. A completely rebuilt chain would not be detected, so this is not a substitute for a trusted third-party timestamp.

## Evaluation (on self-made fictional data)

Details in [docs/evaluation.md](docs/evaluation.md) (Japanese). **These figures come from fictional data made in this project.** The sample data and the engine follow the same documented pricing rules (`data-gen/README.md`), and the ground-truth rules were read before the engine was written. 100% confirms that the engine follows the documented rules; **it says nothing about accuracy on real sales data.**

| Leak type | Precision (lines) | Recall (lines) | Yearly impact (engine) | Yearly impact (truth) |
|---|---:|---:|---:|---:|
| Unreflected increase | 100.0% | 100.0% | ¥2,204,568 | ¥2,204,568 |
| Expired special price | 100.0% | 100.0% | ¥983,733 | ¥983,733 |
| Outside the rate tier | 100.0% | 100.0% | ¥1,211,016 | ¥1,211,016 |
| Below the margin floor | 100.0% | 100.0% | ¥198,894 | ¥198,894 |

- 56,328 sales lines; last 12 months Oct 2025–Sep 2026. Layouts A and B give identical results on every line.
- Optional files matter: without the previous revision's agreements, precision for unreflected increases drops to 44.4%; without the special-price list, precision for "outside the tier" drops to 11.2%. The Import and Diagnosis screens therefore warn when these files are missing.
- Follow-up check (December 2026, 2,770 lines): all 79 lines still at the old price found with no false positives (¥343,144, equal to the truth).
- The E2E test also checks the ¥4,598,211 total and the 79 lines / ¥343,144 on screen.

## Limits

- Accuracy on real data is unknown: overlapping revisions, prices in fractions of a yen, discounts or rebates booked on later slips, delivery-point prices, or CSV layouts very different from these two may occur.
- The checks are rule-based. They flag *possible* leaks; a person decides after checking the agreement with the customer.
- Proposals and letters are drafts and must be reviewed before sending. Nothing here is legal advice.
- Calculations run on the browser's main thread: a few seconds for ~56,000 lines; hundreds of thousands of lines will take noticeably longer.
- Data lives in one browser only; no sharing between people or devices (negotiation logs can be exchanged as JSON).
- The kanban changes status by appending log entries rather than by dragging cards (so the same works from the keyboard).
- The statistics are a snapshot taken in October 2026; check the latest published values before use ([public/stats/SOURCES.md](public/stats/SOURCES.md)).

## Wording rules

This is a public portfolio repository, so:

- What it is: **"helps prepare the supporting material for price negotiations"** (価格協議の根拠資料づくりを支援).
- Never used: "AI-optimal price" (AI最適価格), guarantees of legal compliance (e.g. 取適法対応を保証), "first in the industry" (業界初). `src/app/wording.test.ts` checks the UI source for them.
- Sample data is labelled fictional (架空) wherever it appears.
- Legal topics stay at the level of general information; no legal advice.
- Statistics always show their source; figures computed by the tool are marked as such.

## Layout

```
src/engine/   calculation engine (no DOM, network, clock or randomness; plain TypeScript)
src/app/      UI (React)
  model/      loading, proposal, negotiation and export logic, browser storage
  screens/    the eight screens
  components/ charts (SVG), file drop, shared pieces
e2e/          Playwright tests and a tiny server that serves dist/ under a subpath
data-gen/     generator of the fictional sample data (fixed seed, same data every time)
public/stats/ public statistics snapshot and sources (SOURCES.md)
docs/         evaluation and screenshots
```

Built with TypeScript, React 19, Vite, Vitest, Biome and Playwright. The only runtime dependency is React.

## Sources

- Corporate Goods Price Index and Services Producer Price Index: Bank of Japan. This service uses the API of the BOJ Time-Series Data Search site (only to build the snapshot); its content is not guaranteed by the Bank of Japan.
- Regional minimum wages and spring wage settlements of major private companies: Ministry of Health, Labour and Welfare.
- Retrieval dates, processing and terms of use: [public/stats/SOURCES.md](public/stats/SOURCES.md).
