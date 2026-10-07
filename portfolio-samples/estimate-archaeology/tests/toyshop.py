"""A tiny fictional shop with known rules, for end-to-end tests (fast: a few hundred quotes).

Rules (pre-tax net):
* flyer:  3,000 fixed + unit[paper] x quantity     (unit: 上質 2.0, コート 3.0)
          revised on 2024-04-01: 3,500 fixed, 上質 2.5, コート 3.5
* card:   1,200 fixed + 12 per card x quantity
* poster: 2,000 fixed + 120 per sheet; a sheet holds 4 (A3) / 2 (A2) / 1 (A1) posters,
          sheets = ceil(quantity / pieces per sheet)            (yield-based material)
* notes contain 「データ修正」: +2,000 (before the customer rate)
* customer rate: C x1.0, D x0.9 ; special customer C005 x0.85
* rounding: floor to 100 yen
* tax label: 税抜 / 税込 (floor) / blank
"""

from __future__ import annotations

import csv
import math
from datetime import date, timedelta
from pathlib import Path

import numpy as np

REV = date(2024, 4, 1)
PER_SHEET = {"A3": 4, "A2": 2, "A1": 1}
CONFIG = {
    "name": "toyshop",
    "columns": {
        "id": "quote_id",
        "date": "quote_date",
        "customer": "customer_code",
        "rep": "rep",
        "amount": "amount",
        "tax_label": "tax_label",
    },
    "segment": "product",
    "customer_class": "regex(customer_code, '^([A-Z]+)', 1, 'その他')",
    "revision_id_pattern": "-R\\d+$",
    "categorical": ["paper", "size"],
    "numeric": ["quantity"],
    "text": ["notes"],
    "search": {"time_budget_s": 60, "variants": [{}], "workers": 1},
}


def rate_of(c: str) -> float:
    if c == "C005":
        return 0.85
    return 0.9 if c.startswith("D") else 1.0


def net_of(r: dict, stale: bool = False, rate: float | None = None) -> int:
    v2 = r["_date"] >= REV and not stale
    q = r["quantity"]
    if r["product"] == "flyer":
        unit = {"上質": 2.5 if v2 else 2.0, "コート": 3.5 if v2 else 3.0}[r["paper"]]
        sub = (3500 if v2 else 3000) + unit * q
    elif r["product"] == "card":
        sub = 1200 + 12 * q
    else:
        sub = 2000 + 120 * math.ceil(q / PER_SHEET[r["size"]])
    if "データ修正" in r["notes"]:
        sub += 2000
    sub *= rate_of(r["customer_code"]) if rate is None else rate
    return math.floor(sub / 100 + 1e-9) * 100


def generate(n: int = 360, seed: int = 3) -> tuple[list[dict], dict[str, str]]:
    """Return (rows, labels): labels maps quote_id -> injected quirk (clean rows omitted)."""
    rng = np.random.default_rng(seed)
    custs = [f"C{i:03d}" for i in range(1, 16)] + [f"D{i:03d}" for i in range(1, 6)]
    start = date(2023, 4, 1)
    rows = []
    for _ in range(n):
        d = start + timedelta(days=int(rng.integers(0, 730)))
        u = rng.random()
        product = "flyer" if u < 0.5 else ("card" if u < 0.75 else "poster")
        qty = {
            "flyer": [500, 1000, 2000, 3000, 5000],
            "card": [100, 200, 300],
            "poster": [5, 10, 15, 25, 30, 50, 75],
        }[product]
        r = {
            "_date": d,
            "product": product,
            "paper": {"flyer": str(rng.choice(["上質", "コート"])), "card": "ケント", "poster": "コート"}[product],
            "size": {"flyer": "A4", "card": "名刺", "poster": str(rng.choice(list(PER_SHEET)))}[product],
            "quantity": int(rng.choice(qty)),
            "customer_code": str(rng.choice(custs)),
            "rep": str(rng.choice(["担当A", "担当B", "担当C"])),
            "notes": str(rng.choice(["", "", "", "データ修正あり", "前回同様"])),
        }
        rows.append(r)
    rows.sort(key=lambda r: r["_date"])
    out, labels = [], {}
    for i, r in enumerate(rows):
        qid = f"T{i + 1:04d}"
        net = net_of(r)
        # injected quirks at fixed positions (deterministic)
        if i % 37 == 5 and r["_date"] >= REV + timedelta(days=30) and r["product"] == "flyer":
            new = net_of(r, stale=True)
            if new != net:
                net, labels[qid] = new, "stale_table"
        elif i % 53 == 7:
            new = (net // 1000) * 1000 - 1000
            if 0 < new < net:
                net, labels[qid] = new, "undocumented_discount"
        written = net
        t = i % 5
        if t in (0, 1):
            label, written = "税抜", net
        elif t in (2, 3):
            label, written = "税込", math.floor(net * 11 / 10)
        else:
            label = ""
        if i % 61 == 11 and qid not in labels:
            s = str(written)
            s2 = s[0] + s[2] + s[1] + s[3:]
            if s2 != s:
                written, labels[qid] = int(s2), "typo"
        out.append(
            {
                "quote_id": qid,
                "quote_date": r["_date"].isoformat(),
                "customer_code": r["customer_code"],
                "rep": r["rep"],
                "product": r["product"],
                "paper": r["paper"],
                "size": r["size"],
                "quantity": str(r["quantity"]),
                "notes": r["notes"],
                "amount": f"{written:,}" if i % 3 else f"¥{written:,}",
                "tax_label": label,
            }
        )
    return out, labels


def write_csv(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
