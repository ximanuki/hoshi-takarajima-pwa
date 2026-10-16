"""Score solver output (predictions.csv) against a dev generator's truth.csv.

These are DEVELOPMENT numbers: the generators and the solver were written by the same
side, so they show that the machinery works, not how it does on unseen data.

Metrics (same yardsticks as the blind protocol):
* share of quotes reproduced to the yen (all / clean / clean in-grammar / clean out-of-grammar)
* deviation detection: flagged = status deviation or unexplained; positive = truth label != clean
* class accuracy on correctly flagged deviations
* false "human quirk" attributions: truth is clean (rule-following, possibly a rule outside
  the grammar) but the solver output a deviation class
* abstentions
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path


def evaluate(pred_csv: Path, truth_csv: Path) -> dict:
    pred = {r["quote_id"]: r for r in csv.DictReader(pred_csv.open(encoding="utf-8"))}
    truth = {r["quote_id"]: r for r in csv.DictReader(truth_csv.open(encoding="utf-8"))}
    ids = [q for q in truth if q in pred]
    n = len(ids)
    exact = [q for q in ids if pred[q]["status"] == "reproduced"]
    clean = [q for q in ids if truth[q]["label"] == "clean"]
    clean_ig = [q for q in clean if truth[q].get("out_of_grammar", "0") != "1"]
    clean_oog = [q for q in clean if truth[q].get("out_of_grammar", "0") == "1"]

    def rate(qs: list[str]) -> float:
        return sum(pred[q]["status"] == "reproduced" for q in qs) / len(qs) if qs else float("nan")

    def near(qs: list[str], tol_abs: float | None, tol_rel: float | None) -> float:
        k = 0
        for q in qs:
            p, o = pred[q]["predicted_net"], pred[q]["observed_net"]
            if not p or not o:
                continue
            p, o = float(p), float(o)
            if (tol_abs is not None and abs(p - o) <= tol_abs) or (tol_rel is not None and abs(p - o) <= tol_rel * o):
                k += 1
        return k / len(qs) if qs else float("nan")

    flagged = {q for q in ids if pred[q]["status"] in ("deviation", "unexplained")}
    positive = {q for q in ids if truth[q]["label"] != "clean"}
    tp = flagged & positive
    precision = len(tp) / len(flagged) if flagged else float("nan")
    recall = len(tp) / len(positive) if positive else float("nan")
    confusion = Counter((truth[q]["label"], pred[q]["class"] or "-") for q in tp)
    class_ok = sum(1 for q in tp if pred[q]["class"] == truth[q]["label"])
    false_quirk = [q for q in ids if truth[q]["label"] == "clean" and pred[q]["status"] == "deviation"]
    abstained = sum(1 for q in ids if pred[q]["status"] == "abstained")
    per_label = {}
    for lab in sorted({truth[q]["label"] for q in ids}):
        qs = [q for q in ids if truth[q]["label"] == lab]
        per_label[lab] = {
            "n": len(qs),
            "flagged": sum(q in flagged for q in qs),
            "class_correct": sum(pred[q]["class"] == lab for q in qs if q in flagged),
            "reproduced": sum(pred[q]["status"] == "reproduced" for q in qs),
            "abstained": sum(pred[q]["status"] == "abstained" for q in qs),
        }
    return {
        "n": n,
        "exact": len(exact),
        "exact_rate": len(exact) / n if n else float("nan"),
        "within_100_yen": near(ids, 100, None),
        "within_1_percent": near(ids, None, 0.01),
        "clean_exact_rate": rate(clean),
        "clean_in_grammar_exact_rate": rate(clean_ig),
        "clean_out_of_grammar_exact_rate": rate(clean_oog),
        "n_clean_in_grammar": len(clean_ig),
        "n_clean_out_of_grammar": len(clean_oog),
        "deviations_true": len(positive),
        "flagged": len(flagged),
        "detection_precision": precision,
        "detection_recall": recall,
        "class_accuracy_on_detected": class_ok / len(tp) if tp else float("nan"),
        "false_quirk_attributions": len(false_quirk),
        "abstained": abstained,
        "per_label": per_label,
        "confusion": {f"{a} -> {b}": c for (a, b), c in sorted(confusion.items())},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pred", required=True)
    ap.add_argument("--truth", required=True)
    a = ap.parse_args()
    print(json.dumps(evaluate(Path(a.pred), Path(a.truth)), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
