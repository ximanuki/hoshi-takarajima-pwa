from fractions import Fraction

import pytest

from estimate_archaeology.normalize import (
    TaxTable,
    day_to_iso,
    gross_from_net,
    net_candidates,
    nets_from_gross,
    parse_amount,
    parse_date,
    round_rational,
    tax_label_kind,
)


@pytest.mark.parametrize(
    ("text", "value"),
    [
        ("12,300", 12300),
        ("¥12,300-", 12300),
        ("１２，３００円", 12300),
        ("12300円也", 12300),
        ("1万2300円", 12300),
        ("一万二千三百円", 12300),
        ("12.5万", 125000),
        ("弐万円", 20000),
        ("△1,000", -1000),
        ("1,100（税込）", 1100),
    ],
)
def test_parse_amount(text, value):
    assert parse_amount(text).value == value


def test_parse_amount_embedded_label_and_blank():
    assert parse_amount("11,000円(税込)").label == "incl"
    assert parse_amount("10,000 税別").label == "excl"
    assert parse_amount("").value is None
    assert parse_amount("お見積り中").value is None


@pytest.mark.parametrize(
    ("label", "kind"),
    [
        ("税込", "incl"),
        ("税込み", "incl"),
        ("内税", "incl"),
        ("税抜", "excl"),
        ("税別", "excl"),
        ("外税", "excl"),
        ("", ""),
        ("—", ""),
    ],
)
def test_tax_label_kind(label, kind):
    assert tax_label_kind(label) == kind


@pytest.mark.parametrize(
    ("text", "iso"),
    [
        ("2024-04-01", "2024-04-01"),
        ("2024/4/1", "2024-04-01"),
        ("２０２４年４月１日", "2024-04-01"),
        ("令和6年4月1日", "2024-04-01"),
        ("R6.4.1", "2024-04-01"),
        ("令和元年5月1日", "2019-05-01"),
        ("45383", "2024-04-01"),  # Excel serial
    ],
)
def test_parse_date(text, iso):
    assert day_to_iso(parse_date(text)) == iso


def test_parse_date_invalid():
    assert parse_date("2024-02-30") is None
    assert parse_date("未定") is None


def test_round_rational():
    assert round_rational(7, 2, "floor") == 3
    assert round_rational(7, 2, "round") == 4
    assert round_rational(7, 2, "ceil") == 4
    assert round_rational(6, 2, "ceil") == 3


def test_tax_roundtrip_is_exact():
    rate = Fraction(1, 10)
    for net in range(1, 5000, 7):
        gross = gross_from_net(net, rate, "floor")
        assert net in nets_from_gross(gross, rate, "floor")


def test_tax_table_by_date():
    t = TaxTable.from_config(None)
    assert t.rate_on(parse_date("2019-09-30")) == Fraction(8, 100)
    assert t.rate_on(parse_date("2019-10-01")) == Fraction(1, 10)


def test_net_candidates():
    r = Fraction(1, 10)
    assert net_candidates(10000, "excl", None, r).excl == 10000
    nc = net_candidates(11000, "incl", None, r)
    assert (nc.excl, nc.incl) == (-1, 10000)
    nc = net_candidates(11000, "", None, r)  # no label: both readings stay open
    assert (nc.excl, nc.incl) == (11000, 10000)
    nc = net_candidates(11000, "", 1000, r)  # a written tax amount settles it
    assert (nc.excl, nc.incl) == (-1, 10000)
    nc = net_candidates(10000, "", 1000, r)
    assert (nc.excl, nc.incl) == (10000, -1)
    assert net_candidates(None, "excl", None, r).excl == -1
