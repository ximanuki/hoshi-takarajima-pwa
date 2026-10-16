# estimate-archaeology — common tasks. Run `make help`.
PY      := .venv/bin/python
# one BLAS thread per process: deterministic reductions, no oversubscription
export OPENBLAS_NUM_THREADS := 1
export OMP_NUM_THREADS := 1
export MKL_NUM_THREADS := 1
UV      := $(shell command -v uv 2>/dev/null)
JOBS    ?= 2
EA      := $(PY) -m estimate_archaeology.cli

.DEFAULT_GOAL := help
.PHONY: help setup test test-all lint format devdata dev-eval hash-core blind-fit clean

help: ## show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

setup: $(PY) ## create .venv and install pinned deps (numpy; pytest/ruff for dev)

$(PY):
ifdef UV
	uv venv --python 3.13 .venv
	uv pip install --python $(PY) -e ".[dev]"
else
	python3 -m venv .venv
	$(PY) -m pip install -e ".[dev]"
endif

test: $(PY) ## fast tests (toy shop end-to-end, units, stop rule, extensions)
	PYTHONPATH=src $(PY) -m pytest -m "not slow"

test-all: $(PY) ## all tests, including the full dev-data runs (several minutes)
	PYTHONPATH=src $(PY) -m pytest

lint: $(PY) ## ruff lint + format check
	$(PY) -m ruff check src tests devdata
	$(PY) -m ruff format --check src tests devdata

format: $(PY) ## apply ruff formatting and safe fixes
	$(PY) -m ruff check --fix src tests devdata
	$(PY) -m ruff format src tests devdata

devdata: $(PY) ## regenerate the development datasets (print, print_heavy, sign) from the generators
	$(PY) devdata/gen_print.py --out devdata/print
	$(PY) devdata/gen_print.py --out devdata/print_heavy --heavy
	$(PY) devdata/gen_sign.py --out devdata/sign

dev-eval: $(PY) ## fit every dev dataset, score against its truth, write reports/dev_results.md
	PYTHONPATH=src $(PY) devdata/run_dev.py --jobs $(JOBS)

hash-core: $(PY) ## SHA-256 of the frozen core modules (unchanged by --extensions)
	PYTHONPATH=src $(EA) hash-core

# Blind runs are NOT part of development. The configs were written from SCHEMA.md only.
blind-fit: $(PY) ## fit the blind datasets with configs/blind_*.json (outputs in runs/blind_*)
	PYTHONPATH=src $(EA) fit --config configs/blind_print.json --quotes blind/print/quotes.csv --out runs/blind_print
	PYTHONPATH=src $(EA) fit --config configs/blind_sign.json --quotes blind/sign/quotes.csv --out runs/blind_sign

clean: ## remove run outputs and caches
	rm -rf runs .pytest_cache .ruff_cache
	find . \( -path ./.venv -o -path ./blind \) -prune -o -name __pycache__ -type d -prune -exec rm -rf {} +
