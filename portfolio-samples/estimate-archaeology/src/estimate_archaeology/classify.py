"""Residual classification: why does a quote not follow the recovered rules?

Every test re-runs the deterministic evaluator with one thing changed and checks for an
*exact* match. Order of the tests (first hit wins; other hits are kept as evidence):

1. revision_or_duplicate  re-issued number (``-R2``) or duplicate of an earlier quote
2. stale_table            matches an older version of the price tables after a revision
3. copied_rate            matches with another customer's / class's rate
4. rounding_inconsistency matches with another rounding unit or mode
5. typo                   the written digits differ from the rule's by a transposition or a
                          dropped / extra digit
6. undocumented_discount  lower than the rule by a round amount / a common percentage
7. unrecorded_surcharge   higher than the rule by a factor or amount that recurs, or by a
                          factor the rules use elsewhere (e.g. rush) without its trigger
8. typo (one digit)       a single digit differs
9. unexplained

A quote is **abstained** instead of classified when the rules cannot be trusted for it:
the overall or the segment's reproduction rate is below the stop threshold, its parameter
combination is rarely reproduced, or it needs a value history cannot pin down.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field

import numpy as np

from . import expr as ex
from .exact import Compiled
from .normalize import day_to_iso, gross_from_net, iso_to_day
from .program import ROUND_MODES, multiplier_factors

CLASSES = (
    "stale_table",
    "copied_rate",
    "undocumented_discount",
    "typo",
    "unrecorded_surcharge",
    "rounding_inconsistency",
    "revision_or_duplicate",
    "unexplained",
)
MODE_NAME = {"floor": "切り捨て", "round": "四捨五入", "ceil": "切り上げ"}
# deviation classes that could also be an unwritten rule when they recur with a pattern
SYSTEMATIC_CLASSES = ("undocumented_discount", "unrecorded_surcharge", "rounding_inconsistency")
DISCOUNT_RATIOS = (0.98, 0.97, 0.95, 0.93, 0.92, 0.9, 0.88, 0.85, 0.8, 0.75, 0.7, 0.5)
SURCHARGE_RATIOS = (1.03, 1.05, 1.08, 1.1, 1.15, 1.2, 1.25, 1.3, 1.4, 1.5, 2.0)


@dataclass
class RowResult:
    quote_id: str
    status: str  # reproduced | deviation | unexplained | abstained
    cls: str = ""
    predicted_net: int = -1
    observed_net: int = -1
    evidence: str = ""


@dataclass
class Classification:
    rows: list[RowResult]
    stop: dict = field(default_factory=dict)
    segment_rates: dict[str, tuple[int, int]] = field(default_factory=dict)
    rule_candidates: list[dict] = field(default_factory=list)


def _digits(v: int) -> str:
    return str(abs(int(v)))


def typo_kind(written: int, rule: int) -> str:
    """'transposition' / 'dropped_or_extra_digit' / 'one_digit' / '' between two amounts."""
    a, b = _digits(written), _digits(rule)
    if a == b:
        return ""
    if len(a) == len(b):
        diff = [i for i in range(len(a)) if a[i] != b[i]]
        if len(diff) == 2 and diff[1] == diff[0] + 1 and a[diff[0]] == b[diff[1]] and a[diff[1]] == b[diff[0]]:
            return "transposition"
        if len(diff) == 1:
            return "one_digit"
        return ""
    if abs(len(a) - len(b)) == 1:
        long_, short = (a, b) if len(a) > len(b) else (b, a)
        for i in range(len(long_)):
            if long_[:i] + long_[i + 1 :] == short:
                return "dropped_or_extra_digit"
    return ""


def _roundness(v: int) -> int:
    v = abs(int(v))
    if v == 0:
        return 0
    k = 0
    while v % 10 == 0:
        v //= 10
        k += 1
    return k


def _yen(v: float) -> str:
    return f"{round(v):,}円"


class Classifier:
    def __init__(
        self,
        c: Compiled,
        threshold: float,
        params: list[dict] | None,
        search_cfg: dict,
        context_columns: list[str] | None = None,
    ):
        self.c = c
        self.context_columns = list(context_columns or [])
        self.sig = ""
        self.sig_of: dict[int, str] = {}
        self.ds = c.ds
        self.prog = c.prog
        self.threshold = threshold
        self.params = params or []
        self.min_rows = int(search_cfg.get("local_reliability_min_rows", 6))
        self.min_rate = float(search_cfg.get("local_reliability_threshold", 0.5))
        self.R_all = np.arange(self.ds.n)
        self.net = np.where(c.ok, c.net_rows(self.R_all), -1)
        self.match = c.hits(self.R_all, c.net_rows(self.R_all))
        a, b = self.ds.candidates(c.tax_rounding)
        self.cand_a, self.cand_b = a, b

    # ---------------------------------------------------------------- helpers
    def _hit(self, i: int, net: int) -> bool:
        return bool(net >= 0 and (net == self.cand_a[i] or net == self.cand_b[i]))

    def _obs(self, i: int) -> int:
        a, b, p = self.cand_a[i], self.cand_b[i], self.net[i]
        if a < 0:
            return int(b)
        if b < 0:
            return int(a)
        return int(a if abs(a - p) <= abs(b - p) else b)

    def _net_with(self, i: int, **kw) -> int:
        R = np.array([i])
        return int(self.c.net_rows(R, **kw)[0])

    def _written_rule(self, i: int, net: int) -> int:
        """The amount the rule would have *written* (tax-inclusive when the row is)."""
        if self.cand_a[i] < 0 and self.cand_b[i] >= 0:
            return gross_from_net(net, self.ds.rate[i], self.c.tax_rounding)
        if self.cand_a[i] >= 0 and self.cand_b[i] >= 0 and self._obs(i) == self.cand_b[i]:
            return gross_from_net(net, self.ds.rate[i], self.c.tax_rounding)
        return net

    # ---------------------------------------------------------------- tests
    def t_revision(self, i: int) -> str | None:
        qid = str(self.ds.ids[i])
        if self.ds.is_revision[i]:
            base = self.base_of.get(i)
            if base is not None and not math.isnan(self.ds.amount[base]) and self.ds.amount[base] == self.ds.amount[i]:
                return f"再発行見積：元見積 {self.ds.ids[base]} と同額（{_yen(self.ds.amount[i])}）のまま仕様・日付が変わっている"
            return f"再発行見積（{qid}）：元見積からの変更で規則と一致しない"
        dup = self.dup_of.get(i)
        if dup is not None:
            return f"見積 {self.ds.ids[dup]} と同一内容・同額の重複"
        return None

    def t_stale(self, i: int) -> str | None:
        day = int(self.ds.day[i])
        seg = self.c.seg[i]
        breaks = sorted({iso_to_day(v) for t in self.prog.terms if t.segment in (seg, None) for v in t.versions})
        older = [b for b in breaks if b <= day]
        for b in reversed(older):
            d = np.array([b - 1])
            if self._hit(i, self._eval_day(i, d)):
                return f"改定前（{day_to_iso(b)} より前）の単価表で計算すると一致"
        return None

    def t_future(self, i: int) -> str | None:
        day = int(self.ds.day[i])
        seg = self.c.seg[i]
        breaks = sorted({iso_to_day(v) for t in self.prog.terms if t.segment in (seg, None) for v in t.versions})
        for b in breaks:
            if b > day and self._hit(i, self._eval_day(i, np.array([b]))):
                return f"改定後（{day_to_iso(b)}〜）の単価表で一致（日付の記載違いか、改定の先行適用の可能性）"
        return None

    def _eval_day(self, i: int, day: np.ndarray) -> int:
        sub = self.ds.subset(np.array([i]))
        sub.day = day.astype(np.int64)
        cc = Compiled.build(self.prog, sub, self._cache_for(i), self.c.tax_rounding)
        cc.unit[:] = self.c.unit[i]
        cc.mode[:] = self.c.mode[i]
        cc.F[:] = self.c.F[i]
        return int(cc.net_rows(np.array([0]))[0]) if cc.ok[0] else -1

    def _cache_for(self, i: int):
        from .program import EvalCache

        sub = self.ds.subset(np.array([i]))
        cache = EvalCache(sub)
        cache.ensure_flags(self.prog.flags)
        return cache

    def t_copied(self, i: int) -> str | None:
        cm = next((m for m in self.prog.multipliers if m.key.columns == ("_customer",)), None)
        if cm is None:
            return None
        cur, _ = multiplier_factors(cm, self.c.cache)
        f_cur = cur[i]
        other = self.c.F[i] / f_cur if f_cur else self.c.F[i]
        alts: dict[float, str] = {}
        for lab, v in cm.fallback_table.items():
            alts.setdefault(round(v, 6), f"区分 {lab}")
        for lab, v in cm.table.items():
            alts.setdefault(round(v, 6), f"得意先 {lab}")
        for v, who in sorted(alts.items()):
            if abs(v - f_cur) < 1e-9:
                continue
            if self._hit(i, self._net_with(i, F=np.array([other * v]))):
                return f"{who} の掛率 {v:g} を当てると一致（この得意先の掛率は {f_cur:g}）"
        return None

    def t_rounding(self, i: int) -> str | None:
        """Same unit with another mode, or a finer unit. (Rounding *down* to a coarser unit
        is a discount -- see :meth:`t_discount`.)"""
        u0, m0 = int(self.c.unit[i]), int(self.c.mode[i])
        for u in sorted({1, 10, 100, 1000, u0}):
            for mi, m in enumerate(ROUND_MODES):
                if (u, mi) == (u0, m0) or (u > u0 and m == "floor"):
                    continue
                if self._hit(i, self._net_with(i, unit=np.array([u]), mode=np.array([mi], dtype=np.int8))):
                    self.sig = f"{u}円未満{MODE_NAME[m]}"
                    return f"{u}円未満を{MODE_NAME[m]}にすると一致（規則は {u0}円未満{MODE_NAME[ROUND_MODES[m0]]}）"
        return None

    def t_typo(self, i: int, kinds: tuple[str, ...]) -> str | None:
        if math.isnan(self.ds.amount[i]):
            return None
        written = int(self.ds.amount[i])
        net = int(self.net[i])
        rules = [self._written_rule(i, net)]
        if self.cand_a[i] >= 0 and self.cand_b[i] >= 0:
            # no tax label: the rule's amount may have been written either way
            rules += [net, gross_from_net(net, self.ds.rate[i], self.c.tax_rounding)]
        for rule in dict.fromkeys(rules):
            k = typo_kind(written, rule)
            if k in kinds:
                label = {
                    "transposition": "数字の入れ替わり",
                    "dropped_or_extra_digit": "桁の脱落・重複",
                    "one_digit": "1桁の書き違い",
                }[k]
                return f"{label}：規則どおりなら {rule:,} のところ {written:,} と記載"
        return None

    def t_discount(self, i: int) -> str | None:
        p, o = int(self.net[i]), self._obs(i)
        if o >= p or p <= 0:
            return None
        u = int(self.c.unit[i])
        for r in DISCOUNT_RATIOS:
            for m in (0, 1, 2):
                v = int(
                    np.asarray(
                        self.c.net_rows(np.array([i]), F=np.array([self.c.F[i] * r]), mode=np.array([m], dtype=np.int8))
                    )[0]
                )
                if v == o:
                    self.sig = f"{round((1 - r) * 100):g}%引き"
                    return f"規則の金額 {_yen(p)} から {round((1 - r) * 100):g}% 引き（{_yen(o)}）、条件の記録なし"
        for uu in (1000, 10000):
            if uu > u and o == (p // uu) * uu:
                self.sig = f"{uu}円未満切り捨て"
                return f"規則の金額 {_yen(p)} の {uu:,}円未満を切り捨て（{_yen(p - o)} 引き）、条件の記録なし"
        if _roundness(o) > _roundness(p) and (p - o) <= 0.15 * p:
            self.sig = "端数調整"
            return f"規則の金額 {_yen(p)} を {_yen(o)} に端数調整（{_yen(p - o)} 引き）、条件の記録なし"
        d = p - o
        if d % max(500, u) == 0 and d <= 0.2 * p:
            self.sig = f"{d}円引き"
            return f"規則の金額 {_yen(p)} から {_yen(d)} 引き、条件の記録なし"
        return None

    def t_surcharge(self, i: int) -> str | None:
        p, o = int(self.net[i]), self._obs(i)
        if o <= p or p <= 0:
            return None
        for v, label in self.known_factors:
            if self._hit(i, self._net_with(i, F=np.array([self.c.F[i] * v]))):
                self.sig = f"×{v:g}"
                return f"{label}（×{v:g}）と同じ割増が、その条件の記録なしで適用されている"
        r_hit = self.surcharge_ratio.get(i)
        if r_hit is not None and self.ratio_count[r_hit] >= 3:
            self.sig = f"×{r_hit:g}"
            return f"規則の金額 {_yen(p)} の ×{r_hit:g}（{_yen(o)}）。同じ割増が条件の記録なしで {self.ratio_count[r_hit]} 件"
        d = o - p
        if self.diff_count.get(d, 0) >= 3 and d % 100 == 0:
            self.sig = f"+{d}円"
            return f"規則の金額 {_yen(p)} に {_yen(d)} の上乗せ。同じ上乗せが条件の記録なしで {self.diff_count[d]} 件"
        return None

    # ---------------------------------------------------------------- run
    def _prepare(self) -> None:
        ds = self.ds
        ids = [str(x) for x in ds.ids]
        idx_of = {q: i for i, q in enumerate(ids)}
        self.base_of: dict[int, int] = {}
        import re

        for i in np.nonzero(ds.is_revision)[0]:
            q = ids[i]
            for cand in (re.sub(r"-R\d+$", "", q), re.sub(r"-\d+$", "", q), re.sub(r"[-_]?(R|r|rev)\d*$", "", q)):
                if cand != q and cand in idx_of:
                    self.base_of[int(i)] = idx_of[cand]
                    break
        # exact duplicates (same spec, customer and amount, different number)
        spec_cols = [c for c in ds.columns if c not in self._id_cols()]
        seen: dict[tuple, int] = {}
        self.dup_of: dict[int, int] = {}
        for i in range(ds.n):
            key = tuple(str(ds.env[c][i]) for c in spec_cols)
            if key in seen:
                self.dup_of[i] = seen[key]
            else:
                seen[key] = i
        # factors used by the rules (for "surcharge applied without its trigger")
        self.known_factors: list[tuple[float, str]] = []
        for m in self.prog.multipliers:
            if m.key.columns == ("_customer",):
                continue
            for lab, v in m.table.items():
                if v > 1.0001:
                    self.known_factors.append((v, f"{m.key.columns[0]}={lab} の係数"))
        # recurring uplifts among non-reproduced quotes
        self.surcharge_ratio: dict[int, float] = {}
        cnt: Counter = Counter()
        dcnt: Counter = Counter()
        for i in np.nonzero(~self.match & self.c.ok)[0]:
            p, o = int(self.net[i]), self._obs(i)
            if p <= 0 or o <= p:
                continue
            dcnt[o - p] += 1
            for r in SURCHARGE_RATIOS:
                v = int(self.c.net_rows(np.array([i]), F=np.array([self.c.F[i] * r]))[0])
                if v == o:
                    self.surcharge_ratio[int(i)] = r
                    cnt[r] += 1
                    break
        self.ratio_count = cnt
        self.diff_count = dcnt

    def _id_cols(self) -> set[str]:
        return {"quote_id", "quote_no", "quote_date", "issue_date", "_day"} | {
            v for k, v in self.cfg_columns.items() if k in ("id", "date")
        }

    def local_reliability(self) -> np.ndarray:
        """Reproduction rate of the quote's parameter combination (cell)."""
        c = self.c
        keys = []
        for ts in c.terms:
            keys.append(np.where(ts.pid >= 0, ts.pid, -1))
        if not keys:
            return np.ones(self.ds.n)
        mat = np.column_stack(keys)
        cell_rate = np.ones(self.ds.n)
        cells: dict[tuple, list[int]] = {}
        for i in range(self.ds.n):
            cells.setdefault(tuple(mat[i]), []).append(i)
        self.cell_size = np.zeros(self.ds.n, dtype=int)
        for rows in cells.values():
            r = np.array(rows)
            cell_rate[r] = self.match[r].mean()
            self.cell_size[r] = len(r)
        return cell_rate

    def run(self, cfg_columns: dict[str, str], stop_scope: str = "global") -> Classification:
        self.cfg_columns = cfg_columns
        ds, c = self.ds, self.c
        self._prepare()
        n = ds.n
        total_rate = float(self.match.mean()) if n else 0.0
        seg_rates: dict[str, tuple[int, int]] = {}
        for s in sorted(set(c.seg)):
            m = c.seg == s
            seg_rates[s] = (int(self.match[m].sum()), int(m.sum()))
        global_stop = stop_scope != "segment" and total_rate < self.threshold
        seg_stop = {s: (k / t if t else 0.0) < self.threshold for s, (k, t) in seg_rates.items()}
        cell_rate = self.local_reliability()
        weak_params = {
            (p["term"], p["level"], p["version"]) for p in self.params if p.get("status") == "not_identifiable"
        }
        weak_rows = np.zeros(n, dtype=bool)
        for k, info in enumerate(c.pinfo):
            t = self.prog.terms[info[0]]
            if (t.id, info[1], info[2]) in weak_params:
                weak_rows[c.prow[k]] = True
        out: list[RowResult] = []
        for i in range(n):
            qid = str(ds.ids[i])
            pred = int(self.net[i])
            obs = self._obs(i) if pred >= 0 else (int(self.cand_a[i]) if self.cand_a[i] >= 0 else int(self.cand_b[i]))
            if self.match[i]:
                out.append(RowResult(qid, "reproduced", "", pred, obs, ""))
                continue
            if not c.ok[i]:
                out.append(RowResult(qid, "abstained", "", -1, obs, "規則にない区分の組み合わせ（要聞き取り）"))
                continue
            if obs < 0:
                out.append(RowResult(qid, "abstained", "", pred, -1, "金額を読めない"))
                continue
            seg = c.seg[i]
            if global_stop:
                out.append(
                    RowResult(
                        qid,
                        "abstained",
                        "",
                        pred,
                        obs,
                        f"規則不足のため判定停止（全体の再現率 {total_rate:.0%} < {self.threshold:.0%}）",
                    )
                )
                continue
            if seg_stop.get(seg, False):
                k, t = seg_rates[seg]
                out.append(
                    RowResult(
                        qid,
                        "abstained",
                        "",
                        pred,
                        obs,
                        f"規則不足のため判定停止（{seg} の再現率 {k}/{t} < {self.threshold:.0%}）",
                    )
                )
                continue
            if weak_rows[i]:
                out.append(
                    RowResult(qid, "abstained", "", pred, obs, "履歴で確定できないパラメータを使う見積（要聞き取り）")
                )
                continue
            if self.cell_size[i] >= self.min_rows and cell_rate[i] < self.min_rate:
                out.append(
                    RowResult(
                        qid,
                        "abstained",
                        "",
                        pred,
                        obs,
                        f"同じ条件の組み合わせの再現率が低い（{cell_rate[i]:.0%}、{self.cell_size[i]}件）",
                    )
                )
                continue
            self.sig = ""
            cls, ev = self.classify_row(i)
            status = "unexplained" if cls == "unexplained" else "deviation"
            out.append(RowResult(qid, status, cls, pred, obs, ev))
            self.sig_of[i] = self.sig
        candidates = self.systematic(out)
        stop = {
            "threshold": self.threshold,
            "scope": stop_scope,
            "overall_rate": total_rate,
            "global_stop": global_stop,
            "segments_stopped": sorted(s for s, v in seg_stop.items() if v),
        }
        return Classification(out, stop, seg_rates, candidates)

    def labelings(self) -> list[tuple[str, np.ndarray]]:
        """Recorded fields a hidden rule could depend on (never the rep)."""
        n = self.ds.n
        out: list[tuple[str, np.ndarray]] = []
        env = self.c.cache.env
        for col in self.context_columns:
            if col not in env:
                continue
            v = env[col]
            if ex.is_numeric(v):
                x = ex.as_float(v, n)
                u = np.unique(x[~np.isnan(x)])
                if len(u) == 0:
                    continue
                if len(u) > 12:
                    qs = np.quantile(x[~np.isnan(x)], [0.25, 0.5, 0.75])
                    lab = [
                        ""
                        if math.isnan(t)
                        else (
                            f"{col}≤{qs[0]:g}"
                            if t <= qs[0]
                            else f"{col}>{qs[2]:g}"
                            if t > qs[2]
                            else f"{col} {qs[0]:g}〜{qs[2]:g}"
                        )
                        for t in x
                    ]
                else:
                    lab = ["" if math.isnan(t) else f"{col}={t:g}" for t in x]
                out.append((col, np.array(lab, dtype=object)))
            else:
                out.append((col, np.array([f"{col}={s_}" for s_ in ex.as_str(v, n)], dtype=object)))
        dom = np.array([int(day_to_iso(int(d))[8:10]) if d >= 0 else 0 for d in self.ds.day])
        for t in (15, 20, 25, 28):
            out.append((f"dom{t}", np.where(dom >= t, f"見積日が{t}日以降", f"見積日が{t - 1}日以前").astype(object)))
        wd = np.array(
            [["月", "火", "水", "木", "金", "土", "日"][(int(d) + 3) % 7] + "曜日" for d in self.ds.day], dtype=object
        )
        out.append(("weekday", wd))
        return out

    def systematic(self, out: list[RowResult]) -> list[dict]:
        """Recurring deviations that line up with a recorded field are more likely a pricing
        rule nobody wrote down (e.g. 3% off for one product late in the month) than a
        person's quirk. Such quotes are not attributed to anyone: they become ``abstained``
        with the pattern as evidence, and the pattern is reported as a rule candidate."""
        groups: dict[tuple[str, str, str], list[int]] = {}
        for i, r in enumerate(out):
            if r.status == "deviation" and r.cls in SYSTEMATIC_CLASSES and self.sig_of.get(i):
                groups.setdefault((str(self.c.seg[i]), r.cls, self.sig_of[i]), []).append(i)
        cands = []
        labelings = None
        for (seg, cls, sig), rows in sorted(groups.items()):
            seg_rows = np.nonzero(self.c.seg == seg)[0]
            if len(rows) < max(5, len(seg_rows) // 100):
                continue
            if labelings is None:
                labelings = self.labelings()
            best = None
            r_idx = np.array(rows)
            for _, lab in labelings:
                levels, cnt = np.unique(lab[r_idx], return_counts=True)
                j = int(np.argmax(cnt))
                lev = str(levels[j])
                if not lev:
                    continue
                share = cnt[j] / len(rows)
                base = float(np.mean(lab[seg_rows] == lev))
                if share >= 0.8 and base <= 0.5 and share >= 2 * base and (best is None or share / base > best[0]):
                    best = (share / base, lev, share, base)
            if best is None:
                continue
            _, lev, share, base = best
            note = (
                f"同じ「{sig}」が{len(rows)}件あり、{lev} に集中（{share:.0%}。{seg} 全体では {base:.0%}）。"
                "記録されていない料金ルールの可能性があるため判定保留（要聞き取り）"
            )
            for i in rows:
                r = out[i]
                out[i] = RowResult(r.quote_id, "abstained", "", r.predicted_net, r.observed_net, note)
            cands.append(
                {
                    "segment": seg,
                    "class": cls,
                    "pattern": sig,
                    "count": len(rows),
                    "where": lev,
                    "share": share,
                    "base": base,
                }
            )
        return cands

    def classify_row(self, i: int) -> tuple[str, str]:
        tests = [
            ("revision_or_duplicate", self.t_revision),
            ("stale_table", self.t_stale),
            ("rounding_inconsistency", self.t_rounding),
            ("copied_rate", self.t_copied),
            ("typo", lambda j: self.t_typo(j, ("transposition", "dropped_or_extra_digit"))),
            ("undocumented_discount", self.t_discount),
            ("unrecorded_surcharge", self.t_surcharge),
            ("typo", lambda j: self.t_typo(j, ("one_digit",))),
        ]
        for name, fn in tests:
            ev = fn(i)
            if ev:
                return name, ev
        ev = self.t_future(i)
        p, o = int(self.net[i]), self._obs(i)
        base = f"規則では {_yen(p)}、記載は {_yen(o)}（差 {o - p:+,}円）"
        return "unexplained", base + ("。" + ev if ev else "")


def classify(
    c: Compiled,
    threshold: float,
    params: list[dict],
    search_cfg: dict,
    columns: dict[str, str],
    stop_scope: str = "global",
    context_columns: list[str] | None = None,
) -> Classification:
    return Classifier(c, threshold, params, search_cfg, context_columns).run(columns, stop_scope)


def segment_of(c: Compiled) -> np.ndarray:
    return ex.as_str(c.seg, c.ds.n)
