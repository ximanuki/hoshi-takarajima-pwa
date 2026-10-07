"""Round 1 analyst extension (print): normalised remark tags and banding bundles.

The free-text remarks mix price-relevant requests (rush, new design, corrections, spot
colour, colour proofs, banding) with administrative chatter (payment terms, file format,
"same as last time" ...). The mined keywords were dominated by the chatter and split one
request into several substrings ("データ修正", "文字修正", "修正あり"; "DIC", "特色").

``note_tags`` maps each remark to a small set of tags, one per *kind of request*; the
engine sees them as keywords of a text column and decides by exact-yen matches whether a
tag carries a fee or a factor. ``bundles`` is the number of bundles for banding requests
("N枚ごと帯掛け"; 100 per bundle when no size is written). Nothing here looks at amounts.
"""

import re

import numpy as np

from estimate_archaeology.expr import as_float, as_str
from estimate_archaeology.normalize import nfkc

# tag -> substrings of the remark that request it (domain vocabulary, not per-quote)
TAGS = {
    "#rush": ("特急",),
    "#design": ("新規",),
    "#fix": ("データ修正", "文字修正", "修正あり"),
    "#spot": ("DIC", "特色"),
    "#band": ("帯掛",),
    "#proof": ("色校", "校正あり"),
}
_BUNDLE = re.compile(r"(\d+)\s*枚ごと")


def note_tags(env, n):
    out = []
    for v in as_str(env["notes"], n):
        s = nfkc(v)
        out.append(" ".join(t for t, subs in TAGS.items() if any(x in s for x in subs)))
    return np.array(out, dtype=object)


def bundles(env, n):
    notes = as_str(env["notes"], n)
    qty = as_float(env["quantity"], n) * as_float(env["kinds"], n)
    out = np.zeros(n)
    for i, v in enumerate(notes):
        s = nfkc(v)
        if "帯掛" not in s:
            continue
        m = _BUNDLE.search(s)
        size = float(m.group(1)) if m else 100.0
        out[i] = np.ceil(qty[i] / size) if qty[i] == qty[i] else 0.0
    return out


def register(registry):
    registry.add_column("note_tags", note_tags)
    registry.add_column("bundles", bundles)
