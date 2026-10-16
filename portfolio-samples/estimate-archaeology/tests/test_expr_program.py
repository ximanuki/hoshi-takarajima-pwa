import json

import numpy as np
import pytest

from estimate_archaeology import expr as ex
from estimate_archaeology.config import config_from_dict
from estimate_archaeology.dataset import build_dataset
from estimate_archaeology.program import (
    FeatureSpec,
    FlagSpec,
    KeySpec,
    MinCharge,
    Multiplier,
    Program,
    Rounding,
    Term,
    bin_label,
    explain_row,
    matches,
    predict,
)


def env_of(**cols):
    n = len(next(iter(cols.values())))
    return {k: np.array(v, dtype=object) for k, v in cols.items()}, n


def test_expressions():
    env, n = env_of(
        q=["100", "250", ""], colors=["4/0", "4/4", "1/1"], d0=["2024-04-01"] * 3, d1=["2024-04-04", "", "2024-04-11"]
    )
    assert list(ex.evaluate("q * 2", env, n)[:2]) == [200, 500]
    assert np.isnan(ex.evaluate("q * 2", env, n)[2])
    assert list(ex.evaluate("ceil(q, 100)", env, n)[:2]) == [100, 300]
    plates = ex.evaluate("num(split(colors, '/', 0)) + num(split(colors, '/', 1))", env, n)
    assert list(plates) == [4, 8, 2]
    lead = ex.evaluate("days_between(d0, d1)", env, n)
    assert lead[0] == 3 and np.isnan(lead[1]) and lead[2] == 10
    lab = ex.evaluate("if_(q == '100', 'small', 'other')", env, n)
    assert list(lab) == ["small", "other", "other"]
    town = ex.evaluate(r"regex(colors, '^(\d)', 1, '-')", env, n)
    assert list(town) == ["4", "4", "1"]


@pytest.mark.parametrize("bad", ["__import__('os')", "q.real", "q[0]", "(lambda: 1)()", "open('x')"])
def test_expressions_are_sandboxed(bad):
    env, n = env_of(q=["1"])
    with pytest.raises(ex.ExprError):
        ex.evaluate(bad, env, n)


def test_bin_label():
    assert bin_label(50, (100.0, 200.0)) == "~100"
    assert bin_label(150, (100.0, 200.0)) == "100~200"
    assert bin_label(200, (100.0, 200.0)) == "200~"


def small_dataset():
    cfg = config_from_dict(
        {
            "name": "t",
            "columns": {"id": "id", "date": "date", "customer": "cust", "amount": "amount", "tax_label": "tax"},
            "segment": "product",
            "customer_class": "regex(cust, '^([A-Z])', 1, '')",
        }
    )
    header = ["id", "date", "cust", "product", "paper", "qty", "notes", "amount", "tax"]
    rows = [
        # flyer, before the revision: 3000 + 2.0 * 1000 = 5000
        dict(
            id="1",
            date="2024-03-01",
            cust="C1",
            product="flyer",
            paper="上質",
            qty="1000",
            notes="",
            amount="5,000",
            tax="税抜",
        ),
        # flyer, after: 3500 + 2.5 * 1000 = 6000, D x0.9 = 5400 -> tax incl 5940
        dict(
            id="2",
            date="2024-05-01",
            cust="D1",
            product="flyer",
            paper="上質",
            qty="1000",
            notes="",
            amount="5,940",
            tax="税込",
        ),
        # keyword surcharge +2000: 3500 + 3.5 * 1000 + 2000 = 9000
        dict(
            id="3",
            date="2024-05-02",
            cust="C2",
            product="flyer",
            paper="コート",
            qty="1000",
            notes="データ修正",
            amount="9000",
            tax="",
        ),
        # envelope: packs of 500 -> ceil(600/500)*500 = 1000 * 5 = 5000 ; minimum 6000 applies
        dict(
            id="4",
            date="2024-05-03",
            cust="C1",
            product="envelope",
            paper="",
            qty="600",
            notes="",
            amount="6,000",
            tax="税抜",
        ),
        # envelope 1600 -> 2000 * 5 = 10000 -> x0.9 = 9000
        dict(
            id="5",
            date="2024-05-03",
            cust="D2",
            product="envelope",
            paper="",
            qty="1600",
            notes="",
            amount="9,000",
            tax="税抜",
        ),
        # rounding: 3500 + 2.5 * 333 = 4332.5 -> floor 100 -> 4300
        dict(
            id="6",
            date="2024-05-04",
            cust="C1",
            product="flyer",
            paper="上質",
            qty="333",
            notes="",
            amount="4,300",
            tax="税抜",
        ),
    ]
    return build_dataset(header, rows, cfg)


def hand_program() -> Program:
    kw = FlagSpec("kw:notes:データ修正", "keyword", ("notes",), pattern="データ修正")
    return Program(
        terms=[
            Term("flyer:fixed", FeatureSpec("1"), None, {"": [3000, 3500]}, versions=["2024-04-01"], segment="flyer"),
            Term(
                "flyer:paper",
                FeatureSpec("qty"),
                KeySpec(("paper",)),
                {"上質": [2.0, 2.5], "コート": [3.0, 3.5]},
                versions=["2024-04-01"],
                segment="flyer",
            ),
            Term("flyer:kw", FeatureSpec("1"), KeySpec((kw.name,)), {"0": [0], "1": [2000], "": [0]}, segment="flyer"),
            Term("envelope:pack", FeatureSpec("qty", ceil_step=500), None, {"": [5]}, segment="envelope"),
        ],
        multipliers=[
            Multiplier("m:customer", KeySpec(("_customer",)), {}, KeySpec(("_customer_class",)), {"C": 1.0, "D": 0.9}),
        ],
        flags=[kw],
        min_charge={"envelope": MinCharge(6000, "post")},
        rounding=Rounding(100, "floor"),
    )


def test_evaluator_reproduces_hand_written_rules():
    ds = small_dataset()
    prog = hand_program()
    pred = predict(prog, ds)
    assert list(pred) == [5000, 5400, 9000, 6000, 9000, 4300]
    assert matches(pred, ds).all()
    assert "→" in explain_row(prog, ds, 2)


def test_program_json_roundtrip():
    prog = hand_program()
    again = Program.from_json(json.loads(prog.dumps()))
    assert again.to_json() == prog.to_json()
    ds = small_dataset()
    assert list(predict(again, ds)) == list(predict(prog, ds))


def test_unknown_level_is_not_priced():
    ds = small_dataset()
    prog = hand_program()
    del prog.terms[1].table["コート"]
    pred = predict(prog, ds)
    assert pred[2] == -1  # needs a parameter the program does not have
    assert pred[0] == 5000
