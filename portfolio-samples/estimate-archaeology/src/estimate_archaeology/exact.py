"""Exact stage: turn an approximate program into one that reproduces quotes to the yen.

The deterministic evaluator is the only judge here: every decision is "does the number
of quotes reproduced *exactly* go up?", with ties broken towards the simpler choice
(coarser numbers, fewer parameters). Steps:

* snap every parameter to the coarsest value that keeps/increases exact matches
  (coordinate search over a ladder of round numbers);
* rounding unit/mode (globally, then per group such as the rep column), tax rounding;
* in/out of the multipliers for each additive term (e.g. delivery fee not discounted);
* minimum charge per segment (or "not identifiable" with the consistent range);
* pack rounding / clamping variants of each term's quantity feature;
* revision dates moved to the best day, with the range of equally good dates recorded;
* customer rates as absolute factors with the class rate as fallback;
* identifiability: the range of values of each parameter that reproduces the same quotes.
"""

from __future__ import annotations

import dataclasses
import math
from dataclasses import dataclass, field

import numpy as np

from . import expr as ex
from .dataset import Dataset
from .library import feature_variants as variants_of
from .normalize import TAX_ROUNDING, day_to_iso, iso_to_day
from .program import (
    ROUND_MODES,
    EvalCache,
    FeatureSpec,
    FlagSpec,
    KeySpec,
    MinCharge,
    Multiplier,
    Program,
    Term,
    multiplier_factors,
    round_to,
    version_index,
)

PRICE_STEPS = (10000.0, 5000.0, 1000.0, 500.0, 100.0, 50.0, 10.0, 5.0, 1.0, 0.5, 0.1, 0.05, 0.01, 0.005, 0.001)
FACTOR_STEPS = (0.1, 0.05, 0.01, 0.005, 0.001, 0.0005, 0.0001)


def step_rank(v: float, steps: tuple[float, ...]) -> int:
    """Index of the coarsest step that divides ``v`` (lower = simpler number)."""
    for i, s in enumerate(steps):
        if abs(v / s - round(v / s)) < 1e-7:
            return i
    return len(steps)


def snap_candidates(x: float, steps: tuple[float, ...], reach: int = 2) -> list[float]:
    if not math.isfinite(x):
        return []
    out = {0.0} if steps is PRICE_STEPS else set()
    ax = abs(x)
    for s in steps:
        if s > max(ax * 4, steps[-1]):
            continue
        base = round(x / s)
        for d in range(-reach, reach + 1):
            out.add(round((base + d) * s, 10))
    return sorted(out)


@dataclass
class TermState:
    idx: int
    f: np.ndarray
    pid: np.ndarray  # parameter index per row (-1: not used / unknown)
    use: np.ndarray  # rows where the term applies (segment & feature != 0)
    inside: bool


@dataclass
class Compiled:
    """Numeric form of a program on a dataset (fast, incremental evaluation)."""

    prog: Program
    ds: Dataset
    cache: EvalCache
    tax_rounding: str = "floor"
    terms: list[TermState] = field(default_factory=list)
    P: np.ndarray = field(default_factory=lambda: np.zeros(0))
    fixed: np.ndarray = field(default_factory=lambda: np.zeros(0, bool))  # structural zeros
    pinfo: list[tuple[int, str, int]] = field(default_factory=list)
    prow: list[np.ndarray] = field(default_factory=list)
    F: np.ndarray = field(default_factory=lambda: np.zeros(0))
    lin_in: np.ndarray = field(default_factory=lambda: np.zeros(0))
    lin_out: np.ndarray = field(default_factory=lambda: np.zeros(0))
    ok: np.ndarray = field(default_factory=lambda: np.zeros(0, bool))
    ok_struct: np.ndarray = field(default_factory=lambda: np.zeros(0, bool))
    minv: np.ndarray = field(default_factory=lambda: np.zeros(0))
    min_pre: np.ndarray = field(default_factory=lambda: np.zeros(0, bool))
    unit: np.ndarray = field(default_factory=lambda: np.zeros(0, np.int64))
    mode: np.ndarray = field(default_factory=lambda: np.zeros(0, np.int8))
    seg: np.ndarray = field(default_factory=lambda: np.zeros(0, object))

    @classmethod
    def build(cls, prog: Program, ds: Dataset, cache: EvalCache, tax_rounding: str = "floor") -> Compiled:
        c = cls(prog, ds, cache, tax_rounding)
        c.recompile()
        return c

    # -------------------------------------------------------------- compile
    def recompile(self) -> None:
        prog, ds, cache = self.prog, self.ds, self.cache
        cache.ensure_flags(prog.flags)
        n = ds.n
        self.seg = ex.as_str(cache.env.get(prog.segment_column, ds.segment), n)
        self.terms = []
        P: list[float] = []
        fixed: list[bool] = []
        flag_names = {f.name for f in prog.flags}
        self.pinfo = []
        self.prow = []
        ok = np.ones(n, dtype=bool)
        for ti, t in enumerate(prog.terms):
            f = cache.feature(t.feature)
            labels = cache.key_labels(t.key).astype(str)
            vidx = version_index(t.versions, ds.day)
            use = (np.ones(n, bool) if t.segment is None else (self.seg == t.segment)) & (f != 0)
            pid = np.full(n, -1, dtype=np.int64)
            is_flag = t.key is not None and len(t.key.columns) == 1 and t.key.columns[0] in flag_names
            for lev, vals in t.table.items():
                lm = use & (labels == lev)
                for v, val in enumerate(vals):
                    rows = lm & (np.minimum(vidx, len(vals) - 1) == v)
                    k = len(P)
                    fixed.append(is_flag and lev != "1")
                    P.append(math.nan if val is None else float(val))
                    self.pinfo.append((ti, lev, v))
                    self.prow.append(np.nonzero(rows)[0])
                    pid[rows] = k
            ok &= ~(use & (pid < 0))
            self.terms.append(TermState(ti, f, pid, use, t.apply_multipliers))
        self.P = np.array(P, dtype=float)
        self.fixed = np.array(fixed, dtype=bool)
        self.ok_struct = ok
        self.F = np.ones(n)
        for m in prog.multipliers:
            self.F = self.F * multiplier_factors(m, cache)[0]
        self.minv = np.full(n, math.nan)
        self.min_pre = np.zeros(n, dtype=bool)
        for s, mc in prog.min_charge.items():
            if mc.value is not None:
                mk = self.seg == s
                self.minv[mk] = mc.value
                self.min_pre[mk] = mc.stage == "pre"
        r = prog.rounding
        self.unit = np.full(n, max(int(r.unit), 1), dtype=np.int64)
        self.mode = np.full(n, ROUND_MODES.index(r.mode), dtype=np.int8)
        if r.group_column and r.groups:
            g = ex.as_str(cache.env[r.group_column], n)
            for name, (u, md) in r.groups.items():
                mk = g == name
                self.unit[mk] = u
                self.mode[mk] = ROUND_MODES.index(md)
        self.relin()

    def relin(self) -> None:
        n = self.ds.n
        self.lin_in = np.zeros(n)
        self.lin_out = np.zeros(n)
        for t in self.terms:
            coef = np.where(t.pid >= 0, self.P[np.maximum(t.pid, 0)], 0.0)
            c = np.nan_to_num(coef) * t.f
            if t.inside:
                self.lin_in += c
            else:
                self.lin_out += c
        self.ok = self.ok_struct & ~self._uses_nan()

    def _uses_nan(self) -> np.ndarray:
        bad = np.zeros(self.ds.n, dtype=bool)
        nanp = np.isnan(self.P)
        if not nanp.any():
            return bad
        for t in self.terms:
            bad |= (t.pid >= 0) & nanp[np.maximum(t.pid, 0)]
        return bad

    # -------------------------------------------------------------- evaluation
    def net_rows(
        self,
        R: np.ndarray,
        lin_in: np.ndarray | None = None,
        lin_out: np.ndarray | None = None,
        F: np.ndarray | None = None,
        minv: np.ndarray | None = None,
        min_pre: np.ndarray | None = None,
        unit: np.ndarray | None = None,
        mode: np.ndarray | None = None,
    ) -> np.ndarray:
        li = self.lin_in[R] if lin_in is None else lin_in
        lo = self.lin_out[R] if lin_out is None else lin_out
        f = self.F[R] if F is None else F
        mv = self.minv[R] if minv is None else minv
        mp = self.min_pre[R] if min_pre is None else min_pre
        a = np.where(mp & ~np.isnan(mv), np.fmax(li, mv), li)
        sub = a * f + lo
        post = ~mp & ~np.isnan(mv)
        sub = np.where(post, np.fmax(sub, mv), sub)
        u = self.unit[R] if unit is None else unit
        md = self.mode[R] if mode is None else mode
        return round_to(sub, u, md)

    def subtotal_rows(self, R: np.ndarray) -> np.ndarray:
        li, lo, f = self.lin_in[R], self.lin_out[R], self.F[R]
        mv, mp = self.minv[R], self.min_pre[R]
        a = np.where(mp & ~np.isnan(mv), np.fmax(li, mv), li)
        sub = a * f + lo
        return np.where(~mp & ~np.isnan(mv), np.fmax(sub, mv), sub)

    def hits(self, R: np.ndarray, net: np.ndarray) -> np.ndarray:
        a, b = self.ds.candidates(self.tax_rounding)
        return self.ok[R] & ((net == a[R]) | (net == b[R]))

    def count(self, R: np.ndarray | None = None, **kw) -> int:
        R = np.arange(self.ds.n) if R is None else R
        return int(self.hits(R, self.net_rows(R, **kw)).sum())

    def net_all(self) -> np.ndarray:
        R = np.arange(self.ds.n)
        return np.where(self.ok, self.net_rows(R), -1)

    def match_all(self) -> np.ndarray:
        R = np.arange(self.ds.n)
        return self.hits(R, self.net_rows(R))

    # -------------------------------------------------------------- write back
    def write_back(self, clean: bool = True) -> None:
        for k, (ti, lev, v) in enumerate(self.pinfo):
            t = self.prog.terms[ti]
            val = self.P[k]
            if lev in t.table and v < len(t.table[lev]):
                t.table[lev][v] = None if math.isnan(val) else (_clean(val) if clean else float(val))
        for ts in self.terms:
            self.prog.terms[ts.idx].apply_multipliers = ts.inside
            self.prog.terms[ts.idx].feature = self.prog.terms[ts.idx].feature

    def recompile_keep(self) -> None:
        """Recompile after a structural change (e.g. version dates), keeping parameter values."""
        unit, mode = self.unit.copy(), self.mode.copy()
        F = self.F.copy()
        self.write_back(clean=False)
        self.recompile()
        self.unit, self.mode, self.F = unit, mode, F
        self.relin()


def _clean(v: float) -> float:
    r = round(v, 6)
    return float(int(r)) if r == int(r) else r


# --------------------------------------------------------------------------- parameter search


def param_search(c: Compiled, k: int, steps: tuple[float, ...] = PRICE_STEPS, reach: int = 2) -> bool:
    """Coordinate step on parameter ``k``; returns True if the value changed."""
    R = c.prow[k]
    if len(R) == 0 or math.isnan(c.P[k]) or c.fixed[k]:
        return False
    ti = c.pinfo[k][0]
    ts = c.terms[ti]
    f = ts.f[R]
    cur = c.P[k]
    base_in = c.lin_in[R] - (cur * f if ts.inside else 0.0)
    base_out = c.lin_out[R] - (0.0 if ts.inside else cur * f)
    scored = []
    for v in [*snap_candidates(cur, steps, reach), cur]:
        li = base_in + v * f if ts.inside else base_in
        lo = base_out if ts.inside else base_out + v * f
        n = int(c.hits(R, c.net_rows(R, lin_in=li, lin_out=lo)).sum())
        scored.append((n, v, li, lo))
    # an extra digit needs evidence in proportion to how many quotes use the parameter
    _, v, li, lo = pick_simplest(scored, cur, steps, slack=max(1, len(R) // 100))
    if v == cur:
        return False
    c.P[k] = v
    c.lin_in[R] = li
    c.lin_out[R] = lo
    return True


def pick_simplest(scored: list[tuple], cur: float, steps: tuple[float, ...], slack: int = 1) -> tuple:
    """Among candidates within ``slack`` quotes of the best count, take the simplest number.

    A more precise value has to reproduce at least ``slack + 1`` more quotes to be preferred
    over a rounder one (one quote is not enough evidence for an extra digit).
    """
    top = max(s[0] for s in scored)
    pool = [s for s in scored if s[0] >= top - slack]
    return min(pool, key=lambda s: (step_rank(s[1], steps), -s[0], abs(s[1] - cur)))


def simplest_near(x: float, steps: tuple[float, ...], rel: float) -> float:
    """The roundest number within ``rel`` (relative) of ``x``: rational reconstruction of a
    fitted coefficient (4010.3 -> 4000, 1.0004 -> 1, 2.4987 -> 2.5)."""
    if not math.isfinite(x):
        return x
    if abs(x) < 1e-6:
        return 0.0
    for s in steps:
        v = round(x / s) * s
        if v != 0 and abs(v - x) <= rel * abs(x):
            return round(v, 10)
    return x


def simplest_within(x: float, steps: tuple[float, ...], tol: float) -> float:
    """The roundest number within absolute distance ``tol`` of ``x``."""
    if not math.isfinite(x):
        return x
    best = x
    for s in steps:
        v = round(x / s) * s
        if abs(v - x) <= tol:
            return round(v, 10)
    return best


def presnap(c: Compiled, rel_price: float = 0.005, rel_factor: float = 0.003) -> None:
    """Round every parameter to the simplest number whose effect on the quotes that use it
    stays below ``rel_price`` of their subtotal (the exact search corrects mistakes)."""
    R_all = np.arange(c.ds.n)
    sub = np.abs(c.subtotal_rows(R_all))
    for k in range(len(c.P)):
        R = c.prow[k]
        if len(R) == 0 or math.isnan(c.P[k]) or c.fixed[k]:
            continue
        f = np.abs(c.terms[c.pinfo[k][0]].f[R])
        scale = float(np.median(sub[R]) / max(float(np.median(f)), 1e-12))
        c.P[k] = simplest_within(c.P[k], PRICE_STEPS, rel_price * scale)
    c.relin()
    for m in c.prog.multipliers:
        for table in (m.table, m.fallback_table):
            for lev in table:
                table[lev] = simplest_near(table[lev], FACTOR_STEPS, rel_factor)
    c.F = np.ones(c.ds.n)
    for m in c.prog.multipliers:
        c.F = c.F * multiplier_factors(m, c.cache)[0]


def consensus_refit(c: Compiled, rounds: int = 3, log=None) -> None:
    """Least-squares refit of all parameters on the quotes that are (nearly) reproduced.

    For a reproduced quote the subtotal before rounding is known to within one rounding
    unit, so an ordinary least-squares fit on those quotes pins the parameters down
    jointly; the result is then snapped to round numbers again. This makes the joint moves
    that a one-parameter-at-a-time search cannot (e.g. a fixed fee and a factor together).
    """
    from .search import independent_columns

    a, b = c.ds.candidates(c.tax_rounding)
    R_all = np.arange(c.ds.n)
    for _ in range(rounds):
        before = c.count()
        net = c.net_rows(R_all)
        obs = np.where(np.abs(a - net) <= np.abs(np.where(b >= 0, b, 10**15) - net), a, b).astype(float)
        u = c.unit.astype(float)
        sub = c.subtotal_rows(R_all)
        clipped = ~np.isnan(c.minv) & (np.abs(sub - c.minv) < 1e-6)
        near = c.ok & (obs >= 0) & (np.abs(net - obs) <= u) & ~clipped
        off = np.where(c.mode == 0, u / 2, np.where(c.mode == 2, -u / 2, 0.0))
        y = obs + off
        newP = c.P.copy()
        for seg in sorted(set(c.seg)):
            R = np.nonzero(near & (c.seg == seg))[0]
            if len(R) < 3:
                continue
            pos = {r: i for i, r in enumerate(R)}
            ks = [
                k
                for k in range(len(c.P))
                if len(c.prow[k]) and c.seg[c.prow[k][0]] == seg and not math.isnan(c.P[k]) and not c.fixed[k]
            ]
            if not ks:
                continue
            X = np.zeros((len(R), len(ks)))
            for j, k in enumerate(ks):
                ts = c.terms[c.pinfo[k][0]]
                for r in c.prow[k]:
                    i = pos.get(int(r))
                    if i is not None:
                        X[i, j] = ts.f[r] * (c.F[r] if ts.inside else 1.0)
            used = np.any(X != 0, axis=0)
            keep = np.zeros(len(ks), dtype=bool)
            if used.any():
                keep[np.nonzero(used)[0][independent_columns(X[:, used])]] = True
            if not keep.any():
                continue
            th, *_ = np.linalg.lstsq(X[:, keep], y[R], rcond=None)
            for j, t in zip(np.nonzero(keep)[0], th, strict=True):
                newP[ks[j]] = t
        saved = c.P.copy()
        c.P = np.array([simplest_near(v, PRICE_STEPS, 0.002) for v in newP])
        c.relin()
        snap_all(c, sweeps=1)
        after = c.count()
        if after < before:
            c.P = saved
            c.relin()
            break
        if log:
            log(f"    consensus refit: {before} -> {after} exact")
        if after == before:
            break


def ransac_segments(c: Compiled, iters: int = 300, seed: int = 0, log=None) -> None:
    """Exact consensus (RANSAC): solve a segment's parameters from small random samples of
    quotes, snap them to round numbers and keep the solution that reproduces the most
    quotes. Robust to a large share of quotes that follow rules outside the grammar, which
    would otherwise bias a least-squares fit. Deterministic (fixed seed)."""
    rng = np.random.default_rng(seed)
    a, b = c.ds.candidates(c.tax_rounding)
    R_all = np.arange(c.ds.n)
    for seg in sorted(set(c.seg)):
        Rs = np.nonzero((c.seg == seg) & c.ok)[0]
        ks = [
            k
            for k in range(len(c.P))
            if len(c.prow[k]) and c.seg[c.prow[k][0]] == seg and not c.fixed[k] and not math.isnan(c.P[k])
        ]
        if len(Rs) < 10 or not ks:
            continue
        net = c.net_rows(R_all)
        obs = np.where(np.abs(a - net) <= np.abs(np.where(b >= 0, b, 10**15) - net), a, b).astype(float)
        pos = {int(r): i for i, r in enumerate(Rs)}
        A_in = np.zeros((len(Rs), len(ks)))
        A_out = np.zeros((len(Rs), len(ks)))
        for j, k in enumerate(ks):
            ts = c.terms[c.pinfo[k][0]]
            for r in c.prow[k]:
                i = pos.get(int(r))
                if i is not None:
                    (A_in if ts.inside else A_out)[i, j] = ts.f[r]
        Fr = c.F[Rs]
        X = A_in * Fr[:, None] + A_out
        u = c.unit[Rs].astype(float)
        off = np.where(c.mode[Rs] == 0, u / 2, np.where(c.mode[Rs] == 2, -u / 2, 0.0))
        y = obs[Rs] + off
        usable = obs[Rs] >= 0
        sub = np.abs(c.subtotal_rows(Rs))
        fmed = np.array(
            [
                float(np.median(np.abs((A_in + A_out)[:, j][(A_in + A_out)[:, j] != 0])))
                if np.any((A_in + A_out)[:, j] != 0)
                else 1.0
                for j in range(len(ks))
            ]
        )
        smed = float(np.median(sub)) if len(sub) else 1.0

        def count(theta: np.ndarray, A_in=A_in, A_out=A_out, Rs=Rs, ks=ks) -> int:
            li = A_in @ theta + (c.lin_in[Rs] - A_in @ c.P[ks])
            lo = A_out @ theta + (c.lin_out[Rs] - A_out @ c.P[ks])
            return int(c.hits(Rs, c.net_rows(Rs, lin_in=li, lin_out=lo)).sum())

        cur = c.P[ks].copy()
        best_n, best = count(cur), cur
        m = min(len(ks) + 2, int(usable.sum()))
        idx_usable = np.nonzero(usable)[0]
        if m < 2:
            continue
        for _ in range(iters):
            pick = rng.choice(idx_usable, size=m, replace=False)
            Xs = X[pick]
            cols = np.nonzero(np.any(Xs != 0, axis=0))[0]
            if len(cols) == 0:
                continue
            th, *_ = np.linalg.lstsq(Xs[:, cols], y[pick], rcond=None)
            theta = cur.copy()
            theta[cols] = th
            theta = np.array(
                [simplest_within(v, PRICE_STEPS, 0.005 * smed / max(fmed[j], 1e-12)) for j, v in enumerate(theta)]
            )
            n_ = count(theta)
            if n_ > best_n:
                best_n, best = n_, theta
        if best is not cur:
            before = count(cur)
            c.P[ks] = best
            c.relin()
            if log:
                log(f"    [{seg}] exact consensus: {before} -> {best_n} of {len(Rs)}")


def snap_all(c: Compiled, sweeps: int = 3, log=None) -> None:
    order = sorted(range(len(c.P)), key=lambda k: (-len(c.prow[k]), k))
    for sw in range(sweeps):
        changed = 0
        for k in order:
            if param_search(c, k):
                changed += 1
        if log:
            log(f"    snap sweep {sw + 1}: {c.count()} exact, {changed} changed")
        if changed == 0:
            break


# --------------------------------------------------------------------------- rounding / tax


def search_mode(c: Compiled, resnap: bool = True, log=None) -> None:
    """Choose floor/round/ceil for the current units (keeps per-group units).

    The parameters coming out of the continuous fit are only approximately right, so each
    mode is compared *after* re-snapping the parameters under that mode: otherwise a
    parameter that is off by half a rounding unit locks in the wrong mode early, and later
    snapping adapts the prices to it. Ties go to floor (the most common practice), then round.
    """
    saved = c.P.copy()
    results = []
    for mi, m in enumerate(ROUND_MODES):
        c.P = saved.copy()
        c.relin()
        c.mode[:] = mi
        if resnap:
            snap_all(c, sweeps=2)
        results.append((c.count(), -mi, mi, m, c.P.copy()))
    _, _, mi, m, P = max(results, key=lambda r: (r[0], r[1]))
    c.P = P
    c.relin()
    c.mode[:] = mi
    c.prog.rounding.mode = m
    c.prog.rounding.groups = {g: (u, m) for g, (u, _) in c.prog.rounding.groups.items()}
    if log:
        log(f"    rounding mode: {m} ({', '.join(f'{r[3]} {r[0]}' for r in results)})")


def search_rounding(c: Compiled, group_column: str | None, log=None) -> None:
    """Rounding mode (floor / round / ceil) globally and per group.

    Units come from divisibility of the written amounts (detected before fitting); a group
    gets its own unit/mode only when that reproduces clearly more of its quotes.
    """
    prog = c.prog
    n = c.ds.n
    R = np.arange(n)
    g = ex.as_str(c.cache.env[group_column], n) if group_column and group_column in c.cache.env else None
    detected = dict(prog.rounding.groups)
    base_unit = int(prog.rounding.unit)
    unit = np.full(n, base_unit, dtype=np.int64)
    if g is not None:
        for name, (u, _) in detected.items():
            unit[g == name] = u
    best = None
    for mi, m in enumerate(ROUND_MODES):
        cnt = c.count(R, unit=unit, mode=np.full(n, mi, dtype=np.int8))
        if best is None or cnt > best[0]:
            best = (cnt, mi, m)
    _, mi, m = best
    prog.rounding.mode = m
    c.unit[:] = unit
    c.mode[:] = mi
    groups: dict[str, tuple[int, str]] = {}
    if g is not None:
        for name in sorted(set(g)):
            Rg = np.nonzero(g == name)[0]
            if len(Rg) < 10:
                continue
            u0 = int(unit[Rg[0]])
            base = c.count(Rg)
            options = []
            for uu in sorted({u0, base_unit, 1, 10, 100, 1000}):
                for mj, mm in enumerate(ROUND_MODES):
                    cnt = c.count(Rg, unit=np.full(len(Rg), uu), mode=np.full(len(Rg), mj, dtype=np.int8))
                    options.append((cnt, uu == u0, mj == mi, uu, mm, mj))
            # the unit was read off the amounts themselves (divisibility); only change it on
            # strong evidence, while the mode may change on modest evidence
            same_unit = [o for o in options if o[3] == u0]
            top_same = max(same_unit)
            top = max(options)
            choice = (u0, m, mi)
            if top_same[0] >= base + 3:
                choice = (u0, top_same[4], top_same[5])
            if top[0] >= max(base, top_same[0]) + max(10, int(0.05 * len(Rg))):
                choice = (top[3], top[4], top[5])
            if (choice[0], choice[1]) != (base_unit, m):
                groups[name] = (choice[0], choice[1])
            c.unit[Rg] = choice[0]
            c.mode[Rg] = choice[2]
    prog.rounding.groups = groups
    prog.rounding.group_column = group_column if groups else None
    if log:
        log(f"    rounding: {base_unit} {m}, groups={groups} -> {c.count()} exact")


def search_tax_rounding(c: Compiled) -> None:
    best = None
    for m in TAX_ROUNDING:
        c.tax_rounding = m
        cnt = c.count()
        if best is None or cnt > best[0]:
            best = (cnt, m)
    c.tax_rounding = best[1]
    c.prog.tax_rounding = best[1]


# --------------------------------------------------------------------------- minimum charge


def search_min_charge(c: Compiled, log=None) -> None:
    prog = c.prog
    a, b = c.ds.candidates(c.tax_rounding)
    for s in sorted(set(c.seg)):
        Rs = np.nonzero(c.seg == s)[0]
        if len(Rs) == 0:
            continue
        prog.min_charge.pop(s, None)
        c.minv[Rs] = math.nan
        base = c.count(Rs)
        sub = c.subtotal_rows(Rs)
        obs = np.where(a[Rs] >= 0, a[Rs], b[Rs]).astype(float)
        under = (sub < obs - c.unit[Rs]) & (obs > 0) & c.ok[Rs]
        cands: dict[tuple[float, str], int] = {}
        if under.any():
            vals, cnt = np.unique(obs[under], return_counts=True)
            for v, k in sorted(zip(vals, cnt, strict=True), key=lambda t: -t[1])[:6]:
                cands[(float(v), "post")] = int(k)
                F = c.F[Rs][under & (obs == v)]
                if len(F) and np.all(F > 0):
                    pre = float(np.median(v / F))
                    for pv in snap_candidates(pre, PRICE_STEPS, 1):
                        if pv > 0:
                            cands[(pv, "pre")] = int(k)
        best = (base, None, "post")
        for (v, stage), _ in cands.items():
            cnt = c.count(Rs, minv=np.full(len(Rs), v), min_pre=np.full(len(Rs), stage == "pre"))
            key = (cnt, -step_rank(v, PRICE_STEPS), stage == "post")
            # a minimum charge must explain several quotes (one or two coincidences are not
            # evidence: the value is then reported as not identifiable instead)
            need = max(3, len(Rs) // 100)
            if key > (best[0], -step_rank(best[1] or 0.0, PRICE_STEPS), best[2] == "post") and cnt >= base + need:
                best = (cnt, v, stage)
        smin = float(np.min(sub[c.ok[Rs]])) if c.ok[Rs].any() else math.nan
        if best[1] is None:
            prog.min_charge[s] = MinCharge(None, "post", (None, _clean(smin) if math.isfinite(smin) else None))
        else:
            v, stage = best[1], best[2]
            prog.min_charge[s] = MinCharge(v, stage, (None, None))
            c.minv[Rs] = v
            c.min_pre[Rs] = stage == "pre"
            if log:
                log(f"    [{s}] minimum charge {v:g} ({stage}) -> +{best[0] - base}")


def min_charge_bounds(c: Compiled) -> None:
    """Range of minimum-charge values consistent with every reproduced quote."""
    prog = c.prog
    hit = c.match_all()
    for s, mc in prog.min_charge.items():
        if mc.value is None:
            continue
        Rs = np.nonzero((c.seg == s) & hit)[0]
        if len(Rs) == 0:
            continue
        lo, hi = mc.value, mc.value
        step = 10.0 ** max(0, int(math.log10(max(mc.value, 1))) - 2)
        for direction in (-1, 1):
            v = mc.value
            for _ in range(400):
                v2 = v + direction * step
                if v2 <= 0:
                    break
                cnt = c.count(Rs, minv=np.full(len(Rs), v2))
                if cnt < len(Rs):
                    break
                v = v2
            if direction < 0:
                lo = v
            else:
                hi = v
        mc.bounds = (_clean(lo), _clean(hi))


# --------------------------------------------------------------------------- structure edits


def term_params(c: Compiled, ti: int) -> list[int]:
    return [k for k, (t, _, _) in enumerate(c.pinfo) if t == ti]


def _signature(c: Compiled, ti: int) -> tuple:
    t = c.prog.terms[ti]
    return (None if t.key is None else t.key.columns, t.feature.key())


def toggle_inside(c: Compiled, log=None) -> None:
    """Try adding terms after the multipliers instead of before (or vice versa).

    Terms with the same key and feature in different segments (e.g. the delivery fee) are
    flipped together, and the factor tables are re-fitted before comparing, because a
    fee outside the discount changes the discount rate that reproduces the quotes.
    """
    if np.all(np.abs(c.F - 1) < 1e-12):
        return
    groups: dict[tuple, list[int]] = {}
    for ts in c.terms:
        groups.setdefault(_signature(c, ts.idx), []).append(ts.idx)
    for sig, tis in groups.items():
        rows = np.zeros(c.ds.n, dtype=bool)
        for ti in tis:
            rows |= c.terms[ti].use
        if not rows.any() or np.all(np.abs(c.F[rows] - 1) < 1e-12):
            continue
        before = c.count()
        saved = (c.P.copy(), c.F.copy(), [ts.inside for ts in c.terms], c.prog.copy())
        for ti in tis:
            c.terms[ti].inside = not c.terms[ti].inside
        c.relin()
        for ti in tis:
            for k in term_params(c, ti):
                param_search(c, k)
        multiplier_search(c, min_gain=2)
        for ti in tis:
            for k in term_params(c, ti):
                param_search(c, k)
        after = c.count()
        if after > before:
            if log:
                where = "before" if c.terms[tis[0]].inside else "after"
                log(
                    f"    {sig[0]} x {sig[1].split('|')[0]}: {where} multipliers ({len(tis)} segments) -> +{after - before}"
                )
        else:
            c.P, c.F = saved[0], saved[1]
            for ts, ins in zip(c.terms, saved[2], strict=True):
                ts.inside = ins
            c.prog.multipliers = saved[3].multipliers
            c.relin()


def feature_variants(c: Compiled, log=None) -> None:
    """Pack rounding (ceil to a step) and minimum quantities for each term's feature.

    The plain feature, every pack step and every clamp are compared by exact matches in
    the segment; the plain feature wins ties (within one quote), then the rounder step.
    """
    prog = c.prog
    for ts in c.terms:
        t = prog.terms[ts.idx]
        if t.feature.is_const:
            continue
        R = np.nonzero(ts.use)[0]
        if len(R) < 3:
            continue
        raw = FeatureSpec(t.feature.full_expr)
        x = c.cache.feature(raw)[R]
        variants = [raw, *variants_of(raw, lambda f, R=R: c.cache.feature(f)[R])]
        segR = np.nonzero(c.seg == t.segment)[0] if t.segment is not None else np.arange(c.ds.n)
        orig = t.feature
        saved_p = c.P.copy()
        results = []
        for fs in variants:
            fv = c.cache.feature(fs)
            if fs is not raw and np.allclose(fv[R], x):
                continue
            t.feature = fs
            ts.f = fv
            c.P = saved_p.copy()
            c.relin()
            for k in term_params(c, ts.idx):
                param_search(c, k, reach=3)
            cnt = c.count(segR)
            rank = (
                0
                if fs is raw
                else 1 + step_rank(fs.ceil_step or fs.clamp_min or 0.0, PRICE_STEPS) + (1 if fs.times else 0)
            )
            results.append((cnt, rank, fs, c.P.copy()))
        top = max(r[0] for r in results)
        cnt, _, fs, P = min((r for r in results if r[0] >= top - 1), key=lambda r: (r[1], -r[0]))
        t.feature = fs
        ts.f = c.cache.feature(fs)
        c.P = P
        c.relin()
        if log and fs.key() != orig.key():
            log(f"    {t.id}: feature {fs.to_json()} ({cnt} exact in segment)")


YIELD_STEPS = (2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 25, 32, 40, 48, 50, 64, 100, 200, 250, 500, 1000)


def _observed(c: Compiled) -> np.ndarray:
    """Per row, the candidate net closest to the current prediction (-1 if none)."""
    a, b = c.ds.candidates(c.tax_rounding)
    net = c.net_rows(np.arange(c.ds.n))
    obs = np.where(np.abs(a - net) <= np.abs(np.where(b >= 0, b, 10**15) - net), a, b)
    return np.where((a < 0) & (b < 0), -1, obs).astype(float)


def robust_segment_refit(c: Compiled, seg: str, sweeps: int = 2) -> bool:
    """Joint robust refit of all parameters of a segment on all its quotes.

    Cauchy IRLS annealed down to the rounding unit (quotes that follow other rules get
    down-weighted), each value snapped to the roundest number within 2.5 standard errors,
    then coordinate snapping. Kept only if the segment reproduces more quotes."""
    from .search import robust_fit

    obs = _observed(c)
    Rseg = np.nonzero(c.seg == seg)[0]
    sub = c.subtotal_rows(Rseg)
    clipped = ~np.isnan(c.minv[Rseg]) & (np.abs(sub - c.minv[Rseg]) < 1e-6)
    Rs = Rseg[c.ok[Rseg] & (obs[Rseg] >= 0) & ~clipped]
    ks = [
        k
        for k in range(len(c.P))
        if len(c.prow[k]) and c.seg[c.prow[k][0]] == seg and not c.fixed[k] and not math.isnan(c.P[k])
    ]
    if len(Rs) < 5 or not ks:
        return False
    pos = {int(r): i for i, r in enumerate(Rs)}
    X = np.zeros((len(Rs), len(ks)))
    for j, k in enumerate(ks):
        ts = c.terms[c.pinfo[k][0]]
        for r in c.prow[k]:
            i = pos.get(int(r))
            if i is not None:
                X[i, j] = ts.f[r] * (c.F[r] if ts.inside else 1.0)
    u = c.unit[Rs].astype(float)
    off = np.where(c.mode[Rs] == 0, u / 2, np.where(c.mode[Rs] == 2, -u / 2, 0.0))
    # parameters of other segments do not enter; terms without a segment are held fixed
    fixed_part = c.lin_in[Rs] * c.F[Rs] + c.lin_out[Rs] - X @ c.P[ks]
    y = obs[Rs] + off - fixed_part
    tol = np.maximum(u, 1.0)
    fit = robust_fit(X, y, tol, np.ones(len(Rs)), np.log2(2.0 + np.abs(y) / tol))
    before = c.count(Rseg)
    saved = c.P.copy()
    for j, k in enumerate(ks):
        if not fit.keep[j]:
            continue
        se = float(fit.se[j]) if fit.se is not None and math.isfinite(fit.se[j]) else abs(fit.theta[j]) * 0.01
        c.P[k] = simplest_within(float(fit.theta[j]), PRICE_STEPS, max(2.5 * se, 1e-9))
    c.relin()
    for _ in range(sweeps):
        for k in sorted(ks, key=lambda k: -len(c.prow[k])):
            param_search(c, k)
    if c.count(Rseg) > before:
        return True
    c.P = saved
    c.relin()
    return False


def round_factors(c: Compiled, log=None) -> None:
    """Joint move of a factor and the prices: set a factor that is not a round number to the
    roundest value within 1% (1.295 -> 1.3) and refit the additive prices of every segment;
    kept only if more quotes are reproduced."""
    for m in c.prog.multipliers:
        for which in ("table", "fallback_table"):
            table = getattr(m, which)
            for lev in sorted(table):
                v = table[lev]
                target = simplest_near(v, FACTOR_STEPS[:3], 0.01)
                if target == v or abs(target - v) > 0.01 * abs(v):
                    continue
                before = c.count()
                saved_P, saved_F = c.P.copy(), c.F.copy()
                table[lev] = target
                c.F = np.ones(c.ds.n)
                for mm in c.prog.multipliers:
                    c.F = c.F * multiplier_factors(mm, c.cache)[0]
                c.relin()
                for seg in sorted(set(c.seg)):
                    robust_segment_refit(c, seg, sweeps=1)
                if c.count() > before:
                    if log:
                        log(f"    factor {m.id}[{lev}] {v:g} -> {target:g} with refit: {before} -> {c.count()} exact")
                    continue
                table[lev] = v
                c.P, c.F = saved_P, saved_F
                c.relin()


def refit_segments(c: Compiled, log=None) -> None:
    """Joint robust refit of every segment (see :func:`robust_segment_refit`): moves that
    change several parameters at once, e.g. a constant shifted between a fee inside the
    customer rate and a delivery fee outside it."""
    for seg in sorted(set(c.seg)):
        before = c.count()
        if robust_segment_refit(c, seg) and log:
            log(f"    [{seg}] joint refit: {before} -> {c.count()} exact")


def _local_line_hits(
    c: Compiled, RL: np.ndarray, base: np.ndarray, x: np.ndarray, y: np.ndarray, one: np.ndarray | None
) -> int:
    """Robust fit of ``y ≈ base + a·one + b·x`` (no ``a`` when ``one`` is None) on rows RL,
    snap a and b to the roundest numbers within 2.5 standard errors, and return how many of
    the rows then match exactly."""
    from .search import robust_fit

    A = np.column_stack([one, x]) if one is not None else x[:, None]
    t = y - base
    tol = np.maximum(c.unit[RL].astype(float), 1.0)
    fit = robust_fit(A, t, tol, np.ones(len(RL)), np.log2(2.0 + np.abs(t) / tol))
    if not fit.keep.all():
        return 0
    w = fit.w
    res = t - A @ fit.theta
    s2 = float(np.sum(w * res * res) / max(np.sum(w) - A.shape[1], 1.0))
    try:
        cov = max(s2, float(np.median(tol)) ** 2 / 12) * np.linalg.inv((A * w[:, None]).T @ A)
    except np.linalg.LinAlgError:
        return 0
    se = np.sqrt(np.maximum(np.diag(cov), 0.0))
    snapped = [
        simplest_within(float(v), PRICE_STEPS, max(2.5 * float(e), 1e-9)) for v, e in zip(fit.theta, se, strict=True)
    ]
    sub = base + A @ np.array(snapped)
    return int(c.hits(RL, round_to(sub, c.unit[RL], c.mode[RL])).sum())


def level_steps(c: Compiled, columns: list[str], max_levels: int = 12, log=None) -> None:
    """Pack size per level of a column (yield-based material).

    The quantity of a term is rounded up to whole packs / sheets whose capacity depends on
    another column (pieces per sheet by finished size): ``ceil(qty / step[level])`` packs at
    a price per pack. Screening, level by level: for each candidate step a straight line
    (offset + price per pack) is fitted to that level's quotes alone and snapped to round
    numbers; a step is kept if it reproduces clearly more of the level's quotes than the
    same refit without rounding. The variant is then applied to the whole segment (robust
    joint refit + snapping) and kept only if the segment reproduces at least ``max(3, 1%)``
    more quotes.
    """
    from .library import product_factors

    prog = c.prog
    n = c.ds.n
    for ts in c.terms:
        t = prog.terms[ts.idx]
        fs = t.feature
        if fs.is_const or fs.ceil_step or fs.step_by or fs.clamp_min is not None or t.segment is None:
            continue
        R = np.nonzero(ts.use & c.ok)[0]
        if len(R) < 10:
            continue
        segR = np.nonzero(c.seg == t.segment)[0]
        before = c.count(segR)
        obs = _observed(c)
        u = c.unit.astype(float)
        off = np.where(c.mode == 0, u / 2, np.where(c.mode == 2, -u / 2, 0.0))
        has_base = any(
            prog.terms[o.idx].segment == t.segment
            and prog.terms[o.idx].feature.is_const
            and prog.terms[o.idx].key is None
            and o.inside == ts.inside
            for o in c.terms
        )
        base_contrib = np.zeros(n)
        for o in c.terms:
            ot = prog.terms[o.idx]
            if ot.segment == t.segment and ot.feature.is_const and ot.key is None and o.inside == ts.inside:
                base_contrib += np.where(o.pid >= 0, c.P[np.maximum(o.pid, 0)], 0.0) * o.f
        own = np.where(ts.pid >= 0, c.P[np.maximum(ts.pid, 0)], 0.0) * ts.f
        Fv = c.F if ts.inside else np.ones(n)
        if ts.inside:
            base = (c.lin_in - own - base_contrib) * c.F + c.lin_out
        else:
            base = c.lin_in * c.F + c.lin_out - own - base_contrib
        orig_feature, orig_f, saved_P = t.feature, ts.f, c.P.copy()
        best = None
        for expr_, rest in [(fs.full_expr, None), *product_factors(fs.full_expr)]:
            xb = c.cache.feature(FeatureSpec(expr_))
            if np.any(np.abs(xb[R] - np.round(xb[R])) > 1e-9) or np.all(xb[R] <= 1):
                continue
            times = c.cache.feature(FeatureSpec(rest)) if rest else np.ones(n)
            for col in columns:
                if col not in c.cache.env:
                    continue
                labels = ex.as_str(c.cache.env[col], n)
                levels = sorted(set(labels[R]))
                if not 1 <= len(levels) <= max_levels:
                    continue
                steps: dict[str, float] = {}
                for lev in levels:
                    RL = R[(labels[R] == lev) & (obs[R] >= 0)]
                    if len(RL) < 5:
                        continue
                    y = obs[RL] + off[RL]
                    xl = xb[RL]
                    scale = times[RL] * Fv[RL]
                    one = Fv[RL] if has_base else None
                    plain = _local_line_hits(c, RL, base[RL], xl * scale, y, one)
                    pick = (plain, None)
                    for st in YIELD_STEPS:
                        if st >= xl.max() or np.all(xl % st == 0):
                            continue
                        packs = np.ceil(np.round(xl / st, 9))
                        cnt = _local_line_hits(c, RL, base[RL], packs * scale, y, one)
                        if cnt > pick[0] + max(1, len(RL) // 20):
                            pick = (cnt, st)
                    if pick[1] is not None:
                        steps[lev] = float(pick[1])
                if not steps:
                    continue
                cand = FeatureSpec(expr_, times=rest, step_by=col, steps=tuple(sorted(steps.items())), per_pack=True)
                t.feature = cand
                ts.f = c.cache.feature(cand)
                c.P = saved_P.copy()
                for k in term_params(c, ts.idx):  # per-piece price -> price per pack (first guess)
                    rows = c.prow[k]
                    if len(rows):
                        c.P[k] = c.P[k] * steps.get(str(labels[rows[0]]), 1.0)
                c.relin()
                robust_segment_refit(c, t.segment)
                cnt = c.count(segR)
                if cnt >= before + max(3, len(segR) // 100) and (best is None or cnt > best[0]):
                    best = (cnt, cand, c.P.copy())
                t.feature, ts.f, c.P = orig_feature, orig_f, saved_P.copy()
                c.relin()
        if best is not None:
            cnt, cand, P = best
            t.feature = cand
            ts.f = c.cache.feature(cand)
            c.P = P
            c.relin()
            if log:
                log(f"    {t.id}: packs by {cand.step_by} {dict(cand.steps)} ({before} -> {cnt} exact in segment)")


def coarsen_keys(prog: Program) -> None:
    """Drop a key column from a term's table when the values do not depend on it
    (e.g. a per-sheet price keyed by size × paper that only depends on the paper)."""
    for t in prog.terms:
        if t.key is None or t.key.bins:
            continue
        if len(t.key.columns) == 1:
            vals = list(t.table.values())
            if (
                len(vals) > 1
                and all(v == vals[0] for v in vals)
                and t.key.columns[0] not in {f.name for f in prog.flags}
            ):
                t.table = {"": vals[0]}
                t.key = None
                t.id = t.id.split("[")[0]
            continue
        cols = list(t.key.columns)
        for j in range(len(cols) - 1, -1, -1):
            if len(cols) < 2:
                break
            groups: dict[str, list] = {}
            ok = True
            for lev, vals in t.table.items():
                parts = lev.split("|")
                if len(parts) != len(cols):
                    ok = False
                    break
                rest = "|".join(parts[:j] + parts[j + 1 :])
                prev = groups.get(rest)
                if prev is not None and prev != vals:
                    ok = False
                    break
                groups[rest] = vals
            if ok:
                cols.pop(j)
                t.table = groups
        if tuple(cols) != t.key.columns:
            t.key = KeySpec(tuple(cols))
            t.id = t.id.split("[")[0] + "[" + ",".join(cols) + "]"


def refine_versions(c: Compiled, log=None) -> list[dict]:
    """Move each revision date to the day that reproduces the most quotes."""
    prog = c.prog
    report = []
    segs = sorted({t.segment for t in prog.terms if t.versions})
    for s in segs:
        terms = [t for t in prog.terms if t.segment == s and t.versions]
        if not terms:
            continue
        breaks = sorted({v for t in terms for v in t.versions})
        Rs = np.nonzero(c.seg == s)[0]
        days = np.unique(c.ds.day[Rs])
        for j, b in enumerate(breaks):
            bd = iso_to_day(b)
            # stay strictly between the neighbouring revision dates (never merge two dates)
            lo_b = iso_to_day(breaks[j - 1]) if j > 0 else -(10**9)
            hi_b = iso_to_day(breaks[j + 1]) if j + 1 < len(breaks) else 10**9
            cands = {int(d) for d in days if abs(int(d) - bd) <= 62 and lo_b < int(d) < hi_b} | {bd}
            # the 1st of each month in the window too (revisions usually start on the 1st,
            # which need not be a day with a quote)
            for d in range(bd - 62, bd + 63):
                if lo_b < d < hi_b and day_to_iso(d).endswith("-01"):
                    cands.add(d)
            cands = sorted(cands)
            scores = {}
            for d in cands:
                nb = day_to_iso(d)
                for t in terms:
                    t.versions = [nb if v == b else v for v in t.versions]
                c.recompile_keep()
                scores[d] = c.count(Rs)
                for t in terms:
                    t.versions = [b if v == nb else v for v in t.versions]
            top = max(scores.values())
            best_days = [d for d in cands if scores[d] == top]
            # prefer the 1st of a month, then the earliest
            firsts = [d for d in best_days if day_to_iso(d).endswith("-01")]
            chosen = (firsts or best_days)[0]
            nb = day_to_iso(chosen)
            for t in terms:
                t.versions = [nb if v == b else v for v in t.versions]
            breaks[j] = nb
            c.recompile_keep()
            lo, hi = _contiguous(best_days, chosen, cands)
            report.append(
                {"segment": s, "date": nb, "consistent_from": day_to_iso(lo), "consistent_to": day_to_iso(hi)}
            )
            if log and nb != b:
                log(f"    [{s}] revision {b} -> {nb} (consistent {day_to_iso(lo)}..{day_to_iso(hi)})")
    return report


def adopt_shared_terms(c: Compiled, log=None) -> None:
    """Offer each segment the terms that other segments share (same key and feature, e.g.
    a delivery fee or a keyword surcharge), starting from another segment's table.
    Kept only if the segment reproduces clearly more quotes."""
    import copy as _copy

    prog = c.prog
    by_sig: dict[tuple, list] = {}
    for t in prog.terms:
        if t.segment is None:
            continue
        sig = (None if t.key is None else t.key.key(), t.feature.key(), t.apply_multipliers)
        by_sig.setdefault(sig, []).append(t)
    for s in sorted(set(c.seg)):
        Rs = np.nonzero(c.seg == s)[0]
        have = {
            (None if t.key is None else t.key.key(), t.feature.key(), t.apply_multipliers)
            for t in prog.terms
            if t.segment == s
        }
        for sig, donors in sorted(by_sig.items(), key=lambda kv: -len(kv[1])):
            if sig in have or len(donors) < 2:
                continue
            donor = donors[0]
            fv = c.cache.feature(donor.feature)
            labels = c.cache.key_labels(donor.key).astype(str)
            used = Rs[fv[Rs] != 0]
            if len(used) < 3 or not set(labels[used]) <= set(donor.table):
                continue
            before = c.count(Rs)
            unit, mode, F = c.unit.copy(), c.mode.copy(), c.F.copy()
            inside = [ts.inside for ts in c.terms]
            c.write_back(clean=False)
            saved_terms = list(prog.terms)
            new = _copy.deepcopy(donor)
            new.segment = s
            new.id = f"{s}:{donor.id.split(':', 1)[1]}"
            prog.terms = [*prog.terms, new]
            c.recompile()
            for ts, ins in zip(c.terms, [*inside, new.apply_multipliers], strict=True):
                ts.inside = ins
            c.unit, c.mode, c.F = unit, mode, F
            c.relin()
            ti = len(prog.terms) - 1
            for _ in range(2):
                for k in term_params(c, ti):
                    param_search(c, k, reach=3)
            # the segment's other tables may have absorbed part of the shared fee (a delivery
            # fee folded into a per-kind fee keyed by delivery): let them move jointly
            robust_segment_refit(c, s)
            after = c.count(Rs)
            if after >= before + max(3, int(0.01 * len(Rs))):
                have.add(sig)
                if log:
                    log(f"    [{s}] adopted {donor.id.split(':', 1)[1]} from other segments -> +{after - before}")
                continue
            prog.terms = saved_terms
            c.recompile()
            for ts, ins in zip(c.terms, inside, strict=True):
                ts.inside = ins
            c.unit, c.mode, c.F = unit, mode, F
            c.relin()


def param_change_points(c: Compiled, min_rows: int = 5, max_tries: int = 12, log=None) -> None:
    """Find revisions of single table entries from the residuals.

    For each parameter, the quotes that use it but are not reproduced each imply an
    interval for it ("what would this entry have to be for the quote to match?"). If at
    least ``min_rows`` of them agree on the same round value, all from some date on, and the
    earlier quotes mostly match the current value, the entry gets a new version from the 1st
    of that month. Kept only when the exact count goes up."""
    prog = c.prog
    a, b = c.ds.candidates(c.tax_rounding)
    R_all = np.arange(c.ds.n)
    tried: set[tuple] = set()
    for _ in range(max_tries):
        net = c.net_rows(R_all)
        hit = c.hits(R_all, net)
        obs = np.where(np.abs(a - net) <= np.abs(np.where(b >= 0, b, 10**15) - net), a, b).astype(float)
        cands = []
        for k in range(len(c.P)):
            if c.fixed[k] or math.isnan(c.P[k]):
                continue
            R = c.prow[k]
            if len(R) < min_rows * 2:
                continue
            ts = c.terms[c.pinfo[k][0]]
            miss = R[~hit[R] & (obs[R] >= 0)]
            if len(miss) < min_rows:
                continue
            scale = ts.f[miss] * (c.F[miss] if ts.inside else 1.0)
            mm = miss[np.abs(scale) > 1e-9]
            if len(mm) < min_rows:
                continue
            sc = ts.f[mm] * (c.F[mm] if ts.inside else 1.0)
            u = c.unit[mm].astype(float)
            # the pre-rounding subtotal that produces the written amount lies in [lo, lo + u)
            lo_sub = np.where(c.mode[mm] == 0, obs[mm], np.where(c.mode[mm] == 1, obs[mm] - u / 2, obs[mm] - u))
            sub_now = c.subtotal_rows(mm)
            lo_v = c.P[k] + (lo_sub - sub_now) / sc
            hi_v = c.P[k] + (lo_sub + u - sub_now) / sc
            vals = np.array([simplest_in(min(x, y), max(x, y)) for x, y in zip(lo_v, hi_v, strict=True)])
            good = ~np.isnan(vals)
            if good.sum() < min_rows:
                continue
            uniq, cnt = np.unique(np.round(vals[good], 6), return_counts=True)
            order = np.argsort(-cnt)
            for j in order[:2]:
                if cnt[j] < min_rows or abs(uniq[j] - c.P[k]) < 1e-9:
                    continue
                rows_v = mm[good][np.abs(vals[good] - uniq[j]) < 1e-6]
                first = int(c.ds.day[rows_v].min())
                earlier = R[c.ds.day[R] < first]
                if len(earlier) < min_rows or hit[earlier].mean() < 0.6:
                    continue
                key = (k, round(float(uniq[j]), 6), first)
                if key in tried:
                    continue
                cands.append((int(cnt[j]), k, float(uniq[j]), first))
        if not cands:
            break
        cands.sort(key=lambda t: (-t[0], t[1]))
        accepted = False
        for _score, k, newv, first in cands[:max_tries]:
            tried.add((k, round(newv, 6), first))
            ti, lev, _ = c.pinfo[k]
            t = prog.terms[ti]
            b_iso = day_to_iso(first)[:8] + "01"
            if b_iso in t.versions:
                continue
            before = c.count()
            unit, mode, F = c.unit.copy(), c.mode.copy(), c.F.copy()
            inside = [ts.inside for ts in c.terms]
            c.write_back(clean=False)
            saved = {lv: list(vs) for lv, vs in t.table.items()}
            saved_versions = list(t.versions)
            vers = sorted({*t.versions, b_iso})
            pos = vers.index(b_iso)
            t.table = {lv: [*vs[: pos + 1], vs[min(pos, len(vs) - 1)], *vs[pos + 1 :]] for lv, vs in t.table.items()}
            t.table[lev][pos + 1] = newv
            t.versions = vers
            c.recompile()
            for ts, ins in zip(c.terms, inside, strict=True):
                ts.inside = ins
            c.unit, c.mode, c.F = unit, mode, F
            c.relin()
            after = c.count()
            if after >= before + min_rows:
                if log:
                    log(f"    {t.id} [{lev}] -> {fmt(newv)} from {b_iso} (+{after - before})")
                accepted = True
                break
            t.table, t.versions = saved, saved_versions
            c.recompile()
            for ts, ins in zip(c.terms, inside, strict=True):
                ts.inside = ins
            c.unit, c.mode, c.F = unit, mode, F
            c.relin()
        if not accepted:
            break


def simplest_in_vec(lo: np.ndarray, hi: np.ndarray) -> np.ndarray:
    """Vectorised :func:`simplest_in` (nan where the interval holds no listed step)."""
    out = np.full(len(lo), math.nan)
    todo = np.ones(len(lo), dtype=bool)
    for st in PRICE_STEPS:
        v = np.ceil(lo / st - 1e-9) * st
        ok = todo & (v < hi - 1e-9)
        out[ok] = np.round(v[ok], 10)
        todo &= ~ok
        if not todo.any():
            break
    return out


def mine_terms(
    c: Compiled,
    keys: list[KeySpec],
    features: list[FeatureSpec],
    flags: list,
    min_rows: int = 5,
    rounds: int = 12,
    log=None,
) -> None:
    """Missing additive terms, found directly in the exact domain.

    For a quote that is not reproduced, the written amount pins the pre-rounding subtotal
    to one rounding unit, so a single missing term ``value × feature`` (on the rows of one
    key level, inside or outside the factors) must lie in an interval. When at least
    ``min_rows`` quotes of a segment agree on the same round value, the term is tried and
    kept if the segment reproduces clearly more quotes (``max(3, 1 %)``). This catches
    surcharges the continuous search missed (a fixed fee on a keyword, a per-piece fee
    above a threshold) without refitting anything else.
    """
    c.cache.ensure_flags(flags)
    a, b = c.ds.candidates(c.tax_rounding)
    n = c.ds.n
    R_all = np.arange(n)
    flag_by_name = {f.name: f for f in flags}
    tried: set[tuple] = set()
    for _ in range(rounds):
        net = c.net_rows(R_all)
        hit = c.hits(R_all, net)
        obs = np.where(np.abs(a - net) <= np.abs(np.where(b >= 0, b, 10**15) - net), a, b).astype(float)
        sub_now = c.subtotal_rows(R_all)
        u = c.unit.astype(float)
        lo_sub = np.where(c.mode == 0, obs, np.where(c.mode == 1, obs - u / 2, obs - u))
        miss = c.ok & ~hit & (obs >= 0)
        cands = []
        for s in sorted(set(c.seg)):
            seg_miss = miss & (c.seg == s)
            if seg_miss.sum() < min_rows:
                continue
            for key in keys:
                labels = c.cache.key_labels(key).astype(str)
                is_flag = key.columns[0] in flag_by_name
                for fs in features:
                    fv = c.cache.feature(fs)
                    for inside in (True, False):
                        scale = fv * (c.F if inside else 1.0)
                        m = seg_miss & (np.abs(scale) > 1e-12)
                        if m.sum() < min_rows:
                            continue
                        levs = ["1"] if is_flag else sorted(set(labels[m]))
                        for lev in levs:
                            rows = np.nonzero(m & (labels == lev))[0]
                            if len(rows) < min_rows:
                                continue
                            x1 = (lo_sub[rows] - sub_now[rows]) / scale[rows]
                            x2 = (lo_sub[rows] + u[rows] - sub_now[rows]) / scale[rows]
                            vals = simplest_in_vec(np.minimum(x1, x2), np.maximum(x1, x2))
                            vals = vals[np.isfinite(vals) & (vals != 0)]
                            if len(vals) < min_rows:
                                continue
                            uniq, cnt = np.unique(vals, return_counts=True)
                            j = int(np.argmax(cnt))
                            if cnt[j] < min_rows:
                                continue
                            sig = (s, key.key(), fs.key(), inside, lev, float(uniq[j]))
                            if sig in tried:
                                continue
                            cands.append((int(cnt[j]), step_rank(float(uniq[j]), PRICE_STEPS), sig, key, fs))
        if not cands:
            break
        cands.sort(key=lambda t: (-t[0], t[1], t[2]))
        accepted = False
        for _cnt, _rank, sig, key, fs in cands[:8]:
            tried.add(sig)
            s, _, _, inside, lev, val = sig
            Rs = np.nonzero(c.seg == s)[0]
            before_seg, before = c.count(Rs), c.count()

            def mutate(p: Program, s=s, key=key, fs=fs, inside=inside, lev=lev, val=val) -> None:
                labels = c.cache.key_labels(key).astype(str)
                existing = next(
                    (
                        t
                        for t in p.terms
                        if t.segment == s
                        and t.apply_multipliers == inside
                        and t.feature.key() == fs.key()
                        and (t.key.key() if t.key else "") == key.key()
                    ),
                    None,
                )
                if existing is not None:
                    nv = len(next(iter(existing.table.values()), [0.0]))
                    existing.table[lev] = [val] * nv
                    return
                table = {str(lv): [0.0] for lv in set(labels[c.seg == s])}
                if key.columns[0] in flag_by_name:
                    table = {"0": [0.0], "": [0.0]}
                    if all(f.name != key.columns[0] for f in p.flags):
                        p.flags.append(flag_by_name[key.columns[0]])
                table[lev] = [val]
                name = f"{fs.expr}[{','.join(key.columns)}]"
                p.terms.append(
                    Term(
                        id=f"{s}:{name}",
                        feature=fs,
                        key=key,
                        table=table,
                        segment=s,
                        apply_multipliers=inside,
                        role="surcharge" if key.columns[0] in flag_by_name else "per_unit",
                    )
                )

            snap = _edit(c, mutate)
            c.F = np.ones(n)
            for mm in c.prog.multipliers:
                c.F = c.F * multiplier_factors(mm, c.cache)[0]
            c.relin()
            after_seg, after = c.count(Rs), c.count()
            if after_seg >= before_seg + max(3, len(Rs) // 100) and after > before:
                if log:
                    where = "factors-in" if inside else "after factors"
                    log(
                        f"    [{s}] mined {fs.expr} × [{','.join(key.columns)}={lev}] = {fmt(val)} ({where}): {before} -> {after}"
                    )
                accepted = True
                break
            _undo(c, snap)
            c.F = np.ones(n)
            for mm in c.prog.multipliers:
                c.F = c.F * multiplier_factors(mm, c.cache)[0]
            c.relin()
        if not accepted:
            break


def mine_factors(c: Compiled, keys: list[KeySpec], flags: list, min_rows: int = 5, rounds: int = 4, log=None) -> None:
    """Missing multiplicative factors (rush, a customer group, a discount for one product
    under a condition), found in the exact domain.

    For a quote that is not reproduced, the written amount pins the factor that would
    reproduce it to an interval; when at least ``min_rows`` quotes of one key level agree
    on the same round factor, a factor table on that key is tried and kept if clearly more
    quotes are reproduced overall (``max(3, 0.5 %)``). A flag may also act on one segment
    only (key ``segment × flag``); additive terms on the same flag in that segment (which
    the continuous search may have used to approximate the factor) are then replaced, and
    the segment is refitted."""
    prog = c.prog
    c.cache.ensure_flags(flags)
    a, b = c.ds.candidates(c.tax_rounding)
    n = c.ds.n
    R_all = np.arange(n)
    flag_by_name = {f.name: f for f in flags}
    have = {m.key.key() for m in prog.multipliers}
    tried: set[tuple] = set()

    def flag_terms(s: str, flag: str) -> list[int]:
        return [
            i
            for i, t in enumerate(prog.terms)
            if t.segment == s and t.key is not None and flag in t.key.columns and len(t.key.columns) == 1
        ]

    for _ in range(rounds):
        net = c.net_rows(R_all)
        hit = c.hits(R_all, net)
        obs = np.where(np.abs(a - net) <= np.abs(np.where(b >= 0, b, 10**15) - net), a, b).astype(float)
        u = c.unit.astype(float)
        lo_sub = np.where(c.mode == 0, obs, np.where(c.mode == 1, obs - u / 2, obs - u))
        base = c.lin_in * c.F
        no_min = np.isnan(c.minv)
        usable = c.ok & (obs >= 0) & (base > 0) & no_min
        miss = usable & ~hit
        cands = []

        def cluster(
            rows: np.ndarray, b_in: np.ndarray, b_out: np.ndarray, lo_sub=lo_sub, u=u
        ) -> tuple[int, float] | None:
            if len(rows) < min_rows:
                return None
            x1 = (lo_sub[rows] - b_out[rows]) / b_in[rows]
            x2 = (lo_sub[rows] + u[rows] - b_out[rows]) / b_in[rows]
            vals = _simplest_factor_vec(x1, x2)
            vals = vals[np.isfinite(vals) & (np.abs(vals - 1.0) > 1e-9) & (vals > 0.3) & (vals < 3.0)]
            if len(vals) < min_rows:
                return None
            uniq, cnt = np.unique(vals, return_counts=True)
            j = int(np.argmax(cnt))
            return (int(cnt[j]), float(uniq[j])) if cnt[j] >= min_rows else None

        for key in keys:
            labels = c.cache.key_labels(key).astype(str)
            is_flag = key.columns[0] in flag_by_name
            if key.key() not in have:
                for lev in ["1"] if is_flag else sorted(set(labels[miss])):
                    got = cluster(np.nonzero(miss & (labels == lev))[0], base, c.lin_out)
                    if got is not None and (key.key(), lev, got[1]) not in tried:
                        sig = (key.key(), lev, got[1])
                        cands.append((got[0], step_rank(got[1], FACTOR_STEPS), sig, key, lev, got[1], None))
            if not is_flag:
                continue
            pair = KeySpec(("_segment", key.columns[0]))
            if pair.key() in have:
                continue
            for s in sorted(set(c.seg)):
                drop = flag_terms(s, key.columns[0])
                c_in = np.zeros(n)
                c_out = np.zeros(n)
                for i in drop:
                    ts = c.terms[i]
                    v = np.where(ts.pid >= 0, c.P[np.maximum(ts.pid, 0)], 0.0) * ts.f
                    if ts.inside:
                        c_in += np.nan_to_num(v)
                    else:
                        c_out += np.nan_to_num(v)
                b_in = (c.lin_in - c_in) * c.F
                b_out = c.lin_out - c_out
                rows_all = usable & (c.seg == s) & (labels == "1") & (b_in > 0)
                rows = np.nonzero(rows_all if drop else rows_all & ~hit)[0]
                got = cluster(rows, b_in, b_out)
                lev = f"{s}|1"
                if got is not None and (pair.key(), lev, got[1]) not in tried:
                    sig = (pair.key(), lev, got[1])
                    cands.append((got[0], step_rank(got[1], FACTOR_STEPS), sig, pair, lev, got[1], (s, key.columns[0])))
        if not cands:
            break
        cands.sort(key=lambda t: (-t[0], t[1], t[2]))
        accepted = False
        for _cnt, _rank, sig, key, lev, val, seg_flag in cands[:6]:
            tried.add(sig)
            before = c.count()
            labels = c.cache.key_labels(key).astype(str)
            drop_ids = {prog.terms[i].id for i in flag_terms(*seg_flag)} if seg_flag else set()
            flag_name = key.columns[-1]

            def mutate(
                p: Program, key=key, lev=lev, val=val, labels=labels, drop_ids=drop_ids, flag_name=flag_name
            ) -> None:
                table = {str(lv): 1.0 for lv in set(labels)}
                table[lev] = val
                p.multipliers.append(Multiplier(id=f"m:{'|'.join(key.columns)}", key=key, table=table, role="category"))
                if flag_name in flag_by_name and all(f.name != flag_name for f in p.flags):
                    p.flags.append(flag_by_name[flag_name])
                p.terms = [t for t in p.terms if t.id not in drop_ids]

            snap = _edit(c, mutate)
            if seg_flag:
                robust_segment_refit(c, seg_flag[0])
            after = c.count()
            if after >= before + max(3, n // 200):
                if log:
                    log(f"    mined factor ×{val:g} on [{','.join(key.columns)}={lev}]: {before} -> {after}")
                have.add(key.key())
                accepted = True
                break
            _undo(c, snap)
        if not accepted:
            break


def _simplest_factor_vec(lo: np.ndarray, hi: np.ndarray) -> np.ndarray:
    out = np.full(len(lo), math.nan)
    lo2, hi2 = np.minimum(lo, hi), np.maximum(lo, hi)
    todo = np.ones(len(lo), dtype=bool)
    for st in FACTOR_STEPS:
        v = np.ceil(lo2 / st - 1e-9) * st
        ok = todo & (v < hi2 - 1e-12)
        out[ok] = np.round(v[ok], 10)
        todo &= ~ok
        if not todo.any():
            break
    return out


def refine_thresholds(c: Compiled, log=None) -> None:
    """Move each numeric threshold used by a term to the neighbouring cut point (an observed
    value of the same column) that reproduces the most quotes. The continuous search picks
    a cut from rough residuals; the exact count tells e.g. ``height >= 3 m`` from ``>= 4 m``."""
    prog = c.prog
    by_name = {f.name: f for f in prog.flags}
    for ti in range(len(prog.terms)):
        t = prog.terms[ti]
        if t.key is None or len(t.key.columns) != 1:
            continue
        fl = by_name.get(t.key.columns[0])
        if fl is None or fl.kind != "threshold" or fl.columns[0] == "_day":
            continue
        col = fl.columns[0]
        x = ex.as_float(c.cache.env[col], c.ds.n)
        Rs = np.nonzero(c.seg == t.segment)[0] if t.segment is not None else np.arange(c.ds.n)
        vals = np.unique(x[Rs][~np.isnan(x[Rs])])
        if len(vals) < 3:
            continue
        before = c.count()
        best = (before, 0, fl.threshold)
        for v in vals[1:]:
            if abs(v - fl.threshold) < 1e-12:
                continue
            name = f"{col}>={v:g}"
            nf = FlagSpec(name, "threshold", (col,), threshold=float(v))

            def mutate(p: Program, ti=ti, nf=nf) -> None:
                if all(f.name != nf.name for f in p.flags):
                    p.flags.append(nf)
                tt = p.terms[ti]
                tt.key = KeySpec((nf.name,))

            snap = _edit(c, mutate)
            for k in term_params(c, ti):
                param_search(c, k, reach=3)
            cnt = c.count()
            _undo(c, snap)
            t = prog.terms[ti]
            if cnt > best[0]:
                best = (cnt, 1, float(v))
        if best[1]:
            v = best[2]
            nf = FlagSpec(f"{col}>={v:g}", "threshold", (col,), threshold=v)

            def mutate(p: Program, ti=ti, nf=nf) -> None:
                if all(f.name != nf.name for f in p.flags):
                    p.flags.append(nf)
                p.terms[ti].key = KeySpec((nf.name,))
                p.terms[ti].id = p.terms[ti].id.split("[")[0] + f"[{nf.name}]"

            _edit(c, mutate)
            for k in term_params(c, ti):
                param_search(c, k, reach=3)
            if log:
                log(f"    {t.id}: threshold {fl.threshold:g} -> {v:g} ({before} -> {c.count()} exact)")
            by_name = {f.name: f for f in prog.flags}


def merge_pairs(c: Compiled, max_levels: int = 40, log=None) -> None:
    """Two tables on the same quantity keyed by different columns (rate by thickness + rate
    by sides) -> one table keyed by both (rate by thickness × sides), when the prices do not
    add up. Starts from the sums (same predictions), refits the segment jointly, and keeps
    the merged table if more quotes are reproduced."""
    prog = c.prog
    flag_names = {f.name for f in prog.flags}
    changed = True
    while changed:
        changed = False
        for i in range(len(prog.terms)):
            ti_ = prog.terms[i]
            if ti_.key is None or len(ti_.key.columns) != 1 or ti_.key.columns[0] in flag_names or ti_.feature.is_const:
                continue
            for j in range(i + 1, len(prog.terms)):
                ti_ = prog.terms[i]  # re-read: an undone trial replaces the term objects
                tj = prog.terms[j]
                if (
                    tj.segment != ti_.segment
                    or tj.key is None
                    or len(tj.key.columns) != 1
                    or tj.key.columns[0] in flag_names
                    or tj.key.columns[0] == ti_.key.columns[0]
                    or tj.apply_multipliers != ti_.apply_multipliers
                    or tj.feature.full_expr.replace(" ", "") != ti_.feature.full_expr.replace(" ", "")
                    or tj.versions != ti_.versions
                ):
                    continue
                pair = KeySpec((ti_.key.columns[0], tj.key.columns[0]))
                labels = c.cache.key_labels(pair).astype(str)
                Rs = np.nonzero(c.seg == ti_.segment)[0]
                combos = sorted(set(labels[Rs]))
                if len(combos) > max_levels:
                    continue
                before = c.count()

                def mutate(p: Program, i=i, j=j, pair=pair, combos=combos) -> None:
                    a, b = p.terms[i], p.terms[j]
                    nv = len(a.versions) + 1
                    table: dict[str, list[float | None]] = {}
                    for lab in combos:
                        la, lb = lab.split("|", 1)
                        va, vb = a.table.get(la), b.table.get(lb)
                        if va is None or vb is None:
                            continue
                        table[lab] = [
                            None
                            if (va[min(k, len(va) - 1)] is None or vb[min(k, len(vb) - 1)] is None)
                            else float(va[min(k, len(va) - 1)]) + float(vb[min(k, len(vb) - 1)])
                            for k in range(nv)
                        ]
                    a.key = pair
                    a.table = table
                    a.id = a.id.split("[")[0] + "[" + ",".join(pair.columns) + "]"
                    p.terms.pop(j)

                snap = _edit(c, mutate)
                robust_segment_refit(c, ti_.segment)
                for k in term_params(c, i):
                    param_search(c, k, reach=3)
                after = c.count()
                if after >= before + max(3, len(Rs) // 100):
                    if log:
                        log(
                            f"    [{ti_.segment}] tables by {pair.columns[0]} and {pair.columns[1]} -> one table by both ({before} -> {after})"
                        )
                    changed = True
                    break
                _undo(c, snap)
            if changed:
                break


def simplest_in(lo: float, hi: float) -> float:
    """The roundest number in [lo, hi) (nan if the interval is empty)."""
    for st in PRICE_STEPS:
        v = math.ceil(lo / st - 1e-9) * st
        if v < hi - 1e-9:
            return round(v, 10)
    return math.nan


def fmt(v: float) -> str:
    return f"{v:,.6g}"


def try_version_splits(c: Compiled, log=None) -> None:
    """Try every revision date found anywhere on segments that have no split there yet.

    A small revision (one fixed fee) may be invisible to the continuous search; the exact
    count is a sharper test: split all of the segment's tables at the date, re-snap, keep
    the split if it reproduces clearly more quotes.
    """
    prog = c.prog
    dates = sorted({v for t in prog.terms for v in t.versions})
    for s in sorted(set(c.seg)):
        Rs = np.nonzero(c.seg == s)[0]
        terms = [t for t in prog.terms if t.segment == s]
        if not terms:
            continue
        for d in dates:
            if any(d in t.versions for t in terms):
                continue
            dd = iso_to_day(d)
            if (c.ds.day[Rs] >= dd).sum() < 5 or (c.ds.day[Rs] < dd).sum() < 5:
                continue
            before = c.count(Rs)
            saved = c.prog.copy()
            saved_inside = [ts.inside for ts in c.terms]
            unit, mode, F = c.unit.copy(), c.mode.copy(), c.F.copy()
            c.write_back(clean=False)
            for t in terms:
                vers = sorted({*t.versions, d})
                pos = vers.index(d)
                t.table = {
                    lev: [*vals[: pos + 1], vals[min(pos, len(vals) - 1)], *vals[pos + 1 :]]
                    for lev, vals in t.table.items()
                }
                t.versions = vers
            c.recompile()
            c.unit, c.mode, c.F = unit, mode, F
            c.relin()
            ks = [k for k in range(len(c.P)) if c.prog.terms[c.pinfo[k][0]].segment == s]
            for _ in range(2):
                for k in sorted(ks, key=lambda k: -len(c.prow[k])):
                    param_search(c, k, reach=3)
            # values after a revision can be far from the old ones (+10-20 %): coordinate
            # snapping alone cannot get there, a joint robust refit can
            robust_segment_refit(c, s)
            after = c.count(Rs)
            if after >= before + max(3, int(0.01 * len(Rs))):
                if log:
                    log(f"    [{s}] revision {d} adopted from other segments -> +{after - before}")
                continue
            c.prog.terms = saved.terms
            c.recompile()
            for ts, ins in zip(c.terms, saved_inside, strict=True):
                ts.inside = ins
            c.unit, c.mode, c.F = unit, mode, F
            c.relin()


def _contiguous(best: list[int], chosen: int, cands: list[int]) -> tuple[int, int]:
    s = set(best)
    i = cands.index(chosen)
    lo = hi = i
    while lo - 1 >= 0 and cands[lo - 1] in s:
        lo -= 1
    while hi + 1 < len(cands) and cands[hi + 1] in s:
        hi += 1
    # the change can happen on any day after the last earlier quote date
    lo_day = cands[lo - 1] + 1 if lo - 1 >= 0 else cands[lo]
    return lo_day, cands[hi]


# --------------------------------------------------------------------------- simplification


def _edit(c: Compiled, mutate) -> tuple:
    """Apply a structural edit to the program (keeping parameter values, rounding and the
    in/out flags); returns a snapshot for :func:`_undo`."""
    c.write_back(clean=False)
    snap = (c.prog.copy(), c.unit.copy(), c.mode.copy())
    mutate(c.prog)
    c.recompile()
    c.unit, c.mode = snap[1].copy(), snap[2].copy()
    c.relin()
    return snap


def _undo(c: Compiled, snap: tuple) -> None:
    prog, unit, mode = snap
    c.prog.terms, c.prog.multipliers = prog.terms, prog.multipliers
    c.prog.flags, c.prog.min_charge = prog.flags, prog.min_charge
    c.recompile()
    c.unit, c.mode = unit, mode
    c.relin()


def dedupe_versions(prog: Program) -> None:
    """Drop versions that cover no day (two revision dates on the same day)."""
    for t in prog.terms:
        vers = t.versions
        if len(vers) < 2:
            continue
        idx = [0]
        new_vers = []
        for k in range(1, len(vers) + 1):
            if k < len(vers) and vers[k] == vers[k - 1]:
                continue  # version k starts and ends on the same date
            new_vers.append(vers[k - 1])
            idx.append(k)
        if len(new_vers) != len(vers):
            t.versions = new_vers
            t.table = {lev: [vals[min(i, len(vals) - 1)] for i in idx] for lev, vals in t.table.items()}


def _drop_break(prog: Program, seg: str, date_iso: str, side: str) -> None:
    for t in prog.terms:
        if t.segment != seg or date_iso not in t.versions:
            continue
        k = t.versions.index(date_iso)
        new = {}
        for lev, vals in t.table.items():
            keep = vals[min(k, len(vals) - 1)] if side == "before" else vals[min(k + 1, len(vals) - 1)]
            new[lev] = [*vals[:k], keep, *vals[k + 2 :]]
        t.table = new
        t.versions = [v for v in t.versions if v != date_iso]


def _drop_break_terms(prog: Program, idxs: set[int], date_iso: str) -> None:
    """Remove revision date ``date_iso`` from the given terms (keeping the values of the
    version with the larger share of quotes is left to the refit; start from the later one)."""
    for i, t in enumerate(prog.terms):
        if i not in idxs or date_iso not in t.versions:
            continue
        k = t.versions.index(date_iso)
        t.table = {lev: [*vals[:k], vals[min(k + 1, len(vals) - 1)], *vals[k + 2 :]] for lev, vals in t.table.items()}
        t.versions = [v for v in t.versions if v != date_iso]


def localize_revisions(c: Compiled, log=None) -> None:
    """Which table actually changed at a revision date?

    The search splits every table of a segment at a revision date. Here each single table
    is tried as the only one that changed (all other tables keep one value across the date
    and are re-estimated jointly on the quotes before *and* after it). The localized
    version is kept when it reproduces at least as many quotes."""
    prog = c.prog
    for s in sorted({t.segment for t in prog.terms if t.versions and t.segment is not None}):
        for d in sorted({v for t in prog.terms if t.segment == s for v in t.versions}):
            idx = [i for i, t in enumerate(prog.terms) if t.segment == s and d in t.versions]
            if len(idx) < 2:
                continue
            before = c.count()
            results = []
            for keep in idx:
                others = set(idx) - {keep}
                snap = _edit(c, lambda p, others=others, d=d: _drop_break_terms(p, others, d))
                robust_segment_refit(c, s)
                results.append((c.count(), -keep))
                _undo(c, snap)
            cnt, neg_keep = max(results)
            if cnt >= before:
                keep = -neg_keep
                others = set(idx) - {keep}
                tid = prog.terms[keep].id
                _edit(c, lambda p, others=others, d=d: _drop_break_terms(p, others, d))
                robust_segment_refit(c, s)
                if log:
                    log(f"    [{s}] revision {d}: only {tid} changed ({before} -> {c.count()} exact)")


def simplify(c: Compiled, log=None) -> None:
    """Prefer the shorter program whenever it reproduces at least as many quotes.

    Tries, in order: removing each revision date of a segment (merging the two versions,
    starting from either side's values, then re-snapping the segment's parameters),
    removing each term, and removing each factor table other than the customer rates.
    """
    prog = c.prog
    c.write_back(clean=False)
    _edit(c, dedupe_versions)
    for s in sorted({t.segment for t in prog.terms if t.versions and t.segment is not None}):
        for d in sorted({v for t in prog.terms if t.segment == s for v in t.versions}):
            before = c.count()
            results = []
            for side in ("before", "after"):
                snap = _edit(c, lambda p, side=side, d=d, s=s: _drop_break(p, s, d, side))
                ks = [k for k in range(len(c.P)) if c.prog.terms[c.pinfo[k][0]].segment == s]
                for _ in range(2):
                    for k in sorted(ks, key=lambda k: -len(c.prow[k])):
                        param_search(c, k, reach=3)
                results.append((c.count(), side))
                _undo(c, snap)
            cnt, side = max(results, key=lambda r: (r[0], r[1] == "before"))
            if cnt >= before:
                _edit(c, lambda p, side=side, d=d, s=s: _drop_break(p, s, d, side))
                ks = [k for k in range(len(c.P)) if c.prog.terms[c.pinfo[k][0]].segment == s]
                for _ in range(2):
                    for k in sorted(ks, key=lambda k: -len(c.prow[k])):
                        param_search(c, k, reach=3)
                if log:
                    log(f"    [{s}] revision {d} not needed ({before} -> {c.count()} exact)")
    for ti in range(len(prog.terms) - 1, -1, -1):
        before = c.count()
        tid = prog.terms[ti].id
        snap = _edit(c, lambda p, ti=ti: p.terms.pop(ti))
        if c.count() >= before:
            if log:
                log(f"    term {tid} not needed")
            continue
        _undo(c, snap)
    for mi in range(len(prog.multipliers) - 1, -1, -1):
        m = prog.multipliers[mi]
        if m.key.columns == ("_customer",):
            continue
        before = c.count()
        snap = _edit(c, lambda p, mi=mi: p.multipliers.pop(mi))
        if c.count() >= before:
            if log:
                log(f"    factor table {m.id} not needed")
            continue
        _undo(c, snap)


# --------------------------------------------------------------------------- multipliers


def merge_customer_multipliers(prog: Program, cache: EvalCache) -> None:
    """Class factor table + per-customer overrides -> one absolute table with the class as fallback."""
    cls = next((m for m in prog.multipliers if m.key.columns == ("_customer_class",)), None)
    over = next((m for m in prog.multipliers if m.key.columns == ("_customer",)), None)
    if cls is None and over is None:
        return
    rest = [m for m in prog.multipliers if m is not cls and m is not over]
    table: dict[str, float] = {}
    if over is not None:
        cust = cache.key_labels(KeySpec(("_customer",))).astype(str)
        ccls = cache.key_labels(KeySpec(("_customer_class",))).astype(str)
        first = {}
        for cu, cl in zip(cust, ccls, strict=True):
            first.setdefault(cu, cl)
        for cu, g in over.table.items():
            base = cls.table.get(first.get(cu, ""), 1.0) if cls else 1.0
            table[cu] = round(base * g, 4)
    merged = Multiplier(
        id="m:customer",
        key=KeySpec(("_customer",)),
        table=table,
        fallback_key=KeySpec(("_customer_class",)) if cls else None,
        fallback_table=dict(cls.table) if cls else {},
        default=1.0,
        role="customer_rate",
    )
    prog.multipliers = [merged, *rest]


def multiplier_search(c: Compiled, min_gain: int = 2, log=None) -> None:
    """Snap factor tables (class/fallback and other keys) and fit per-customer absolute rates."""
    prog = c.prog
    cache = c.cache
    for m in prog.multipliers:
        for which in ("fallback_table", "table"):
            table = getattr(m, which)
            if not table:
                continue
            labels = cache.key_labels(m.fallback_key if which == "fallback_table" else m.key).astype(str)
            for lev in sorted(table, key=lambda k: -int(np.sum(labels == k))):
                cur_f, src = multiplier_factors(m, cache)
                rows = labels == lev
                if which == "fallback_table":
                    rows &= src == 2
                else:
                    rows &= src == 1
                R = np.nonzero(rows)[0]
                if len(R) == 0:
                    continue
                other = c.F[R] / cur_f[R]
                cur = table[lev]
                scored = []
                for v in [*snap_candidates(cur, FACTOR_STEPS, 3), cur]:
                    scored.append((int(c.hits(R, c.net_rows(R, F=other * v)).sum()), v))
                # an extra digit in a rate needs real evidence (rates are round in practice)
                best = pick_simplest(scored, cur, FACTOR_STEPS, slack=max(3, len(R) // 20))
                table[lev] = _clean(best[1])
                c.F[R] = other * best[1]
    # per-customer absolute rates (only where they reproduce >= min_gain more quotes)
    cm = next((m for m in prog.multipliers if m.key.columns == ("_customer",)), None)
    if cm is None:
        return
    cust = c.ds.customer.astype(str)
    cur_f, src = multiplier_factors(cm, cache)
    grid = sorted({round(x, 4) for x in np.arange(0.5, 1.5001, 0.005)} | set(cm.fallback_table.values()))
    new_table = {}
    for cc in sorted(set(cust)):
        R = np.nonzero(cust == cc)[0]
        if len(R) < 2:
            continue
        other = c.F[R] / cur_f[R]
        fb = (
            cm.fallback_table.get(str(cache.key_labels(cm.fallback_key)[R[0]]), cm.default)
            if cm.fallback_key
            else cm.default
        )
        base = int(c.hits(R, c.net_rows(R, F=other * fb)).sum())
        best = (base, fb)
        start = cm.table.get(cc)
        cands = list(grid)
        if start is not None:
            cands += snap_candidates(start, FACTOR_STEPS, 3)
        scored = [(int(c.hits(R, c.net_rows(R, F=other * v)).sum()), v) for v in cands]
        top = max(s_[0] for s_ in scored)
        pool = [s_ for s_ in scored if s_[0] >= top - max(1, len(R) // 20)]
        pick = min(pool, key=lambda s_: (step_rank(s_[1], FACTOR_STEPS), -s_[0]))
        best = (int(c.hits(R, c.net_rows(R, F=other * pick[1])).sum()), pick[1])
        if best[0] >= base + min_gain and abs(best[1] - fb) > 1e-9:
            new_table[cc] = _clean(best[1])
            c.F[R] = other * best[1]
        else:
            c.F[R] = other * fb
    cm.table = new_table
    if log:
        log(f"    customer rates: {len(new_table)} individual, {c.count()} exact")


# --------------------------------------------------------------------------- identifiability


def identifiability(c: Compiled) -> list[dict]:
    """For every parameter: how many reproduced quotes use it, and which range of values
    would reproduce exactly the same quotes. Parameters no reproduced quote uses are
    *not identifiable* from history (要聞き取り)."""
    hit = c.match_all()
    out = []
    for k, (ti, lev, v) in enumerate(c.pinfo):
        R = c.prow[k]
        if c.fixed[k] or len(R) == 0:
            continue  # structural zero (flag not set) or a level no quote uses
        t = c.prog.terms[ti]
        support = int(hit[R].sum()) if len(R) else 0
        val = c.P[k]
        info = {
            "term": t.id,
            "level": lev,
            "version": v,
            "value": None if math.isnan(val) else _clean(val),
            "rows": len(R),
            "support": support,
        }
        if support == 0 or math.isnan(val):
            info["status"] = "not_identifiable"
            out.append(info)
            continue
        Rh = R[hit[R]]
        ts = c.terms[ti]
        f = ts.f[Rh]
        base_in = c.lin_in[Rh] - (val * f if ts.inside else 0.0)
        base_out = c.lin_out[Rh] - (0.0 if ts.inside else val * f)
        step = PRICE_STEPS[min(step_rank(val, PRICE_STEPS) + 2, len(PRICE_STEPS) - 1)] if val else 1.0
        bounds = []
        for direction in (-1, 1):
            x = val
            for _ in range(300):
                x2 = x + direction * step
                li = base_in + x2 * f if ts.inside else base_in
                lo = base_out if ts.inside else base_out + x2 * f
                if int(c.hits(Rh, c.net_rows(Rh, lin_in=li, lin_out=lo)).sum()) < len(Rh):
                    break
                x = x2
            bounds.append(_clean(x))
        info["consistent_range"] = bounds
        width = bounds[1] - bounds[0]
        info["status"] = "identified" if width <= 2 * step + 1e-9 else "range"
        out.append(info)
    return out


def merge_versions(prog: Program) -> None:
    """Drop version splits whose values did not change."""
    for t in prog.terms:
        if not t.versions:
            continue
        keep_idx = [0]
        nv = len(t.versions) + 1
        for v in range(1, nv):
            same = all(
                (vals[v] == vals[keep_idx[-1]])
                for vals in t.table.values()
                if v < len(vals) and keep_idx[-1] < len(vals)
            )
            if not same:
                keep_idx.append(v)
        if len(keep_idx) == nv:
            continue
        t.versions = [t.versions[v - 1] for v in keep_idx[1:]]
        t.table = {lev: [vals[v] for v in keep_idx] for lev, vals in t.table.items()}


def drop_zero_levels(prog: Program) -> None:
    for t in prog.terms:
        if t.feature.is_const and t.key is not None:
            continue
    prog.terms = [t for t in prog.terms if any(any((x or 0) != 0 for x in vals) for vals in t.table.values())]


def per_pack_form(prog: Program) -> None:
    """Show 'price per pack' when that is the simpler number (e.g. 1,500 per 100 sheets)."""
    for t in prog.terms:
        fs = t.feature
        if not fs.ceil_step or fs.per_pack or fs.step_by:
            continue
        s = fs.ceil_step
        simpler = True
        for vals in t.table.values():
            for x in vals:
                if x is None:
                    continue
                if step_rank(round(x * s, 6), PRICE_STEPS) > step_rank(x, PRICE_STEPS):
                    simpler = False
        if simpler:
            t.feature = dataclasses.replace(fs, per_pack=True)
            t.table = {k: [None if x is None else _clean(x * s) for x in v] for k, v in t.table.items()}


# --------------------------------------------------------------------------- driver


def joint_feature_variants(c: Compiled, max_variants: int = 30, log=None) -> None:
    """Pack rounding / minimum quantity applied to *all* terms of a segment that are charged
    on the same quantity (price by size + by paper + by colour, all per piece).

    :func:`feature_variants` changes one term at a time, which cannot show the effect when
    several tables share the quantity: rounding one of them up to whole packs breaks the
    others. Here every term on that quantity gets the same variant, the segment is refitted
    jointly, and the variant is kept if the segment reproduces clearly more quotes."""
    prog = c.prog
    for s in sorted({t.segment for t in prog.terms if t.segment is not None}):
        Rs = np.nonzero(c.seg == s)[0]
        groups: list[tuple[np.ndarray, list[int]]] = []
        for i, t in enumerate(prog.terms):
            if t.segment != s or t.feature.is_const:
                continue
            raw = c.cache.feature(FeatureSpec(t.feature.full_expr))[Rs]
            for g in groups:
                if np.allclose(g[0], raw):
                    g[1].append(i)
                    break
            else:
                groups.append((raw, [i]))
        for raw, idxs in groups:
            if len(idxs) < 2:
                continue
            base = FeatureSpec(prog.terms[idxs[0]].feature.full_expr)
            nz = raw != 0
            whole = [v for v in variants_of(base, lambda f, nz=nz, Rs=Rs: c.cache.feature(f)[Rs][nz]) if not v.times]
            before_seg, before = c.count(Rs), c.count()
            best = None
            for fs in [base, *whole[:max_variants]]:

                def mutate(p: Program, idxs=idxs, fs=fs) -> None:
                    for i in idxs:
                        p.terms[i].feature = fs

                snap = _edit(c, mutate)
                robust_segment_refit(c, s)
                for i in idxs:
                    for k in term_params(c, i):
                        param_search(c, k, reach=3)
                cnt, tot = c.count(Rs), c.count()
                _undo(c, snap)
                if tot > before and cnt >= before_seg + max(3, len(Rs) // 100) and (best is None or cnt > best[0]):
                    best = (cnt, fs)
            if best is None:
                continue
            fs = best[1]

            def mutate(p: Program, idxs=idxs, fs=fs) -> None:
                for i in idxs:
                    p.terms[i].feature = fs

            _edit(c, mutate)
            robust_segment_refit(c, s)
            for i in idxs:
                for k in term_params(c, i):
                    param_search(c, k, reach=3)
            if log:
                log(
                    f"    [{s}] {len(idxs)} tables on {base.expr}: feature {fs.to_json()} ({before} -> {c.count()} exact)"
                )


def polish(prog: Program, ds: Dataset, rep_column: str | None, log=None, mine: dict | None = None) -> list[dict]:
    """Exact-stage repairs once more on the program combined from the search variants (it is
    a new program: a revision or pack size may now be visible that no single variant had).
    Every step only keeps changes that reproduce more quotes. Returns the revision report."""
    c = Compiled.build(prog, ds, EvalCache(ds), prog.tax_rounding)
    before = c.count()
    joint_feature_variants(c, log=log)
    c.write_back()
    if mine is not None:
        mine_factors(c, mine["mult_keys"], mine["flags"], log=log)
        mine_terms(c, mine["keys"], mine["features"], mine["flags"], log=log)
        c.write_back()
    param_change_points(c, log=log)
    c.write_back()
    try_version_splits(c, log)
    snap_all(c, sweeps=1)
    multiplier_search(c)
    search_rounding(c, rep_column, log)
    search_min_charge(c, log)
    simplify(c, log)
    c.write_back()
    revisions = refine_versions(c, log)
    snap_all(c, sweeps=1)
    search_min_charge(c, log)
    c.write_back()
    min_charge_bounds(c)
    c.write_back()
    merge_versions(prog)
    drop_zero_levels(prog)
    coarsen_keys(prog)
    per_pack_form(prog)
    present = {(t.segment, v) for t in prog.terms for v in t.versions}
    revisions = [r for r in revisions if (r["segment"], r["date"]) in present]
    after = Compiled.build(prog, ds, EvalCache(ds), prog.tax_rounding).count()
    if log:
        log(f"  polish after combining variants: {before} -> {after} exact")
    return revisions


def transplant_segments(
    prog: Program, others: list[Program], ds: Dataset, log=None
) -> tuple[Program, list[tuple[int, str]]]:
    """Combine search variants segment by segment.

    The variants share nothing but the data; one may find the right structure for one
    product and another for a different product. For every segment where another
    variant reproduces more quotes, its terms (and minimum charge) replace the current
    ones; the swap is kept only if the whole dataset then reproduces more quotes (the
    customer rates and rounding are shared, so a segment cannot be judged alone).
    Returns the combined program and the (variant, segment) pairs taken over.
    """
    cur = prog.copy()
    cache = EvalCache(ds)
    c = Compiled.build(cur, ds, cache, cur.tax_rounding)
    best_total = c.count()
    hits = c.match_all()
    seg = c.seg
    taken: list[tuple[int, str]] = []
    for vi, other in enumerate(others):
        co = Compiled.build(other, ds, EvalCache(ds), other.tax_rounding)
        hits_o = co.match_all()
        for s in sorted(set(seg)):
            m = seg == s
            if int(hits_o[m].sum()) <= int(hits[m].sum()):
                continue
            trial = cur.copy()
            trial.terms = [t for t in trial.terms if t.segment != s] + [
                Term.from_json(t.to_json()) for t in other.terms if t.segment == s
            ]
            names = {f.name for f in trial.flags}
            trial.flags = trial.flags + [f for f in other.flags if f.name not in names]
            if s in other.min_charge:
                trial.min_charge[s] = MinCharge.from_json(other.min_charge[s].to_json())
            ct = Compiled.build(trial, ds, EvalCache(ds), trial.tax_rounding)
            tot = ct.count()
            if tot > best_total:
                if log:
                    log(f"    [{s}] taken from variant {vi}: {best_total} -> {tot} exact")
                best_total = tot
                cur = trial
                hits = ct.match_all()
                taken.append((vi, s))
    return cur, taken


def adopt_variant_terms(prog: Program, others: list[Program], ds: Dataset, max_tries: int = 40, log=None) -> int:
    """Single terms that another search variant found for a segment (a keyword surcharge,
    a fee keyed by another column) are tried in the combined program: added with that
    variant's values, the segment refitted jointly, kept if the segment reproduces clearly
    more quotes (``max(3, 1 %)``). Returns the number of terms adopted."""
    c = Compiled.build(prog, ds, EvalCache(ds), prog.tax_rounding)

    def sig(t: Term) -> tuple:
        return (t.segment, None if t.key is None else t.key.key(), t.feature.key(), t.apply_multipliers)

    adopted = 0
    tries = 0
    seen: set[tuple] = set()
    for other in others:
        for t in other.terms:
            if t.segment is None or tries >= max_tries:
                continue
            sg = sig(t)
            if sg in seen or any(sig(u) == sg for u in prog.terms):
                continue
            seen.add(sg)
            tries += 1
            Rs = np.nonzero(c.seg == t.segment)[0]
            before_seg, before = c.count(Rs), c.count()
            flags_needed = [f for f in other.flags if t.key is not None and f.name in t.key.columns]

            def mutate(p: Program, t=t, flags_needed=flags_needed) -> None:
                p.terms.append(Term.from_json(t.to_json()))
                names = {f.name for f in p.flags}
                p.flags.extend(f for f in flags_needed if f.name not in names)

            snap = _edit(c, mutate)
            robust_segment_refit(c, t.segment)
            if c.count(Rs) >= before_seg + max(3, len(Rs) // 100) and c.count() > before:
                adopted += 1
                if log:
                    log(f"    [{t.segment}] adopted {t.id} from another variant: {before} -> {c.count()} exact")
                continue
            _undo(c, snap)
    c.write_back()
    return adopted


@dataclass
class ExactReport:
    exact: int
    total: int
    revisions: list[dict] = field(default_factory=list)
    params: list[dict] = field(default_factory=list)


def make_exact(
    prog: Program,
    ds: Dataset,
    cache: EvalCache,
    rep_column: str | None,
    log=None,
    step_columns: list[str] | None = None,
    mine: dict | None = None,
) -> ExactReport:
    import time

    t0 = time.time()
    base_log = log or (lambda *_: None)

    def log(m: str) -> None:
        base_log(f"{m}  [{time.time() - t0:.0f}s]")

    merge_customer_multipliers(prog, cache)
    c = Compiled.build(prog, ds, cache)
    log(f"  exact stage: start {c.count()} / {ds.n}")
    presnap(c)
    log(f"    pre-snap: {c.count()} exact")
    search_mode(c, log=log)
    multiplier_search(c, log=log)
    snap_all(c, sweeps=2, log=log)
    refit_segments(c, log=log)
    round_factors(c, log=log)
    consensus_refit(c, log=log)
    ransac_segments(c, log=log)
    snap_all(c, sweeps=1, log=log)
    multiplier_search(c, log=log)
    toggle_inside(c, log)
    snap_all(c, sweeps=2, log=log)
    search_rounding(c, rep_column, log)
    search_min_charge(c, log)
    feature_variants(c, log)
    if step_columns:
        level_steps(c, step_columns, log=log)
    multiplier_search(c, log=log)
    snap_all(c, sweeps=2, log=log)
    refit_segments(c, log=log)
    consensus_refit(c, log=log)
    c.write_back()
    adopt_shared_terms(c, log)
    c.write_back()
    param_change_points(c, log=log)
    c.write_back()
    if mine is not None:
        mine_factors(c, mine["mult_keys"], mine["flags"], log=log)
        mine_terms(c, mine["keys"], mine["features"], mine["flags"], log=log)
        c.write_back()
    refine_thresholds(c, log)
    merge_pairs(c, log=log)
    joint_feature_variants(c, log=log)
    c.write_back()
    try_version_splits(c, log)
    ransac_segments(c, log=log)
    snap_all(c, sweeps=1, log=log)
    simplify(c, log)
    localize_revisions(c, log)
    c.write_back()
    revisions = refine_versions(c, log)
    snap_all(c, sweeps=1, log=log)
    search_tax_rounding(c)
    search_rounding(c, rep_column, log)
    search_min_charge(c, log)
    c.write_back()
    params = identifiability(c)
    min_charge_bounds(c)
    c.write_back()
    merge_versions(prog)
    drop_zero_levels(prog)
    coarsen_keys(prog)
    per_pack_form(prog)
    present = {(t.segment, v) for t in prog.terms for v in t.versions}
    revisions = [r for r in revisions if (r["segment"], r["date"]) in present]
    c2 = Compiled.build(prog, ds, cache, c.tax_rounding)
    log(f"  exact stage: end {c2.count()} / {ds.n}")
    return ExactReport(c2.count(), ds.n, revisions, params)
