"""End-to-end on the toy shop: known rules, injected quirks, exact-yen checks."""

import csv
import json

from estimate_archaeology.cli import main
from estimate_archaeology.pipeline import check


def term(prog, tid):
    return next(t for t in prog.terms if t.id == tid)


def test_outputs_written(toy_fit):
    _, out, _ = toy_fit
    for name in ("rules.json", "rules_ja.md", "predictions.csv", "coverage.md"):
        assert (out / name).is_file(), name
    rules = json.loads((out / "rules.json").read_text(encoding="utf-8"))
    assert rules["dsl"].startswith("ea-dsl/")
    header = next(csv.reader((out / "predictions.csv").open(encoding="utf-8")))
    assert header[:4] == ["quote_id", "status", "class", "predicted_net"]
    assert "evidence" in header


def test_every_clean_quote_is_reproduced_to_the_yen(toy_fit):
    res, _, labels = toy_fit
    rows = res.classification.rows
    clean = [r for r in rows if r.quote_id not in labels]
    assert all(r.status == "reproduced" for r in clean)
    assert res.summary["exact"] == len(clean)


def test_recovered_rules(toy_fit):
    res, _, _ = toy_fit
    prog = res.program
    fixed = term(prog, "flyer:1")
    assert fixed.versions == ["2024-04-01"]
    assert fixed.table[""] == [3000, 3500]
    paper = next(t for t in prog.terms if t.segment == "flyer" and t.key is not None and t.key.columns == ("paper",))
    assert paper.table["上質"] == [2, 2.5]
    assert paper.table["コート"] == [3, 3.5]
    card = [t for t in prog.terms if t.segment == "card"]
    assert all(not t.versions for t in card)  # no spurious revision
    cm = next(m for m in prog.multipliers if m.key.columns == ("_customer",))
    assert cm.fallback_table["D"] == 0.9
    assert cm.table == {"C005": 0.85}
    assert prog.rounding.unit == 100 and prog.rounding.mode == "floor"
    assert [r["date"] for r in prog.meta["revisions"]] == ["2024-04-01"]


def test_yield_based_material(toy_fit):
    """Posters: 120 yen per sheet, 4 (A3) / 2 (A2) / 1 (A1) posters per sheet."""
    res, out, _ = toy_fit
    sheets = next(t for t in res.program.terms if t.segment == "poster" and not t.feature.is_const)
    fs = sheets.feature
    assert fs.step_by == "size" and dict(fs.steps) == {"A2": 2.0, "A3": 4.0} and fs.per_pack
    assert sheets.key is None and sheets.table[""] == [120]
    assert term(res.program, "poster:1").table[""] == [2000]
    assert "size ごとの入り数" in (out / "rules_ja.md").read_text(encoding="utf-8")


def test_minimum_charge_not_identifiable(toy_fit):
    res, out, _ = toy_fit
    assert all(m.value is None for m in res.program.min_charge.values())
    assert "要聞き取り" in (out / "rules_ja.md").read_text(encoding="utf-8")


def test_deviations_are_classified(toy_fit):
    res, _, labels = toy_fit
    by_id = {r.quote_id: r for r in res.classification.rows}
    flagged = [r for r in res.classification.rows if r.status in ("deviation", "unexplained")]
    assert {r.quote_id for r in flagged} <= set(labels)  # no clean quote is flagged
    for qid, lab in labels.items():
        r = by_id[qid]
        assert r.status in ("deviation", "unexplained"), qid
        if lab in ("typo", "stale_table"):
            assert r.cls == lab, (qid, r.cls, r.evidence)
        assert r.evidence
    correct = sum(by_id[q].cls == lab for q, lab in labels.items())
    assert correct >= 0.7 * len(labels)


def test_reports_use_safe_wording_and_never_name_reps(toy_fit):
    res, out, _ = toy_fit
    cov = (out / "coverage.md").read_text(encoding="utf-8")
    spec = (out / "rules_ja.md").read_text(encoding="utf-8")
    n, k = res.summary["n"], res.summary["exact"]
    assert f"{n:,}件中{k:,}件を円単位で再現" in cov
    assert "±100円" in cov and "±1%" in cov
    for rep in ("担当A", "担当B", "担当C"):
        assert rep not in cov
        assert rep not in spec
    for banned in ("業界初", "100%再現", "AI見積", "不正検知"):
        assert banned not in cov and banned not in spec


def test_check_reapplies_rules_without_refit(toy_fit, toy_dir, tmp_path):
    res, out, _ = toy_fit
    again = check(out / "rules.json", toy_dir / "config.json", toy_dir / "quotes.csv", tmp_path)
    a = [(r.quote_id, r.status, r.predicted_net) for r in res.classification.rows]
    b = [(r.quote_id, r.status, r.predicted_net) for r in again.classification.rows]
    assert a == b


def test_fit_is_deterministic(toy_fit, toy_dir, tmp_path):
    _, out, _ = toy_fit
    main(
        [
            "fit",
            "--config",
            str(toy_dir / "config.json"),
            "--quotes",
            str(toy_dir / "quotes.csv"),
            "--out",
            str(tmp_path),
            "--quiet",
        ]
    )
    assert (tmp_path / "predictions.csv").read_text(encoding="utf-8") == (out / "predictions.csv").read_text(
        encoding="utf-8"
    )
    assert (tmp_path / "rules_ja.md").read_text(encoding="utf-8") == (out / "rules_ja.md").read_text(encoding="utf-8")
