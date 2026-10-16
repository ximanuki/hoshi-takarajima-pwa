"""Dictionary-free Japanese tokenisation for BM25: character n-grams.

Why character bigrams (see README "Design decisions" for the measured ablation):

* No dictionary download or native build (MeCab/Sudachi need 50–100 MB+
  dictionaries and an install step that tends to break in slim containers).
* Robust to compounds and domain terms that a morphological dictionary splits
  differently from how employees type them (年次有給休暇 / 有給 / 有休).
* The well-known weakness — bigrams that straddle word boundaries — is mostly
  absorbed by BM25's IDF weighting, and the dense retriever covers paraphrases.

Text is NFKC-normalised (full-width digits/letters → ASCII) and lowercased.
Line breaks inside Japanese text are removed first, because PDFs hard-wrap
lines in the middle of words (就業規\\n則).
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterator

_JOIN_WRAPPED = re.compile(r"(?<=[^\x00-\x7f])\s+(?=[^\x00-\x7f])")
_ASCII_WORD = re.compile(r"[a-z0-9]+(?:[.,][0-9]+)*")


def _is_cjk(ch: str) -> bool:
    code = ord(ch)
    return (
        0x3040 <= code <= 0x30FF  # hiragana, katakana (incl. ー)
        or 0x3400 <= code <= 0x4DBF  # CJK ext A
        or 0x4E00 <= code <= 0x9FFF  # CJK unified ideographs
        or 0xF900 <= code <= 0xFAFF  # compatibility ideographs
        or ch in "々〆ヶ〇"
    )


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    return _JOIN_WRAPPED.sub("", text)


def _runs(text: str) -> Iterator[tuple[str, str]]:
    """Yield ``(kind, run)`` with kind in {"cjk", "ascii"}; everything else separates."""
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if _is_cjk(ch):
            j = i + 1
            while j < n and _is_cjk(text[j]):
                j += 1
            yield "cjk", text[i:j]
            i = j
        elif ch.isascii() and ch.isalnum():
            m = _ASCII_WORD.match(text, i)
            assert m is not None
            yield "ascii", m.group(0)
            i = m.end()
        else:
            i += 1


class CharNgramTokenizer:
    """Character n-gram tokenizer for Japanese; ASCII words/numbers stay whole.

    ``ngram=2`` (default) emits bigrams; a 1-character CJK run (e.g. "月") is
    emitted as a unigram so that it is still searchable. ``with_unigrams``
    additionally emits every CJK character (used in the ablation only).
    """

    def __init__(self, ngram: int = 2, with_unigrams: bool = False) -> None:
        if ngram < 1:
            raise ValueError("ngram must be >= 1")
        self.ngram = ngram
        self.with_unigrams = with_unigrams

    @property
    def name(self) -> str:
        return f"char{self.ngram}gram" + ("+uni" if self.with_unigrams and self.ngram > 1 else "")

    def tokenize(self, text: str) -> list[str]:
        tokens: list[str] = []
        n = self.ngram
        for kind, run in _runs(normalize(text)):
            if kind == "ascii":
                tokens.append(run)
                continue
            if self.with_unigrams and n > 1:
                tokens.extend(run)
            if len(run) < n:
                if not (self.with_unigrams and n > 1):
                    tokens.append(run)
                continue
            tokens.extend(run[i : i + n] for i in range(len(run) - n + 1))
        return tokens

    __call__ = tokenize
