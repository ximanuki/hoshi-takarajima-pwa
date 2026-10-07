from estimate_archaeology.exact import coarsen_keys, dedupe_versions, per_pack_form
from estimate_archaeology.program import FeatureSpec, KeySpec, Program, Term
from estimate_archaeology.report import feature_ja, numeric_tiers


def test_numeric_tiers_merge_equal_prices():
    t = Term(
        "x",
        FeatureSpec("qty"),
        KeySpec(("height_mm",)),
        {"50": [1800], "80": [1800], "100": [1800], "150": [3200], "200": [3200], "300": [5200]},
    )
    assert numeric_tiers(t, {}) == [
        ("50〜100（50, 80, 100）", [1800]),
        ("150〜200（150, 200）", [3200]),
        ("300", [5200]),
    ]


def test_numeric_tiers_not_for_text_keys():
    t = Term("x", FeatureSpec("qty"), KeySpec(("paper",)), {"上質": [2], "コート": [3], "マット": [3]})
    assert numeric_tiers(t, {}) is None


def test_per_pack_form_keeps_times():
    # 15 yen per card, cards rounded up to boxes of 100, per person: shown as 1,500 per box
    t = Term("s:cards", FeatureSpec("quantity", ceil_step=100, times="kinds"), None, {"": [15.0]}, segment="s")
    prog = Program(terms=[t])
    per_pack_form(prog)
    fs = prog.terms[0].feature
    assert fs.per_pack and fs.times == "kinds" and fs.ceil_step == 100
    assert prog.terms[0].table[""] == [1500]


def test_dedupe_versions_drops_empty_version():
    t = Term("s:1", FeatureSpec("1"), None, {"": [3000, 0, 3500]}, versions=["2024-04-01", "2024-04-01"])
    prog = Program(terms=[t])
    dedupe_versions(prog)
    assert t.versions == ["2024-04-01"]
    assert t.table[""] == [3000, 3500]


def test_coarsen_keys():
    t = Term(
        "s:qty[size,paper]",
        FeatureSpec("qty"),
        KeySpec(("size", "paper")),
        {"A4|上質": [2], "A3|上質": [2], "A4|コート": [3], "A3|コート": [3]},
    )
    single = Term("s:qty[size]", FeatureSpec("qty"), KeySpec(("size",)), {"A4": [120], "A3": [120]})
    prog = Program(terms=[t, single])
    coarsen_keys(prog)
    assert t.key.columns == ("paper",) and t.table == {"上質": [2], "コート": [3]}
    assert t.id == "s:qty[paper]"
    assert single.key is None and single.table == {"": [120]}


def test_feature_ja_for_yield():
    fs = FeatureSpec("quantity", step_by="size", steps=(("A2", 2.0), ("A3", 4.0)), per_pack=True)
    text = feature_ja(fs)
    assert "size ごとの入り数" in text and "A3: 4" in text
