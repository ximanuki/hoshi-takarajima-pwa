"""Per-dataset configuration (column mapping + search space hints).

A config is a JSON file (YAML is accepted when PyYAML happens to be installed).
It only says *what the columns mean*; it never contains prices. Example::

    {
      "name": "print-shop",
      "columns": {"id": "quote_id", "date": "quote_date", "customer": "customer_code",
                  "rep": "rep", "amount": "amount", "tax_label": "tax_label",
                  "tax_amount": "tax_amount"},
      "segment": "product",
      "customer_class": "regex(customer_code, '^(一般|[A-Z]+)', 1, 'その他')",
      "revision_id_pattern": "-R\\\\d+$",
      "categorical": ["size", "paper", "colors", "delivery"],
      "numeric": ["quantity", "kinds", "pages"],
      "derived": {"total_qty": "quantity * kinds",
                  "lead_days": "days_between(quote_date, due_date)"},
      "text": ["notes"],
      "thresholds": ["lead_days"],
      "features": ["pages * quantity * kinds"]
    }
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

DEFAULT_SEARCH: dict[str, Any] = {
    "penalty": 24.0,  # MDL cost of one free parameter, in bits (see search.row_bits)
    "max_terms": 12,  # per segment
    "max_key_levels": 40,  # categorical keys with more levels are not used as table keys
    "max_pair_levels": 80,  # two-column keys with more combinations are skipped
    "max_feature_degree": 2,  # products of up to this many numeric columns
    "max_keywords": 40,
    "min_keyword_df": 3,
    "max_thresholds_per_column": 12,
    "max_revisions": 3,
    "outer_iterations": 3,
    "min_customer_rows": 2,
    "local_reliability_min_rows": 6,
    "local_reliability_threshold": 0.5,
    "work_budget": 120,  # search budget in G work units (deterministic; see search.WORK)
    "time_budget_s": 3600,  # wall-clock safety cap only (reported in rules.json when hit)
    "ordinal_keys_in_rich": False,  # lookup tables on small numeric columns in the first model
    "rich_max_cols_per_quote": 1.0,  # cap on lookup-table columns added to the first model
    "ordinal_scope": "segment",  # few distinct values per segment ("segment") or overall ("global")
    "plain_first": True,  # first model on plain quotes only (most common customer class, no keyword)
    "init": "rich",  # first model: "rich" (main effects) or "forward" (parsimonious)
    "init_ridge": 0.0,
    "init_terms": 12,
    "anneal_forward": True,  # forward selection scores at the current error scale first (coarse-to-fine)
    "start": "rich",  # "rich": prune a main-effects model; "empty": forward selection from the base fee
    "tier_discovery": True,  # offer step thresholds read off the residuals (columns the config did not list)
    "additive_test": False,  # keep flags that look like fixed surcharges out of the factor search
    # search variants run in parallel; the program reproducing the most quotes wins
    "variants": [
        {"ordinal_keys_in_rich": True},
        {"plain_first": False},
        {"additive_test": True},
        {"ordinal_keys_in_rich": True, "additive_test": True},
    ],
    "workers": 0,  # 0 = one process per variant (up to the CPU count)
}


@dataclass
class Config:
    name: str
    columns: dict[str, str]
    segment: str | None = None
    customer_class: str | None = None
    revision_id_pattern: str | None = None
    categorical: list[str] = field(default_factory=list)
    numeric: list[str] = field(default_factory=list)
    derived: dict[str, str] = field(default_factory=dict)
    text: list[str] = field(default_factory=list)
    thresholds: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)
    features: list[str] = field(default_factory=list)
    pack_steps: dict[str, list[float]] = field(default_factory=dict)
    multiplier_keys: list[str] | None = None
    tax_rates: list | None = None
    search: dict[str, Any] = field(default_factory=lambda: dict(DEFAULT_SEARCH))
    stop_threshold: float = 0.80
    notes: str = ""

    def s(self, key: str) -> Any:
        return self.search.get(key, DEFAULT_SEARCH[key])

    def to_json(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "columns": self.columns,
            "segment": self.segment,
            "customer_class": self.customer_class,
            "revision_id_pattern": self.revision_id_pattern,
            "categorical": self.categorical,
            "numeric": self.numeric,
            "derived": self.derived,
            "text": self.text,
            "thresholds": self.thresholds,
            "keywords": self.keywords,
            "features": self.features,
            "pack_steps": self.pack_steps,
            "multiplier_keys": self.multiplier_keys,
            "tax_rates": self.tax_rates,
            "search": self.search,
            "stop_threshold": self.stop_threshold,
            "notes": self.notes,
        }


REQUIRED_COLUMNS = ("id", "date", "amount")


def _read_structured(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() in (".yaml", ".yml"):
        try:
            import yaml  # type: ignore[import-untyped]
        except ImportError as e:  # pragma: no cover - optional
            raise RuntimeError("YAML configs need PyYAML; use the JSON form instead") from e
        return yaml.safe_load(text)
    return json.loads(text)


def config_from_dict(d: dict[str, Any]) -> Config:
    cols = dict(d.get("columns", {}))
    for k in REQUIRED_COLUMNS:
        if k not in cols:
            raise ValueError(f"config.columns.{k} is required")
    search = dict(DEFAULT_SEARCH)
    search.update(d.get("search", {}))
    return Config(
        name=d.get("name", "dataset"),
        columns=cols,
        segment=d.get("segment"),
        customer_class=d.get("customer_class"),
        revision_id_pattern=d.get("revision_id_pattern"),
        categorical=list(d.get("categorical", [])),
        numeric=list(d.get("numeric", [])),
        derived=dict(d.get("derived", {})),
        text=list(d.get("text", [])),
        thresholds=list(d.get("thresholds", [])),
        keywords=list(d.get("keywords", [])),
        features=list(d.get("features", [])),
        pack_steps={k: list(v) for k, v in d.get("pack_steps", {}).items()},
        multiplier_keys=d.get("multiplier_keys"),
        tax_rates=d.get("tax_rates"),
        search=search,
        stop_threshold=float(d.get("stop_threshold", 0.80)),
        notes=d.get("notes", ""),
    )


def load_config(path: str | Path) -> Config:
    return config_from_dict(_read_structured(Path(path)))


def merge_extension(cfg: Config, ext: dict[str, Any]) -> Config:
    """Add candidate terms/hints from an extension JSON without touching the base file.

    Lists are appended (deduplicated), dicts are merged (extension wins on conflicts).
    """
    d = cfg.to_json()
    for key in ("categorical", "numeric", "text", "thresholds", "keywords", "features"):
        if key in ext:
            d[key] = list(dict.fromkeys(list(d.get(key) or []) + list(ext[key])))
    for key in ("derived", "pack_steps", "search"):
        if key in ext:
            merged = dict(d.get(key) or {})
            merged.update(ext[key])
            d[key] = merged
    if "multiplier_keys" in ext:
        d["multiplier_keys"] = list(dict.fromkeys(list(d.get("multiplier_keys") or []) + ext["multiplier_keys"]))
    return config_from_dict(d)
