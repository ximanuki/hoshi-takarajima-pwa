"""Normalisation of quote values as written.

Everything here is deterministic and side-effect free:

* ``parse_amount``   -- "¥12,300-", "１２，３００円", "1万2300円", "一万二千三百円" -> 12300
* ``tax_label_kind`` -- 税込 / 税抜 / 税別 / 内税 / 外税 / blank -> "incl" / "excl" / ""
* ``parse_date``     -- 2024-04-01, 2024/4/1, 令和6年4月1日, R6.4.1 -> days since 1970-01-01
* ``TaxTable``       -- consumption-tax rate by date and integer-exact tax arithmetic
* ``net_candidates`` -- the pre-tax net amounts that are consistent with what was written
"""

from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from fractions import Fraction

_KANJI_DIGIT = {
    "〇": 0,
    "零": 0,
    "一": 1,
    "壱": 1,
    "二": 2,
    "弐": 2,
    "三": 3,
    "参": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}
_KANJI_SMALL = {"十": 10, "拾": 10, "百": 100, "千": 1000, "阡": 1000}
_KANJI_LARGE = {"万": 10**4, "萬": 10**4, "億": 10**8}

_INCL_WORDS = ("税込", "内税", "込み", "込", "incl", "tax included", "gross")
_EXCL_WORDS = ("税抜", "税別", "外税", "抜き", "別途", "本体", "excl", "net", "+tax", "plus tax")


def nfkc(value: object) -> str:
    """Unicode NFKC normalisation + whitespace strip; ``None`` -> ""."""
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    return unicodedata.normalize("NFKC", str(value)).strip()


def tax_label_kind(value: object) -> str:
    """Map a tax label as written to ``"incl"``, ``"excl"`` or ``""`` (unknown / blank)."""
    s = nfkc(value).lower()
    if not s:
        return ""
    # "税抜" must win over the bare "込" test, so check the exclusive words first.
    for w in _EXCL_WORDS:
        if w in s:
            return "excl"
    for w in _INCL_WORDS:
        if w in s:
            return "incl"
    return ""


def _parse_kanji_number(s: str) -> float | None:
    """Parse a number mixing Arabic digits and kanji (``1万2千``, ``一万二千三百``, ``12.5万``)."""
    total = 0.0
    section = 0.0
    current: float | None = None
    i = 0
    seen = False
    while i < len(s):
        ch = s[i]
        if ch.isdigit() or ch == ".":
            j = i
            while j < len(s) and (s[j].isdigit() or s[j] == "."):
                j += 1
            try:
                current = float(s[i:j])
            except ValueError:
                return None
            seen = True
            i = j
            continue
        if ch in _KANJI_DIGIT:
            # positional kanji digits ("二〇〇〇") concatenate
            d = _KANJI_DIGIT[ch]
            current = d if current is None else current * 10 + d
            seen = True
        elif ch in _KANJI_SMALL:
            section += (1 if current is None else current) * _KANJI_SMALL[ch]
            current = None
            seen = True
        elif ch in _KANJI_LARGE:
            total += (section + (0 if current is None else current)) * _KANJI_LARGE[ch]
            section = 0.0
            current = None
            seen = True
        else:
            return None
        i += 1
    if not seen:
        return None
    return total + section + (0 if current is None else current)


@dataclass(frozen=True)
class ParsedAmount:
    value: int | None
    label: str  # tax label embedded in the amount text ("incl"/"excl"/"")
    issue: str  # "" when parsed cleanly


def parse_amount(value: object) -> ParsedAmount:
    """Parse a yen amount as written. Returns the integer value and any embedded tax label."""
    s = nfkc(value)
    if not s:
        return ParsedAmount(None, "", "blank")
    label = tax_label_kind(s)
    t = s
    for w in ("税込み", "税込", "内税", "税抜き", "税抜", "税別", "外税", "(", ")", "（", "）"):
        t = t.replace(w, "")
    neg = False
    if t.startswith(("△", "▲", "-")) and len(t) > 1:
        neg = True
        t = t[1:]
    t = t.replace("¥", "").replace("\\", "").replace("円", "").replace("也", "")
    t = t.replace(",", "").replace(" ", "").replace("_", "")
    t = t.rstrip("-").rstrip("ー").rstrip("―")
    if not t:
        return ParsedAmount(None, label, "unparseable")
    num: float | None
    if re.fullmatch(r"\d+(\.\d+)?", t):
        num = float(t)
    else:
        num = _parse_kanji_number(t)
    if num is None:
        return ParsedAmount(None, label, "unparseable")
    issue = ""
    if abs(num - round(num)) > 1e-9:
        issue = "fractional_yen"
    v = round(num)
    return ParsedAmount(-v if neg else v, label, issue)


_ERA = {"令和": 2018, "R": 2018, "平成": 1988, "H": 1988, "昭和": 1925, "S": 1925}
_EPOCH = date(1970, 1, 1).toordinal()


def parse_date(value: object) -> int | None:
    """Parse a date as written; returns days since 1970-01-01 or ``None``."""
    s = nfkc(value)
    if not s:
        return None
    m = re.fullmatch(r"(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T].*)?", s)
    if m:
        y, mo, d = (int(g) for g in m.groups())
    else:
        m = re.fullmatch(r"(令和|平成|昭和|R|H|S)\s*(\d{1,2}|元)[-/.年](\d{1,2})[-/.月](\d{1,2})日?", s)
        if not m:
            if re.fullmatch(r"\d{5}(\.0+)?", s):  # Excel serial date
                return int(float(s)) - 25569
            return None
        era, ey, mo_s, d_s = m.groups()
        y = _ERA[era] + (1 if ey == "元" else int(ey))
        mo, d = int(mo_s), int(d_s)
    try:
        return date(y, mo, d).toordinal() - _EPOCH
    except ValueError:
        return None


def day_to_iso(day: int | None) -> str:
    if day is None:
        return ""
    return date.fromordinal(int(day) + _EPOCH).isoformat()


def iso_to_day(s: str) -> int:
    d = parse_date(s)
    if d is None:
        raise ValueError(f"bad date: {s!r}")
    return d


# --------------------------------------------------------------------------- tax

_DEFAULT_RATES = (
    ("1989-04-01", "0.03"),
    ("1997-04-01", "0.05"),
    ("2014-04-01", "0.08"),
    ("2019-10-01", "0.10"),
)

TAX_ROUNDING = ("floor", "round", "ceil")


def round_rational(num: int, den: int, mode: str) -> int:
    """Round ``num/den`` (den > 0) to an integer with ``floor``/``round`` (half up)/``ceil``."""
    if mode == "floor":
        return num // den
    if mode == "ceil":
        return -((-num) // den)
    if mode == "round":
        return (2 * num + den) // (2 * den)
    raise ValueError(mode)


@dataclass
class TaxTable:
    """Consumption-tax rates by effective date (exact rational arithmetic)."""

    rates: list[tuple[int, Fraction]]

    @classmethod
    def from_config(cls, cfg: list | None) -> TaxTable:
        items = cfg if cfg else _DEFAULT_RATES
        rates = sorted((iso_to_day(d), Fraction(str(r))) for d, r in items)
        return cls(rates)

    def rate_on(self, day: int | None) -> Fraction:
        if day is None:
            return self.rates[-1][1]
        rate = self.rates[0][1]
        for d, r in self.rates:
            if day >= d:
                rate = r
        return rate

    def to_json(self) -> list:
        return [[day_to_iso(d), str(float(r))] for d, r in self.rates]


def gross_from_net(net: int, rate: Fraction, mode: str = "floor") -> int:
    """Tax-inclusive amount for a pre-tax ``net`` (tax computed on the total)."""
    m = 1 + rate
    return round_rational(net * m.numerator, m.denominator, mode)


def nets_from_gross(gross: int, rate: Fraction, mode: str = "floor") -> list[int]:
    """All integer nets ``n`` with ``gross_from_net(n) == gross`` (usually 0 or 1 values)."""
    m = 1 + rate
    approx = (gross * m.denominator) // m.numerator
    return [n for n in range(approx - 2, approx + 3) if n >= 0 and gross_from_net(n, rate, mode) == gross]


def tax_of(net: int, rate: Fraction, mode: str = "floor") -> int:
    return round_rational(net * rate.numerator, rate.denominator, mode)


@dataclass(frozen=True)
class NetCandidates:
    """Pre-tax nets consistent with the written amount. ``excl``/``incl`` are -1 when impossible."""

    excl: int
    incl: int
    basis: str  # how the candidates were derived (evidence text)


def net_candidates(
    amount: int | None,
    label: str,
    tax_amount: int | None,
    rate: Fraction,
    mode: str = "floor",
) -> NetCandidates:
    """Derive candidate pre-tax nets from an amount as written.

    * label ``excl``: the amount is the net.
    * label ``incl``: the net is any integer whose tax-inclusive amount equals the written one.
    * no label: both readings stay open (the fitted rules decide later);
      a written tax amount, when present, settles the reading arithmetically.
    """
    if amount is None:
        return NetCandidates(-1, -1, "金額を読めない")
    if tax_amount is not None:
        if label == "incl":
            return NetCandidates(-1, amount - tax_amount, "税込額−消費税額")
        if label == "excl":
            return NetCandidates(amount, -1, "税抜額（消費税額の記載あり）")
        excl_ok = abs(tax_of(amount, rate, mode) - tax_amount) <= 1
        incl_net = amount - tax_amount
        incl_ok = incl_net > 0 and abs(tax_of(incl_net, rate, mode) - tax_amount) <= 1
        if excl_ok and not incl_ok:
            return NetCandidates(amount, -1, "表示なし→消費税額が金額の税率分なので税抜と判断")
        if incl_ok and not excl_ok:
            return NetCandidates(-1, incl_net, "表示なし→金額−消費税額が税抜額と判断")
        return NetCandidates(amount, incl_net if incl_ok else -1, "表示なし（税額から判別不能）")
    if label == "excl":
        return NetCandidates(amount, -1, "税抜表示")
    incl = nets_from_gross(amount, rate, mode)
    incl_net = incl[0] if incl else -1
    if label == "incl":
        return NetCandidates(-1, incl_net, "税込表示→税抜額に換算")
    return NetCandidates(amount, incl_net, "税表示なし（税抜・税込の両方を候補）")
