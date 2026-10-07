"""Rule DSL (JSON-serialisable) and its deterministic evaluator.

A *program* computes a pre-tax net for every quote::

    lin_in  = Σ (terms applied before multipliers)   coef[key, version] × feature
    lin_out = Σ (terms added after multipliers)       coef[key, version] × feature
    a       = max(lin_in, min_charge)                 (when the minimum is "pre")
    sub     = a × Π multipliers + lin_out
    sub     = max(sub, min_charge)                    (when the minimum is "post")
    net     = round(sub, unit, mode)                  (unit/mode may depend on a group column)

* a *feature* is an expression over the quote's columns, optionally rounded up to a pack
  size (``ceil_step``), counted in packs (``per_pack``) or clamped (``clamp_min``);
* a *key* selects a row of a parameter table: categorical columns, flags
  (keyword in notes, numeric threshold) or numeric columns binned into tiers;
* every table value is a list over *versions*: ``versions`` holds the dates from which
  the next value applies (time-versioned price tables);
* ``None`` as a value means "not identifiable from history" (要聞き取り): rows that need
  it cannot be predicted.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from . import expr as ex
from .dataset import Dataset
from .normalize import iso_to_day, nfkc

ROUND_MODES = ("floor", "round", "ceil")
_EPS = 1e-7


# --------------------------------------------------------------------------- specs


@dataclass(frozen=True)
class FeatureSpec:
    """``transform(expr) × times``.

    The transform rounds ``expr`` up to a multiple of ``ceil_step`` (or counts packs when
    ``per_pack``) and/or applies a minimum ``clamp_min``. ``times`` (an expression) is
    multiplied *after* the transform, so that rounding/minimums apply per piece:
    ``ceil(area_m2 / 0.1) × 0.1 × qty`` or ``max(area_m2, 0.5) × qty``.

    ``step_by`` + ``steps`` give a pack size per level of a column instead of one
    ``ceil_step`` (yield-based material: pieces per sheet depend on the size, so the
    quantity is rounded up to whole sheets, ``ceil(qty / yield[size]) × yield[size]``).
    Levels without a step are not rounded.
    """

    expr: str = "1"
    ceil_step: float | None = None
    per_pack: bool = False
    clamp_min: float | None = None
    times: str | None = None
    step_by: str | None = None
    steps: tuple[tuple[str, float], ...] = ()

    def key(self) -> str:
        return f"{self.expr}|{self.ceil_step}|{self.per_pack}|{self.clamp_min}|{self.times}|{self.step_by}|{self.steps}"

    def to_json(self) -> dict[str, Any]:
        d: dict[str, Any] = {"expr": self.expr}
        if self.ceil_step is not None:
            d["ceil_step"] = self.ceil_step
        if self.per_pack:
            d["per_pack"] = True
        if self.clamp_min is not None:
            d["clamp_min"] = self.clamp_min
        if self.times:
            d["times"] = self.times
        if self.step_by:
            d["step_by"] = self.step_by
            d["steps"] = dict(self.steps)
        return d

    @classmethod
    def from_json(cls, d: dict[str, Any] | str) -> FeatureSpec:
        if isinstance(d, str):
            return cls(d)
        steps = tuple(sorted((str(k), float(v)) for k, v in d.get("steps", {}).items()))
        return cls(
            d["expr"],
            d.get("ceil_step"),
            bool(d.get("per_pack", False)),
            d.get("clamp_min"),
            d.get("times"),
            d.get("step_by"),
            steps,
        )

    @property
    def is_const(self) -> bool:
        return (
            self.expr.strip() == "1"
            and self.ceil_step is None
            and self.clamp_min is None
            and not self.times
            and not self.step_by
        )

    @property
    def full_expr(self) -> str:
        """The plain product this feature transforms (for display and grouping)."""
        return self.expr if not self.times else f"{self.expr} * {self.times}"


@dataclass(frozen=True)
class KeySpec:
    columns: tuple[str, ...] = ()
    bins: tuple[tuple[str, tuple[float, ...]], ...] = ()

    def key(self) -> str:
        return f"{self.columns}|{self.bins}"

    @property
    def bins_map(self) -> dict[str, tuple[float, ...]]:
        return dict(self.bins)

    def to_json(self) -> dict[str, Any]:
        d: dict[str, Any] = {"columns": list(self.columns)}
        if self.bins:
            d["bins"] = {k: list(v) for k, v in self.bins}
        return d

    @classmethod
    def from_json(cls, d: dict[str, Any] | None) -> KeySpec | None:
        if d is None:
            return None
        bins = tuple((k, tuple(float(x) for x in v)) for k, v in sorted(d.get("bins", {}).items()))
        return cls(tuple(d["columns"]), bins)


def bin_label(x: float, edges: tuple[float, ...]) -> str:
    """Tier label for ``x`` given ascending tier lower bounds ``edges`` ("~150", "150~300", "300~")."""
    if math.isnan(x):
        return ""
    i = int(np.searchsorted(np.asarray(edges), x, side="right"))

    def f(v: float) -> str:
        return str(int(v)) if float(v).is_integer() else str(v)

    if i == 0:
        return f"~{f(edges[0])}"
    if i == len(edges):
        return f"{f(edges[-1])}~"
    return f"{f(edges[i - 1])}~{f(edges[i])}"


@dataclass(frozen=True)
class FlagSpec:
    """A derived yes/no column: keyword in free text, or numeric threshold."""

    name: str
    kind: str  # "keyword" | "threshold" | "expr"
    columns: tuple[str, ...] = ()
    pattern: str = ""
    threshold: float | None = None
    expr: str = ""

    def to_json(self) -> dict[str, Any]:
        d: dict[str, Any] = {"name": self.name, "kind": self.kind, "columns": list(self.columns)}
        if self.kind == "keyword":
            d["pattern"] = self.pattern
        elif self.kind == "threshold":
            d["threshold"] = self.threshold
        else:
            d["expr"] = self.expr
        return d

    @classmethod
    def from_json(cls, d: dict[str, Any]) -> FlagSpec:
        return cls(
            d["name"],
            d["kind"],
            tuple(d.get("columns", [])),
            d.get("pattern", ""),
            d.get("threshold"),
            d.get("expr", ""),
        )

    def evaluate(self, env: dict[str, np.ndarray], n: int) -> np.ndarray:
        if self.kind == "keyword":
            hit = np.zeros(n, dtype=bool)
            for c in self.columns:
                vals = env[c]
                hit |= np.array([self.pattern in nfkc(v) for v in vals], dtype=bool)
            return np.where(hit, "1", "0").astype(object)
        if self.kind == "threshold":
            x = ex.as_float(env[self.columns[0]], n)
            t = float(self.threshold)  # type: ignore[arg-type]
            with np.errstate(invalid="ignore"):
                out = np.where(np.isnan(x), "", np.where(x >= t - 1e-9, "1", "0"))
            return out.astype(object)
        v = ex.evaluate(self.expr, env, n)
        if ex.is_numeric(v):
            return np.where(np.isnan(v), "", np.where(v != 0, "1", "0")).astype(object)
        return ex.as_str(v, n)


@dataclass
class Term:
    id: str
    feature: FeatureSpec
    key: KeySpec | None
    table: dict[str, list[float | None]]
    versions: list[str] = field(default_factory=list)
    segment: str | None = None
    apply_multipliers: bool = True
    role: str = ""  # free description from the search ("fixed", "per_unit", "surcharge" ...)

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "segment": self.segment,
            "role": self.role,
            "feature": self.feature.to_json(),
            "key": None if self.key is None else self.key.to_json(),
            "versions": self.versions,
            "apply_multipliers": self.apply_multipliers,
            "table": self.table,
        }

    @classmethod
    def from_json(cls, d: dict[str, Any]) -> Term:
        return cls(
            id=d["id"],
            feature=FeatureSpec.from_json(d["feature"]),
            key=KeySpec.from_json(d.get("key")),
            table={k: list(v) for k, v in d["table"].items()},
            versions=list(d.get("versions", [])),
            segment=d.get("segment"),
            apply_multipliers=bool(d.get("apply_multipliers", True)),
            role=d.get("role", ""),
        )


@dataclass
class Multiplier:
    id: str
    key: KeySpec
    table: dict[str, float]
    fallback_key: KeySpec | None = None
    fallback_table: dict[str, float] = field(default_factory=dict)
    default: float = 1.0
    role: str = ""

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "role": self.role,
            "key": self.key.to_json(),
            "table": self.table,
            "fallback_key": None if self.fallback_key is None else self.fallback_key.to_json(),
            "fallback_table": self.fallback_table,
            "default": self.default,
        }

    @classmethod
    def from_json(cls, d: dict[str, Any]) -> Multiplier:
        return cls(
            id=d["id"],
            key=KeySpec.from_json(d["key"]),  # type: ignore[arg-type]
            table=dict(d["table"]),
            fallback_key=KeySpec.from_json(d.get("fallback_key")),
            fallback_table=dict(d.get("fallback_table", {})),
            default=float(d.get("default", 1.0)),
            role=d.get("role", ""),
        )


@dataclass
class MinCharge:
    value: float | None = None  # None: not identifiable / not observed
    stage: str = "post"  # "pre" (before multipliers) or "post" (on the final subtotal)
    bounds: tuple[float | None, float | None] = (None, None)  # values consistent with history

    def to_json(self) -> dict[str, Any]:
        return {"value": self.value, "stage": self.stage, "consistent_range": list(self.bounds)}

    @classmethod
    def from_json(cls, d: dict[str, Any]) -> MinCharge:
        b = d.get("consistent_range", [None, None])
        return cls(d.get("value"), d.get("stage", "post"), (b[0], b[1]))


@dataclass
class Rounding:
    unit: int = 1
    mode: str = "floor"
    group_column: str | None = None
    groups: dict[str, tuple[int, str]] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        return {
            "unit": self.unit,
            "mode": self.mode,
            "group_column": self.group_column,
            "groups": {k: {"unit": u, "mode": m} for k, (u, m) in self.groups.items()},
        }

    @classmethod
    def from_json(cls, d: dict[str, Any]) -> Rounding:
        return cls(
            int(d.get("unit", 1)),
            d.get("mode", "floor"),
            d.get("group_column"),
            {k: (int(v["unit"]), v["mode"]) for k, v in d.get("groups", {}).items()},
        )


DSL_VERSION = "ea-dsl/0.1"


@dataclass
class Program:
    terms: list[Term] = field(default_factory=list)
    multipliers: list[Multiplier] = field(default_factory=list)
    flags: list[FlagSpec] = field(default_factory=list)
    min_charge: dict[str, MinCharge] = field(default_factory=dict)  # segment -> min
    rounding: Rounding = field(default_factory=Rounding)
    tax_rounding: str = "floor"
    segment_column: str = "_segment"
    meta: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        return {
            "dsl": DSL_VERSION,
            "segment_column": self.segment_column,
            "flags": [f.to_json() for f in self.flags],
            "terms": [t.to_json() for t in self.terms],
            "multipliers": [m.to_json() for m in self.multipliers],
            "min_charge": {k: v.to_json() for k, v in self.min_charge.items()},
            "rounding": self.rounding.to_json(),
            "tax_rounding": self.tax_rounding,
            "meta": self.meta,
        }

    def dumps(self) -> str:
        return json.dumps(self.to_json(), ensure_ascii=False, indent=2, default=_json_default)

    @classmethod
    def from_json(cls, d: dict[str, Any]) -> Program:
        return cls(
            terms=[Term.from_json(t) for t in d.get("terms", [])],
            multipliers=[Multiplier.from_json(m) for m in d.get("multipliers", [])],
            flags=[FlagSpec.from_json(f) for f in d.get("flags", [])],
            min_charge={k: MinCharge.from_json(v) for k, v in d.get("min_charge", {}).items()},
            rounding=Rounding.from_json(d.get("rounding", {})),
            tax_rounding=d.get("tax_rounding", "floor"),
            segment_column=d.get("segment_column", "_segment"),
            meta=d.get("meta", {}),
        )

    def copy(self) -> Program:
        return Program.from_json(json.loads(self.dumps()))

    def segments(self) -> list[str]:
        segs = {t.segment for t in self.terms if t.segment is not None}
        return sorted(segs | set(self.min_charge))


def _json_default(o: object) -> object:
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, tuple):
        return list(o)
    raise TypeError(type(o))


# --------------------------------------------------------------------------- evaluation


class EvalCache:
    """Caches feature vectors, key labels and flags for one dataset."""

    def __init__(self, ds: Dataset):
        self.ds = ds
        self.env = dict(ds.env)
        self._features: dict[str, np.ndarray] = {}
        self._keys: dict[str, np.ndarray] = {}
        self._flags: set[str] = set()

    def ensure_flags(self, flags: list[FlagSpec]) -> None:
        for f in flags:
            if f.name not in self._flags:
                self.env[f.name] = f.evaluate(self.env, self.ds.n)
                self._flags.add(f.name)

    def feature(self, spec: FeatureSpec) -> np.ndarray:
        k = spec.key()
        v = self._features.get(k)
        if v is None:
            base_key = FeatureSpec(spec.expr).key()
            base = self._features.get(base_key)
            if base is None:
                if spec.expr.strip() == "1":
                    base = np.ones(self.ds.n)
                else:
                    base = ex.as_float(ex.evaluate(spec.expr, self.env, self.ds.n), self.ds.n)
                base = np.nan_to_num(base, nan=0.0)
                self._features[base_key] = base
            v = base
            if spec.ceil_step:
                packs = np.ceil(np.round(v / spec.ceil_step, 9))
                v = packs if spec.per_pack else packs * spec.ceil_step
            if spec.step_by:
                labels = ex.as_str(self.env[spec.step_by], self.ds.n)
                smap = dict(spec.steps)
                st = np.array([smap.get(str(lab), 0.0) for lab in labels])
                has = st > 0
                packs = np.ceil(np.round(v / np.where(has, st, 1.0), 9))
                v = np.where(has, packs if spec.per_pack else packs * st, v)
            if spec.clamp_min is not None:
                v = np.where(v > 0, np.maximum(v, spec.clamp_min), v)
            if spec.times:
                v = v * self.feature(FeatureSpec(spec.times))
            self._features[k] = v
        return v

    def key_labels(self, key: KeySpec | None) -> np.ndarray:
        if key is None or not key.columns:
            return np.array([""] * self.ds.n, dtype=object)
        k = key.key()
        v = self._keys.get(k)
        if v is None:
            bins = key.bins_map
            parts = []
            for c in key.columns:
                if c in bins:
                    x = ex.as_float(self.env[c], self.ds.n)
                    parts.append(np.array([bin_label(xi, bins[c]) for xi in x], dtype=object))
                else:
                    parts.append(ex.as_str(self.env[c], self.ds.n))
            if len(parts) == 1:
                v = parts[0]
            else:
                v = np.array(["|".join(str(p[i]) for p in parts) for i in range(self.ds.n)], dtype=object)
            self._keys[k] = v
        return v


def version_index(versions: list[str], day: np.ndarray) -> np.ndarray:
    if not versions:
        return np.zeros(len(day), dtype=np.int64)
    breaks = np.array([iso_to_day(v) for v in versions], dtype=np.int64)
    return np.searchsorted(breaks, day, side="right").astype(np.int64)


def term_coefficients(term: Term, labels: np.ndarray, vidx: np.ndarray) -> np.ndarray:
    """Per-row coefficient (nan where the key value or version has no parameter)."""
    out = np.full(len(labels), math.nan)
    uniq, inv = np.unique(labels.astype(str), return_inverse=True)
    for j, u in enumerate(uniq):
        vals = term.table.get(u)
        if vals is None:
            continue
        rows = np.nonzero(inv == j)[0]
        arr = np.array([math.nan if v is None else float(v) for v in vals])
        vi = np.minimum(vidx[rows], len(arr) - 1)
        out[rows] = arr[vi]
    return out


@dataclass
class Components:
    lin_in: np.ndarray
    lin_out: np.ndarray
    mult: dict[str, np.ndarray]  # multiplier id -> factor per row
    minv: np.ndarray  # nan = no minimum
    min_pre: np.ndarray  # bool: minimum applied before multipliers
    unit: np.ndarray
    mode: np.ndarray  # 0 floor, 1 round, 2 ceil
    ok: np.ndarray  # False where a needed parameter is missing
    missing: list[str]  # per row: why it cannot be predicted ("" if ok)
    contrib: dict[str, np.ndarray]  # term id -> contribution per row

    @property
    def F(self) -> np.ndarray:  # noqa: N802
        f = np.ones(len(self.lin_in))
        for v in self.mult.values():
            f = f * v
        return f


def multiplier_factors(m: Multiplier, cache: EvalCache) -> tuple[np.ndarray, np.ndarray]:
    labels = cache.key_labels(m.key)
    out = np.full(cache.ds.n, math.nan)
    src = np.zeros(cache.ds.n, dtype=np.int8)  # 0 default, 1 table, 2 fallback
    for i, lab in enumerate(labels):
        v = m.table.get(str(lab))
        if v is not None:
            out[i] = v
            src[i] = 1
    if m.fallback_key is not None:
        fl = cache.key_labels(m.fallback_key)
        for i in np.nonzero(np.isnan(out))[0]:
            v = m.fallback_table.get(str(fl[i]))
            if v is not None:
                out[i] = v
                src[i] = 2
    out[np.isnan(out)] = m.default
    return out, src


def components(
    program: Program, ds: Dataset, cache: EvalCache | None = None, day: np.ndarray | None = None
) -> Components:
    cache = cache or EvalCache(ds)
    cache.ensure_flags(program.flags)
    n = ds.n
    day = ds.day if day is None else day
    seg = ex.as_str(cache.env.get(program.segment_column, ds.segment), n)
    lin_in = np.zeros(n)
    lin_out = np.zeros(n)
    ok = np.ones(n, dtype=bool)
    missing = [""] * n
    contrib: dict[str, np.ndarray] = {}
    for t in program.terms:
        mask = np.ones(n, dtype=bool) if t.segment is None else (seg == t.segment)
        if not mask.any():
            continue
        f = cache.feature(t.feature)
        labels = cache.key_labels(t.key)
        coef = term_coefficients(t, labels, version_index(t.versions, day))
        use = mask & (f != 0)
        bad = use & np.isnan(coef)
        if bad.any():
            for i in np.nonzero(bad)[0]:
                if not missing[i]:
                    missing[i] = f"{t.id}: 未知の区分 {labels[i]!r}"
            ok &= ~bad
        c = np.where(use, np.nan_to_num(coef) * f, 0.0)
        contrib[t.id] = c
        if t.apply_multipliers:
            lin_in += c
        else:
            lin_out += c
    mult = {m.id: multiplier_factors(m, cache)[0] for m in program.multipliers}
    minv = np.full(n, math.nan)
    min_pre = np.zeros(n, dtype=bool)
    for s, mc in program.min_charge.items():
        if mc.value is None:
            continue
        mk = seg == s
        minv[mk] = mc.value
        min_pre[mk] = mc.stage == "pre"
    r = program.rounding
    unit = np.full(n, r.unit, dtype=np.int64)
    mode = np.full(n, ROUND_MODES.index(r.mode), dtype=np.int8)
    if r.group_column and r.groups:
        g = ex.as_str(cache.env[r.group_column], n)
        for name, (u, md) in r.groups.items():
            mk = g == name
            unit[mk] = u
            mode[mk] = ROUND_MODES.index(md)
    return Components(lin_in, lin_out, mult, minv, min_pre, unit, mode, ok, missing, contrib)


def round_to(sub: np.ndarray, unit: np.ndarray, mode: np.ndarray) -> np.ndarray:
    q = sub / unit
    fl = np.floor(q + _EPS)
    ce = np.ceil(q - _EPS)
    rd = np.floor(q + 0.5 + _EPS)
    out = np.where(mode == 0, fl, np.where(mode == 1, rd, ce))
    return (out * unit).astype(np.int64)


def subtotal(c: Components, F: np.ndarray | None = None) -> np.ndarray:
    F = c.F if F is None else F
    a = np.where(c.min_pre & ~np.isnan(c.minv), np.fmax(c.lin_in, c.minv), c.lin_in)
    sub = a * F + c.lin_out
    post = ~c.min_pre & ~np.isnan(c.minv)
    return np.where(post, np.fmax(sub, c.minv), sub)


def finish(c: Components, F: np.ndarray | None = None) -> np.ndarray:
    """Rounded net per row; -1 where the program cannot price the quote."""
    net = round_to(subtotal(c, F), c.unit, c.mode)
    return np.where(c.ok, net, -1)


def predict(program: Program, ds: Dataset, cache: EvalCache | None = None) -> np.ndarray:
    return finish(components(program, ds, cache))


def matches(pred: np.ndarray, ds: Dataset, tax_rounding: str = "floor") -> np.ndarray:
    a, b = ds.candidates(tax_rounding)
    return (pred >= 0) & ((pred == a) | (pred == b))


def observed_net(pred: np.ndarray, ds: Dataset, tax_rounding: str = "floor") -> np.ndarray:
    """The candidate net closest to the prediction (or the only one); -1 if none."""
    a, b = ds.candidates(tax_rounding)
    da = np.where(a >= 0, np.abs(a - pred), np.inf)
    db = np.where(b >= 0, np.abs(b - pred), np.inf)
    out = np.where(da <= db, a, b)
    return np.where((a < 0) & (b < 0), -1, out)


def explain_row(program: Program, ds: Dataset, i: int, cache: EvalCache | None = None) -> str:
    """Human-readable calculation for one quote (used as evidence)."""
    cache = cache or EvalCache(ds)
    c = components(program, ds, cache)
    parts = []
    for t in program.terms:
        v = c.contrib.get(t.id)
        if v is None or v[i] == 0:
            continue
        parts.append(f"{t.id}={_yen(v[i])}")
    s = " + ".join(parts) if parts else "0"
    F = c.F[i]
    if abs(F - 1) > 1e-12:
        s = f"({s})×{F:g}"
    if not math.isnan(c.minv[i]):
        s += f"（最低{_yen(c.minv[i])}）"
    net = finish(c)[i]
    return f"{s} → {_yen(net)}"


def _yen(v: float) -> str:
    if abs(v - round(v)) < 1e-6:
        return f"{round(v):,}"
    return f"{v:,.2f}"
