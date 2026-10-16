"""Structure search + continuous parameter fitting.

The search is deterministic. It looks for the *shortest* program (MDL: bits for the
parameters + bits for the residuals) that reproduces the written amounts:

1. per segment, a rich main-effects model ``Σ table[key] × feature`` (every single
   categorical key × every base feature, plus flag surcharges) is fitted with robust
   IRLS, then pruned block by block (backward elimination, MDL);
2. price-table revisions: change points of the residual ratio over time are tested by
   splitting every parameter of a segment at the date (parameters that did not change
   are not charged for);
3. global multiplicative factors (customer class, customer overrides, categorical
   columns, flags) estimated from median ratios and accepted by MDL;
4. a forward phase adds interactions (two-column keys, lookup tables on small numeric
   columns, flags × quantities, products of numeric columns), then prunes again;
5. 3-4 are alternated.

The result is a :class:`~estimate_archaeology.program.Program` with float parameters;
:mod:`estimate_archaeology.exact` snaps them to exact values and verifies them.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from datetime import date

import numpy as np

from . import expr as ex
from .config import Config
from .dataset import Dataset
from .library import Library, feature_variants
from .normalize import day_to_iso
from .program import EvalCache, FeatureSpec, FlagSpec, KeySpec, Multiplier, Program, Term

# --------------------------------------------------------------------------- scoring


def row_bits(res: np.ndarray, tol: np.ndarray, cap: np.ndarray) -> np.ndarray:
    """Description length (bits) of each residual at precision ``tol``, capped at ``cap``.

    A quote reproduced within one rounding unit costs ~0.5 bit; a quote off by 2**k units
    costs ~k bits; nothing costs more than writing the amount down as-is (``cap``).
    """
    z = res / tol
    return np.minimum(0.5 * np.log2(1.0 + z * z), cap)


def robust_score(res: np.ndarray, tol: np.ndarray, w0: np.ndarray, cap: np.ndarray | None = None) -> float:
    if cap is None:
        cap = np.full(len(res), 40.0)
    return float(np.sum(w0 * row_bits(res, tol, cap)))


def independent_columns(X: np.ndarray, rtol: float = 1e-6) -> np.ndarray:
    """Columns that are not (numerically) linear combinations of earlier columns."""
    n, p = X.shape
    keep = np.zeros(p, dtype=bool)
    Q = np.zeros((n, min(n, p)))
    k = 0
    for j in range(p):
        x = X[:, j]
        nx = float(np.linalg.norm(x))
        if nx == 0:
            continue
        v = x / nx
        if k:
            Qk = Q[:, :k]
            v = v - Qk @ (Qk.T @ v)
            v = v - Qk @ (Qk.T @ v)
        nv = float(np.linalg.norm(v))
        if nv > rtol:
            keep[j] = True
            Q[:, k] = v / nv
            k += 1
            if k >= Q.shape[1]:
                break
    return keep


@dataclass
class Fit:
    theta: np.ndarray
    res: np.ndarray
    w: np.ndarray
    keep: np.ndarray
    score: float
    se: np.ndarray | None = None


def _stderr(Xs: np.ndarray, w: np.ndarray, norms: np.ndarray, sigma: float, p: int, keep: np.ndarray) -> np.ndarray:
    """Approximate standard errors of the coefficients (noise scale ``sigma``)."""
    se = np.full(p, np.inf)
    A = (Xs * w[:, None]).T @ Xs
    try:
        inv = np.linalg.pinv(A, rcond=1e-10)
    except np.linalg.LinAlgError:
        return se
    se[keep] = sigma * np.sqrt(np.maximum(np.diag(inv), 0.0)) / norms
    return se


# Deterministic work counter (cells x columns of every least-squares solve). The search
# budget is expressed in these units rather than wall-clock seconds, so that the result
# does not depend on the speed or load of the machine.
WORK = [0]


def _solve(Xs: np.ndarray, y: np.ndarray, w: np.ndarray, ridge: float = 0.0) -> np.ndarray:
    WORK[0] += Xs.shape[0] * Xs.shape[1] * max(Xs.shape[1], 1)
    sw = np.sqrt(np.maximum(w, 1e-12))
    A, b = Xs * sw[:, None], y * sw
    if ridge > 0:
        # columns are unit-norm: a small ridge only shrinks directions the data cannot pin down
        p = Xs.shape[1]
        A = np.vstack([A, math.sqrt(ridge * float(np.mean(w))) * np.eye(p)])
        b = np.concatenate([b, np.zeros(p)])
    th, *_ = np.linalg.lstsq(A, b, rcond=None)
    return th


def robust_fit(
    X: np.ndarray,
    y: np.ndarray,
    tol: np.ndarray,
    w0: np.ndarray,
    cap: np.ndarray,
    keep: np.ndarray | None = None,
    inner: int = 2,
    ridge: float = 0.0,
) -> Fit:
    """Cauchy-loss IRLS with the scale annealed from the residual spread down to ``tol``."""
    p = X.shape[1]
    if p == 0:
        return Fit(np.zeros(0), y.copy(), w0.copy(), np.zeros(0, bool), robust_score(y, tol, w0, cap))
    keep = independent_columns(X) if keep is None else keep
    Xk = X[:, keep]
    norms = np.linalg.norm(Xk, axis=0)
    Xs = Xk / norms
    th = _solve(Xs, y, w0, ridge)
    r = y - Xs @ th
    tmed = float(np.median(tol))
    c = max(1.4826 * float(np.median(np.abs(r[w0 > 0]))) if np.any(w0 > 0) else tmed, tmed)
    w = w0
    while True:
        for _ in range(inner):
            w = w0 / (1.0 + (r / np.maximum(c, tol)) ** 2)
            th = _solve(Xs, y, w, ridge)
            r = y - Xs @ th
        if c <= tmed:
            break
        c = max(c / 4.0, tmed)
    theta = np.zeros(p)
    theta[keep] = th / norms
    se = _stderr(Xs, w, norms, tmed, p, keep)
    return Fit(theta, r, w, keep, robust_score(r, tol, w0, cap), se)


def fixed_weight_fit(
    X: np.ndarray,
    y: np.ndarray,
    tol: np.ndarray,
    w0: np.ndarray,
    cap: np.ndarray,
    w: np.ndarray,
) -> Fit:
    """One weighted least-squares solve with given weights (cheap screening of a structure)."""
    p = X.shape[1]
    if p == 0:
        return Fit(np.zeros(0), y.copy(), w, np.zeros(0, bool), robust_score(y, tol, w0, cap))
    keep = independent_columns(X)
    Xk = X[:, keep]
    norms = np.linalg.norm(Xk, axis=0)
    Xs = Xk / norms
    th = _solve(Xs, y, w)
    r = y - Xs @ th
    theta = np.zeros(p)
    theta[keep] = th / norms
    se = _stderr(Xs, w, norms, float(np.median(tol)), p, keep)
    return Fit(theta, r, w, keep, robust_score(r, tol, w0, cap), se)


def group_median(vals: np.ndarray, codes: np.ndarray, k: int) -> np.ndarray:
    out = np.full(k, math.nan)
    if len(vals) == 0:
        return out
    order = np.lexsort((vals, codes))
    sv = vals[order]
    counts = np.bincount(codes, minlength=k)
    starts = np.concatenate([[0], np.cumsum(counts)[:-1]])
    nz = counts > 0
    lo = starts + (counts - 1) // 2
    hi = starts + counts // 2
    out[nz] = (sv[lo[nz]] + sv[hi[nz]]) / 2
    return out


# --------------------------------------------------------------------------- per-segment state


@dataclass(frozen=True)
class TermSpec:
    key: KeySpec | None
    feat: FeatureSpec
    inside: bool = True  # multiplied by the factors (customer rate, rush ...) or added after them

    @property
    def ident(self) -> tuple[str, str]:
        return ("" if self.key is None else self.key.key(), self.feat.key())


class SegCtx:
    def __init__(self, cache: EvalCache, seg: str, idx: np.ndarray, flag_names: set[str] | None = None):
        self.flag_names = flag_names or set()
        self.cache = cache
        self.seg = seg
        self.idx = idx
        self.n = len(idx)
        self.day = cache.ds.day[idx]
        self._codes: dict[str, tuple[np.ndarray, list[str]]] = {}
        self._feat: dict[str, np.ndarray] = {}
        self._blocks: dict[tuple, tuple[np.ndarray, list[tuple[int, int]]]] = {}

    def codes(self, key: KeySpec | None) -> tuple[np.ndarray, list[str]]:
        k = "" if key is None else key.key()
        v = self._codes.get(k)
        if v is None:
            if key is None:
                v = (np.zeros(self.n, dtype=np.int64), [""])
            else:
                labels = self.cache.key_labels(key)[self.idx].astype(str)
                uniq, inv, cnt = np.unique(labels, return_inverse=True, return_counts=True)
                # ascending frequency: the most common level comes last and becomes the
                # baseline when the column set is collinear (e.g. with a constant term)
                order = np.lexsort((uniq, cnt))
                rank = np.empty(len(order), dtype=np.int64)
                rank[order] = np.arange(len(order))
                v = (rank[inv], [str(u) for u in uniq[order]])
            self._codes[k] = v
        return v

    def feat(self, fs: FeatureSpec) -> np.ndarray:
        k = fs.key()
        v = self._feat.get(k)
        if v is None:
            v = self.cache.feature(fs)[self.idx]
            self._feat[k] = v
        return v

    def vidx(self, breaks: list[int]) -> np.ndarray:
        if not breaks:
            return np.zeros(self.n, dtype=np.int64)
        return np.searchsorted(np.asarray(breaks), self.day, side="right").astype(np.int64)

    def block(self, t: TermSpec, breaks: list[int]) -> tuple[np.ndarray, list[tuple[int, int]]]:
        k = (t.ident, tuple(breaks))
        v = self._blocks.get(k)
        if v is None:
            vidx = self.vidx(breaks)
            codes, levels = self.codes(t.key)
            f = self.feat(t.feat)
            cols = []
            ent = []
            # a flag only carries a surcharge on its "1" level; "0"/blank stay at zero
            is_flag = t.key is not None and len(t.key.columns) == 1 and t.key.columns[0] in self.flag_names
            for ver in range(len(breaks) + 1):
                vm = vidx == ver
                for li in range(len(levels)):
                    if is_flag and levels[li] != "1":
                        continue
                    col = np.where(vm & (codes == li), f, 0.0)
                    if np.any(col != 0):
                        cols.append(col)
                        ent.append((li, ver))
            mat = np.column_stack(cols) if cols else np.zeros((self.n, 0))
            v = (mat, ent)
            self._blocks[k] = v
        return v


def build_design(
    ctx: SegCtx, terms: list[TermSpec], breaks: list[int]
) -> tuple[np.ndarray, list[tuple[int, int, int]]]:
    mats = []
    cmap: list[tuple[int, int, int]] = []
    for ti, t in enumerate(terms):
        mat, ent = ctx.block(t, breaks)
        mats.append(mat)
        cmap.extend((ti, li, v) for li, v in ent)
    if not mats:
        return np.zeros((ctx.n, 0)), cmap
    return np.hstack(mats), cmap


@dataclass
class SegModel:
    seg: str
    ctx: SegCtx
    terms: list[TermSpec] = field(default_factory=list)
    breaks: list[int] = field(default_factory=list)
    theta: np.ndarray = field(default_factory=lambda: np.zeros(0))
    cmap: list[tuple[int, int, int]] = field(default_factory=list)
    keep: np.ndarray = field(default_factory=lambda: np.zeros(0, bool))
    pred: np.ndarray = field(default_factory=lambda: np.zeros(0))  # full prediction, rows of segment
    pred_in: np.ndarray = field(default_factory=lambda: np.zeros(0))  # part before multipliers
    pred_out: np.ndarray = field(default_factory=lambda: np.zeros(0))  # part added after them
    score: float = math.inf
    nparam: int = 0
    w: np.ndarray = field(default_factory=lambda: np.zeros(0))


def count_params(
    theta: np.ndarray, cmap: list[tuple[int, int, int]], keep: np.ndarray, se: np.ndarray | None = None
) -> int:
    """Free parameters; a later-version value counts only when it differs significantly
    from the value of the previous version (otherwise the two would be merged)."""
    vals: dict[tuple[int, int, int], tuple[float, float]] = {}
    for j, ((ti, li, v), th, k) in enumerate(zip(cmap, theta, keep, strict=True)):
        if k:
            vals[(ti, li, v)] = (float(th), math.inf if se is None else float(se[j]))
    n = 0
    for (ti, li, v), (th, s1) in vals.items():
        prev = None
        for pv in range(v - 1, -1, -1):
            if (ti, li, pv) in vals:
                prev = vals[(ti, li, pv)]
                break
        if prev is None:
            n += 1
            continue
        p0, s0 = prev
        thr = 3.0 * math.sqrt(s1 * s1 + s0 * s0) if math.isfinite(s1 + s0) else 0.015 * abs(p0)
        if abs(th - p0) > max(thr, 1e-6, 0.002 * abs(p0)):
            n += 1
    return n


class Searcher:
    def __init__(self, ds: Dataset, cfg: Config, lib: Library, cache: EvalCache, log=None):
        self.ds = ds
        self.cfg = cfg
        self.lib = lib
        self.cache = cache
        self.lam = float(cfg.s("penalty"))
        base_log = log or (lambda *_: None)
        self.log = lambda m: base_log(f"{m}  [{self.elapsed():.0f}s {self.work() / 1e9:.1f}G]")
        self.t0 = time.time()
        self.work0 = WORK[0]
        self.time_capped = False
        self.seg_limit: float | None = None  # per-segment share of the budget (segment_pass)
        n = ds.n
        # rounding unit by divisibility, per rep when reps differ (e.g. one rep rounds to 10 yen)
        self.unit = detect_units(ds)
        self.unit_rows = np.full(n, float(self.unit))
        self.unit_groups: dict[str, int] = {}
        rep_col = cfg.columns.get("rep")
        if rep_col and rep_col in cache.env:
            g = ex.as_str(cache.env[rep_col], n)
            per = {}
            for name in sorted(set(g)):
                m = g == name
                if m.sum() >= 20:
                    per[name] = (detect_units(ds, m), int(m.sum()))
            if len({u for u, _ in per.values()}) > 1:
                weight: dict[int, int] = {}
                for u, c in per.values():
                    weight[u] = weight.get(u, 0) + c
                self.unit = max(weight, key=lambda u: (weight[u], u))
                self.unit_rows[:] = self.unit
                for name, (u, _) in per.items():
                    if u != self.unit:
                        self.unit_groups[name] = u
                        self.unit_rows[g == name] = u
        self.rep_col = rep_col
        self.y = self._initial_y()
        self.w0 = np.where(ds.ambiguous(), 0.7, 1.0)
        self.w0[np.isnan(self.y)] = 0.0
        self.y = np.nan_to_num(self.y, nan=0.0)
        self.F = np.ones(n)
        self.mults: list[tuple[KeySpec, dict[str, float]]] = []
        self.cust_over: dict[str, float] = {}
        segs = ex.as_str(ds.segment, n)
        # one set shared with the segment contexts (tier discovery adds flags on the way)
        self.flag_names = {f.name for f in lib.flags}
        self.segments: dict[str, SegModel] = {}
        for s in sorted(set(segs)):
            idx = np.nonzero(segs == s)[0]
            self.segments[s] = SegModel(s, SegCtx(cache, s, idx, self.flag_names))
        self.pred_lin = np.zeros(n)
        self.pred_out = np.zeros(n)
        self.ordinal = set(lib.ordinal_columns)
        self.period_flags: dict[str, int] = {}
        self.plain = self._plain_rows()
        self.plain_only = False
        self.main_effects = False
        self.ridge = 0.0
        self.tol_scale = 1.0  # > 1 while a forward search is still far from exact (coarse-to-fine)

    # ------------------------------------------------------------------ targets
    def _initial_y(self) -> np.ndarray:
        ds = self.ds
        a, b = ds.candidates("floor")
        y = np.where(a >= 0, a, b).astype(float)
        amb = (a >= 0) & (b >= 0)
        if amb.any():
            u = self.unit
            a_ok = (a % u) == 0
            b_ok = (b % u) == 0
            n_incl = int(np.sum((a < 0) & (b >= 0)))
            n_excl = int(np.sum((a >= 0) & (b < 0)))
            prefer_b = n_incl > n_excl
            choose_b = amb & ((b_ok & ~a_ok) | (prefer_b & (a_ok == b_ok)))
            y = np.where(choose_b, b, y)
        y[(a < 0) & (b < 0)] = math.nan
        return y

    def _refresh_ambiguous(self) -> None:
        a, b = self.ds.candidates("floor")
        amb = (a >= 0) & (b >= 0)
        if not amb.any():
            return
        pred = self.pred_lin * self.F
        self.y = np.where(amb, np.where(np.abs(a - pred) <= np.abs(b - pred), a, b), self.y).astype(float)

    def _plain_rows(self) -> np.ndarray:
        """Quotes most likely priced at the plain list price: the most common customer class,
        no (rare) keyword in the remarks, not a re-issue. The first additive model is fitted
        on these only, so that factors (customer rates, rush) are measured against prices
        they did not distort. Segments with too few plain quotes use all of them."""
        ds = self.ds
        n = ds.n
        plain = ~ds.is_revision.copy()
        cls = ex.as_str(ds.customer_class, n)
        if self.cfg.customer_class:
            vals, cnt = np.unique(cls, return_counts=True)
            plain &= cls == vals[int(np.argmax(cnt))]
        for f in self.lib.flags:
            if f.kind != "keyword":
                continue
            hit = ex.as_str(self.cache.env[f.name], n) == "1"
            if hit.sum() <= 0.3 * n:
                plain &= ~hit
        segs = ex.as_str(ds.segment, n)
        for s in set(segs):
            m = segs == s
            if (plain & m).sum() < max(30, 0.15 * m.sum()):
                plain[m] = True
        return plain

    def targets(self, idx: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        u = self.unit_rows[idx]
        y = self.y[idx] + u / 2.0
        tol = np.maximum(u, 1.0) * self.tol_scale
        cap = np.log2(2.0 + np.abs(y) / tol)
        w = self.w0[idx] * self.plain[idx] if self.plain_only else self.w0[idx]
        return y, tol, w, cap

    def design(
        self, sm: SegModel, terms: list[TermSpec], breaks: list[int]
    ) -> tuple[np.ndarray, list[tuple[int, int, int]], np.ndarray]:
        """Design matrix with the columns of 'inside' terms multiplied by the row factors."""
        X, cmap = build_design(sm.ctx, terms, breaks)
        inside = np.array([terms[ti].inside for ti, _, _ in cmap], dtype=bool)
        if X.shape[1] and inside.any():
            X[:, inside] *= self.F[sm.ctx.idx][:, None]
        return X, cmap, inside

    def elapsed(self) -> float:
        return time.time() - self.t0

    def work(self) -> int:
        return WORK[0] - self.work0

    def budget_left(self, frac: float) -> bool:
        """Deterministic budget (work units); the wall-clock cap is only a safety net and is
        reported when it is hit, because then the result depends on the machine."""
        if self.elapsed() >= float(self.cfg.s("time_budget_s")) * frac:
            self.time_capped = True
            return False
        if self.seg_limit is not None and self.work() >= self.seg_limit:
            return False
        return self.work() < float(self.cfg.s("work_budget")) * 1e9 * frac

    # ------------------------------------------------------------------ linear fit per segment
    def fit_terms(self, sm: SegModel, terms: list[TermSpec], breaks: list[int] | None = None) -> SegModel:
        breaks = sm.breaks if breaks is None else breaks
        y, tol, w0, cap = self.targets(sm.ctx.idx)
        X, cmap, inside = self.design(sm, terms, breaks)
        fit = robust_fit(X, y, tol, w0, cap, ridge=self.ridge)
        n = sm.ctx.n
        if X.shape[1]:
            pred = X @ fit.theta
            pred_out = X[:, ~inside] @ fit.theta[~inside] if (~inside).any() else np.zeros(n)
        else:
            pred = np.zeros(n)
            pred_out = np.zeros(n)
        pred_in = (pred - pred_out) / self.F[sm.ctx.idx]
        npar = count_params(fit.theta, cmap, fit.keep, fit.se)
        return SegModel(
            sm.seg,
            sm.ctx,
            list(terms),
            list(breaks),
            fit.theta,
            cmap,
            fit.keep,
            pred,
            pred_in,
            pred_out,
            fit.score,
            npar,
            fit.w,
        )

    def quick_total(self, sm: SegModel, terms: list[TermSpec]) -> float:
        y, tol, w0, cap = self.targets(sm.ctx.idx)
        X, cmap, _ = self.design(sm, terms, sm.breaks)
        fit = fixed_weight_fit(X, y, tol, w0, cap, sm.w if len(sm.w) else w0)
        return fit.score + self.lam * count_params(fit.theta, cmap, fit.keep, fit.se)

    def total(self, sm: SegModel) -> float:
        return sm.score + self.lam * sm.nparam

    def base_features(self, sm: SegModel) -> list[FeatureSpec]:
        ctx = sm.ctx
        base = {"1", *self.lib.numeric_columns, *self.cfg.features}
        out = []
        for f in self.lib.features:
            if f.expr in base and np.count_nonzero(ctx.feat(f)) >= 2:
                out.append(f)
        return out

    def rich_terms(self, sm: SegModel) -> list[TermSpec]:
        ctx = sm.ctx
        feats = self.base_features(sm)
        keys: list[KeySpec | None] = [None]
        ordinal_keys = []
        for k in self.lib.keys:
            c = k.columns[0]
            if c in self.flag_names:
                continue
            _, levels = ctx.codes(k)
            if len(levels) <= 1:
                continue
            if c not in self.ordinal:
                keys.append(k)
            elif self.cfg.s("ordinal_keys_in_rich") and len(levels) <= 15:
                # small numeric columns (quantity steps, character heights ...) as lookup keys
                ordinal_keys.append((len(levels), k.key(), k))
        # ... but only as many as the segment can pin down
        cols = sum(len(ctx.codes(k)[1]) if k is not None else 1 for k in keys) * max(len(feats), 1)
        limit = max(40.0, ctx.n * float(self.cfg.s("rich_max_cols_per_quote")))
        for nlev, _, k in sorted(ordinal_keys, key=lambda t: (t[0], t[1])):
            extra = nlev * max(len(feats), 1)
            if cols + extra > limit:
                break
            keys.append(k)
            cols += extra
        # flags (keywords, thresholds) are left out on purpose: additive flag terms would
        # absorb multiplicative effects (rush ×1.3) and hide them from the factor search;
        # they enter later through the forward phase.
        out = []
        for k in keys:
            for f in feats:
                t = self.canonical(TermSpec(k, f))
                if t is not None and t.ident not in {x.ident for x in out}:
                    out.append(t)
        return out

    def canonical(self, t: TermSpec) -> TermSpec | None:
        """``(K × rest)`` keyed by a numeric column K is just ``rest`` keyed by K (a lookup
        table with round prices instead of per-unit slopes)."""
        if t.key is None or len(t.key.columns) != 1 or t.key.columns[0] not in self.ordinal:
            return t
        k = t.key.columns[0]
        from .library import product_factors

        if t.feat.full_expr.replace(" ", "") == k:
            return TermSpec(t.key, FeatureSpec("1"), t.inside)
        for a, rest in product_factors(t.feat.full_expr):
            if a.replace(" ", "") == k:
                return TermSpec(t.key, FeatureSpec(rest), t.inside)
        return t

    def phase2_candidates(self, sm: SegModel) -> list[TermSpec]:
        ctx = sm.ctx
        used_feats = {t.feat.key(): t.feat for t in sm.terms}
        all_feats = [f for f in self.lib.features if np.count_nonzero(ctx.feat(f)) >= 2]
        numeric = [f for f in all_feats if not f.is_const]
        have = {t.ident for t in sm.terms}
        out: list[TermSpec] = []

        def add(k: KeySpec | None, f: FeatureSpec) -> None:
            t = self.canonical(TermSpec(k, f))
            if t is not None and t.ident not in have:
                have.add(t.ident)
                out.append(t)

        singles = []
        for k in self.lib.keys:
            _, levels = ctx.codes(k)
            if len(levels) > 1:
                singles.append(k)
        # main effects (the terms of the rich model), for a search that starts small
        if self.cfg.s("start") == "empty" or self.main_effects:
            for t in self.rich_terms(sm):
                add(t.key, t.feat)
        # products of numeric columns (no key or one key)
        for f in all_feats:
            if f.expr not in {"1", *self.lib.numeric_columns, *self.cfg.features}:
                add(None, f)
                for k in singles:
                    if k.columns[0] not in self.flag_names and k.columns[0] not in self.ordinal:
                        add(k, f)
        # flags × features (constant surcharge or per-quantity surcharge)
        for k in singles:
            if k.columns[0] in self.flag_names:
                for f in [FeatureSpec("1"), *numeric]:
                    add(k, f)
        # tier steps read off the residuals (thresholds the config did not list)
        if self.cfg.s("tier_discovery"):
            for k, f in self.tier_candidates(sm, [FeatureSpec("1"), *numeric]):
                add(k, f)
        # lookup tables on small numeric columns and two-column keys × features in use
        for k in singles:
            if k.columns[0] in self.ordinal and len(ctx.codes(k)[1]) <= 25:
                for f in [*used_feats.values(), *self.base_features(sm)]:
                    add(k, f)
        for k in self.lib.pair_keys:
            _, levels = ctx.codes(k)
            if len(levels) > 1:
                for f in used_feats.values():
                    add(k, f)
        return out

    def tier_candidates(self, sm: SegModel, feats: list[FeatureSpec]) -> list[tuple[KeySpec, FeatureSpec]]:
        """Step thresholds suggested by the data: for each numeric column and feature, the cut
        that best splits the per-unit residual ``r / (feature × factors)`` of the segment into
        two levels (least absolute deviation around each side's median). The cut becomes a
        threshold flag ``column >= value`` (a tier step), offered as a candidate term."""
        ctx = sm.ctx
        y, _, w0, _ = self.targets(ctx.idx)
        r = y - sm.pred
        Fs = self.F[ctx.idx]
        cols = list(dict.fromkeys([*self.lib.numeric_columns, *self.cfg.thresholds]))
        out = []
        new_flags = []
        for col in cols:
            if col not in self.cache.env:
                continue
            x = ex.as_float(self.cache.env[col], self.ds.n)[ctx.idx]
            for f in feats:
                fv = ctx.feat(f) * Fs
                m = (np.abs(fv) > 1e-12) & ~np.isnan(x) & (w0 > 0)
                if m.sum() < 10:
                    continue
                z = r[m] / fv[m]
                xs = x[m]
                ux = np.unique(xs)
                if len(ux) < 3:
                    continue
                order = np.argsort(xs, kind="stable")
                zs, xs_sorted = z[order], xs[order]
                base = float(np.sum(np.abs(zs - np.median(zs))))
                best = None
                for c in ux[1:]:
                    left = xs_sorted < c
                    nl = int(left.sum())
                    if nl < 3 or len(zs) - nl < 3:
                        continue
                    zl, zr = zs[left], zs[~left]
                    cost = float(np.sum(np.abs(zl - np.median(zl))) + np.sum(np.abs(zr - np.median(zr))))
                    if best is None or cost < best[0]:
                        best = (cost, float(c))
                if best is None or best[0] > 0.8 * base:
                    continue
                name = f"{col}>={best[1]:g}"
                if name not in self.flag_names:
                    new_flags.append(FlagSpec(name, "threshold", (col,), threshold=best[1]))
                    self.flag_names.add(name)
                out.append((KeySpec((name,)), f))
        if new_flags:
            self.lib.flags.extend(new_flags)
            self.cache.ensure_flags(new_flags)
        return out

    def screen(self, sm: SegModel, cands: list[TermSpec], top: int) -> list[TermSpec]:
        y, tol, w0, cap = self.targets(sm.ctx.idx)
        r = y - sm.pred
        Fs = self.F[sm.ctx.idx]
        scored = []
        for t in cands:
            codes, levels = sm.ctx.codes(t.key)
            f = sm.ctx.feat(t.feat) * (Fs if t.inside else 1.0)
            m = f != 0
            if m.sum() < 2:
                continue
            med = np.nan_to_num(group_median(r[m] / f[m], codes[m], len(levels)))
            used = int(np.sum(np.abs(med) > 1e-9))
            r2 = r - med[codes] * f
            scored.append((robust_score(r2, tol, w0, cap) + self.lam * used, len(scored), t))
        scored.sort(key=lambda s: (s[0], s[1]))
        short = [t for _, _, t in scored[: top * 4]]
        # second screen: one weighted solve with the current weights
        rescored = []
        for i, t in enumerate(short):
            rescored.append((self.quick_total(sm, [*sm.terms, t]), i, t))
        rescored.sort(key=lambda s: (s[0], s[1]))
        return [t for _, _, t in rescored[:top]]

    def forward(self, sm: SegModel, max_terms: int, quiet: bool = False) -> SegModel:
        """Greedy forward selection by MDL. Far from an exact fit, residual bits at the
        precision of one rounding unit barely react to a term that halves the error, so the
        precision is coarsened to the current robust spread (coarse-to-fine) and refined as
        the model improves."""
        anneal = bool(self.cfg.s("anneal_forward"))
        while len(sm.terms) < max_terms and self.budget_left(0.6):
            if anneal:
                y, _, w0, _ = self.targets(sm.ctx.idx)
                spread = 1.4826 * float(np.median(np.abs((y - sm.pred)[w0 > 0]))) if np.any(w0 > 0) else 0.0
                scale = max(1.0, spread / (4.0 * float(np.median(np.maximum(self.unit_rows[sm.ctx.idx], 1.0)))))
                if abs(scale - self.tol_scale) > 1e-9:
                    self.tol_scale = scale
                    sm = self.fit_terms(sm, sm.terms)
            cands = self.screen(sm, self.phase2_candidates(sm), top=4)
            best = None
            for t in cands:
                trial = self.fit_terms(sm, [*sm.terms, t])
                if best is None or self.total(trial) < self.total(best):
                    best = trial
            if best is None or self.total(best) >= self.total(sm) - 1.0:
                break
            sm = best
            if not quiet:
                self.log(f"  [{sm.seg}] + {_term_name(sm.terms[-1])}  bits={sm.score:.0f} params={sm.nparam}")
        if self.tol_scale != 1.0:
            self.tol_scale = 1.0
            sm = self.fit_terms(sm, sm.terms)
        return sm

    @staticmethod
    def _is_base(t: TermSpec) -> bool:
        """The base fee (constant, no key) is always kept: keyed constant tables are then
        surcharges relative to it (dummy coding) and cannot absorb the base fee."""
        return t.key is None and t.feat.is_const and t.inside

    def wald_prune(self, sm: SegModel) -> SegModel:
        """Batch backward elimination using Wald statistics (fast, approximate).

        For a block of coefficients B, removing it costs about ``W_B / (2 ln 2)`` bits of
        residual description length and saves ``λ·|B|`` bits of parameters.
        """
        for _ in range(60):
            if len(sm.terms) <= 1 or not self.budget_left(0.6):
                break
            tol = self.targets(sm.ctx.idx)[1]
            X, cmap, _ = self.design(sm, sm.terms, sm.breaks)
            keep = sm.keep
            Xk = X[:, keep]
            norms = np.linalg.norm(Xk, axis=0)
            Xs = Xk / norms
            A = (Xs * sm.w[:, None]).T @ Xs
            inv = np.linalg.pinv(A, rcond=1e-10)
            ths = sm.theta[keep] * norms
            kept_idx = np.nonzero(keep)[0]
            term_of = np.array([cmap[j][0] for j in kept_idx])
            sigma2 = float(np.median(tol)) ** 2
            gains = []
            for ti in range(len(sm.terms)):
                if self._is_base(sm.terms[ti]):
                    continue
                cols = np.nonzero(term_of == ti)[0]
                if len(cols) == 0:
                    gains.append((self.lam, ti))  # fully collinear: free to drop
                    continue
                sub = inv[np.ix_(cols, cols)]
                try:
                    wald = float(ths[cols] @ np.linalg.solve(sub, ths[cols])) / sigma2
                except np.linalg.LinAlgError:
                    wald = float(ths[cols] @ np.linalg.pinv(sub) @ ths[cols]) / sigma2
                cost = wald / (2 * math.log(2))
                gains.append((self.lam * len(cols) - cost, ti))
            pos = sorted([g for g in gains if g[0] > 0], reverse=True)
            if not pos:
                break
            # drop a batch of the most clearly useless blocks; when the refit says the
            # approximation was too optimistic, halve the batch (down to a single block)
            k = max(1, len(pos) // 2)
            accepted = None
            while True:
                drop = {ti for _, ti in pos[:k]}
                trial = self.fit_terms(sm, [t for i, t in enumerate(sm.terms) if i not in drop])
                if self.total(trial) < self.total(sm):
                    accepted = trial
                    break
                if k == 1 or not self.budget_left(0.6):
                    break
                k //= 2
            if accepted is None:
                break
            sm = accepted
        return sm

    def backward(self, sm: SegModel) -> SegModel:
        sm = self.wald_prune(sm)
        while len(sm.terms) > 1 and self.budget_left(0.6):
            cur = self.total(sm)
            approx = []
            for i in range(len(sm.terms)):
                if self._is_base(sm.terms[i]):
                    continue
                if not self.budget_left(0.6):
                    break
                approx.append((self.quick_total(sm, sm.terms[:i] + sm.terms[i + 1 :]), i))
            approx.sort()
            best = None
            for _, i in approx[:4]:
                trial = self.fit_terms(sm, sm.terms[:i] + sm.terms[i + 1 :])
                if best is None or self.total(trial) < self.total(best[1]):
                    best = (i, trial)
            keep_tie = best is not None and sm.terms[best[0]].key is None and sm.terms[best[0]].feat.is_const
            if best is None or self.total(best[1]) > cur or (keep_tie and self.total(best[1]) >= cur - 0.5):
                # ties remove redundant (collinear) terms, but keep the base fee next to a keyed table
                break
            self.log(f"  [{sm.seg}] - {_term_name(sm.terms[best[0]])}")
            sm = best[1]
        return sm

    def refresh_pred(self) -> None:
        for sm in self.segments.values():
            if len(sm.pred_in):
                self.pred_lin[sm.ctx.idx] = sm.pred_in
                self.pred_out[sm.ctx.idx] = sm.pred_out

    def refit_all(self) -> None:
        for s, sm in self.segments.items():
            if sm.terms:
                self.segments[s] = self.fit_terms(sm, sm.terms)
        self.refresh_pred()

    # ------------------------------------------------------------------ multipliers
    def _ratio(self) -> np.ndarray:
        with np.errstate(divide="ignore", invalid="ignore"):
            r = (self.y + self.unit_rows / 2.0 - self.pred_out) / (self.pred_lin * self.F)
        return np.where(np.isfinite(r), r, math.nan)

    def _mult_factor_table(self, key: KeySpec, ratio: np.ndarray) -> dict[str, float]:
        labels = self.cache.key_labels(key).astype(str)
        ok = (ratio > 0.3) & (ratio < 3.0) & (self.w0 > 0)
        out: dict[str, float] = {}
        for lab in sorted(set(labels)):
            m = ok & (labels == lab)
            if m.sum() == 0:
                continue
            out[lab] = round(float(np.median(ratio[m])), 4)
        return out

    def _apply_table(self, key: KeySpec, table: dict[str, float]) -> np.ndarray:
        labels = self.cache.key_labels(key).astype(str)
        return np.array([table.get(lab, 1.0) for lab in labels])

    def _normalise(self, key: KeySpec, table: dict[str, float]) -> tuple[dict[str, float], float]:
        """Scale a factor table so that its most common level is exactly 1."""
        labels = self.cache.key_labels(key).astype(str)
        cnt = {lab: int(np.sum(labels == lab)) for lab in table}
        anchor = max(cnt, key=lambda k: (cnt[k], k))
        a = table[anchor] or 1.0
        return {k: round(v / a, 4) for k, v in table.items()}, a

    def _global_score(self, F: np.ndarray, rows: np.ndarray | None = None) -> float:
        u = self.unit_rows
        res = self.y + u / 2 - self.pred_lin * F - self.pred_out
        tol = np.maximum(u, 1.0)
        cap = np.log2(2.0 + np.abs(self.y) / tol)
        if rows is None:
            return robust_score(res, tol, self.w0, cap)
        return robust_score(res[rows], tol[rows], self.w0[rows], cap[rows])

    def _mult_product(self) -> np.ndarray:
        F = np.ones(self.ds.n)
        for key, table in self.mults:
            F = F * self._apply_table(key, table)
        if self.cust_over:
            cust = self.ds.customer.astype(str)
            F = F * np.array([self.cust_over.get(c, 1.0) for c in cust])
        return F

    def global_total(self) -> float:
        lin = sum(self.total(sm) for sm in self.segments.values() if sm.terms)
        mpar = sum(sum(1 for v in t.values() if abs(v - 1) > 0.002) for _, t in self.mults)
        return lin + self.lam * (mpar + len(self.cust_over))

    def period_keys(self) -> list[KeySpec]:
        """Date flags (on/after the 1st of each month) for price-level changes over time."""
        out = []
        flags = []
        for b in self.month_starts():
            name = f"date>={day_to_iso(b)}"
            self.period_flags[name] = b
            flags.append(FlagSpec(name, "threshold", ("_day",), threshold=float(b)))
            out.append(KeySpec((name,)))
            if len(self.segments) > 1:
                out.append(KeySpec(("_segment", name)))
        self.cache.ensure_flags(flags)
        return out

    def family(self, key: KeySpec) -> set[str]:
        """Columns whose additive terms compete with a multiplier on ``key``.

        For a flag this is every flag derived from the same source column (all thresholds of
        ``lead_days``, all keywords of ``notes``), so that nested flags cannot absorb the effect.
        """
        out = set(key.columns)
        src = {c for f in self.lib.flags if f.name in key.columns for c in f.columns}
        if src:
            out |= {f.name for f in self.lib.flags if set(f.columns) & src}
        return out

    def _trial(self, F: np.ndarray, drop_cols: set[str]) -> tuple[float, dict[str, SegModel]]:
        saved = self.F
        self.F = F
        models: dict[str, SegModel] = {}
        tot = 0.0
        try:
            for s, sm in self.segments.items():
                if not sm.terms:
                    continue
                terms = [t for t in sm.terms if t.key is None or not (set(t.key.columns) & drop_cols)]
                m = self.fit_terms(sm, terms)
                models[s] = m
                tot += self.total(m)
        finally:
            self.F = saved
        return tot, models

    def _in_model(self, cols: set[str]) -> bool:
        return any(t.key is not None and set(t.key.columns) & cols for sm in self.segments.values() for t in sm.terms)

    def _drop_family(self, fam: set[str]) -> None:
        for s, sm in self.segments.items():
            if not sm.terms:
                continue
            terms = [t for t in sm.terms if t.key is None or not (set(t.key.columns) & fam)]
            if len(terms) != len(sm.terms):
                self.segments[s] = self.fit_terms(sm, terms)
        self.refresh_pred()

    def _key_dummies(self, key: KeySpec, ok: np.ndarray) -> tuple[list[np.ndarray], list[str], str]:
        labels = self.cache.key_labels(key).astype(str)
        levels, cnt = np.unique(labels[ok], return_counts=True)
        if len(levels) < 2:
            return [], [], ""
        anchor = str(levels[int(np.argmax(cnt))])
        cols, names = [], []
        for lev, c in zip(levels, cnt, strict=True):
            if str(lev) == anchor or c < 3:
                continue
            cols.append((labels == lev).astype(float))
            names.append(str(lev))
        return cols, names, anchor

    def _additive_better(self, key: KeySpec, levels: list[str]) -> bool:
        """Is the effect of a flag better described as an additive surcharge than as a factor?

        On the rows where the flag is set, the residual of the current model is regressed
        (robustly) on two explanations at once: ``δ × price`` (a factor, e.g. rush × 1.3)
        and ``a_segment × factors`` (a fixed surcharge, e.g. night work + 15,000, possibly
        different per segment). A fixed surcharge on quotes of very different sizes looks
        like a factor of 5-30 % to a ratio test; the joint regression tells them apart
        because only a factor grows with the price. The flag is treated as additive when
        the fixed part explains more of the typical effect than the proportional part.
        """
        u = self.unit_rows
        base_in = self.pred_lin * self.F
        r = self.y + u / 2.0 - base_in - self.pred_out
        labels = self.cache.key_labels(key).astype(str)
        segs = ex.as_str(self.ds.segment, self.ds.n)
        add_total = mult_total = 0.0
        for lev in levels:
            m = (labels == lev) & (self.w0 > 0) & np.isfinite(r) & (base_in > 0)
            if m.sum() < 5:
                continue
            rows = np.nonzero(m)[0]
            cols = [base_in[rows]]
            for sg in np.unique(segs[rows]):
                cols.append(np.where(segs[rows] == sg, self.F[rows], 0.0))
            X = np.column_stack(cols)
            rr = r[rows]
            scale = max(float(np.median(np.abs(rr - np.median(rr)))) * 1.4826, float(np.median(u[rows])))
            tol = np.full(len(rows), scale / 4.0)
            fit = robust_fit(X, rr, tol, np.ones(len(rows)), np.log2(2.0 + np.abs(rr) / tol))
            delta = float(fit.theta[0])
            mult_part = abs(delta) * float(np.median(base_in[rows]))
            a_row = (X[:, 1:] @ fit.theta[1:]) if X.shape[1] > 1 else np.zeros(len(rows))
            add_part = float(np.median(np.abs(a_row)))
            # levels weigh in by how many quotes they cover (a level without an effect
            # has both parts near zero and does not matter)
            add_total += add_part * len(rows)
            mult_total += mult_part * len(rows)
        return add_total > mult_total

    def joint_multipliers(self, keys: list[KeySpec]) -> list[tuple[KeySpec, dict[str, float]]]:
        """Robust regression of the log price ratio on indicator columns of all candidate keys,
        followed by MDL backward elimination of whole keys. Returns the surviving factor tables."""
        u = self.unit_rows
        y = self.y + u / 2.0
        with np.errstate(divide="ignore", invalid="ignore"):
            ratio = (y - self.pred_out) / (self.pred_lin * self.F)
        ok = np.isfinite(ratio) & (ratio > 0.5) & (ratio < 2.0) & (self.w0 > 0)
        if ok.sum() < 20:
            return []
        z = np.log(np.where(ok, ratio, 1.0))
        tol = np.maximum(u / np.maximum(y, 1.0), 1e-4)
        cap = np.log2(2.0 + np.abs(z) / tol)
        w0 = np.where(ok, self.w0, 0.0)
        blocks: list[tuple[KeySpec, list[np.ndarray], list[str]]] = []
        base0 = robust_fit(np.ones((self.ds.n, 1)), z, tol, w0, cap).score
        marginal = []
        for key in keys:
            cols, names, _ = self._key_dummies(key, ok)
            if not cols:
                continue
            if key.columns[0] in self.flag_names and self.cfg.s("additive_test") and self._additive_better(key, names):
                continue
            f = robust_fit(np.column_stack([np.ones(self.ds.n), *cols]), z, tol, w0, cap)
            gain = base0 - f.score - self.lam * len(cols)
            if gain > 0:
                is_period = key.columns[-1] in self.period_flags
                marginal.append((gain, is_period, key.key(), key, cols, names))
        marginal.sort(key=lambda m: (-m[0], m[2]))
        periods = [m for m in marginal if m[1]][:1]  # one revision step per round (nested steps are collinear)
        others = [m for m in marginal if not m[1]][:12]
        for _, _, _, key, cols, names in periods + others:
            blocks.append((key, cols, names))

        def fit(active: list[int]) -> tuple[float, int, np.ndarray, list[tuple[int, str]]]:
            mats = [np.ones(self.ds.n)]
            owners: list[tuple[int, str]] = [(-1, "")]
            for b in active:
                for c, nm in zip(blocks[b][1], blocks[b][2], strict=True):
                    mats.append(c)
                    owners.append((b, nm))
            X = np.column_stack(mats)
            f = robust_fit(X, z, tol, w0, cap)
            return f.score + self.lam * int(f.keep.sum()), int(f.keep.sum()), f.theta, owners

        active = list(range(len(blocks)))
        cur, _, theta, owners = fit(active)
        while active and self.budget_left(0.5):
            best = None
            for b in active:
                trial = [a for a in active if a != b]
                tot = fit(trial)
                if best is None or tot[0] < best[1][0]:
                    best = (b, tot)
            if best is None or best[1][0] > cur:
                break
            active = [a for a in active if a != best[0]]
            cur, _, theta, owners = best[1]
        out = []
        for b in active:
            key = blocks[b][0]
            table = {}
            for (ob, nm), th in zip(owners, theta, strict=True):
                if ob == b and abs(th) > 1e-4:
                    table[nm] = round(math.exp(th), 4)
            if table:
                labels = self.cache.key_labels(key).astype(str)
                for lev in set(labels[ok]):
                    table.setdefault(str(lev), 1.0)
                out.append((key, table))
        return out

    def discover_multipliers(self, rounds: int = 3) -> None:
        """Joint multiplicative factors (see :meth:`joint_multipliers`), alternated with the
        linear refit. Additive constant terms on a selected key are dropped (the factor
        replaces them); flag × quantity terms come back later if they still pay."""
        for _ in range(rounds):
            if not self.budget_left(0.5):
                break
            used = {k.key() for k, _ in self.mults}
            keys = [k for k in self.lib.mult_keys + self.period_keys() if k.key() not in used and len(k.columns) == 1]
            found = self.joint_multipliers(keys)
            if not found:
                break
            for key, table in found:
                self.mults.append((key, table))
                self.log(f"  multiplier + {key.columns}: {_short({k: v for k, v in table.items() if v != 1.0})}")
            self.F = self._mult_product()
            drop: set[str] = set()
            for key, _ in found:
                drop |= set(key.columns)
            self._drop_family(drop)
            self.reestimate_multipliers(overrides=False)

    def swap_test(self) -> None:
        """For every flag factor, try the additive reading instead: drop the factor and add the
        best surcharge terms on the same flag (constant and/or per quantity), segment by
        segment. Keep whichever description is shorter."""
        for i in range(len(self.mults) - 1, -1, -1):
            key, table = self.mults[i]
            if key.columns[0] not in self.flag_names:
                continue
            nfree = sum(1 for v in table.values() if abs(v - 1) > 0.002)
            cur = self.global_total()
            rest = self.mults[:i] + self.mults[i + 1 :]
            saved_mults, saved_F, saved_segs = self.mults, self.F, dict(self.segments)
            self.mults = rest
            self.F = self._mult_product()
            for s, sm in self.segments.items():
                if not sm.terms:
                    continue
                sm = self.fit_terms(sm, sm.terms)
                cands = [TermSpec(key, f) for f in self.base_features(sm)]
                cands = [t for t in cands if t.ident not in {x.ident for x in sm.terms}]
                while cands and self.budget_left(0.9):
                    best = None
                    for t in cands:
                        trial = self.fit_terms(sm, [*sm.terms, t])
                        if best is None or self.total(trial) < self.total(best[1]):
                            best = (t, trial)
                    if best is None or self.total(best[1]) >= self.total(sm) - 1.0:
                        break
                    sm = best[1]
                    cands = [t for t in cands if t.ident != best[0].ident]
                self.segments[s] = sm
            self.refresh_pred()
            new = self.global_total()
            if new < cur:
                self.log(
                    f"  multiplier {key.columns} -> additive surcharge ({cur:.0f} -> {new:.0f} bits, {nfree} factors)"
                )
            else:
                self.mults, self.F, self.segments = saved_mults, saved_F, saved_segs
                self.refresh_pred()

    def refine_breaks(self, months: int = 6) -> None:
        """Move each revision date to the month start (within ±``months``) with the shortest description."""
        starts = self.month_starts()
        for s, sm in self.segments.items():
            if not sm.breaks or not sm.terms:
                continue
            for j in range(len(sm.breaks)):
                b = sm.breaks[j]
                best = (self.total(sm), b, sm)
                for c in starts:
                    if c == b or abs(c - b) > months * 31 or c in sm.breaks:
                        continue
                    if not self.budget_left(0.9):
                        break
                    br = sorted([*sm.breaks[:j], c, *sm.breaks[j + 1 :]])
                    trial = self.fit_terms(sm, sm.terms, br)
                    if self.total(trial) < best[0]:
                        best = (self.total(trial), c, trial)
                if best[1] != b:
                    self.log(f"  [{s}] revision {day_to_iso(b)} -> {day_to_iso(best[1])}")
                    sm = best[2]
            self.segments[s] = sm
        self.refresh_pred()

    def reestimate_multipliers(self, overrides: bool = True) -> None:
        """One coordinate pass over the factor tables, then refit the linear parts."""
        for i in range(len(self.mults)):
            key, _ = self.mults[i]
            old = self.mults[i][1]
            self.mults[i] = (key, {})
            self.F = self._mult_product()
            table = self._mult_factor_table(key, self._ratio())
            self.mults[i] = (key, self._normalise(key, table)[0] if table else old)
        self.F = self._mult_product()
        self.refit_all()
        if overrides:
            self.fit_customer_overrides()
            self.refit_all()

    def fit_customer_overrides(self) -> None:
        self.cust_over = {}
        self.F = self._mult_product()
        ratio = self._ratio()
        cust = self.ds.customer.astype(str)
        min_rows = int(self.cfg.s("min_customer_rows"))
        over = {}
        for c in sorted(set(cust)):
            m = (cust == c) & (ratio > 0.3) & (ratio < 3.0) & (self.w0 > 0)
            if m.sum() < min_rows:
                continue
            g = round(float(np.median(ratio[m])), 4)
            if abs(g - 1) <= 0.002:
                continue
            rows = cust == c
            F2 = self.F.copy()
            F2[rows] *= g
            gain = self._global_score(self.F, rows) - self._global_score(F2, rows) - self.lam
            if gain > 0:
                over[c] = g
        self.cust_over = over
        if over:
            self.log(f"  customer overrides: {len(over)}")
        self.F = self._mult_product()

    def prune_multipliers(self) -> None:
        for i in range(len(self.mults) - 1, -1, -1):
            key, table = self.mults[i]
            nfree = sum(1 for v in table.values() if abs(v - 1) > 0.002)
            cur = self.global_total()
            rest = self.mults[:i] + self.mults[i + 1 :]
            saved = self.mults
            self.mults = rest
            F2 = self._mult_product()
            self.mults = saved
            tot, models = self._trial(F2, set())
            mpar = sum(sum(1 for v in t.values() if abs(v - 1) > 0.002) for _, t in rest)
            tot += self.lam * (mpar + len(self.cust_over))
            if tot <= cur:
                self.log(f"  multiplier - {key.columns} ({nfree} factors)")
                self.mults = rest
                self.segments.update(models)
                self.F = self._mult_product()
                self.refresh_pred()

    def periods_to_versions(self) -> None:
        """Replace accepted date factors by versioned parameter tables (price revisions)."""
        for i in range(len(self.mults) - 1, -1, -1):
            key, table = self.mults[i]
            name = key.columns[-1]
            if name not in self.period_flags:
                continue
            b = self.period_flags[name]
            if key.columns[0] == "_segment":
                segs = set()
                for s in self.segments:
                    f0 = table.get(f"{s}|0", 1.0)
                    f1 = table.get(f"{s}|1", 1.0)
                    if abs(f1 / f0 - 1) > 0.003:
                        segs.add(s)
            else:
                segs = set(self.segments)
            del self.mults[i]
            self.F = self._mult_product()
            for s, sm in self.segments.items():
                if not sm.terms:
                    continue
                base = self.fit_terms(sm, sm.terms)
                if s in segs and b not in sm.breaks:
                    split = self.fit_terms(sm, sm.terms, sorted([*sm.breaks, b]))
                    if self.total(split) < self.total(base):
                        self.log(f"  revision {day_to_iso(b)} -> versioned tables in [{s}]")
                        base = split
                self.segments[s] = base
            self.refresh_pred()

    # ------------------------------------------------------------------ revisions
    def scan_revisions(self) -> None:
        """Direct change-point scan per segment: split every table of the segment at each
        month start and keep the split with the shortest description. Values that did not
        change are not charged (see :func:`count_params`); the date costs log2(#dates) bits.
        Up to ``max_revisions`` dates per segment."""
        starts = self.month_starts()
        if not starts:
            return
        date_bits = math.log2(len(starts))
        max_rev = int(self.cfg.s("max_revisions"))
        for s, sm in self.segments.items():
            if not sm.terms or sm.ctx.n < 20:
                continue
            while len(sm.breaks) < max_rev and self.budget_left(0.6):
                cur = self.total(sm)
                best = None
                for b in starts:
                    if b in sm.breaks:
                        continue
                    if not self.budget_left(0.75):
                        break
                    br = sorted([*sm.breaks, b])
                    counts = np.bincount(sm.ctx.vidx(br), minlength=len(br) + 1)
                    if counts.min() < 5:
                        continue
                    trial = self.fit_terms(sm, sm.terms, br)
                    if best is None or self.total(trial) < self.total(best[1]):
                        best = (b, trial)
                if best is None or self.total(best[1]) >= cur - date_bits - 1.0:
                    break
                self.log(f"  [{s}] revision at {day_to_iso(best[0])} ({cur:.0f} -> {self.total(best[1]):.0f} bits)")
                sm = best[1]
            self.segments[s] = sm
        self.refresh_pred()

    def month_starts(self) -> list[int]:
        days = np.sort(self.ds.day[self.ds.day >= 0])
        if len(days) < 20:
            return []
        lo = days[int(len(days) * 0.04)]
        hi = days[int(len(days) * 0.96)]
        out = []
        d0 = date.fromisoformat(day_to_iso(int(days[0])))
        y, m = d0.year, d0.month
        while True:
            m += 1
            if m > 12:
                y, m = y + 1, 1
            k = date(y, m, 1).toordinal() - date(1970, 1, 1).toordinal()
            if k > hi:
                break
            if k > lo:
                out.append(k)
        return out

    # ------------------------------------------------------------------ driver
    def segment_pass(self, restart: bool, max_terms: int) -> None:
        """Prune / extend every segment. Each segment gets a share of the remaining work
        budget in proportion to its number of quotes, so that late segments are not starved."""
        left_rows = sum(sm.ctx.n for sm in self.segments.values())
        for s, sm in self.segments.items():
            remaining = float(self.cfg.s("work_budget")) * 1e9 * 0.6 - self.work()
            self.seg_limit = self.work() + max(remaining, 0.0) * sm.ctx.n / max(left_rows, 1)
            left_rows -= sm.ctx.n
            if sm.ctx.n < 2:
                continue
            if (restart or not sm.terms) and self.cfg.s("start") == "empty":
                # forward selection from the base fee alone (small segments: a rich model
                # with more columns than the data can pin down is a bad starting point)
                sm = self.fit_terms(sm, [TermSpec(None, FeatureSpec("1"))])
            elif restart or not sm.terms:
                sm = self.fit_terms(sm, self.rich_terms(sm))
                sm = self.backward(sm)
            else:
                sm = self.fit_terms(sm, sm.terms)
            sm = self.forward(sm, max_terms)
            sm = self.backward(sm)
            sm = self.interaction_pass(sm)
            sm = self.variant_pass(sm)
            self.segments[s] = sm
        self.seg_limit = None
        self.refresh_pred()

    def interaction_pass(self, sm: SegModel) -> SegModel:
        """Merge two one-column tables on the same quantity into one two-column table (price
        by size and by paper -> price by size × paper) when that description is shorter."""
        import itertools

        max_pair = int(self.cfg.s("max_pair_levels"))
        while self.budget_left(0.6):
            # group by the plain quantity (pack / minimum variants of it count as the same)
            groups: dict[tuple, list[int]] = {}
            for i, t in enumerate(sm.terms):
                if t.key is not None and len(t.key.columns) == 1 and t.key.columns[0] not in self.flag_names:
                    groups.setdefault((t.feat.full_expr.replace(" ", ""), t.inside), []).append(i)
            best = None
            for idxs in groups.values():
                for a, b in itertools.combinations(idxs, 2):
                    pair = KeySpec((sm.terms[a].key.columns[0], sm.terms[b].key.columns[0]))  # type: ignore[union-attr]
                    if len(sm.ctx.codes(pair)[1]) > max_pair:
                        continue
                    rest = [t for i, t in enumerate(sm.terms) if i not in (a, b)]
                    feats = dict.fromkeys([sm.terms[a].feat, sm.terms[b].feat, FeatureSpec(sm.terms[a].feat.full_expr)])
                    for fs in feats:
                        trial = self.fit_terms(sm, [*rest, TermSpec(pair, fs, sm.terms[a].inside)])
                        if self.total(trial) < self.total(sm) - 1.0 and (
                            best is None or self.total(trial) < self.total(best)
                        ):
                            best = trial
            if best is None:
                break
            self.log(
                f"  [{sm.seg}] two tables -> {_term_name(best.terms[-1])}  bits={best.score:.0f} params={best.nparam}"
            )
            sm = best
        return sm

    def variant_pass(self, sm: SegModel) -> SegModel:
        """Pack rounding: try replacing a term's quantity by ceil(quantity / step) × step."""
        for i in range(len(sm.terms)):
            if not self.budget_left(0.7):
                break
            t = sm.terms[i]
            if t.feat.is_const or t.feat.ceil_step is not None or t.feat.clamp_min is not None:
                continue
            x = sm.ctx.feat(t.feat)
            nz = x != 0
            best = None
            for fs in feature_variants(t.feat, lambda f, sm=sm, nz=nz: sm.ctx.feat(f)[nz]):
                xv = sm.ctx.feat(fs)
                changed = int(np.sum(np.abs(xv - x) > 1e-9))
                if changed < 3 or changed > 0.9 * np.count_nonzero(x):
                    continue
                trial = self.fit_terms(sm, [*sm.terms[:i], TermSpec(t.key, fs, t.inside), *sm.terms[i + 1 :]])
                # a pack size is a structural choice: it must pay like a parameter
                if self.total(trial) < self.total(sm) - self.lam and (
                    best is None or self.total(trial) < self.total(best)
                ):
                    best = trial
            if best is not None:
                self.log(f"  [{sm.seg}] {_term_name(t)} -> {best.terms[i].feat.to_json()}")
                sm = best
        return sm

    def toggle_groups(self) -> None:
        """Flip terms with the same key and feature in all segments at once (e.g. the delivery
        fee) between 'before' and 'after' the multipliers, re-estimating the factor tables
        before comparing description lengths."""
        if not self.mults and not self.cust_over:
            return
        groups: dict[tuple, list[tuple[str, int]]] = {}
        for s, sm in self.segments.items():
            for i, t in enumerate(sm.terms):
                sig = ("" if t.key is None else t.key.key(), t.feat.key(), t.inside)
                groups.setdefault(sig, []).append((s, i))
        for sig, members in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1])):
            if not self.budget_left(0.75):
                break
            rows = np.zeros(self.ds.n, dtype=bool)
            for s, _ in members:
                rows[self.segments[s].ctx.idx] = True
            if np.all(np.abs(self.F[rows] - 1) < 1e-9):
                continue
            cur = self.global_total()
            saved = (dict(self.segments), list(self.mults), dict(self.cust_over), self.F.copy())
            for s, i in members:
                sm = self.segments[s]
                t = sm.terms[i]
                terms = list(sm.terms)
                terms[i] = TermSpec(t.key, t.feat, not t.inside)
                self.segments[s] = self.fit_terms(sm, terms)
            self.refresh_pred()
            self.reestimate_multipliers(overrides=False)
            new = self.global_total()
            if new < cur - 1.0:
                where = "after" if sig[2] else "before"
                self.log(
                    f"  {sig[0] or '-'} x {sig[1].split('|')[0]} -> {where} multipliers ({cur:.0f} -> {new:.0f} bits)"
                )
            else:
                self.segments, self.mults, self.cust_over, self.F = saved[0], saved[1], saved[2], saved[3]
                self.refresh_pred()

    def run(self) -> None:
        max_terms = int(self.cfg.s("max_terms")) + 30
        self.plain_only = bool(self.cfg.s("plain_first"))
        if self.cfg.s("init") == "forward":
            # a parsimonious additive model per segment (forward selection on the plain
            # quotes): a rich model has more columns than a small segment can pin down,
            # and its predictions on the other quotes are then too noisy to read factors off
            self.log(f"initial forward model ({int(self.plain.sum())} plain quotes)")
            self.main_effects = True
            for s, sm in self.segments.items():
                if sm.ctx.n >= 2:
                    sm = self.fit_terms(sm, [TermSpec(None, FeatureSpec("1"))])
                    self.segments[s] = self.forward(sm, int(self.cfg.s("init_terms")), quiet=True)
            self.main_effects = False
        else:
            # ridge: the rich model may have more columns than a small segment's plain quotes
            # pin down; only its predictions are used here (to read factors off)
            self.ridge = float(self.cfg.s("init_ridge"))
            for sm in self.segments.values():
                if sm.ctx.n >= 2:
                    # too few plain quotes for the columns of the rich model: use them all
                    p = self.design(sm, self.rich_terms(sm), sm.breaks)[0].shape[1]
                    if self.plain[sm.ctx.idx].sum() < 1.5 * p:
                        self.plain[sm.ctx.idx] = True
            self.log(
                "rich main-effects model" + (f" ({int(self.plain.sum())} plain quotes)" if self.plain_only else "")
            )
            for s, sm in self.segments.items():
                if sm.ctx.n >= 2:
                    self.segments[s] = self.fit_terms(sm, self.rich_terms(sm))
        self.refresh_pred()
        self.log("multiplicative factors and revisions")
        self.discover_multipliers()
        self.plain_only = False
        self.ridge = 0.0
        self.refit_all()
        self._refresh_ambiguous()
        self.log("pruning + interactions")
        self.segment_pass(restart=True, max_terms=max_terms)
        self.scan_revisions()
        self.swap_test()
        self.periods_to_versions()
        self.refine_breaks()
        self.toggle_groups()
        for it in range(max(1, int(self.cfg.s("outer_iterations")) - 1)):
            self.log(f"refinement {it + 1}")
            self.reestimate_multipliers(overrides=False)
            self.prune_multipliers()
            self.discover_multipliers(rounds=2)
            self.swap_test()
            self.periods_to_versions()
            self.refine_breaks()
            self._refresh_ambiguous()
            self.segment_pass(restart=False, max_terms=max_terms)
            self.scan_revisions()
            self.toggle_groups()
        self.reestimate_multipliers()
        self.log(f"search work {self.work() / 1e9:.1f} G units in {self.elapsed():.0f}s")

    # ------------------------------------------------------------------ export
    def to_program(self) -> Program:
        prog = Program()
        used_flags: set[str] = set()
        for s, sm in self.segments.items():
            versions = [day_to_iso(b) for b in sm.breaks]
            nv = len(sm.breaks) + 1
            for ti, t in enumerate(sm.terms):
                _, levels = sm.ctx.codes(t.key)
                present = {(li, v) for (tj, li, v) in sm.cmap if tj == ti}
                table: dict[str, list[float | None]] = {}
                is_flag = t.key is not None and len(t.key.columns) == 1 and t.key.columns[0] in self.flag_names
                for li, lev in enumerate(levels):
                    if is_flag or any((li, v) in present for v in range(nv)):
                        table[lev] = [0.0] * nv
                if is_flag:
                    for lev in ("0", "1", ""):
                        table.setdefault(lev, [0.0] * nv)
                for (tj, li, v), th in zip(sm.cmap, sm.theta, strict=True):
                    if tj == ti:
                        table[levels[li]][v] = float(th)
                # versions where a level had no rows inherit the nearest observed value
                for lev, vals in table.items():
                    if lev not in levels:
                        continue
                    li = levels.index(lev)
                    src = [w for w in range(nv) if (li, w) in present]
                    for v in range(nv):
                        if (li, v) not in present and src:
                            nearest = min(src, key=lambda w, v=v: (abs(w - v), w))
                            vals[v] = vals[nearest]
                if all(all(abs(x or 0.0) < 1e-12 for x in vals) for vals in table.values()):
                    continue
                if t.key is not None:
                    used_flags.update(t.key.columns)
                prog.terms.append(
                    Term(
                        id=f"{s}:{_term_name(t)}",
                        feature=t.feat,
                        key=t.key,
                        table=table,
                        versions=versions if nv > 1 else [],
                        segment=s,
                        apply_multipliers=t.inside,
                        role=_role(t),
                    )
                )
        for key, table in self.mults:
            used_flags.update(key.columns)
            prog.multipliers.append(
                Multiplier(id=f"m:{'|'.join(key.columns)}", key=key, table=dict(table), role="category")
            )
        if self.cust_over:
            prog.multipliers.append(
                Multiplier(
                    id="m:customer",
                    key=KeySpec(("_customer",)),
                    table=dict(self.cust_over),
                    role="customer_override",
                )
            )
        prog.flags = [f for f in self.lib.flags if f.name in used_flags]
        prog.rounding.unit = int(self.unit)
        if self.unit_groups and self.rep_col:
            prog.rounding.group_column = self.rep_col
            prog.rounding.groups = {g: (u, "floor") for g, u in self.unit_groups.items()}
        return prog


def detect_units(ds: Dataset, rows: np.ndarray | None = None) -> int:
    a, b = ds.candidates("floor")
    v = np.where(a >= 0, a, b)
    if rows is not None:
        v = v[rows]
    v = v[v > 0]
    if len(v) == 0:
        return 1
    for u in (10000, 5000, 1000, 500, 100, 50, 10, 5):
        if np.mean(v % u == 0) >= 0.85:
            return u
    return 1


def _term_name(t: TermSpec) -> str:
    k = "" if t.key is None else "[" + ",".join(t.key.columns) + "]"
    return f"{t.feat.expr}{k}"


def _role(t: TermSpec) -> str:
    if t.feat.is_const:
        return "fixed" if t.key is None else "fixed_by_key"
    return "per_unit"


def _short(table: dict[str, float]) -> str:
    items = sorted(table.items(), key=lambda kv: kv[0])[:6]
    return ", ".join(f"{k}:{v:g}" for k, v in items) + (" ..." if len(table) > 6 else "")
