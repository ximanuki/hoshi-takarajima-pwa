import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

import toyshop
from estimate_archaeology.pipeline import fit


@pytest.fixture(scope="session")
def toy_dir(tmp_path_factory) -> Path:
    d = tmp_path_factory.mktemp("toy")
    rows, labels = toyshop.generate()
    toyshop.write_csv(d / "quotes.csv", rows)
    (d / "config.json").write_text(json.dumps(toyshop.CONFIG, ensure_ascii=False), encoding="utf-8")
    (d / "labels.json").write_text(json.dumps(labels, ensure_ascii=False), encoding="utf-8")
    return d


@pytest.fixture(scope="session")
def toy_fit(toy_dir):
    out = toy_dir / "out"
    res = fit(toy_dir / "config.json", toy_dir / "quotes.csv", out)
    labels = json.loads((toy_dir / "labels.json").read_text(encoding="utf-8"))
    return res, out, labels
