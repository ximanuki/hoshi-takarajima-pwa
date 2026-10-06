"""Japanese text helpers shared by ingestion, retrieval and citation checking.

Two ideas matter here:

* The stored document text is never rewritten for search. All normalisation
  (NFKC, width folding, whitespace removal) happens in *views* of the text that
  keep a map back to the original character offsets. That map is what lets a
  citation point at an exact span of the source.
* Japanese PDFs hard-wrap lines in the middle of words, so whitespace is
  ignored when matching quotes and when tokenising.
"""

from __future__ import annotations

import re
import unicodedata
from functools import lru_cache

_QUOTE_WRAPPERS = "「」『』\"'“”‘’"


@lru_cache(maxsize=4096)
def _fold_char(ch: str) -> str:
    """NFKC + lowercase for one character, with whitespace removed."""
    folded = unicodedata.normalize("NFKC", ch).lower()
    return "".join(c for c in folded if not c.isspace())


def normalize_for_match(text: str) -> str:
    """Width/case-insensitive, whitespace-free form used to compare quotes."""
    return "".join(_fold_char(ch) for ch in text if not ch.isspace())


class MatchIndex:
    """A whitespace/width-insensitive view of ``text`` that maps back to offsets.

    ``find(quote)`` returns the ``(start, end)`` span of ``quote`` in the
    *original* text, or ``None`` if the quote does not occur verbatim (modulo
    whitespace, full/half width and ASCII case).
    """

    def __init__(self, text: str) -> None:
        self.text = text
        chars: list[str] = []
        offsets: list[int] = []
        for i, ch in enumerate(text):
            if ch.isspace():
                continue
            for c in _fold_char(ch):
                chars.append(c)
                offsets.append(i)
        self.normalized = "".join(chars)
        self._offsets = offsets

    def find(self, quote: str) -> tuple[int, int] | None:
        spans = self.find_all(quote, limit=1)
        return spans[0] if spans else None

    def find_all(self, quote: str, limit: int | None = None) -> list[tuple[int, int]]:
        """All (non-overlapping) occurrences of ``quote`` as original-text spans."""
        needle = normalize_for_match(quote.strip().strip(_QUOTE_WRAPPERS))
        spans: list[tuple[int, int]] = []
        if not needle:
            return spans
        pos = self.normalized.find(needle)
        while pos >= 0 and (limit is None or len(spans) < limit):
            spans.append((self._offsets[pos], self._offsets[pos + len(needle) - 1] + 1))
            pos = self.normalized.find(needle, pos + len(needle))
        return spans


def locate_quote(text: str, quote: str) -> tuple[int, int] | None:
    return MatchIndex(text).find(quote)


_JA = r"[^\x00-\x7f]"


def display_text(text: str) -> str:
    """Human-friendly rendering of a source span: join wrapped Japanese lines."""
    text = re.sub(rf"(?<={_JA})[ \t　]*\n[ \t　]*(?={_JA})", "", text)
    text = re.sub(r"[ \t　]*\n[ \t　]*", " ", text)
    text = re.sub(r"[ \t　]{2,}", " ", text)
    return text.strip()


# A line that starts a new list item / paragraph in Japanese rules documents:
# "２ 前項の…", "① 住民票…", "（イ）…", "ア …", "・…"
_ITEM_START = re.compile(
    r"[ \t　]*(?:"
    r"[０-９0-9]{1,2}[ \t　]"
    r"|[①-⑳]"
    r"|[（(][イロハニホヘトチリヌ一二三四五六七八九十０-９0-9]{1,2}[）)]"
    r"|[アイウエオカキクケコ][ \t　]"
    r"|[・●○■□◆◇※]"
    r")"
)


def split_units(text: str) -> list[tuple[int, int]]:
    """Split text into sentence-like units, returned as ``(start, end)`` offsets.

    A unit ends at "。", at a blank line, or right before a line that starts a
    new numbered item / list entry (items in rules often have no "。").
    """
    units: list[tuple[int, int]] = []
    start: int | None = None
    n = len(text)
    i = 0
    while i < n:
        ch = text[i]
        if start is None and not ch.isspace():
            start = i
        if ch == "。" and start is not None:
            units.append((start, i + 1))
            start = None
        elif ch == "\n":
            nxt = text[i + 1 :]
            blank = nxt.startswith("\n") or re.match(r"[ \t　]*\n", nxt) is not None
            if start is not None and (blank or _ITEM_START.match(nxt)):
                units.append((start, i))
                start = None
        i += 1
    if start is not None:
        units.append((start, n))
    # trim trailing whitespace inside each span and drop empties
    out: list[tuple[int, int]] = []
    for s, e in units:
        while e > s and text[e - 1].isspace():
            e -= 1
        if e > s:
            out.append((s, e))
    return out
