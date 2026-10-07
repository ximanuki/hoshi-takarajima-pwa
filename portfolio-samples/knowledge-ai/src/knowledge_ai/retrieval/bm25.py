"""Okapi BM25 over an in-memory inverted index.

The corpus of a company-rules assistant is small (hundreds to a few thousand
chunks), so the index is rebuilt from the chunk table at start-up in well under
a second; there is no separate on-disk lexical index to keep in sync.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from collections.abc import Callable, Sequence

Tokenizer = Callable[[str], list[str]]


class BM25Index:
    def __init__(
        self,
        doc_ids: Sequence[str],
        texts: Sequence[str],
        tokenizer: Tokenizer,
        k1: float = 1.2,
        b: float = 0.75,
    ) -> None:
        if len(doc_ids) != len(texts):
            raise ValueError("doc_ids and texts must have the same length")
        self.doc_ids = list(doc_ids)
        self.tokenizer = tokenizer
        self.k1, self.b = k1, b
        self.postings: dict[str, list[tuple[int, int]]] = defaultdict(list)
        self.doc_len: list[int] = []
        for i, text in enumerate(texts):
            tf = Counter(tokenizer(text))
            self.doc_len.append(sum(tf.values()))
            for term, freq in tf.items():
                self.postings[term].append((i, freq))
        self.n_docs = len(self.doc_ids)
        self.avgdl = (sum(self.doc_len) / self.n_docs) if self.n_docs else 0.0
        # BM25+-style non-negative IDF (Lucene variant)
        self.idf: dict[str, float] = {
            t: math.log(1 + (self.n_docs - len(p) + 0.5) / (len(p) + 0.5))
            for t, p in self.postings.items()
        }
        # IDF a term would get if it appeared in zero documents (unknown term)
        self.max_idf = math.log(1 + (self.n_docs + 0.5) / 0.5) if self.n_docs else 0.0

    def term_idf(self, term: str) -> float:
        return self.idf.get(term, self.max_idf)

    def scores(self, query: str) -> dict[int, float]:
        terms = set(self.tokenizer(query))
        acc: dict[int, float] = defaultdict(float)
        k1, b, avgdl = self.k1, self.b, self.avgdl or 1.0
        for term in terms:
            postings = self.postings.get(term)
            if not postings:
                continue
            idf = self.idf[term]
            for i, tf in postings:
                denom = tf + k1 * (1 - b + b * self.doc_len[i] / avgdl)
                acc[i] += idf * tf * (k1 + 1) / denom
        return acc

    def search(self, query: str, k: int = 10) -> list[tuple[str, float]]:
        acc = self.scores(query)
        ranked = sorted(acc.items(), key=lambda kv: (-kv[1], kv[0]))[:k]
        return [(self.doc_ids[i], s) for i, s in ranked]
