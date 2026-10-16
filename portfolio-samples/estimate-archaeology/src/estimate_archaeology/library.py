"""Candidate building blocks for the structure search.

The library turns a config into:

* numeric *features* (``1``, each numeric column, products of numeric columns,
  explicit expressions from the config or from extensions);
* table *keys* (categorical columns, flags, small-cardinality numeric columns,
  pairs of those);
* *flags*: keywords mined from free-text columns and numeric thresholds;
* candidate *multiplier* keys.

Nothing here looks at amounts; it only enumerates what the search may try.
"""

from __future__ import annotations

import itertools
import math
import re
from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np

from . import expr as ex
from .config import Config
from .dataset import Dataset
from .normalize import nfkc
from .program import EvalCache, FeatureSpec, FlagSpec, KeySpec

_NOISE = re.compile(r"^[\d\s\-/.:,()（）、。・%％~〜#＃]+$")
_SPLIT = re.compile(r"[、。,，・/／\s()（）「」【】\[\]:：;；!！?？]+")


@dataclass
class Library:
    features: list[FeatureSpec] = field(default_factory=list)
    keys: list[KeySpec] = field(default_factory=list)  # single-column keys
    pair_keys: list[KeySpec] = field(default_factory=list)
    flags: list[FlagSpec] = field(default_factory=list)
    mult_keys: list[KeySpec] = field(default_factory=list)
    numeric_columns: list[str] = field(default_factory=list)
    ordinal_columns: list[str] = field(default_factory=list)
    pack_steps: dict[str, list[float]] = field(default_factory=dict)
    keyword_docfreq: dict[str, int] = field(default_factory=dict)


def mine_keywords(texts: list[str], min_df: int, max_keywords: int, hints: list[str]) -> list[tuple[str, int]]:
    """Frequent, maximal substrings of free text (no tokenizer needed for Japanese).

    A substring is kept when it occurs in >= ``min_df`` documents; among substrings that
    occur in exactly the same set of documents only the longest is kept.
    """
    docs = [nfkc(t) for t in texts]
    n = len(docs)
    occ: dict[str, set[int]] = defaultdict(set)
    for i, d in enumerate(docs):
        if not d:
            continue
        for chunk in _SPLIT.split(d):
            if not chunk:
                continue
            L = len(chunk)
            for a in range(L):
                for b in range(a + 2, min(L, a + 12) + 1):
                    occ[chunk[a:b]].add(i)
            if L >= 2:
                occ[chunk].add(i)
    by_docs: dict[frozenset[int], str] = {}
    for s, ds_ in occ.items():
        if len(ds_) < min_df or len(ds_) > 0.6 * max(n, 1):
            continue
        if _NOISE.match(s):
            continue
        key = frozenset(ds_)
        cur = by_docs.get(key)
        if cur is None or len(s) > len(cur) or (len(s) == len(cur) and s < cur):
            by_docs[key] = s
    ranked = sorted(((s, len(k)) for k, s in by_docs.items()), key=lambda t: (-t[1], t[0]))
    out = ranked[:max_keywords]
    have = {s for s, _ in out}
    for h in hints:
        h = nfkc(h)
        if h and h not in have:
            df = sum(1 for d in docs if h in d)
            if df >= 1:
                out.append((h, df))
                have.add(h)
    return out


def threshold_values(x: np.ndarray, max_k: int) -> list[float]:
    v = x[~np.isnan(x)]
    if len(v) == 0:
        return []
    u = np.unique(v)
    if len(u) <= 1:
        return []
    if len(u) <= 2 * max_k + 1:
        return [float(t) for t in u[1:]]
    qs = np.quantile(v, np.linspace(0, 1, max_k + 2)[1:-1])
    out = sorted({float(np.round(q, 6)) for q in qs})
    return [t for t in out if t > u[0]]


def build_library(ds: Dataset, cfg: Config, cache: EvalCache) -> Library:
    lib = Library()
    n = ds.n
    env = cache.env

    # ---- flags: keywords in text columns
    for col in cfg.text:
        if col not in env:
            continue
        kws = mine_keywords(list(env[col]), int(cfg.s("min_keyword_df")), int(cfg.s("max_keywords")), cfg.keywords)
        for kw, df in kws:
            name = f"kw:{col}:{kw}"
            lib.flags.append(FlagSpec(name, "keyword", (col,), pattern=kw))
            lib.keyword_docfreq[name] = df
    # ---- flags: numeric thresholds (candidate cut points from every segment, so that a
    # tier boundary that only matters for one product is still offered)
    segs = ex.as_str(ds.segment, n)
    max_t = int(cfg.s("max_thresholds_per_column"))
    for col in cfg.thresholds:
        if col not in env:
            continue
        x = ex.as_float(env[col], n)
        cuts: set[float] = set()
        for s in sorted(set(segs)):
            cuts.update(threshold_values(x[segs == s], max_t))
        cut_list = sorted(cuts)
        if len(cut_list) > max_t * 8:  # thin out evenly (never just the smallest ones)
            idx = np.unique(np.round(np.linspace(0, len(cut_list) - 1, max_t * 8)).astype(int))
            cut_list = [cut_list[i] for i in idx]
        for t in cut_list:
            lib.flags.append(FlagSpec(f"{col}>={t:g}", "threshold", (col,), threshold=t))
    cache.ensure_flags(lib.flags)

    # ---- numeric features
    numeric = [c for c in cfg.numeric if c in env]
    lib.numeric_columns = numeric
    # explicit features (config / extensions) first, so that they win the de-duplication
    # against auto-generated products with the same values
    feats: list[str] = ["1", *cfg.features, *numeric]
    deg = int(cfg.s("max_feature_degree"))
    if deg >= 2:
        for a, b in itertools.combinations(numeric, 2):
            feats.append(f"{a}*{b}")
    if deg >= 3:
        for a, b, c in itertools.combinations(numeric, 3):
            feats.append(f"{a}*{b}*{c}")
    seen: set[bytes] = set()
    for f in feats:
        try:
            v = cache.feature(FeatureSpec(f))
        except ex.ExprError:
            continue
        if not np.any(v != 0):
            continue
        sig = np.round(v, 9).tobytes()
        if sig in seen:  # same vector as an earlier feature (e.g. total_qty == quantity*kinds)
            continue
        seen.add(sig)
        lib.features.append(FeatureSpec(f))
    lib.pack_steps = dict(cfg.pack_steps)

    # ---- keys
    max_lv = int(cfg.s("max_key_levels"))
    singles: list[KeySpec] = []
    for col in cfg.categorical:
        if col in env:
            nlev = len(set(ex.as_str(env[col], n)))
            if 1 < nlev <= max_lv:
                singles.append(KeySpec((col,)))
    for col in numeric:
        x = ex.as_float(env[col], n)
        # a numeric column with few distinct values in some segment may act as a lookup key
        # there (character height for letters, quantity steps for cards ...)
        few = False
        scopes = sorted(set(segs)) if cfg.s("ordinal_scope") == "segment" else [None]
        for s in scopes:
            u = np.unique(x[((segs == s) if s is not None else np.ones(n, bool)) & ~np.isnan(x)])
            few |= 1 < len(u) <= 20
        if few:
            lib.ordinal_columns.append(col)
            singles.append(KeySpec((col,)))
    lib.keys = singles + [KeySpec((f.name,)) for f in lib.flags]
    max_pair = int(cfg.s("max_pair_levels"))
    for a, b in itertools.combinations(singles, 2):
        la = ex.as_str(env[a.columns[0]], n)
        lb = ex.as_str(env[b.columns[0]], n)
        combos = len(set(zip(la, lb, strict=True)))
        if combos <= max_pair:
            lib.pair_keys.append(KeySpec((a.columns[0], b.columns[0])))

    # ---- multiplier keys: customer class and flags by default (customer rates, rush and
    # keyword surcharges are commonly multiplicative); product attributes only when the
    # config lists them in ``multiplier_keys``
    mk = [KeySpec(("_customer_class",))] if cfg.customer_class else []
    if cfg.multiplier_keys:
        mk += [KeySpec((c,)) for c in cfg.multiplier_keys if c in env and c != "_customer_class"]
    mk += [KeySpec((f.name,)) for f in lib.flags]
    lib.mult_keys = mk
    return lib


def product_factors(expr: str) -> list[tuple[str, str]]:
    """For ``a * b * c`` return [(a, "b * c"), (b, "a * c"), (c, "a * b")] (top-level only)."""
    import ast

    try:
        tree = ast.parse(expr, mode="eval").body
    except SyntaxError:
        return []
    parts: list[ast.AST] = []

    def walk(node: ast.AST) -> None:
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mult):
            walk(node.left)
            walk(node.right)
        else:
            parts.append(node)

    walk(tree)
    if len(parts) < 2:
        return []
    srcs = [ast.unparse(p) for p in parts]
    out = []
    for i, a in enumerate(srcs):
        rest = " * ".join(srcs[:i] + srcs[i + 1 :])
        out.append((a, rest))
    return out


def feature_variants(fs: FeatureSpec, x_of) -> list[FeatureSpec]:
    """Pack-rounding / minimum variants of a feature, on the whole value and per piece.

    ``x_of(spec)`` returns the feature's values on the rows where the term applies.
    """
    out: list[FeatureSpec] = []
    whole = FeatureSpec(fs.full_expr)
    xv = x_of(whole)
    out += [FeatureSpec(whole.expr, ceil_step=s) for s in default_pack_steps(xv)]
    out += [FeatureSpec(whole.expr, clamp_min=m) for m in clamp_candidates(xv)]
    for a, rest in product_factors(fs.full_expr):
        xa = x_of(FeatureSpec(a))
        out += [FeatureSpec(a, ceil_step=s, times=rest) for s in default_pack_steps(xa)]
        out += [FeatureSpec(a, clamp_min=m, times=rest) for m in clamp_candidates(xa)]
    return out


def default_pack_steps(x: np.ndarray) -> list[float]:
    """Plausible pack / rounding-up steps for a feature, from its magnitude."""
    v = x[x > 0]
    if len(v) == 0:
        return []
    med = float(np.median(v))
    steps = []
    for s in (0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000):
        if s < med * 2 and s >= med / 2000:
            steps.append(float(s))
    is_int = bool(np.all(np.abs(v - np.round(v)) < 1e-9))
    if is_int:
        steps = [s for s in steps if s >= 1]
    return steps


def clamp_candidates(x: np.ndarray, max_k: int = 8) -> list[float]:
    v = np.unique(x[x > 0])
    if len(v) < 3:
        return []
    qs = np.quantile(v, np.linspace(0.02, 0.4, max_k))
    out = set()
    for q in qs:
        mag = 10 ** math.floor(math.log10(q)) if q > 0 else 1
        for step in (mag, mag / 2, mag / 4):
            out.add(round(math.ceil(q / step) * step, 6))
    return sorted(out)
