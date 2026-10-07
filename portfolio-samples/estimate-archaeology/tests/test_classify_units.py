import pytest

from estimate_archaeology.classify import typo_kind
from estimate_archaeology.library import mine_keywords, product_factors


@pytest.mark.parametrize(
    ("written", "rule", "kind"),
    [
        (15300, 13500, "transposition"),
        (12345, 12354, "transposition"),
        (1350, 13500, "dropped_or_extra_digit"),
        (135000, 13500, "dropped_or_extra_digit"),
        (13600, 13500, "one_digit"),
        (13500, 13500, ""),
        (99999, 13500, ""),
    ],
)
def test_typo_kind(written, rule, kind):
    assert typo_kind(written, rule) == kind


def test_keyword_mining_finds_maximal_substrings():
    texts = ["データ修正あり", "データ修正1回", "特急 データ修正", "前回同様", "前回同様", "前回同様です", ""]
    kws = dict(mine_keywords(texts, min_df=2, max_keywords=10, hints=[]))
    assert "データ修正" in kws and kws["データ修正"] == 3
    assert "前回同様" in kws
    assert "データ" not in kws  # same documents as the longer string


def test_product_factors():
    assert product_factors("a * b * c") == [("a", "b * c"), ("b", "a * c"), ("c", "a * b")]
    assert product_factors("a") == []
