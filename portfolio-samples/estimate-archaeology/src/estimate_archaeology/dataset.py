"""Load a quote CSV + config into normalised numpy arrays."""

from __future__ import annotations

import csv
import math
import re
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path

import numpy as np

from . import expr as ex
from .config import Config
from .normalize import (
    TAX_ROUNDING,
    TaxTable,
    net_candidates,
    nfkc,
    parse_amount,
    parse_date,
    tax_label_kind,
)


@dataclass
class Dataset:
    n: int
    ids: np.ndarray  # object
    day: np.ndarray  # int64, days since 1970-01-01 (-1 when unparseable)
    segment: np.ndarray  # object
    customer: np.ndarray  # object
    customer_class: np.ndarray  # object
    rep: np.ndarray  # object
    env: dict[str, np.ndarray]  # raw (NFKC) + derived columns for expressions
    amount_written: np.ndarray  # object, verbatim
    amount: np.ndarray  # float (nan when unreadable), value as written
    tax_label: np.ndarray  # object: "incl" / "excl" / ""
    tax_amount: np.ndarray  # float, nan when not written
    rate: list[Fraction]
    cand_excl: np.ndarray  # int64, -1 = not a candidate
    cand_incl: dict[str, np.ndarray]  # tax rounding mode -> int64 array
    basis: list[str]
    is_revision: np.ndarray  # bool
    tax_table: TaxTable
    issues: list[str] = field(default_factory=list)
    columns: list[str] = field(default_factory=list)

    def subset(self, idx: np.ndarray) -> Dataset:
        idx = np.asarray(idx)
        return Dataset(
            n=len(idx),
            ids=self.ids[idx],
            day=self.day[idx],
            segment=self.segment[idx],
            customer=self.customer[idx],
            customer_class=self.customer_class[idx],
            rep=self.rep[idx],
            env={k: v[idx] for k, v in self.env.items()},
            amount_written=self.amount_written[idx],
            amount=self.amount[idx],
            tax_label=self.tax_label[idx],
            tax_amount=self.tax_amount[idx],
            rate=[self.rate[i] for i in idx],
            cand_excl=self.cand_excl[idx],
            cand_incl={k: v[idx] for k, v in self.cand_incl.items()},
            basis=[self.basis[i] for i in idx],
            is_revision=self.is_revision[idx],
            tax_table=self.tax_table,
            issues=list(self.issues),
            columns=list(self.columns),
        )

    def candidates(self, mode: str = "floor") -> tuple[np.ndarray, np.ndarray]:
        return self.cand_excl, self.cand_incl[mode]

    def y_guess(self, mode: str = "floor", prefer: str = "excl") -> np.ndarray:
        """A single best-guess net per row for continuous fitting (nan when none)."""
        a, b = self.candidates(mode)
        y = np.where(a >= 0, a, np.where(b >= 0, b, -1)).astype(float)
        if prefer == "incl":
            y = np.where(b >= 0, b, np.where(a >= 0, a, -1)).astype(float)
        y[y < 0] = math.nan
        return y

    def ambiguous(self, mode: str = "floor") -> np.ndarray:
        a, b = self.candidates(mode)
        return (a >= 0) & (b >= 0)


def read_csv(path: str | Path) -> tuple[list[str], list[dict[str, str]]]:
    with Path(path).open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = [dict(r) for r in reader]
        return list(reader.fieldnames or []), rows


def build_dataset(header: list[str], rows: list[dict[str, str]], cfg: Config) -> Dataset:
    n = len(rows)
    c = cfg.columns
    issues: list[str] = []
    env: dict[str, np.ndarray] = {}
    for h in header:
        env[h] = np.array([nfkc(r.get(h, "")) for r in rows], dtype=object)

    def col(key: str, default: str = "") -> np.ndarray:
        name = c.get(key)
        if not name:
            return np.array([default] * n, dtype=object)
        if name not in env:
            raise ValueError(f"column {name!r} (config.columns.{key}) not in CSV header")
        return env[name]

    ids = col("id")
    days = np.array([(-1 if (d := parse_date(v)) is None else d) for v in col("date")], dtype=np.int64)
    if (days < 0).any():
        issues.append(f"日付を読めない行: {int((days < 0).sum())}件")
    env["_day"] = days.astype(float)

    # derived columns, in declaration order (later ones may use earlier ones)
    for name, e in cfg.derived.items():
        try:
            env[name] = ex.evaluate(e, env, n)
        except ex.ExprError as err:
            raise ValueError(f"derived column {name!r}: {err}") from err

    def eval_or_col(spec: str | None, default: str) -> np.ndarray:
        if not spec:
            return np.array([default] * n, dtype=object)
        if spec in env:
            return ex.as_str(env[spec], n)
        return ex.as_str(ex.evaluate(spec, env, n), n)

    segment = eval_or_col(cfg.segment, "all")
    customer = col("customer", "")
    cclass = eval_or_col(cfg.customer_class, "")
    if not cfg.customer_class:
        cclass = np.array(["all"] * n, dtype=object)
    rep = col("rep", "")
    env["_segment"] = segment
    env["_customer"] = customer
    env["_customer_class"] = cclass

    written = np.array([r.get(c["amount"], "") for r in rows], dtype=object)
    parsed = [parse_amount(v) for v in written]
    amount = np.array([math.nan if p.value is None else p.value for p in parsed], dtype=float)
    bad = sum(1 for p in parsed if p.value is None)
    if bad:
        issues.append(f"金額を読めない行: {bad}件")
    labels = col("tax_label", "")
    tax_label = np.array([tax_label_kind(lab) or p.label for lab, p in zip(labels, parsed, strict=True)], dtype=object)
    if c.get("tax_amount"):
        tax_amount = np.array([parse_amount(v).value for v in col("tax_amount")], dtype=object)
        tax_amount = np.array([math.nan if v is None else v for v in tax_amount], dtype=float)
    else:
        tax_amount = np.full(n, math.nan)

    tax_table = TaxTable.from_config(cfg.tax_rates)
    rates = [tax_table.rate_on(int(d) if d >= 0 else None) for d in days]
    cand_excl = np.full(n, -1, dtype=np.int64)
    cand_incl = {m: np.full(n, -1, dtype=np.int64) for m in TAX_ROUNDING}
    basis: list[str] = []
    for i in range(n):
        amt = None if math.isnan(amount[i]) else int(amount[i])
        tax = None if math.isnan(tax_amount[i]) else int(tax_amount[i])
        first = None
        for m in TAX_ROUNDING:
            nc = net_candidates(amt, tax_label[i], tax, rates[i], m)
            cand_incl[m][i] = nc.incl
            if first is None:
                first = nc
                cand_excl[i] = nc.excl
        basis.append(first.basis if first else "")

    if cfg.revision_id_pattern:
        rx = re.compile(cfg.revision_id_pattern)
        is_rev = np.array([bool(rx.search(str(v))) for v in ids], dtype=bool)
    else:
        is_rev = np.zeros(n, dtype=bool)

    return Dataset(
        n=n,
        ids=ids,
        day=days,
        segment=segment,
        customer=customer,
        customer_class=cclass,
        rep=rep,
        env=env,
        amount_written=written,
        amount=amount,
        tax_label=tax_label,
        tax_amount=tax_amount,
        rate=rates,
        cand_excl=cand_excl,
        cand_incl=cand_incl,
        basis=basis,
        is_revision=is_rev,
        tax_table=tax_table,
        issues=issues,
        columns=header,
    )


def load_dataset(path: str | Path, cfg: Config) -> Dataset:
    header, rows = read_csv(path)
    return build_dataset(header, rows, cfg)
