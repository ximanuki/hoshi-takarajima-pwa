"""A small, safe, vectorised expression language for derived columns and features.

Expressions use Python syntax but only a whitelist of node types and functions is
accepted (no attribute access, subscripts, lambdas, imports ...). Every column is a
numpy array of length ``n``; strings live in ``object`` arrays.

Examples::

    quantity * kinds
    ceil(quantity / 100) * 100
    width_mm * height_mm / 1e6
    days_between(quote_date, due_date)
    num(split(colors, '/', 0)) + num(split(colors, '/', 1))
    regex(site, '^(.+?[市町村])', 1, '不明')
    if_(customer_code == '9999', '諸口', '口座')
"""

from __future__ import annotations

import ast
import math
import re
import warnings
from collections.abc import Callable

import numpy as np

from .normalize import nfkc, parse_date


class ExprError(ValueError):
    pass


def _to_float_scalar(v: object) -> float:
    if v is None:
        return math.nan
    if isinstance(v, (int, float, np.integer, np.floating)):
        return float(v)
    s = nfkc(v).replace(",", "")
    if not s:
        return math.nan
    try:
        return float(s)
    except ValueError:
        m = re.match(r"^-?\d+(\.\d+)?", s)
        return float(m.group(0)) if m else math.nan


def as_float(a: object, n: int) -> np.ndarray:
    if isinstance(a, np.ndarray):
        if a.dtype.kind in "fiub":
            return a.astype(float)
        return np.array([_to_float_scalar(v) for v in a], dtype=float)
    if isinstance(a, str):
        return np.full(n, _to_float_scalar(a))
    return np.full(n, float(a))  # type: ignore[arg-type]


def as_str(a: object, n: int) -> np.ndarray:
    if isinstance(a, np.ndarray):
        if a.dtype == object:
            return a
        if a.dtype.kind == "f":
            return np.array(["" if math.isnan(v) else _fmt_num(v) for v in a], dtype=object)
        return np.array([str(v) for v in a], dtype=object)
    return np.array([str(a)] * n, dtype=object)


def _fmt_num(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else repr(float(v))


def _is_stringy(a: object) -> bool:
    return isinstance(a, str) or (isinstance(a, np.ndarray) and a.dtype == object)


def _dates(a: object, n: int) -> np.ndarray:
    if isinstance(a, np.ndarray) and a.dtype.kind in "fi":
        return a.astype(float)
    s = as_str(a, n)
    out = np.empty(n, dtype=float)
    for i, v in enumerate(s):
        d = parse_date(v)
        out[i] = math.nan if d is None else d
    return out


class _Ctx:
    def __init__(self, env: dict[str, np.ndarray], n: int):
        self.env = env
        self.n = n


def _fn_ceil(ctx: _Ctx, x, step=1.0):
    x = as_float(x, ctx.n)
    return np.ceil(np.round(x / float(step), 9)) * float(step)


def _fn_floor(ctx: _Ctx, x, step=1.0):
    x = as_float(x, ctx.n)
    return np.floor(np.round(x / float(step), 9)) * float(step)


def _fn_round(ctx: _Ctx, x, step=1.0):
    x = as_float(x, ctx.n)
    return np.floor(np.round(x / float(step), 9) + 0.5) * float(step)


def _fn_min(ctx: _Ctx, *args):
    out = as_float(args[0], ctx.n)
    for a in args[1:]:
        out = np.fmin(out, as_float(a, ctx.n))
    return out


def _fn_max(ctx: _Ctx, *args):
    out = as_float(args[0], ctx.n)
    for a in args[1:]:
        out = np.fmax(out, as_float(a, ctx.n))
    return out


def _fn_num(ctx: _Ctx, x):
    return as_float(x, ctx.n)


def _fn_str(ctx: _Ctx, x):
    return as_str(x, ctx.n)


def _fn_date(ctx: _Ctx, x):
    return _dates(x, ctx.n)


def _fn_days_between(ctx: _Ctx, a, b):
    return _dates(b, ctx.n) - _dates(a, ctx.n)


def _fn_weekday(ctx: _Ctx, x):
    d = _dates(x, ctx.n)
    # 1970-01-01 was a Thursday (weekday 3, Monday = 0)
    return np.where(np.isnan(d), np.nan, np.mod(d + 3, 7))


def _fn_regex(ctx: _Ctx, x, pattern, group=1, default=""):
    rx = re.compile(str(pattern))
    s = as_str(x, ctx.n)
    out = []
    for v in s:
        m = rx.search(nfkc(v))
        out.append(m.group(int(group)) if m and m.group(int(group)) is not None else str(default))
    return np.array(out, dtype=object)


def _fn_split(ctx: _Ctx, x, sep, idx, default=""):
    s = as_str(x, ctx.n)
    out = []
    for v in s:
        parts = nfkc(v).split(str(sep))
        i = int(idx)
        out.append(parts[i].strip() if -len(parts) <= i < len(parts) and nfkc(v) else str(default))
    return np.array(out, dtype=object)


def _fn_contains(ctx: _Ctx, x, *subs):
    s = as_str(x, ctx.n)
    return np.array([any(str(t) in nfkc(v) for t in subs) for v in s], dtype=bool)


def _fn_if(ctx: _Ctx, cond, a, b):
    c = np.asarray(cond, dtype=bool) if not isinstance(cond, bool) else np.full(ctx.n, cond)
    if _is_stringy(a) or _is_stringy(b):
        return np.where(c, as_str(a, ctx.n), as_str(b, ctx.n)).astype(object)
    return np.where(c, as_float(a, ctx.n), as_float(b, ctx.n))


def _fn_isblank(ctx: _Ctx, x):
    if isinstance(x, np.ndarray) and x.dtype.kind == "f":
        return np.isnan(x)
    return np.array([nfkc(v) == "" for v in as_str(x, ctx.n)], dtype=bool)


def _fn_coalesce(ctx: _Ctx, *args):
    if any(_is_stringy(a) for a in args):
        out = as_str(args[0], ctx.n).copy()
        for a in args[1:]:
            s = as_str(a, ctx.n)
            out = np.array([o if nfkc(o) else t for o, t in zip(out, s, strict=True)], dtype=object)
        return out
    out = as_float(args[0], ctx.n)
    for a in args[1:]:
        out = np.where(np.isnan(out), as_float(a, ctx.n), out)
    return out


def _fn_concat(ctx: _Ctx, *args):
    parts = [as_str(a, ctx.n) for a in args]
    return np.array(["".join(str(p[i]) for p in parts) for i in range(ctx.n)], dtype=object)


def _fn_col(ctx: _Ctx, name):
    if name not in ctx.env:
        raise ExprError(f"unknown column {name!r}")
    return ctx.env[name]


def _fn_sqrt(ctx: _Ctx, x):
    return np.sqrt(as_float(x, ctx.n))


def _fn_log(ctx: _Ctx, x):
    return np.log(as_float(x, ctx.n))


def _fn_abs(ctx: _Ctx, x):
    return np.abs(as_float(x, ctx.n))


FUNCTIONS: dict[str, Callable] = {
    "ceil": _fn_ceil,
    "floor": _fn_floor,
    "round": _fn_round,
    "min": _fn_min,
    "max": _fn_max,
    "abs": _fn_abs,
    "sqrt": _fn_sqrt,
    "log": _fn_log,
    "num": _fn_num,
    "str": _fn_str,
    "date": _fn_date,
    "days_between": _fn_days_between,
    "weekday": _fn_weekday,
    "regex": _fn_regex,
    "split": _fn_split,
    "contains": _fn_contains,
    "if_": _fn_if,
    "isblank": _fn_isblank,
    "coalesce": _fn_coalesce,
    "concat": _fn_concat,
    "col": _fn_col,
}


def _binop(op: ast.operator, a, b, n: int):
    if isinstance(op, ast.Add) and _is_stringy(a) and _is_stringy(b):
        return _fn_concat(_Ctx({}, n), a, b)
    x, y = as_float(a, n), as_float(b, n)
    with np.errstate(divide="ignore", invalid="ignore"):
        if isinstance(op, ast.Add):
            return x + y
        if isinstance(op, ast.Sub):
            return x - y
        if isinstance(op, ast.Mult):
            return x * y
        if isinstance(op, ast.Div):
            return x / y
        if isinstance(op, ast.FloorDiv):
            return np.floor(x / y)
        if isinstance(op, ast.Mod):
            return np.mod(x, y)
        if isinstance(op, ast.Pow):
            return np.power(x, y)
    raise ExprError(f"operator {type(op).__name__} not allowed")


def _compare(op: ast.cmpop, a, b, n: int):
    if isinstance(op, (ast.Eq, ast.NotEq)) and (_is_stringy(a) or _is_stringy(b)):
        sa = as_str(a, n)
        sb = as_str(b, n)
        eq = np.array([nfkc(x) == nfkc(y) for x, y in zip(sa, sb, strict=True)], dtype=bool)
        return eq if isinstance(op, ast.Eq) else ~eq
    if isinstance(op, (ast.In, ast.NotIn)):
        sa = as_str(a, n)
        sb = as_str(b, n)
        r = np.array([nfkc(x) in nfkc(y) for x, y in zip(sa, sb, strict=True)], dtype=bool)
        return r if isinstance(op, ast.In) else ~r
    x, y = as_float(a, n), as_float(b, n)
    with np.errstate(invalid="ignore"):
        if isinstance(op, ast.Eq):
            return x == y
        if isinstance(op, ast.NotEq):
            return x != y
        if isinstance(op, ast.Lt):
            return x < y
        if isinstance(op, ast.LtE):
            return x <= y
        if isinstance(op, ast.Gt):
            return x > y
        if isinstance(op, ast.GtE):
            return x >= y
    raise ExprError(f"comparison {type(op).__name__} not allowed")


def _eval(node: ast.AST, ctx: _Ctx):
    if isinstance(node, ast.Expression):
        return _eval(node.body, ctx)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float, str, bool)):
            return node.value
        raise ExprError(f"constant {node.value!r} not allowed")
    if isinstance(node, ast.Name):
        if node.id in ctx.env:
            return ctx.env[node.id]
        raise ExprError(f"unknown column {node.id!r}")
    if isinstance(node, ast.BinOp):
        return _binop(node.op, _eval(node.left, ctx), _eval(node.right, ctx), ctx.n)
    if isinstance(node, ast.UnaryOp):
        v = _eval(node.operand, ctx)
        if isinstance(node.op, ast.USub):
            return -as_float(v, ctx.n)
        if isinstance(node.op, ast.UAdd):
            return as_float(v, ctx.n)
        if isinstance(node.op, ast.Not):
            return ~np.asarray(v, dtype=bool)
        raise ExprError("unary operator not allowed")
    if isinstance(node, ast.BoolOp):
        vals = [np.broadcast_to(np.asarray(_eval(v, ctx), dtype=bool), (ctx.n,)) for v in node.values]
        out = vals[0].copy()
        for v in vals[1:]:
            out = (out & v) if isinstance(node.op, ast.And) else (out | v)
        return out
    if isinstance(node, ast.Compare):
        left = _eval(node.left, ctx)
        out = np.ones(ctx.n, dtype=bool)
        for op, comp in zip(node.ops, node.comparators, strict=True):
            right = _eval(comp, ctx)
            out &= np.broadcast_to(_compare(op, left, right, ctx.n), (ctx.n,))
            left = right
        return out
    if isinstance(node, ast.IfExp):
        return _fn_if(ctx, _eval(node.test, ctx), _eval(node.body, ctx), _eval(node.orelse, ctx))
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in FUNCTIONS:
            name = getattr(node.func, "id", "?")
            raise ExprError(f"function {name!r} not allowed")
        args = [_eval(a, ctx) for a in node.args]
        kwargs = {k.arg: _eval(k.value, ctx) for k in node.keywords if k.arg}
        return FUNCTIONS[node.func.id](ctx, *args, **kwargs)
    raise ExprError(f"syntax {type(node).__name__} not allowed")


def parse(expr: str) -> ast.Expression:
    try:
        with warnings.catch_warnings():
            # regexes in JSON configs ("'^\\s*...'") are fine: unknown escapes stay as written
            warnings.simplefilter("ignore", SyntaxWarning)
            return ast.parse(expr.strip(), mode="eval")
    except SyntaxError as e:
        raise ExprError(f"cannot parse {expr!r}: {e.msg}") from e


def names_in(expr: str) -> set[str]:
    """Column names referenced by an expression (used for dependency checks)."""
    tree = parse(expr)
    out = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id not in FUNCTIONS:
            out.add(node.id)
    return out


def evaluate(expr: str, env: dict[str, np.ndarray], n: int) -> np.ndarray:
    """Evaluate ``expr`` over columns ``env``; always returns an array of length ``n``."""
    v = _eval(parse(expr), _Ctx(env, n))
    if isinstance(v, np.ndarray):
        if v.dtype == bool:
            return v.astype(float)
        return np.broadcast_to(v, (n,)).copy() if v.shape != (n,) else v
    if isinstance(v, str):
        return np.array([v] * n, dtype=object)
    return np.full(n, float(v))


def is_numeric(a: np.ndarray) -> bool:
    return a.dtype.kind in "fiub"
