"""Wording rules for everything this package writes or ships as documentation."""

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
BANNED = ("業界初", "100%再現", "100％再現", "AI見積", "不正検知", "LLMが価格を計算", "LLM が価格を計算")
DOCS = [
    ROOT / "README.md",
    ROOT / "README.en.md",
    ROOT / "devdata" / "README.md",
    ROOT / "extensions" / "dev_print_assisted" / "README.md",
    *sorted((ROOT / "src" / "estimate_archaeology").glob("*.py")),
    *sorted((ROOT / "reports").rglob("*.md")),
]


@pytest.mark.parametrize("path", DOCS, ids=lambda p: str(p.relative_to(ROOT)))
def test_no_banned_claims(path):
    text = path.read_text(encoding="utf-8")
    for phrase in BANNED:
        assert phrase not in text, f"{phrase!r} in {path.name}"


def test_readme_uses_the_agreed_phrasing():
    ja = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "件中" in ja and "円単位で再現" in ja
    assert "ルール逸脱の検出と分類" in ja or "検出して分類" in ja
    assert "過去データと矛盾しない最小のルール" in ja
