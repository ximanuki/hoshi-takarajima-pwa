"""Stop mechanism ("rules insufficient") and the extension interface."""

import csv
import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pytest

from estimate_archaeology.extensions import core_hash, load_extensions
from estimate_archaeology.pipeline import fit

CONFIG = {
    "name": "notes-priced",
    "columns": {"id": "id", "date": "date", "customer": "cust", "amount": "amount", "tax_label": "tax"},
    "numeric": ["qty"],
    "search": {"time_budget_s": 30, "variants": [{}], "workers": 1},
}


def write_notes_priced(path: Path, n: int = 240) -> None:
    """Price = 1,000 + 3 x qty + 40 yen per character of the remarks (outside the grammar:
    nothing in the config says that the length of a text matters)."""
    rng = np.random.default_rng(5)
    letters = list("アイウエオカキクケコサシスセソタチツテト")
    rows = []
    for i in range(n):
        qty = int(rng.choice([100, 200, 300, 500, 800]))
        k = int(rng.integers(0, 40))
        notes = "".join(rng.choice(letters, size=k))
        net = 1000 + 3 * qty + 40 * len(notes)
        d = date(2024, 1, 1) + timedelta(days=i)
        rows.append(
            {
                "id": f"N{i:04d}",
                "date": d.isoformat(),
                "cust": "C1",
                "qty": qty,
                "notes": notes,
                "amount": net,
                "tax": "税抜",
            }
        )
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


@pytest.fixture(scope="module")
def notes_data(tmp_path_factory) -> Path:
    d = tmp_path_factory.mktemp("notes")
    write_notes_priced(d / "quotes.csv")
    (d / "config.json").write_text(json.dumps(CONFIG), encoding="utf-8")
    ext = d / "ext"
    ext.mkdir()
    (ext / "10_textlen.py").write_text(
        "import numpy as np\n"
        "from estimate_archaeology.expr import as_str\n\n"
        "def strlen(ctx, x):\n"
        "    return np.array([len(v) for v in as_str(x, ctx.n)], dtype=float)\n\n"
        "def register(registry):\n"
        "    registry.add_function('strlen', strlen)\n",
        encoding="utf-8",
    )
    (ext / "20_features.json").write_text(
        json.dumps({"derived": {"note_len": "strlen(notes)"}, "numeric": ["note_len"]}), encoding="utf-8"
    )
    return d


def test_stop_when_rules_are_insufficient(notes_data, tmp_path):
    res = fit(notes_data / "config.json", notes_data / "quotes.csv", tmp_path)
    assert res.summary["exact_rate"] < 0.8
    assert res.classification.stop["global_stop"]
    rows = res.classification.rows
    assert all(r.status in ("reproduced", "abstained") for r in rows)
    assert not any(r.cls for r in rows)  # no deviation classes are emitted
    assert all("規則不足" in r.evidence for r in rows if r.status == "abstained")
    cov = (tmp_path / "coverage.md").read_text(encoding="utf-8")
    assert "判定停止" in cov
    assert "規則が足りない箇所の手がかり" in cov


def test_threshold_is_configurable(notes_data, tmp_path):
    res = fit(notes_data / "config.json", notes_data / "quotes.csv", tmp_path, threshold=0.0)
    assert not res.classification.stop["global_stop"]
    # other (local) reasons for abstaining may remain, but not the global stop
    assert not any("全体の再現率" in r.evidence for r in res.classification.rows)


def test_extension_adds_a_term_without_touching_the_core(notes_data, tmp_path):
    before = core_hash()
    res = fit(notes_data / "config.json", notes_data / "quotes.csv", tmp_path, extensions=notes_data / "ext")
    assert core_hash() == before
    assert res.summary["exact"] == res.summary["n"]
    terms = {t.feature.full_expr: t.table[""][0] for t in res.program.terms if t.key is None}
    assert terms.get("note_len") == 40
    assert terms.get("qty") == 3
    used = [e["file"] for e in res.program.meta["extensions"]]
    assert used == ["10_textlen.py", "20_features.json"]
    assert res.program.meta["core_sha256"] == before["_combined"]


def test_extension_functions_are_removed_after_the_run(notes_data, tmp_path):
    from estimate_archaeology import expr as ex

    fit(notes_data / "config.json", notes_data / "quotes.csv", tmp_path, extensions=notes_data / "ext")
    assert "strlen" not in ex.FUNCTIONS


def test_extension_dir_must_exist(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_extensions(tmp_path / "missing")
