"""Command line: ``ea fit``, ``ea check``, ``ea hash-core``."""

from __future__ import annotations

import argparse
import json
import sys

from .extensions import core_hash
from .pipeline import check, fit


def _log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="ea", description="estimate archaeology: recover pricing rules from past quotes")
    sub = ap.add_subparsers(dest="cmd", required=True)

    f = sub.add_parser("fit", help="recover rules from a quote history")
    f.add_argument("--config", required=True, help="per-dataset config (JSON)")
    f.add_argument("--quotes", required=True, help="quotes CSV")
    f.add_argument("--out", required=True, help="output directory")
    f.add_argument("--extensions", help="folder with extra candidate terms (*.json, *.py)")
    f.add_argument(
        "--threshold",
        type=float,
        help="stop threshold: minimum share reproduced to the yen (default from config, 0.80)",
    )
    f.add_argument(
        "--stop-scope",
        choices=["global", "segment"],
        default="global",
        help="apply the stop rule to the whole dataset (default) or only per segment",
    )
    f.add_argument("--quiet", action="store_true")

    c = sub.add_parser("check", help="apply an existing rules.json to quotes (no refit)")
    c.add_argument("--rules", required=True)
    c.add_argument("--config", required=True)
    c.add_argument("--quotes", required=True)
    c.add_argument("--out", required=True)
    c.add_argument("--extensions")
    c.add_argument("--threshold", type=float)
    c.add_argument("--stop-scope", choices=["global", "segment"], default="global")

    sub.add_parser("hash-core", help="print SHA-256 of the core modules")

    a = ap.parse_args(argv)
    if a.cmd == "fit":
        res = fit(a.config, a.quotes, a.out, a.extensions, a.threshold, a.stop_scope, log=None if a.quiet else _log)
        print(json.dumps(res.summary, ensure_ascii=False, indent=2))
        return 0
    if a.cmd == "check":
        res = check(a.rules, a.config, a.quotes, a.out, a.extensions, a.threshold, a.stop_scope)
        print(json.dumps(res.summary, ensure_ascii=False, indent=2))
        return 0
    if a.cmd == "hash-core":
        print(json.dumps(core_hash(), indent=2))
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
