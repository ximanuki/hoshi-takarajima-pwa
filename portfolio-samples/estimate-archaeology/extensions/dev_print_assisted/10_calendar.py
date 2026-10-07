"""Example extension (Python): adds ``day_of_month(date)`` to the expression language.

An extension module defines ``register(registry)``. It may add expression functions
(``registry.add_function``), derived columns computed in Python (``registry.add_column``)
and candidate features (``registry.add_features``). The core package is not modified.
"""

import numpy as np

from estimate_archaeology.expr import as_str
from estimate_archaeology.normalize import day_to_iso, parse_date


def day_of_month(ctx, x):
    out = np.full(ctx.n, np.nan)
    for i, v in enumerate(as_str(x, ctx.n)):
        d = parse_date(v)
        if d is not None:
            out[i] = int(day_to_iso(d)[8:10])
    return out


def register(registry):
    registry.add_function("day_of_month", day_of_month)
