"""End-to-end fit: config + quotes -> rules.json, rules_ja.md, predictions.csv, coverage.md."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from . import __version__
from . import expr as ex
from .classify import Classification, classify
from .config import Config, load_config, merge_extension
from .dataset import Dataset, build_dataset, read_csv
from .exact import Compiled, adopt_variant_terms, identifiability, make_exact, polish, transplant_segments
from .extensions import Extensions, core_hash, load_extensions
from .library import build_library
from .normalize import day_to_iso
from .program import EvalCache, Program
from .report import render_coverage, render_rules_ja, write_predictions
from .search import Searcher


@dataclass
class FitResult:
    program: Program
    classification: Classification
    dataset: Dataset
    compiled: Compiled
    summary: dict[str, Any]


def prepare(config: str | Path | Config, extensions: str | Path | None) -> tuple[Config, Extensions]:
    cfg = load_config(config) if not isinstance(config, Config) else config
    ext = load_extensions(extensions)
    for patch in ext.patches:
        cfg = merge_extension(cfg, patch)
    if ext.registry.features:
        cfg = merge_extension(cfg, {"features": ext.registry.features})
    ext.activate()
    return cfg, ext


def load_quotes(path: str | Path, cfg: Config, ext: Extensions) -> Dataset:
    header, rows = read_csv(path)
    ds = build_dataset(header, rows, cfg)
    for name, fn in ext.registry.columns.items():
        ds.env[name] = np.asarray(fn(ds.env, ds.n))
    return ds


def fit(
    config: str | Path | Config,
    quotes: str | Path,
    out_dir: str | Path | None = None,
    extensions: str | Path | None = None,
    threshold: float | None = None,
    stop_scope: str = "global",
    log=None,
) -> FitResult:
    log = log or (lambda *_: None)
    t0 = time.time()
    cfg, ext = prepare(config, extensions)
    try:
        ds = load_quotes(quotes, cfg, ext)
        thr = cfg.stop_threshold if threshold is None else float(threshold)
        log(f"{ds.n} quotes loaded ({', '.join(ds.issues) or 'no parse issues'})")
        variants = list(cfg.s("variants") or [{}])
        results = run_variants(ds, cfg, variants, log)
        best = max(results, key=lambda r: (r["exact"], -r["nparams"], -r["index"]))
        prog = Program.from_json(best["program"])
        exact_report_revisions = list(best["revisions"])
        log(
            "variants: "
            + ", ".join(f"#{r['index']} {r['exact']} exact/{r['nparams']} params" for r in results)
            + f" -> #{best['index']}"
        )
        others = [r for r in results if r is not best]
        taken: list[dict] = []
        if others:
            other_progs = [Program.from_json(r["program"]) for r in others]
            prog, pairs = transplant_segments(prog, other_progs, ds, log)
            adopt_variant_terms(prog, other_progs, ds, log=log)
            for vi, seg in pairs:
                src = others[vi]
                taken.append({"segment": seg, "variant": src["index"]})
                exact_report_revisions = [r for r in exact_report_revisions if r["segment"] != seg] + [
                    r for r in src["revisions"] if r["segment"] == seg
                ]
            exact_report_revisions.sort(key=lambda r: (r["segment"], r["date"]))
            lib = build_library(ds, cfg, EvalCache(ds))
            mine = {
                "keys": lib.keys,
                "features": mining_features(lib, cfg),
                "flags": lib.flags,
                "mult_keys": lib.mult_keys,
            }
            exact_report_revisions = polish(prog, ds, cfg.columns.get("rep"), log=log, mine=mine)
        t_search = time.time() - t0
        cache2 = EvalCache(ds)
        c = Compiled.build(prog, ds, cache2, prog.tax_rounding)
        params = identifiability(c)
        cls = classify(c, thr, params, cfg.search, cfg.columns, stop_scope, diag_columns(cfg))
        days = ds.day[ds.day >= 0]
        exact = sum(1 for r in cls.rows if r.status == "reproduced")
        meta: dict[str, Any] = {
            "generator": f"estimate-archaeology {__version__}",
            "dataset": cfg.name,
            "fit": {
                "n": ds.n,
                "exact": exact,
                "exact_rate": exact / max(ds.n, 1),
                "date_from": day_to_iso(int(days.min())) if len(days) else "",
                "date_to": day_to_iso(int(days.max())) if len(days) else "",
                "seconds": round(time.time() - t0, 1),
                "search_seconds": round(t_search, 1),
            },
            "revisions": exact_report_revisions,
            "search_variants": [
                {
                    "variant": r["variant"],
                    "exact": r["exact"],
                    "params": r["nparams"],
                    "chosen": r["index"] == best["index"],
                    "search_work_G": r["work"],
                    "wall_clock_cap_hit": r["time_capped"],
                }
                for r in results
            ],
            "segments_from_other_variants": taken,
            "params": params,
            "stop": cls.stop,
            "rule_candidates": cls.rule_candidates,
            "segment_rates": {k: list(v) for k, v in cls.segment_rates.items()},
            "parse_issues": ds.issues,
            "config": cfg.to_json(),
            "core_sha256": core_hash()["_combined"],
            "extensions": ext.files,
        }
        prog.meta = meta
        summary = {
            "n": ds.n,
            "exact": exact,
            "exact_rate": exact / max(ds.n, 1),
            "status": _count([r.status for r in cls.rows]),
            "classes": _count([r.cls for r in cls.rows if r.cls]),
            "stop": cls.stop,
            "seconds": meta["fit"]["seconds"],
        }
        if out_dir is not None:
            write_outputs(Path(out_dir), prog, cls, c, cfg, meta)
            # every search variant's own program (audit trail of the combination step)
            vdir = Path(out_dir) / "variants"
            vdir.mkdir(exist_ok=True)
            for r in results:
                (vdir / f"variant_{r['index']}.json").write_text(
                    json.dumps(
                        {"variant": r["variant"], "exact": r["exact"], "program": r["program"]}, ensure_ascii=False
                    )
                    + "\n",
                    encoding="utf-8",
                )
        return FitResult(prog, cls, ds, c, summary)
    finally:
        ext.deactivate()


def _one_variant(ds: Dataset, cfg: Config, index: int, variant: dict, log) -> dict[str, Any]:
    from .config import config_from_dict

    d = cfg.to_json()
    d["search"] = {**cfg.search, **variant}
    cfg_v = config_from_dict(d)
    cache = EvalCache(ds)
    lib = build_library(ds, cfg_v, cache)
    searcher = Searcher(ds, cfg_v, lib, cache, log=(lambda m: log(f"[{index}] {m}")) if log else None)
    searcher.run()
    prog = searcher.to_program()
    rep = make_exact(
        prog,
        ds,
        cache,
        cfg_v.columns.get("rep"),
        log=(lambda m: log(f"[{index}] {m}")) if log else None,
        step_columns=[c for c in cfg_v.categorical if c != cfg_v.columns.get("rep")],
        mine={
            "keys": lib.keys,
            "features": mining_features(lib, cfg_v),
            "flags": lib.flags,
            "mult_keys": lib.mult_keys,
        },
    )
    nparams = sum(1 for p in identifiability(Compiled.build(prog, ds, EvalCache(ds), prog.tax_rounding)))
    return {
        "index": index,
        "variant": variant,
        "exact": rep.exact,
        "nparams": nparams,
        "program": prog.to_json(),
        "revisions": rep.revisions,
        "work": round(searcher.work() / 1e9, 2),
        "time_capped": searcher.time_capped,
    }


def mining_features(lib, cfg: Config) -> list:
    """Quantities a missing surcharge may be charged on: per quote, per numeric column and
    the explicit features of the config."""
    base = {"1", *lib.numeric_columns, *cfg.features}
    return [f for f in lib.features if f.expr in base]


_POOL_STATE: dict[str, Any] = {}


def _worker(args: tuple[int, dict]) -> dict[str, Any]:
    index, variant = args
    return _one_variant(_POOL_STATE["ds"], _POOL_STATE["cfg"], index, variant, None)


def run_variants(ds: Dataset, cfg: Config, variants: list[dict], log) -> list[dict[str, Any]]:
    """Run each search variant (in parallel processes when possible) through the exact stage."""
    import multiprocessing as mp
    import os

    workers = int(cfg.s("workers")) or min(len(variants), os.cpu_count() or 1)
    if len(variants) > 1 and workers > 1 and "fork" in mp.get_all_start_methods():
        _POOL_STATE["ds"], _POOL_STATE["cfg"] = ds, cfg
        try:
            with mp.get_context("fork").Pool(min(workers, len(variants))) as pool:
                return pool.map(_worker, list(enumerate(variants)))
        finally:
            _POOL_STATE.clear()
    return [_one_variant(ds, cfg, i, v, log) for i, v in enumerate(variants)]


def diag_columns(cfg: Config) -> list[str]:
    cols = list(dict.fromkeys([*cfg.categorical, *cfg.numeric, *cfg.thresholds]))
    # summaries never group by the person who wrote the quote
    cols = [c for c in cols if c != cfg.columns.get("rep")]
    if cfg.customer_class:
        cols.append("_customer_class")
    return cols


def write_outputs(out: Path, prog: Program, cls: Classification, c: Compiled, cfg: Config, meta: dict) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "rules.json").write_text(prog.dumps() + "\n", encoding="utf-8")
    (out / "rules_ja.md").write_text(render_rules_ja(prog, meta, cfg.name), encoding="utf-8")
    write_predictions(out / "predictions.csv", cls)
    (out / "coverage.md").write_text(render_coverage(c, cls, prog, meta, cfg.name, diag_columns(cfg)), encoding="utf-8")


def check(
    rules: str | Path,
    config: str | Path | Config,
    quotes: str | Path,
    out_dir: str | Path | None = None,
    extensions: str | Path | None = None,
    threshold: float | None = None,
    stop_scope: str = "global",
) -> FitResult:
    """Apply an existing rules.json to (new) quotes without refitting."""
    cfg, ext = prepare(config, extensions)
    try:
        prog = Program.from_json(json.loads(Path(rules).read_text(encoding="utf-8")))
        ds = load_quotes(quotes, cfg, ext)
        thr = cfg.stop_threshold if threshold is None else float(threshold)
        c = Compiled.build(prog, ds, EvalCache(ds), prog.tax_rounding)
        params = identifiability(c)
        cls = classify(c, thr, params, cfg.search, cfg.columns, stop_scope, diag_columns(cfg))
        exact = sum(1 for r in cls.rows if r.status == "reproduced")
        meta = dict(prog.meta)
        meta["fit"] = dict(meta.get("fit", {}), n=ds.n, exact=exact, exact_rate=exact / max(ds.n, 1))
        meta["stop"] = cls.stop
        meta["rule_candidates"] = cls.rule_candidates
        if out_dir is not None:
            out = Path(out_dir)
            out.mkdir(parents=True, exist_ok=True)
            write_predictions(out / "predictions.csv", cls)
            (out / "coverage.md").write_text(
                render_coverage(c, cls, prog, meta, cfg.name, diag_columns(cfg)), encoding="utf-8"
            )
        summary = {
            "n": ds.n,
            "exact": exact,
            "exact_rate": exact / max(ds.n, 1),
            "status": _count([r.status for r in cls.rows]),
        }
        return FitResult(prog, cls, ds, c, summary)
    finally:
        ext.deactivate()


def _count(xs: list[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for x in xs:
        out[x] = out.get(x, 0) + 1
    return dict(sorted(out.items()))


__all__ = ["FitResult", "check", "ex", "fit"]
