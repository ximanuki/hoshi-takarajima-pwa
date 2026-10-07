"""Exact-stage repairs on the toy shop: each one starts from a damaged copy of the fitted
rules and must restore what the damage broke, judged only by exact-yen matches."""

import numpy as np

from estimate_archaeology import exact as ex_
from estimate_archaeology.program import EvalCache, FeatureSpec, KeySpec, Program


def compiled(res, prog):
    return ex_.Compiled.build(prog, res.dataset, EvalCache(res.dataset), prog.tax_rounding)


def test_mine_terms_restores_a_missing_surcharge(toy_fit):
    res, _, _ = toy_fit
    full = compiled(res, res.program.copy()).count()
    damaged = res.program.copy()
    damaged.terms = [t for t in damaged.terms if not (t.segment == "card" and t.key is not None)]
    c = compiled(res, damaged)
    assert c.count() < full
    flag = res.program.flags[0]
    ex_.mine_terms(c, [KeySpec((flag.name,))], [FeatureSpec("1"), FeatureSpec("quantity")], [flag], min_rows=3)
    c.write_back()
    assert c.count() == full
    mined = [t for t in damaged.terms if t.segment == "card" and t.key is not None]
    assert len(mined) == 1 and mined[0].table["1"] == [2000.0] and mined[0].feature.is_const


def test_mine_factors_restores_a_customer_rate(toy_fit):
    res, _, _ = toy_fit
    full = compiled(res, res.program.copy()).count()
    damaged = res.program.copy()
    damaged.multipliers = []
    c = compiled(res, damaged)
    assert c.count() < full
    ex_.mine_factors(c, [KeySpec(("_customer_class",))], [])
    m = next(m for m in damaged.multipliers if m.key.columns == ("_customer_class",))
    assert m.table["D"] == 0.9


def test_refine_thresholds_moves_a_cut_to_the_exact_one():
    """price = 1,000 + 500 if size >= 30 (the search guessed >= 20)."""
    from estimate_archaeology.config import config_from_dict
    from estimate_archaeology.dataset import build_dataset
    from estimate_archaeology.program import FlagSpec, Term

    sizes = [10, 20, 30, 40] * 10
    rows = [
        {"id": f"Q{i}", "date": "2024-05-01", "size": str(s), "amount": str(1000 + (500 if s >= 30 else 0))}
        for i, s in enumerate(sizes)
    ]
    cfg = config_from_dict({"columns": {"id": "id", "date": "date", "amount": "amount"}, "numeric": ["size"]})
    ds = build_dataset(["id", "date", "size", "amount"], rows, cfg)
    wrong = FlagSpec("size>=20", "threshold", ("size",), threshold=20.0)
    prog = Program(
        terms=[
            Term("all:1", FeatureSpec("1"), None, {"": [1000.0]}, segment="all"),
            Term(
                "all:1[size>=20]",
                FeatureSpec("1"),
                KeySpec(("size>=20",)),
                {"1": [500.0], "0": [0.0], "": [0.0]},
                segment="all",
            ),
        ],
        flags=[wrong],
    )
    c = ex_.Compiled.build(prog, ds, EvalCache(ds))
    assert c.count() == 30  # the size-20 quotes get the surcharge by mistake
    ex_.refine_thresholds(c)
    c.write_back()
    assert c.count() == 40
    assert prog.terms[1].key.columns == ("size>=30",)


def test_transplant_takes_the_better_segment(toy_fit):
    res, _, _ = toy_fit
    good = res.program.copy()
    bad = res.program.copy()
    for t in bad.terms:
        if t.segment == "poster" and not t.feature.is_const:
            t.table = {k: [v[0] * 1.1 for v in [vals]] for k, vals in t.table.items()}
    c_bad = compiled(res, bad)
    combined, taken = ex_.transplant_segments(bad, [good], res.dataset)
    c_comb = compiled(res, combined)
    assert taken == [(0, "poster")]
    assert c_comb.count() > c_bad.count()
    hits = c_comb.match_all()
    assert np.array_equal(hits, compiled(res, good).match_all())
