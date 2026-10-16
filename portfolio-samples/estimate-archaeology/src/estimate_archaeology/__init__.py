"""estimate-archaeology: recover deterministic pricing rules from past quotes.

The engine is fully deterministic (no LLM calls): candidate rules are scored by how many
past quotes they reproduce to the yen, and deviations from the recovered rules are
classified with evidence.
"""

import os

# Single-threaded BLAS: identical floating-point reductions on every machine (so the same
# decisions are taken), and no oversubscription when search variants run in parallel.
# Only effective when this package is imported before numpy (the ``ea`` command does).
for _var in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_var, "1")

__version__ = "0.1.0"
