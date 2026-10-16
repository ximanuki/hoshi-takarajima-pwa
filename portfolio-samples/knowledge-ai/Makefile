# AI総務さん — common tasks. Run `make help`.
PY      ?= .venv/bin/python
KAI     ?= .venv/bin/kai
UV      := $(shell command -v uv 2>/dev/null)
PORT    ?= 8000

.DEFAULT_GOAL := help
.PHONY: help setup model ingest eval test test-all lint format run lock docker-build docker-run clean

help: ## show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-14s %s\n", $$1, $$2}'

setup: ## create .venv, install pinned deps, download the embedding model
ifdef UV
	test -d .venv || uv venv --python 3.13 .venv
	uv pip install --python $(PY) -r requirements-dev.lock
	uv pip install --python $(PY) --no-deps -e .
else
	test -d .venv || python3 -m venv .venv
	$(PY) -m pip install --require-hashes -r requirements-dev.lock
	$(PY) -m pip install --no-deps -e .
endif
	$(KAI) download-model

model: ## (re)download the pinned embedding model only
	$(KAI) download-model

ingest: ## index data/raw → var/index.sqlite (incremental)
	$(KAI) ingest

eval: ## run the evaluation and write reports/eval-<date>.md
	$(PY) scripts/eval.py

test: ## fast unit/API tests (no model download, no network)
	$(PY) -m pytest -m "not slow"

test-all: ## all tests, including the real embedding model
	$(PY) -m pytest

lint: ## ruff lint + format check
	$(PY) -m ruff check .
	$(PY) -m ruff format --check .

format: ## apply ruff formatting and safe fixes
	$(PY) -m ruff check --fix .
	$(PY) -m ruff format .

run: ## serve the API + web UI on http://127.0.0.1:$(PORT)
	$(KAI) serve --port $(PORT)

lock: ## regenerate requirements*.lock from pyproject.toml (needs uv)
	uv pip compile pyproject.toml --python-version 3.13 --generate-hashes -o requirements.lock
	uv pip compile pyproject.toml --extra dev --python-version 3.13 --generate-hashes -o requirements-dev.lock

docker-build: ## build the container image (model + index baked in)
	docker build -t knowledge-ai:local .

docker-run: ## run the container on port $(PORT)
	docker run --rm -p $(PORT):8000 -e ANTHROPIC_API_KEY knowledge-ai:local

clean: ## remove generated index and caches (keeps the model)
	rm -rf var .pytest_cache .ruff_cache
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
