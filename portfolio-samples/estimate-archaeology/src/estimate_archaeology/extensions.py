"""Extension interface: add candidate terms without editing the frozen core.

``ea fit --extensions DIR`` loads, in file-name order:

* ``*.json`` -- config patches merged into the dataset config (lists are appended,
  dicts merged): extra ``features`` (expressions), ``derived`` columns, ``keywords``,
  ``thresholds``, ``pack_steps``, ``multiplier_keys``, ``search`` settings.
* ``*.py``  -- modules defining ``register(registry)``; the registry can add functions to
  the expression language and derived columns computed in Python.

The core package files are never modified; ``ea hash-core`` prints their SHA-256 so a run
with extensions can be shown to use a byte-identical core. ``rules.json`` records which
extension files (and their hashes) were used, because a program that refers to an
extension function needs the same extension to be evaluated again.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from . import expr as ex


@dataclass
class Registry:
    functions: dict[str, Callable] = field(default_factory=dict)
    columns: dict[str, Callable[[dict[str, np.ndarray], int], np.ndarray]] = field(default_factory=dict)
    features: list[str] = field(default_factory=list)

    def add_function(self, name: str, fn: Callable) -> None:
        """Add ``name(ctx, *args)`` to the expression language (see ``expr.FUNCTIONS``)."""
        if name in ex.FUNCTIONS and ex.FUNCTIONS[name] is not fn:
            raise ValueError(f"expression function {name!r} already exists")
        self.functions[name] = fn

    def add_column(self, name: str, fn: Callable[[dict[str, np.ndarray], int], np.ndarray]) -> None:
        """Add a derived column computed in Python from the other columns."""
        self.columns[name] = fn

    def add_features(self, exprs: list[str]) -> None:
        self.features.extend(exprs)


@dataclass
class Extensions:
    patches: list[dict[str, Any]] = field(default_factory=list)
    registry: Registry = field(default_factory=Registry)
    files: list[dict[str, str]] = field(default_factory=list)

    def activate(self) -> None:
        for name, fn in self.registry.functions.items():
            ex.FUNCTIONS[name] = fn

    def deactivate(self) -> None:
        for name in self.registry.functions:
            ex.FUNCTIONS.pop(name, None)


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_extensions(path: str | Path | None) -> Extensions:
    ext = Extensions()
    if not path:
        return ext
    root = Path(path)
    if not root.is_dir():
        raise FileNotFoundError(f"extensions directory not found: {root}")
    for f in sorted(root.iterdir()):
        if f.suffix == ".json":
            ext.patches.append(json.loads(f.read_text(encoding="utf-8")))
        elif f.suffix == ".py" and not f.name.startswith("_"):
            spec = importlib.util.spec_from_file_location(f"ea_extension_{f.stem}", f)
            if spec is None or spec.loader is None:
                continue
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            if not hasattr(mod, "register"):
                raise ValueError(f"{f.name}: an extension module must define register(registry)")
            mod.register(ext.registry)
        else:
            continue
        ext.files.append({"file": f.name, "sha256": sha256_file(f)})
    return ext


def core_hash() -> dict[str, str]:
    """SHA-256 of every core module plus a combined digest."""
    pkg = Path(__file__).resolve().parent
    out = {}
    h = hashlib.sha256()
    for f in sorted(pkg.glob("*.py")):
        d = sha256_file(f)
        out[f.name] = d
        h.update(f.name.encode() + b"\0" + d.encode() + b"\n")
    out["_combined"] = h.hexdigest()
    return out
