"""Development data: a fictional print shop with known pricing rules and labelled quirks.

This generator is written by the solver side for development only. Its rules are
invented here and are NOT derived from any blind dataset. Truth labels go to
``truth.csv`` next to ``quotes.csv``.

Hidden rules (pre-tax net, before rounding)
-------------------------------------------
* table revision on 2024-04-01 (v1 -> v2); delivery fee revision on 2025-01-01
* setup per kind:      flyer 4,000 -> 4,500 | leaflet 5,000 -> 5,500 | booklet 12,000 -> 13,000
                       card 1,000 | envelope 3,000 -> 3,300
* per piece (× quantity × kinds), by (size, paper) -- see ``UNIT``; v2 = v1 × 1.2 (paper up)
* colour adder per piece: 4/4 +1.5 (v2 +1.8), 1/1 +0.5, others 0 (flyers/leaflets)
* leaflet folding: +0.8 per piece
* booklet: per page per copy (pages × quantity) 1.8 (4/4) / 0.9 (1/1); binding 30 per copy;
  OUT OF GRAMMAR: thick booklets (40 pages or more) add 2 × ceil(pages / 16) per copy
* card: box of 100 -> price per card = box price / 100 (quantity is a multiple of 100)
* envelope: bought in packs of 500 -> ceil(quantity / 500) × 500 × unit
* finishing keyword "PP" +3.0 per piece; "穴あけ" +3,000 fixed
* notes keyword "データ修正" +3,000 ; "色校正" +5,000
* rush: due date set and (due − quote) <= 3 days -> × 1.3 on the subtotal
* customer rate by class: C 1.00, D 0.85, G 0.90, K 1.00, 一般 1.00;
  specials C017 0.95, C023 0.92, D005 0.80
* delivery fee after the customer rate: 引取 0, 市内 800, 市外 1,500, 県外 3,000 (3,500 from 2025-01-01)
* minimum charge 3,000 on the final subtotal
* rounding: floor to 100 yen; rep 佐藤 floors to 10 yen
* OUT OF GRAMMAR: flyers quoted on day 28 or later of a month get 3 % off (before rounding)

``--heavy`` makes the out-of-grammar part large on purpose (campaign from day 15, every
booklet thick) to exercise the stop mechanism ("rules insufficient").

Quirks (labelled): stale_table, copied_rate, undocumented_discount, typo,
unrecorded_surcharge, rounding_inconsistency, revision_or_duplicate, unexplained.
"""

from __future__ import annotations

import argparse
import csv
import math
from datetime import date, timedelta
from pathlib import Path

import numpy as np

REV1 = date(2024, 4, 1)
REV_DELIVERY = date(2025, 1, 1)

PRODUCTS = {
    "チラシ": {
        "sizes": ["A4", "B4", "A3", "B5"],
        "papers": ["コート90kg", "マットコート110kg", "上質70kg", "コート135kg"],
    },
    "リーフレット": {"sizes": ["A4", "A3"], "papers": ["コート90kg", "マットコート110kg", "コート135kg"]},
    "冊子": {"sizes": ["A4", "A5", "B5"], "papers": ["上質70kg", "マットコート110kg"]},
    "名刺": {"sizes": ["91x55"], "papers": ["ケント220kg", "マット220kg"]},
    "封筒": {"sizes": ["長3", "角2"], "papers": ["クラフト85g", "ケント100g"]},
}
SETUP = {
    "チラシ": (4000, 4500),
    "リーフレット": (5000, 5500),
    "冊子": (12000, 13000),
    "名刺": (1000, 1000),
    "封筒": (3000, 3300),
}
UNIT = {  # yen per piece, v1
    ("A4", "コート90kg"): 2.5,
    ("A4", "マットコート110kg"): 3.0,
    ("A4", "上質70kg"): 2.0,
    ("A4", "コート135kg"): 3.5,
    ("B4", "コート90kg"): 3.5,
    ("B4", "マットコート110kg"): 4.0,
    ("B4", "上質70kg"): 3.0,
    ("B4", "コート135kg"): 4.5,
    ("A3", "コート90kg"): 4.5,
    ("A3", "マットコート110kg"): 5.0,
    ("A3", "上質70kg"): 4.0,
    ("A3", "コート135kg"): 5.5,
    ("B5", "コート90kg"): 2.0,
    ("B5", "マットコート110kg"): 2.5,
    ("B5", "上質70kg"): 1.5,
    ("B5", "コート135kg"): 3.0,
    ("91x55", "ケント220kg"): 12.0,
    ("91x55", "マット220kg"): 15.0,
    ("長3", "クラフト85g"): 5.0,
    ("長3", "ケント100g"): 7.0,
    ("角2", "クラフト85g"): 9.0,
    ("角2", "ケント100g"): 12.0,
}
CLASS_RATE = {"C": 1.0, "D": 0.85, "G": 0.90, "K": 1.0, "一般": 1.0}
SPECIAL = {"C017": 0.95, "C023": 0.92, "D005": 0.80}
DELIVERY = {"引取": 0, "市内": 800, "市外": 1500, "県外": 3000}
REPS = ["佐藤", "鈴木", "高橋", "田中"]


def customers() -> list[str]:
    out = [f"C{i:03d}" for i in range(1, 41)]
    out += [f"D{i:03d}" for i in range(1, 11)]
    out += [f"G{i:03d}" for i in range(1, 9)]
    out += [f"K{i:03d}" for i in range(1, 21)]
    return out


def cls_of(c: str) -> str:
    return "一般" if c == "一般" else c[0]


def rate_of(c: str) -> float:
    return SPECIAL.get(c, CLASS_RATE[cls_of(c)])


def unit_price(size: str, paper: str, d: date, stale: bool) -> float:
    u = UNIT[(size, paper)]
    if d >= REV1 and not stale:
        u = round(u * 1.2, 2)
    return u


def color_add(colors: str, d: date, stale: bool) -> float:
    if colors == "4/4":
        return 1.8 if (d >= REV1 and not stale) else 1.5
    if colors == "1/1":
        return 0.5
    return 0.0


HEAVY = False


def campaign_day() -> int:
    return 15 if HEAVY else 28


def thick(pages: int) -> bool:
    return HEAVY or pages >= 40


def base_net(r: dict, stale: bool = False, rate: float | None = None, campaign: bool = True) -> tuple[float, float]:
    """Return (subtotal before delivery and min charge, delivery fee)."""
    d = r["_date"]
    v2 = d >= REV1 and not stale
    p = r["product"]
    k = r["kinds"]
    q = r["quantity"]
    tq = q * k
    sub = SETUP[p][1 if v2 else 0] * k
    if p in ("チラシ", "リーフレット"):
        sub += (unit_price(r["size"], r["paper"], d, stale) + color_add(r["colors"], d, stale)) * tq
        if p == "リーフレット":
            sub += 0.8 * tq
    elif p == "冊子":
        per_page = 1.8 if r["colors"] == "4/4" else 0.9
        sub += per_page * r["pages"] * tq + 30 * tq
        if thick(r["pages"]):
            sub += 2 * math.ceil(r["pages"] / 16) * tq
    elif p == "名刺":
        sub += unit_price(r["size"], r["paper"], d, stale) * tq
    elif p == "封筒":
        sub += unit_price(r["size"], r["paper"], d, stale) * math.ceil(q / 500) * 500
    if "PP" in r["finishing"]:
        sub += 3.0 * tq
    if "穴あけ" in r["finishing"]:
        sub += 3000
    if "データ修正" in r["notes"]:
        sub += 3000
    if "色校正" in r["notes"]:
        sub += 5000
    if r["_rush"]:
        sub *= 1.3
    sub *= rate_of(r["customer_code"]) if rate is None else rate
    if campaign and p == "チラシ" and d.day >= campaign_day():
        sub *= 0.97
    fee = DELIVERY[r["delivery"]]
    if r["delivery"] == "県外" and d >= REV_DELIVERY:
        fee = 3500
    return sub, fee


def finish_net(sub: float, fee: float, unit: int, mode: str = "floor") -> int:
    s = max(sub + fee, 3000)
    q = s / unit
    if mode == "floor":
        return math.floor(q + 1e-7) * unit
    if mode == "round":
        return math.floor(q + 0.5 + 1e-7) * unit
    return math.ceil(q - 1e-7) * unit


def rep_unit(rep: str) -> int:
    return 10 if rep == "佐藤" else 100


def generate(seed: int = 7, n: int = 2400) -> tuple[list[dict], list[dict]]:
    rng = np.random.default_rng(seed)
    cust = customers()
    start = date(2022, 10, 1)
    span = (date(2025, 9, 30) - start).days
    rows: list[dict] = []
    for _ in range(n):
        d = start + timedelta(days=int(rng.integers(0, span + 1)))
        p = str(rng.choice(list(PRODUCTS), p=[0.38, 0.14, 0.14, 0.2, 0.14]))
        spec = PRODUCTS[p]
        size = str(rng.choice(spec["sizes"]))
        paper = str(rng.choice(spec["papers"]))
        if p == "冊子":
            colors = str(rng.choice(["4/4", "1/1"], p=[0.6, 0.4]))
            pages = int(rng.choice([8, 12, 16, 20, 24, 32, 40, 48]))
            q = int(rng.choice([50, 100, 200, 300, 500, 1000]))
            k = 1
        elif p == "名刺":
            colors = str(rng.choice(["4/0", "4/4", "1/0", "1/1"]))
            pages = None
            q = int(rng.choice([100, 200, 300, 500]))
            k = int(rng.choice([1, 1, 1, 2, 3, 5, 8]))
        elif p == "封筒":
            colors = str(rng.choice(["1/0", "2/0"]))
            pages = None
            q = int(rng.choice([300, 500, 1000, 1500, 2000, 3000]))
            k = 1
        else:
            colors = str(rng.choice(["4/0", "4/4", "1/0", "1/1"], p=[0.4, 0.35, 0.15, 0.1]))
            pages = None
            q = int(rng.choice([500, 1000, 2000, 3000, 5000, 10000]))
            k = int(rng.choice([1, 1, 1, 1, 2, 3]))
        fin_opts = ["", "", "", "PP加工(片面)", "PP片面", "穴あけ"] if p in ("チラシ", "リーフレット") else [""]
        finishing = str(rng.choice(fin_opts))
        r = rng.random()
        if r < 0.55:
            c = str(rng.choice(cust))
        else:
            c = "一般" if r < 0.75 else str(rng.choice(cust[:12]))
        rep = str(rng.choice(REPS))
        delivery = str(rng.choice(list(DELIVERY), p=[0.35, 0.35, 0.2, 0.1]))
        due = None
        lead = None
        if rng.random() < 0.7:
            lead = int(rng.choice([2, 3, 3, 5, 7, 7, 10, 14, 14, 21]))
            due = d + timedelta(days=lead)
        rush = lead is not None and lead <= 3
        notes_opts = ["", "", "", "", "前回同様", "データ入稿済", "データ修正あり", "色校正1回", "納品書同封"]
        notes = str(rng.choice(notes_opts))
        if rush and rng.random() < 0.5:
            notes = (notes + " 特急").strip()
        rows.append(
            {
                "_date": d,
                "_rush": rush,
                "customer_code": c,
                "rep": rep,
                "product": p,
                "size": size,
                "paper": paper,
                "colors": colors,
                "pages": pages,
                "finishing": finishing,
                "quantity": q,
                "kinds": k,
                "delivery": delivery,
                "due_date": due,
                "notes": notes,
            }
        )
    rows.sort(key=lambda r: r["_date"])
    out_rows: list[dict] = []
    truth: list[dict] = []
    other_rates = sorted(set(CLASS_RATE.values()) | set(SPECIAL.values()))
    for seq, r in enumerate(rows, start=1):
        d = r["_date"]
        qid = f"P{d:%y%m}-{seq:04d}"
        label = "clean"
        unit = rep_unit(r["rep"])
        stale = d >= REV1 and d < date(2025, 6, 1) and rng.random() < 0.06
        sub, fee = base_net(r, stale=stale)
        mode = "floor"
        if stale:
            label = "stale_table"
        u = rng.random()
        if label == "clean" and u < 0.006:
            alt = [x for x in other_rates if abs(x - rate_of(r["customer_code"])) > 1e-9]
            sub, fee = base_net(r, rate=float(rng.choice(alt)))
            label = "copied_rate"
        elif label == "clean" and u < 0.03:
            mode = "round"
            if finish_net(sub, fee, unit, "round") != finish_net(sub, fee, unit, "floor"):
                label = "rounding_inconsistency"
        net = finish_net(sub, fee, unit, mode)
        u = rng.random()
        if label == "clean" and u < 0.012:
            new = (net // 1000) * 1000 - (1000 if net % 1000 == 0 else 0)
            if rng.random() < 0.5:
                new = int(math.floor(net * 0.95 / 100) * 100)
            if new != net and new > 0:
                net = new
                label = "undocumented_discount"
        elif label == "clean" and u < 0.022:
            r2 = dict(r)
            r2["_rush"] = True
            s2, f2 = base_net(r2)
            new = finish_net(s2, f2, unit)
            if new != net and not r["_rush"]:
                net = new
                label = "unrecorded_surcharge"
        elif label == "clean" and u < 0.025:
            net = int(round(net * float(rng.uniform(0.9, 1.1)) / 10) * 10)
            label = "unexplained"
        oog = (r["product"] == "冊子" and thick(r["pages"])) or (r["product"] == "チラシ" and d.day >= campaign_day())
        # tax presentation
        t = rng.random()
        rate = 0.10
        if t < 0.5:
            tax_label, shown, tax_amt = "税抜", net, (math.floor(net * rate) if rng.random() < 0.4 else None)
        elif t < 0.8:
            gross = math.floor(net * (1 + rate))
            tax_label, shown = str(rng.choice(["税込", "税込み", "内税"])), gross
            tax_amt = gross - net if rng.random() < 0.4 else None
        else:
            if rng.random() < 0.5:
                tax_label, shown, tax_amt = "", net, None
            else:
                tax_label, shown, tax_amt = "", math.floor(net * (1 + rate)), None
        written = shown
        if label == "clean" and rng.random() < 0.004:
            s = str(shown)
            if len(s) >= 4:
                j = int(rng.integers(0, len(s) - 3))
                s2 = s[:j] + s[j + 1] + s[j] + s[j + 2 :]
                if s2 != s:
                    written = int(s2)
                    label = "typo"
        fmt = rng.random()
        if fmt < 0.6:
            amount = f"{written:,}"
        elif fmt < 0.75:
            amount = f"¥{written:,}"
        elif fmt < 0.9:
            amount = f"{written}円"
        else:
            amount = f"{written:,}".translate(str.maketrans("0123456789,", "０１２３４５６７８９，"))
        out = {
            "quote_id": qid,
            "quote_date": d.isoformat(),
            "customer_code": r["customer_code"],
            "rep": r["rep"],
            "product": r["product"],
            "size": r["size"],
            "paper": r["paper"],
            "colors": r["colors"],
            "pages": "" if r["pages"] is None else str(r["pages"]),
            "finishing": r["finishing"],
            "quantity": str(r["quantity"]),
            "kinds": str(r["kinds"]),
            "delivery": r["delivery"],
            "due_date": "" if r["due_date"] is None else r["due_date"].isoformat(),
            "notes": r["notes"],
            "amount": amount,
            "tax_label": tax_label,
            "tax_amount": "" if tax_amt is None else f"{tax_amt:,}",
        }
        out_rows.append(out)
        truth.append({"quote_id": qid, "label": label, "true_net": net, "out_of_grammar": int(oog)})
        # occasional re-issue a few days later
        if rng.random() < 0.015:
            d2 = d + timedelta(days=int(rng.integers(3, 20)))
            r2 = dict(out)
            r2["quote_id"] = qid + "-R2"
            r2["quote_date"] = d2.isoformat()
            if r["due_date"] is not None:  # the requested lead time is kept on re-issue
                r2["due_date"] = (r["due_date"] + (d2 - d)).isoformat()
            lab2 = "clean"
            if rng.random() < 0.6:
                # quantity changed on re-issue, but the amount was carried over from the original
                r2["quantity"] = str(int(r["quantity"]) * 2)
                lab2 = "revision_or_duplicate"
                net2 = net
            else:
                # a proper re-issue: same spec, priced again on the new date
                ri = dict(r)
                ri["_date"] = d2
                s2, f2 = base_net(ri)
                net2 = finish_net(s2, f2, unit)
                r2["amount"] = f"{net2:,}"
                r2["tax_label"] = "税抜"
                r2["tax_amount"] = ""
                oog = (r["product"] == "冊子" and thick(r["pages"])) or (
                    r["product"] == "チラシ" and d2.day >= campaign_day()
                )
            out_rows.append(r2)
            truth.append({"quote_id": r2["quote_id"], "label": lab2, "true_net": net2, "out_of_grammar": int(oog)})
    order = sorted(range(len(out_rows)), key=lambda i: (out_rows[i]["quote_date"], out_rows[i]["quote_id"]))
    return [out_rows[i] for i in order], [truth[i] for i in order]


def write(out_dir: Path, seed: int, n: int, heavy: bool = False) -> None:
    global HEAVY
    HEAVY = heavy
    rows, truth = generate(seed, n)
    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / "quotes.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    with (out_dir / "truth.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(truth[0]), lineterminator="\n")
        w.writeheader()
        w.writerows(truth)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).parent / "print"))
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("-n", type=int, default=2400)
    ap.add_argument("--heavy", action="store_true", help="large out-of-grammar share (tests the stop rule)")
    a = ap.parse_args()
    write(Path(a.out), a.seed, a.n, a.heavy)


if __name__ == "__main__":
    main()
