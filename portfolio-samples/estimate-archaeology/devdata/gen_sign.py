"""Development data: a fictional sign shop with known pricing rules and labelled quirks.

Written by the solver side for development only; the rules are invented here and are NOT
derived from any blind dataset. Truth labels go to ``truth.csv``. Town names are fictional.

Hidden rules (pre-tax net)
--------------------------
* revision on 2024-10-01 (aluminium panel rates and the installation base fee)
* アルミ複合板看板: per sheet, billable area = ceil(w×h / 0.1 m²) × 0.1 m²
      area × rate[thickness, sides]   3 mm: 12,000 / m² (両面 21,600) -> 13,500 (両面 24,300)
                                      4 mm: 15,000 / m² (両面 27,000) -> 16,500 (両面 29,700)
      laminate グロス/マット: +2,000 / m² ; cutting 2,000 per sheet
      OUT OF GRAMMAR: sheets wider than 2,400 mm add a joint fee of 3,000 per sheet
* カルプ文字: per character by character-height tier (≤100: 1,800 | ≤200: 3,200 | ≤300: 5,200 |
      ≤500: 8,500 | >500: 13,000); thickness 20 mm +500, 30 mm +1,200 per character;
      finish 塗装 +1,000 per character
* インクジェット出力: per piece max(area, 0.5 m²) × media rate (ターポリン 3,500, 塩ビシート 4,000,
      合成紙 2,500, メッシュ 4,500) ; laminate +1,500 / m² of the same billable area
      (PARTLY OUT OF GRAMMAR when qty > 1: the minimum applies per piece)
* 袖看板: per unit 45,000 (area < 0.5 m²) / 68,000 (< 1.0 m²) / 95,000; LED内照 +35,000;
      両面 +20,000
* design: 支給 0 | 修正 5,000 | 新規 25,000 -- added after the customer rate
* installation (施工 有): 20,000 (22,000 from 2024-10-01) + 8,000 per piece (per character
      for カルプ文字: 800) ; mounting height >= 4 m: +35,000 (aerial work platform);
      travel by town: 北原市 0 | 南川市 5,000 | 東山町 5,000 | 西浜町 15,000 | 中島村 15,000
* remarks: 「夜間作業」 +15,000 ; 「既存撤去」 +12,000 ; 「急ぎ」 × 1.2 on the subtotal
* customer rate: 9999 (諸口) × 1.1 ; accounts 1.0 except 1003 0.9, 1007 0.9, 1012 0.95
* minimum 5,000 ; rounding: floor to 100 yen; rep 山本 floors to 1,000 yen
"""

from __future__ import annotations

import argparse
import csv
import math
from datetime import date, timedelta
from pathlib import Path

import numpy as np

REV = date(2024, 10, 1)
ITEMS = ["アルミ複合板看板", "カルプ文字", "インクジェット出力", "袖看板"]
UNIT_OF = {"アルミ複合板看板": "枚", "カルプ文字": "文字", "インクジェット出力": "枚", "袖看板": "台"}
TOWNS = {"北原市": 0, "南川市": 5000, "東山町": 5000, "西浜町": 15000, "中島村": 15000}
MEDIA = {"ターポリン": 3500, "塩ビシート": 4000, "合成紙": 2500, "メッシュ": 4500}
SPECIAL = {"1003": 0.9, "1007": 0.9, "1012": 0.95}
REPS = ["山本", "中村", "小林", "加藤"]


def rate_of(c: str) -> float:
    if c == "9999":
        return 1.1
    return SPECIAL.get(c, 1.0)


def alu_rate(th: int, sides: str, d: date, stale: bool) -> int:
    v2 = d >= REV and not stale
    base = {3: 13500 if v2 else 12000, 4: 16500 if v2 else 15000}[th]
    return int(base * 1.8) if sides == "両面" else base


def char_price(h: int) -> int:
    for lim, p in ((100, 1800), (200, 3200), (300, 5200), (500, 8500)):
        if h <= lim:
            return p
    return 13000


def compute(r: dict, stale: bool = False, rate: float | None = None) -> tuple[float, float]:
    """(subtotal subject to the customer rate, amount added after it)."""
    d = r["_date"]
    item = r["item"]
    q = r["qty"]
    sub = 0.0
    if item == "アルミ複合板看板":
        area = math.ceil(r["width_mm"] * r["height_mm"] / 1e5 - 1e-9) / 10
        per = area * alu_rate(r["thickness_mm"], r["sides"], d, stale) + 2000
        if r["laminate"] in ("グロス", "マット"):
            per += 2000 * area
        if r["width_mm"] > 2400:
            per += 3000
        sub += per * q
    elif item == "カルプ文字":
        per = char_price(r["height_mm"]) + {10: 0, 20: 500, 30: 1200}[r["thickness_mm"]]
        if r["finish"] == "塗装":
            per += 1000
        sub += per * q
    elif item == "インクジェット出力":
        area = max(r["width_mm"] * r["height_mm"] / 1e6, 0.5)
        per = area * MEDIA[r["media"]]
        if r["laminate"] in ("グロス", "マット"):
            per += 1500 * area
        sub += per * q
    else:
        area = r["width_mm"] * r["height_mm"] / 1e6
        per = 45000 if area < 0.5 else 68000 if area < 1.0 else 95000
        if r["lighting"] == "LED内照":
            per += 35000
        if r["sides"] == "両面":
            per += 20000
        sub += per * q
    if r["install"] == "有":
        sub += (22000 if (d >= REV and not stale) else 20000) + (800 if item == "カルプ文字" else 8000) * q
        if r["install_height_m"] >= 4.0:
            sub += 35000
        sub += TOWNS[r["_town"]]
    if "夜間作業" in r["remarks"]:
        sub += 15000
    if "既存撤去" in r["remarks"]:
        sub += 12000
    if r["_rush"]:
        sub *= 1.2
    sub *= rate_of(r["customer_code"]) if rate is None else rate
    after = {"支給": 0, "修正": 5000, "新規": 25000}[r["design"]]
    return sub, after


def finish(sub: float, after: float, unit: int, mode: str = "floor") -> int:
    s = max(sub + after, 5000)
    qv = s / unit
    if mode == "floor":
        return math.floor(qv + 1e-7) * unit
    if mode == "round":
        return math.floor(qv + 0.5 + 1e-7) * unit
    return math.ceil(qv - 1e-7) * unit


def unit_of_rep(rep: str) -> int:
    return 1000 if rep == "山本" else 100


def site_text(rng: np.random.Generator, town: str) -> str:
    n1, n2 = int(rng.integers(1, 9)), int(rng.integers(1, 30))
    style = rng.random()
    if style < 0.4:
        return f"{town}中央{n1}-{n2}"
    if style < 0.7:
        return f"{town} 本町{n1}丁目{n2}番"
    if style < 0.85:
        return f"{town}緑ヶ丘{n1}-{n2}-{int(rng.integers(1, 20))}"
    return f"{town}（現場：{['店舗', '倉庫', '事務所'][int(rng.integers(0, 3))]}）"


def generate(seed: int = 11, n: int = 2378) -> tuple[list[dict], list[dict]]:
    rng = np.random.default_rng(seed)
    start = date(2022, 4, 1)
    span = (date(2025, 9, 30) - start).days
    custs = [f"{1000 + i}" for i in range(1, 61)]
    base_rows = []
    for _ in range(n):
        d = start + timedelta(days=int(rng.integers(0, span + 1)))
        item = str(rng.choice(ITEMS, p=[0.35, 0.25, 0.28, 0.12]))
        r = {
            "_date": d,
            "item": item,
            "width_mm": None,
            "height_mm": None,
            "qty": 1,
            "thickness_mm": None,
            "sides": "",
            "media": "",
            "laminate": "",
            "finish": "",
            "lighting": "",
        }
        if item == "アルミ複合板看板":
            r["width_mm"] = int(rng.choice([450, 600, 900, 1200, 1800, 2400, 2700, 3000, 3600]))
            r["height_mm"] = int(rng.choice([300, 450, 600, 900, 1200, 1500, 1800]))
            r["qty"] = int(rng.choice([1, 1, 1, 2, 3, 4]))
            r["thickness_mm"] = int(rng.choice([3, 4], p=[0.7, 0.3]))
            r["sides"] = str(rng.choice(["片面", "両面"], p=[0.75, 0.25]))
            r["laminate"] = str(rng.choice(["なし", "グロス", "マット"], p=[0.5, 0.3, 0.2]))
        elif item == "カルプ文字":
            r["height_mm"] = int(rng.choice([50, 80, 100, 150, 200, 250, 300, 400, 500, 600, 800]))
            r["qty"] = int(rng.integers(2, 16))
            r["thickness_mm"] = int(rng.choice([10, 20, 30], p=[0.4, 0.4, 0.2]))
            r["finish"] = str(rng.choice(["シート貼り", "塗装"], p=[0.6, 0.4]))
        elif item == "インクジェット出力":
            r["width_mm"] = int(rng.choice([420, 594, 841, 900, 1200, 1800, 2700, 3600]))
            r["height_mm"] = int(rng.choice([297, 420, 594, 600, 900, 1200]))
            r["qty"] = int(rng.choice([1, 1, 1, 1, 2, 3, 5]))
            r["media"] = str(rng.choice(list(MEDIA)))
            r["laminate"] = str(rng.choice(["なし", "グロス", "マット"], p=[0.6, 0.25, 0.15]))
        else:
            r["width_mm"] = int(rng.choice([450, 600, 750, 900]))
            r["height_mm"] = int(rng.choice([600, 900, 1200, 1500]))
            r["qty"] = int(rng.choice([1, 1, 1, 2]))
            r["sides"] = str(rng.choice(["片面", "両面"], p=[0.4, 0.6]))
            r["lighting"] = str(rng.choice(["LED内照", "なし"], p=[0.5, 0.5]))
        r["design"] = str(rng.choice(["支給", "修正", "新規"], p=[0.5, 0.3, 0.2]))
        install = item in ("カルプ文字", "袖看板") or rng.random() < 0.45
        r["install"] = "有" if install else "無"
        town = str(rng.choice(list(TOWNS), p=[0.45, 0.2, 0.15, 0.12, 0.08]))
        r["_town"] = town
        r["install_height_m"] = float(rng.choice([1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0])) if install else None
        r["site"] = site_text(rng, town) if install else (site_text(rng, town) if rng.random() < 0.3 else "")
        rr = rng.random()
        c = "9999" if rr < 0.25 else str(rng.choice(custs))
        r["customer_code"] = c
        r["rep"] = str(rng.choice(REPS))
        rem = []
        if install and rng.random() < 0.12:
            rem.append("夜間作業")
        if install and rng.random() < 0.15:
            rem.append("既存撤去")
        r["_rush"] = rng.random() < 0.1
        if r["_rush"]:
            rem.append("急ぎ")
        if rng.random() < 0.2:
            rem.append(str(rng.choice(["現調済", "図面支給", "色見本あり", "前回同様"])))
        r["remarks"] = "・".join(rem)
        base_rows.append(r)
    base_rows.sort(key=lambda r: r["_date"])
    rows, truth = [], []
    seqs: dict[str, int] = {}
    rates = sorted({1.1, 1.0, *SPECIAL.values()})
    for r in base_rows:
        d = r["_date"]
        ym = f"{d:%y%m}"
        seqs[ym] = seqs.get(ym, 0) + 1
        qno = f"{ym}-{seqs[ym]:03d}"
        unit = unit_of_rep(r["rep"])
        label = "clean"
        stale = d >= REV and rng.random() < 0.07 and d < date(2025, 6, 1)
        sub, after = compute(r, stale=stale)
        if stale:
            label = "stale_table"
        mode = "floor"
        u = rng.random()
        if label == "clean" and u < 0.008:
            alt = [x for x in rates if abs(x - rate_of(r["customer_code"])) > 1e-9]
            sub, after = compute(r, rate=float(rng.choice(alt)))
            label = "copied_rate"
        elif label == "clean" and u < 0.03 and unit == 100:
            mode = "round"
            if finish(sub, after, unit, "round") != finish(sub, after, unit):
                label = "rounding_inconsistency"
        net = finish(sub, after, unit, mode)
        u = rng.random()
        if label == "clean" and u < 0.015:
            new = (net // 10000) * 10000 if rng.random() < 0.5 else int(math.floor(net * 0.9 / 100) * 100)
            if 0 < new < net:
                net, label = new, "undocumented_discount"
        elif label == "clean" and u < 0.025 and not r["_rush"]:
            r2 = dict(r)
            r2["_rush"] = True
            s2, a2 = compute(r2)
            new = finish(s2, a2, unit)
            if new != net:
                net, label = new, "unrecorded_surcharge"
        elif label == "clean" and u < 0.028:
            net = int(round(net * float(rng.uniform(0.85, 1.15)) / 100) * 100)
            label = "unexplained"
        oog = (r["item"] == "アルミ複合板看板" and r["width_mm"] > 2400) or (
            r["item"] == "インクジェット出力" and r["qty"] > 1 and r["width_mm"] * r["height_mm"] / 1e6 < 0.5
        )
        t = rng.random()
        if t < 0.45:
            tax_label, shown = str(rng.choice(["税別", "税抜"])), net
        elif t < 0.8:
            tax_label, shown = "税込", math.floor(net * 1.1)
        else:
            tax_label, shown = "", (net if rng.random() < 0.6 else math.floor(net * 1.1))
        written = shown
        if label == "clean" and rng.random() < 0.004:
            s = str(shown)
            if len(s) >= 5:
                j = int(rng.integers(0, len(s) - 3))
                s2 = s[:j] + s[j + 1] + s[j] + s[j + 2 :]
                if s2 != s:
                    written, label = int(s2), "typo"
        amount = f"¥{written:,}" if rng.random() < 0.3 else f"{written:,}"
        out = {
            "quote_no": qno,
            "issue_date": d.isoformat(),
            "customer_code": r["customer_code"],
            "rep": r["rep"],
            "item": r["item"],
            "width_mm": "" if r["width_mm"] is None else str(r["width_mm"]),
            "height_mm": "" if r["height_mm"] is None else str(r["height_mm"]),
            "qty": str(r["qty"]),
            "unit": UNIT_OF[r["item"]],
            "thickness_mm": "" if r["thickness_mm"] is None else str(r["thickness_mm"]),
            "sides": r["sides"],
            "media": r["media"],
            "laminate": r["laminate"] if r["item"] in ("アルミ複合板看板", "インクジェット出力") else "",
            "finish": r["finish"],
            "lighting": r["lighting"],
            "design": r["design"],
            "install": r["install"],
            "install_height_m": "" if r["install_height_m"] is None else f"{r['install_height_m']:g}",
            "site": r["site"],
            "remarks": r["remarks"],
            "amount": amount,
            "tax_label": tax_label,
        }
        rows.append(out)
        truth.append({"quote_id": qno, "label": label, "true_net": net, "out_of_grammar": int(oog)})
        if rng.random() < 0.012:
            d2 = d + timedelta(days=int(rng.integers(2, 15)))
            o2 = dict(out)
            o2["quote_no"] = qno + "-2"
            o2["issue_date"] = d2.isoformat()
            if rng.random() < 0.6:
                o2["qty"] = str(r["qty"] + 1)
                rows.append(o2)
                truth.append(
                    {
                        "quote_id": o2["quote_no"],
                        "label": "revision_or_duplicate",
                        "true_net": net,
                        "out_of_grammar": int(oog),
                    }
                )
            else:
                ri = dict(r)
                ri["_date"] = d2
                s2, a2 = compute(ri)
                n2 = finish(s2, a2, unit)
                o2["amount"] = f"{n2:,}"
                o2["tax_label"] = "税別"
                rows.append(o2)
                truth.append({"quote_id": o2["quote_no"], "label": "clean", "true_net": n2, "out_of_grammar": int(oog)})
    order = sorted(range(len(rows)), key=lambda i: (rows[i]["issue_date"], rows[i]["quote_no"]))
    return [rows[i] for i in order], [truth[i] for i in order]


def write(out_dir: Path, seed: int, n: int) -> None:
    rows, truth = generate(seed, n)
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, data in (("quotes.csv", rows), ("truth.csv", truth)):
        with (out_dir / name).open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(data[0]), lineterminator="\n")
            w.writeheader()
            w.writerows(data)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).parent / "sign"))
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("-n", type=int, default=2378)
    a = ap.parse_args()
    write(Path(a.out), a.seed, a.n)


if __name__ == "__main__":
    main()
