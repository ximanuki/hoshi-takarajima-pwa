"""Fit every development dataset, score it against the generator's truth and write a report.

    PYTHONPATH=src python devdata/run_dev.py [--only print sign ...] [--jobs 2] [--rescore]

Outputs: ``runs/dev_<name>/`` (rules.json, rules_ja.md, predictions.csv, coverage.md),
``reports/dev/<name>/`` (copies of the readable outputs) and ``reports/dev_results.md`` / ``.json``.
``--rescore`` scores existing ``runs/dev_<name>/`` outputs again without refitting.

For each dataset the report also shows what the classification would look like with the stop
rule switched off (the fitted rules re-applied with ``threshold=0``): this is the reason the
stop rule exists.

These are DEVELOPMENT numbers. The generators and the solver were written by the same side,
so they show that the machinery works on rules the author knows; they are not a measure of
accuracy on unseen data.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "devdata"))

from evaluate import evaluate  # noqa: E402

# name -> (config, dataset folder, what it shows)
RUNS = {
    "print": (
        "configs/dev_print.json",
        "devdata/print",
        "print-like shop; 7% of clean quotes carry a rule meant to be outside the grammar (only the month-end flyer discount really is)",
    ),
    "sign": (
        "configs/dev_sign.json",
        "devdata/sign",
        "sign-like shop; 16% of clean quotes carry a rule meant to be outside the grammar (both turn out expressible)",
    ),
    "print_heavy": (
        "configs/dev_print.json",
        "devdata/print_heavy",
        "same shop, 33% of clean quotes carry such rules (month-end discount from day 15): the stop rule should fire",
    ),
    "print_assisted": (
        "configs/dev_print.json",
        "devdata/print",
        "same as print + extensions/dev_print_assisted (day of month, signatures; added without touching the core)",
    ),
    "print_schema_cfg": (
        "configs/blind_print.json",
        "devdata/print",
        "dev print data with the schema-only blind config (checks that config runs; no blind data)",
    ),
    "sign_schema_cfg": (
        "configs/blind_sign.json",
        "devdata/sign",
        "dev sign data with the schema-only blind config (checks that config runs; no blind data)",
    ),
}

EXTENSIONS = {"print_assisted": "extensions/dev_print_assisted"}


def fit_one(name: str) -> str:
    from estimate_archaeology.pipeline import fit

    cfg, data, _ = RUNS[name]
    ext = EXTENSIONS.get(name)
    fit(ROOT / cfg, ROOT / data / "quotes.csv", ROOT / "runs" / f"dev_{name}", extensions=ROOT / ext if ext else None)
    return name


def score(name: str) -> dict:
    from estimate_archaeology.pipeline import check

    cfg, data, what = RUNS[name]
    out = ROOT / "runs" / f"dev_{name}"
    meta = json.loads((out / "rules.json").read_text(encoding="utf-8"))["meta"]
    ev = evaluate(out / "predictions.csv", ROOT / data / "truth.csv")
    ev.update(
        name=name,
        seconds=meta["fit"]["seconds"],
        config=cfg,
        data=data,
        what=what,
        extensions=EXTENSIONS.get(name, ""),
        core_sha256=meta.get("core_sha256", ""),
        stop=meta["stop"],
        revisions=meta.get("revisions", []),
    )
    # what-if: the same rules with the stop rule switched off
    ext = EXTENSIONS.get(name)
    nostop = ROOT / "runs" / f"dev_{name}_nostop"
    check(
        out / "rules.json", ROOT / cfg, ROOT / data / "quotes.csv", nostop, ROOT / ext if ext else None, threshold=0.0
    )
    ns = evaluate(nostop / "predictions.csv", ROOT / data / "truth.csv")
    keys = (
        "flagged",
        "detection_precision",
        "detection_recall",
        "class_accuracy_on_detected",
        "false_quirk_attributions",
    )
    ev["no_stop"] = {k: ns[k] for k in keys}
    dst = ROOT / "reports" / "dev" / name
    dst.mkdir(parents=True, exist_ok=True)
    for f in ("rules_ja.md", "coverage.md", "rules.json"):
        shutil.copyfile(out / f, dst / f)
    return ev


def pct(x: float) -> str:
    return "—" if x != x else f"{x:.1%}"


def stop_ja(st: dict) -> str:
    if st.get("global_stop"):
        return "全体停止"
    if st.get("segments_stopped"):
        return "区分停止: " + "、".join(st["segments_stopped"])
    return "なし"


def render(results: list[dict]) -> str:
    L = ["# 開発用データでの結果（dev numbers）", ""]
    L.append(
        "**注意: これは開発用の数字です。** 生成器（`devdata/gen_*.py`）とソルバーは同じ側が書いたもので、"
        "ルールの形を作者が知っているデータでの動作確認です。未知のデータでの精度を示すものではありません。"
        "目隠し試験（`BLIND_PROTOCOL.md`）の数字は封印を開けた後に別途記録します。"
    )
    L.append("")
    shas = sorted({r.get("core_sha256", "") for r in results})
    L.append("コア（`src/estimate_archaeology/`）の SHA-256: " + ", ".join(f"`{s}`" for s in shas))
    L.append("")
    L.append("## 再現率")
    L.append("")
    L.append(
        "| データ | 件数 | 円単位で再現 | ±100円 | ±1% | 正常見積（文法内）の再現 | 正常見積（文法外）の再現 | 判定停止 | 秒 |"
    )
    L.append("|---|---|---|---|---|---|---|---|---|")
    for r in results:
        L.append(
            f"| {r['name']} | {r['n']:,} | {r['n']:,}件中{r['exact']:,}件（{pct(r['exact_rate'])}） | "
            f"{pct(r['within_100_yen'])} | {pct(r['within_1_percent'])} | {pct(r['clean_in_grammar_exact_rate'])} | "
            f"{pct(r['clean_out_of_grammar_exact_rate'])} | {stop_ja(r['stop'])} | {r['seconds']:.0f} |"
        )
    L.append("")
    L.append("## ルール逸脱の検出と分類")
    L.append("")
    L.append(
        "「出力」は実際の出力（判定停止が働いたデータでは分類を出していません）。"
        "「停止なし（参考）」は、同じルールでしきい値を 0 にして判定し直したもので、判定停止がなぜ必要かを示します。"
    )
    L.append("")
    L.append(
        "| データ | 出力: 検出数 | 適合率 | 再現率 | 分類の正解率 | 正常を癖と誤判定 | 判定保留 "
        "| 停止なし: 検出数 | 適合率 | 再現率 | 分類の正解率 | 正常を癖と誤判定 |"
    )
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in results:
        ns = r["no_stop"]
        L.append(
            f"| {r['name']} | {r['flagged']} | {pct(r['detection_precision'])} | {pct(r['detection_recall'])} | "
            f"{pct(r['class_accuracy_on_detected'])} | {r['false_quirk_attributions']} | {r['abstained']} | "
            f"{ns['flagged']} | {pct(ns['detection_precision'])} | {pct(ns['detection_recall'])} | "
            f"{pct(ns['class_accuracy_on_detected'])} | {ns['false_quirk_attributions']} |"
        )
    L.append("")
    L.append("- 検出: 「deviation / unexplained」と出した見積を陽性、生成器で癖を入れた見積を正解として数えています。")
    L.append(
        "- 正常を癖と誤判定: 生成器では規則どおり（文法外の規則を含む）なのに、逸脱の分類（deviation）を付けた件数。"
    )
    L.append(
        "- 文法外: 生成器で「部品の外」のつもりで入れた規則が効く見積（`devdata/README.md`）。"
        "実際に部品で表せないのはチラシの月末3%引きだけで、残りは表引き・しきい値で表せるため再現されることがあります。"
    )
    L.append("")
    for r in results:
        L.append(f"## {r['name']}")
        L.append("")
        L.append(f"- {r['what']}")
        line = f"- 設定: `{r['config']}` / データ: `{r['data']}/quotes.csv`"
        if r.get("extensions"):
            line += f" / 拡張: `{r['extensions']}`"
        L.append(line)
        L.append(f"- 出力: [`reports/dev/{r['name']}/`](dev/{r['name']}/)（rules_ja.md, coverage.md, rules.json）")
        L.append(
            f"- 正常見積の再現: 全体 {pct(r['clean_exact_rate'])}、文法内 {pct(r['clean_in_grammar_exact_rate'])}"
            f"（{r['n_clean_in_grammar']:,}件）、文法外 {pct(r['clean_out_of_grammar_exact_rate'])}（{r['n_clean_out_of_grammar']:,}件）"
        )
        if r["revisions"]:
            L.append("- 見つかった改定日: " + "、".join(f"{v['segment']} {v['date']}" for v in r["revisions"]))
        L.append("")
        L.append("| 正解ラベル | 件数 | 検出 | 分類一致 | 再現扱い | 保留 |")
        L.append("|---|---|---|---|---|---|")
        for lab, v in r["per_label"].items():
            L.append(
                f"| {lab} | {v['n']} | {v['flagged']} | {v['class_correct']} | {v['reproduced']} | {v['abstained']} |"
            )
        L.append("")
    return "\n".join(L) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", default=list(RUNS))
    ap.add_argument(
        "--jobs",
        type=int,
        default=1,
        help="datasets fitted at the same time (each fit also runs its variants in parallel)",
    )
    ap.add_argument("--rescore", action="store_true", help="score existing runs/dev_* outputs without refitting")
    a = ap.parse_args()
    names = [n for n in RUNS if n in a.only]
    if not a.rescore:
        if a.jobs > 1:
            with ProcessPoolExecutor(a.jobs) as pool:
                list(pool.map(fit_one, names))
        else:
            for n in names:
                fit_one(n)
    results = [score(n) for n in names]
    rep = ROOT / "reports"
    rep.mkdir(exist_ok=True)
    jpath = rep / "dev_results.json"
    old = {r["name"]: r for r in json.loads(jpath.read_text(encoding="utf-8"))} if jpath.exists() else {}
    for r in results:
        old[r["name"]] = r
    merged = [old[n] for n in RUNS if n in old]
    jpath.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (rep / "dev_results.md").write_text(render(merged), encoding="utf-8")
    for r in results:
        print(
            f"{r['name']}: {r['exact']}/{r['n']} exact, flagged {r['flagged']}, "
            f"precision {pct(r['detection_precision'])}, recall {pct(r['detection_recall'])}, {r['seconds']:.0f}s"
        )


if __name__ == "__main__":
    main()
