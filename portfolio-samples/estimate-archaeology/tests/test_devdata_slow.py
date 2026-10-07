"""Full runs on the generated dev datasets (several minutes each; `make test-all`)."""

from pathlib import Path

import pytest

from estimate_archaeology.pipeline import fit

ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.slow
def test_stop_rule_fires_when_a_third_of_the_quotes_follow_rules_outside_the_grammar(tmp_path):
    res = fit(ROOT / "configs" / "dev_print.json", ROOT / "devdata" / "print_heavy" / "quotes.csv", tmp_path)
    assert res.classification.stop["global_stop"]
    assert not any(r.cls for r in res.classification.rows)


@pytest.mark.slow
def test_dev_print_runs_end_to_end(tmp_path):
    res = fit(ROOT / "configs" / "dev_print.json", ROOT / "devdata" / "print" / "quotes.csv", tmp_path)
    assert res.summary["n"] == 2434
    assert res.summary["exact_rate"] > 0.5
    assert (tmp_path / "coverage.md").is_file()
