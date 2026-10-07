"""Human-readable outputs: rules_ja.md, coverage.md, predictions.csv."""

from __future__ import annotations

import csv
import itertools
import math
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

from . import expr as ex
from .classify import CLASSES, Classification
from .exact import Compiled
from .normalize import day_to_iso, iso_to_day
from .program import FeatureSpec, FlagSpec, KeySpec, Program, Term

MODE_JA = {"floor": "切り捨て", "round": "四捨五入", "ceil": "切り上げ"}
CLASS_JA = {
    "stale_table": "改定前の単価表の使用",
    "copied_rate": "別の得意先の掛率の流用",
    "undocumented_discount": "記録のない値引き",
    "typo": "金額の書き違い",
    "unrecorded_surcharge": "記録のない割増",
    "rounding_inconsistency": "端数処理の不一致",
    "revision_or_duplicate": "再発行・重複",
    "unexplained": "原因不明",
}
STATUS_JA = {"reproduced": "再現", "deviation": "逸脱", "unexplained": "原因不明", "abstained": "判定保留"}


def fmt_num(v: float | None) -> str:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "要聞き取り"
    if abs(v - round(v)) < 1e-9:
        return f"{round(v):,}"
    s = f"{v:,.6f}".rstrip("0").rstrip(".")
    return s


# --------------------------------------------------------------------------- naming


def flag_ja(name: str, flags: dict[str, FlagSpec]) -> str:
    f = flags.get(name)
    if f is None:
        if name.startswith("date>="):
            return f"見積日が {name[6:]} 以降"
        return name
    if f.kind == "keyword":
        return f"{f.columns[0]} に「{f.pattern}」を含む"
    if f.kind == "threshold":
        return f"{f.columns[0]} が {fmt_num(f.threshold)} 以上"
    return f"{f.expr}"


def column_ja(col: str) -> str:
    return {
        "_customer": "得意先コード",
        "_customer_class": "得意先区分",
        "_segment": "区分",
    }.get(col, col)


def key_ja(key: KeySpec | None, flags: dict[str, FlagSpec]) -> str:
    if key is None:
        return "（全件共通）"
    parts = []
    bins = key.bins_map
    for c in key.columns:
        if c in flags or c.startswith("date>="):
            parts.append(flag_ja(c, flags))
        elif c in bins:
            parts.append(f"{c}（段階）")
        else:
            parts.append(column_ja(c))
    return " × ".join(parts)


def level_ja(key: KeySpec | None, level: str, flags: dict[str, FlagSpec]) -> str:
    if key is None:
        return "—"
    if len(key.columns) == 1 and (key.columns[0] in flags or key.columns[0].startswith("date>=")):
        return {"1": "該当", "0": "非該当", "": "記載なし"}.get(level, level)
    return level if level != "" else "（空欄）"


def feature_ja(fs: FeatureSpec) -> str:
    e = fs.expr.replace(" ", "")
    if fs.is_const:
        return "1件あたり（固定）"
    base = e
    if fs.ceil_step and fs.per_pack:
        base = f"{e} を {fmt_num(fs.ceil_step)} ごとのパック数に切り上げ"
    elif fs.ceil_step:
        base = f"{e} を {fmt_num(fs.ceil_step)} 単位に切り上げた数"
    if fs.step_by:
        per = "、".join(f"{k}: {fmt_num(v)}" for k, v in fs.steps)
        what = "パック数（枚数）" if fs.per_pack else "数"
        base = f"{e} を {fs.step_by} ごとの入り数（{per}、記載のない区分は 1）で割って切り上げた{what}"
        if not fs.per_pack:
            base = f"{e} を {fs.step_by} ごとの入り数（{per}）の倍数に切り上げた数"
    if fs.clamp_min is not None:
        base += f"（最低 {fmt_num(fs.clamp_min)}）"
    if fs.times:
        base = f"［{base}］× {fs.times.replace(' ', '')}"
    return base


# --------------------------------------------------------------------------- rules_ja.md


def numeric_tiers(t: Term, flags: dict[str, FlagSpec]) -> list[tuple[str, list]] | None:
    """A table keyed by one numeric column, shown as tiers: consecutive values with the
    same prices are merged ("50〜100（50, 80, 100）")."""
    if t.key is None or len(t.key.columns) != 1 or t.key.columns[0] in flags or t.key.bins:
        return None
    levels = [lev for lev in t.table if lev != ""]
    try:
        nums = sorted((float(lev), lev) for lev in levels)
    except ValueError:
        return None
    if len(nums) < 3:
        return None
    groups: list[list[tuple[float, str]]] = []
    for x, lev in nums:
        if groups and t.table[groups[-1][-1][1]] == t.table[lev]:
            groups[-1].append((x, lev))
        else:
            groups.append([(x, lev)])
    if len(groups) == len(nums):
        return None  # nothing merges: a plain lookup table reads better

    def f(v: float) -> str:
        return str(int(v)) if float(v).is_integer() else f"{v:g}"

    out = []
    for g in groups:
        lo, hi = g[0][0], g[-1][0]
        rng = f(lo) if lo == hi else f"{f(lo)}〜{f(hi)}"
        seen = ", ".join(f(x) for x, _ in g)
        out.append((f"{rng}（{seen}）" if len(g) > 1 else rng, t.table[g[0][1]]))
    if "" in t.table:
        out.append(("（空欄）", t.table[""]))
    return out


def version_headers(t: Term) -> list[str]:
    if not t.versions:
        return ["金額"]
    heads = []
    bounds = [None, *t.versions, None]
    for a, b in itertools.pairwise(bounds):
        if a is None:
            prev = day_to_iso(iso_to_day(b) - 1)
            heads.append(f"〜{prev}")
        elif b is None:
            heads.append(f"{a}〜")
        else:
            heads.append(f"{a}〜{day_to_iso(iso_to_day(b) - 1)}")
    return heads


def render_rules_ja(prog: Program, meta: dict, name: str) -> str:
    flags = {f.name: f for f in prog.flags}
    L: list[str] = []
    L.append(f"# 見積ルール（過去データから復元）: {name}")
    L.append("")
    L.append(
        "過去の見積と矛盾しない最小のルールです。金額はすべて**税抜・端数処理前**の積算で、最後に掛率・最低料金・端数処理を適用します。"
    )
    L.append("ルールの数値は決定的な計算（LLM不使用）で求め、履歴の見積で1円単位まで検算しています。")
    L.append("")
    fit = meta.get("fit", {})
    if fit:
        L.append(f"- 対象: {fit.get('n', 0):,}件（{fit.get('date_from', '')}〜{fit.get('date_to', '')}）")
        L.append(
            f"- **{fit.get('n', 0):,}件中{fit.get('exact', 0):,}件を円単位で再現**（{fit.get('exact_rate', 0):.1%}）"
        )
    L.append("")
    L.append("## 計算の順序")
    L.append("")
    L.append("1. 区分ごとの積算（下の表の合計。改定日以降は新しい単価）")
    L.append("2. 掛率（得意先・条件による割引／割増）を掛ける")
    L.append("3. 掛率の対象外の項目（「掛率の後に加算」と書いたもの）を足す")
    L.append("4. 最低料金を適用")
    r = prog.rounding
    L.append(f"5. 端数処理: {fmt_num(r.unit)}円未満{MODE_JA[r.mode]}")
    if r.groups:
        L.append(
            "   - 例外: "
            + "、".join(
                f"{column_ja(r.group_column or '')}={g} は {fmt_num(u)}円未満{MODE_JA[m]}"
                for g, (u, m) in sorted(r.groups.items())
            )
        )
    L.append(f"6. 税込表示の見積は 税抜額×(1+税率) の円未満{MODE_JA[prog.tax_rounding]}")
    L.append("")
    segs = sorted({t.segment for t in prog.terms if t.segment is not None} | set(prog.min_charge))
    for s in segs:
        L.append(f"## 区分: {s}")
        L.append("")
        terms = [t for t in prog.terms if t.segment == s]
        if not terms:
            L.append("（積算項目なし）")
        for t in terms:
            where = "" if t.apply_multipliers else "　※掛率の後に加算（掛率の対象外）"
            L.append(f"### {feature_ja(t.feature)} × 単価　［{key_ja(t.key, flags)}］{where}")
            L.append("")
            heads = version_headers(t)
            L.append("| 条件 | " + " | ".join(heads) + " |")
            L.append("|---|" + "---|" * len(heads))
            tiers = numeric_tiers(t, flags)
            if tiers is not None:
                for label, vals in tiers:
                    L.append(f"| {label} | " + " | ".join(fmt_num(v) for v in vals) + " |")
                L.append("")
                L.append(
                    f"（{t.key.columns[0]} の段階表。境界は観測された値の間のどこか（要聞き取り）。括弧内は履歴に現れた値）"  # type: ignore[union-attr]
                )
                L.append("")
                continue
            for lev in sorted(t.table, key=lambda k: (k == "", k)):
                vals = t.table[lev]
                if t.key is not None and len(t.key.columns) == 1 and t.key.columns[0] in flags and lev != "1":
                    continue
                L.append(f"| {level_ja(t.key, lev, flags)} | " + " | ".join(fmt_num(v) for v in vals) + " |")
            L.append("")
        mc = prog.min_charge.get(s)
        if mc is not None:
            if mc.value is None:
                hi = mc.bounds[1]
                L.append(
                    f"- 最低料金: **要聞き取り**（履歴で発動した例がない。あるとしても {fmt_num(hi)}円以下）"
                    if hi is not None
                    else "- 最低料金: 要聞き取り"
                )
            else:
                stage = "掛率の前" if mc.stage == "pre" else "掛率の後"
                rng = ""
                if mc.bounds[0] is not None and mc.bounds[1] is not None and mc.bounds[0] != mc.bounds[1]:
                    rng = f"（履歴と矛盾しない範囲 {fmt_num(mc.bounds[0])}〜{fmt_num(mc.bounds[1])}円）"
                L.append(f"- 最低料金: {fmt_num(mc.value)}円（{stage}に適用）{rng}")
            L.append("")
    if prog.multipliers:
        L.append("## 掛率（割引・割増）")
        L.append("")
        for m in prog.multipliers:
            if m.key.columns == ("_customer",):
                if m.fallback_table:
                    L.append("### 得意先区分ごとの掛率")
                    L.append("")
                    L.append("| 得意先区分 | 掛率 |")
                    L.append("|---|---|")
                    for lev, v in sorted(m.fallback_table.items()):
                        L.append(f"| {lev or '（空欄）'} | {fmt_num(v)} |")
                    L.append("")
                if m.table:
                    L.append("### 個別の得意先の掛率（区分の掛率より優先）")
                    L.append("")
                    L.append("| 得意先コード | 掛率 |")
                    L.append("|---|---|")
                    for lev, v in sorted(m.table.items()):
                        L.append(f"| {lev} | {fmt_num(v)} |")
                    L.append("")
                continue
            L.append(f"### {key_ja(m.key, flags)}")
            L.append("")
            L.append("| 条件 | 掛率 |")
            L.append("|---|---|")
            for lev, v in sorted(m.table.items()):
                if abs(v - 1) < 1e-12:
                    continue
                L.append(f"| {level_ja(m.key, lev, flags)} | ×{fmt_num(v)} |")
            L.append("")
    revs = meta.get("revisions", [])
    if revs:
        L.append("## 単価表の改定日")
        L.append("")
        L.append("| 区分 | 改定日 | 履歴と矛盾しない範囲 |")
        L.append("|---|---|---|")
        for rv in revs:
            L.append(f"| {rv['segment']} | {rv['date']} | {rv['consistent_from']}〜{rv['consistent_to']} |")
        L.append("")
        L.append(
            "改定日は、その日を境に新旧の単価表を使い分けると最も多く再現できる日です。範囲が広い場合は要聞き取りです。"
        )
        L.append("")
    nid = [p for p in meta.get("params", []) if p.get("status") == "not_identifiable"]
    rng = [p for p in meta.get("params", []) if p.get("status") == "range"]
    L.append("## 要聞き取り（履歴から決められない値）")
    L.append("")
    if not nid and not rng:
        L.append("なし")
    for p in nid:
        L.append(
            f"- {p['term']} / {p['level'] or '—'}（版 {p['version'] + 1}）: 該当する見積 {p['rows']}件のうち再現できたものがなく、値を確定できない（暫定値 {fmt_num(p['value'])}）"
        )
    for p in rng[:30]:
        lo, hi = p["consistent_range"]
        L.append(
            f"- {p['term']} / {p['level'] or '—'}: {fmt_num(p['value'])}（{fmt_num(lo)}〜{fmt_num(hi)} のどの値でも履歴と矛盾しない）"
        )
    if len(rng) > 30:
        L.append(f"- ほか {len(rng) - 30} 件（rules.json の meta.params を参照）")
    L.append("")
    return "\n".join(L) + "\n"


# --------------------------------------------------------------------------- predictions.csv


def write_predictions(path: Path, cls: Classification) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["quote_id", "status", "class", "predicted_net", "observed_net", "evidence"])
        for r in cls.rows:
            w.writerow(
                [
                    r.quote_id,
                    r.status,
                    r.cls,
                    "" if r.predicted_net < 0 else r.predicted_net,
                    "" if r.observed_net < 0 else r.observed_net,
                    r.evidence,
                ]
            )


# --------------------------------------------------------------------------- coverage.md


def _rates(pred: np.ndarray, obs: np.ndarray, exact: np.ndarray, rows: np.ndarray) -> tuple[int, int, int, int]:
    p, o = pred[rows], obs[rows]
    ok = (p >= 0) & (o >= 0)
    n100 = int(np.sum(ok & (np.abs(p - o) <= 100)))
    n1 = int(np.sum(ok & (np.abs(p - o) <= 0.01 * np.maximum(o, 1))))
    return int(exact[rows].sum()), n100, n1, len(rows)


def _pct(k: int, n: int) -> str:
    return f"{k:,}/{n:,}（{k / n:.1%}）" if n else "—"


def diagnostics(c: Compiled, exact: np.ndarray, rows: np.ndarray, columns: list[str], limit: int = 6) -> list[str]:
    """Where are the quotes that the rules do not reproduce? (hints for what is missing)"""
    ds = c.ds
    if len(rows) < 5:
        return []
    base = float(exact[rows].mean())
    out = []
    env = c.cache.env
    cands: list[tuple[str, np.ndarray]] = []
    for col in columns:
        if col in env:
            v = env[col]
            if ex.is_numeric(v):
                x = ex.as_float(v, ds.n)
                u = np.unique(x[~np.isnan(x)])
                if len(u) > 12:
                    qs = np.quantile(x[~np.isnan(x)], [0.25, 0.5, 0.75])
                    lab = np.array(
                        [
                            ""
                            if math.isnan(t)
                            else f"{col}≤{qs[0]:g}"
                            if t <= qs[0]
                            else f"{col}≤{qs[1]:g}"
                            if t <= qs[1]
                            else f"{col}≤{qs[2]:g}"
                            if t <= qs[2]
                            else f">{qs[2]:g}"
                            for t in x
                        ],
                        dtype=object,
                    )
                else:
                    lab = np.array(["" if math.isnan(t) else f"{col}={t:g}" for t in x], dtype=object)
            else:
                lab = np.array([f"{col}={s}" for s in ex.as_str(v, ds.n)], dtype=object)
            cands.append((col, lab))
    dom = np.array([int(day_to_iso(int(d))[8:10]) if d >= 0 else 0 for d in ds.day])
    cands.append(
        (
            "見積日の日付",
            np.array(
                [
                    f"見積日が{a}日〜{b}日"
                    for a, b in [(1, 10) if x <= 10 else (11, 20) if x <= 20 else (21, 31) for x in dom]
                ],
                dtype=object,
            ),
        )
    )
    dom_late = np.array(["見積日が25日以降" if x >= 25 else "見積日が24日以前" for x in dom], dtype=object)
    cands.append(("月末", dom_late))
    wd = np.array([["月", "火", "水", "木", "金", "土", "日"][(int(d) + 3) % 7] + "曜日" for d in ds.day], dtype=object)
    cands.append(("曜日", wd))
    found = []
    for _, lab in cands:
        sub = lab[rows]
        for lev, cnt in Counter(sub).items():
            if cnt < 5 or lev == "":
                continue
            m = rows[sub == lev]
            rate = float(exact[m].mean())
            gap = base - rate
            if gap > 0.25:
                found.append((gap * math.sqrt(cnt), lev, rate, cnt))
    found.sort(reverse=True)
    for _, lev, rate, cnt in found[:limit]:
        out.append(f"- 「{lev}」の見積は再現率 {rate:.0%}（{cnt}件、区分全体は {base:.0%}）")
    # recurring ratios between written and rule amounts
    pred = np.where(c.ok, c.net_rows(np.arange(ds.n)), -1)
    a, b = ds.candidates(c.tax_rounding)
    obs = np.where(a >= 0, a, b)
    miss = rows[~exact[rows] & (pred[rows] > 0) & (obs[rows] > 0)]
    if len(miss) >= 5:
        ratios = np.round(obs[miss] / pred[miss], 2)
        top = Counter(ratios.tolist()).most_common(3)
        for r_, k in top:
            if k >= max(5, int(0.1 * len(miss))) and abs(r_ - 1) >= 0.01:
                out.append(
                    f"- 再現できない見積のうち {k}件が規則の金額の約 ×{r_:g}（共通の割引・割増条件がデータにない可能性）"
                )
    return out


def render_coverage(
    c: Compiled,
    cls: Classification,
    prog: Program,
    meta: dict,
    name: str,
    diag_columns: list[str],
) -> str:
    ds = c.ds
    n = ds.n
    pred = np.array([r.predicted_net for r in cls.rows])
    obs = np.array([r.observed_net for r in cls.rows])
    exact = np.array([r.status == "reproduced" for r in cls.rows])
    status = np.array([r.status for r in cls.rows], dtype=object)
    klass = np.array([r.cls for r in cls.rows], dtype=object)
    L: list[str] = []
    L.append(f"# 再現率と判定の内訳: {name}")
    L.append("")
    e, n100, n1, tot = _rates(pred, obs, exact, np.arange(n))
    L.append(f"- **{tot:,}件中{e:,}件を円単位で再現**（{e / max(tot, 1):.1%}）")
    L.append(f"- ±100円以内: {_pct(n100, tot)}　/　±1%以内: {_pct(n1, tot)}")
    st = cls.stop
    if st.get("global_stop"):
        L.append(
            f"- **判定停止**: 全体の再現率 {st['overall_rate']:.1%} が基準 {st['threshold']:.0%} 未満のため、再現できない見積の逸脱分類は出していません（すべて「判定保留」）。"
        )
    elif st.get("segments_stopped"):
        L.append(
            f"- **区分単位の判定停止**: {', '.join(st['segments_stopped'])}（再現率が基準 {st['threshold']:.0%} 未満のため、その区分の未再現の見積は「判定保留」）"
        )
    else:
        L.append(f"- 判定停止なし（基準: 再現率 {st.get('threshold', 0.8):.0%}）")
    L.append("")
    L.append("## 判定の内訳")
    L.append("")
    L.append("| 判定 | 件数 |")
    L.append("|---|---|")
    for s_ in ("reproduced", "deviation", "unexplained", "abstained"):
        L.append(f"| {STATUS_JA[s_]}（{s_}） | {int(np.sum(status == s_)):,} |")
    L.append("")
    L.append("## 区分別の再現率")
    L.append("")
    L.append("| 区分 | 件数 | 円単位 | ±100円 | ±1% |")
    L.append("|---|---|---|---|---|")
    for s in sorted(set(c.seg)):
        rows = np.nonzero(c.seg == s)[0]
        e, a1, a2, t = _rates(pred, obs, exact, rows)
        L.append(f"| {s} | {t:,} | {e / t:.1%} | {a1 / t:.1%} | {a2 / t:.1%} |")
    L.append("")
    # by table version period
    breaks = sorted({iso_to_day(v) for t in prog.terms for v in t.versions})
    if breaks:
        L.append("## 期間（単価表の版）別の再現率")
        L.append("")
        L.append("| 期間 | 件数 | 円単位 |")
        L.append("|---|---|---|")
        edges = [-(10**9), *breaks, 10**9]
        for lo, hi in itertools.pairwise(edges):
            rows = np.nonzero((ds.day >= lo) & (ds.day < hi))[0]
            if len(rows) == 0:
                continue
            lab = f"{'' if lo < -1e8 else day_to_iso(lo)}〜{'' if hi > 1e8 else day_to_iso(hi - 1)}"
            e = int(exact[rows].sum())
            L.append(f"| {lab} | {len(rows):,} | {e / len(rows):.1%} |")
        L.append("")
    L.append("## 得意先区分別の再現率")
    L.append("")
    L.append("| 得意先区分 | 件数 | 円単位 |")
    L.append("|---|---|---|")
    ccls = ex.as_str(ds.customer_class, n)
    for s in sorted(set(ccls)):
        rows = np.nonzero(ccls == s)[0]
        L.append(f"| {s or '（空欄）'} | {len(rows):,} | {exact[rows].mean():.1%} |")
    L.append("")
    L.append("## ルール逸脱の検出と分類")
    L.append("")
    L.append("担当者別の集計はしていません（逸脱は単価表の版・期間・得意先区分の単位で見ます）。")
    L.append("")
    flagged = np.isin(status, ["deviation", "unexplained"])
    if flagged.any():
        L.append("| 分類 | 件数 |")
        L.append("|---|---|")
        for k in CLASSES:
            cnt = int(np.sum(flagged & (klass == k)))
            if cnt:
                L.append(f"| {CLASS_JA[k]}（{k}） | {cnt:,} |")
        L.append("")
        # by period and customer class
        L.append("### 期間別（四半期）")
        L.append("")
        q = np.array(
            [
                f"{day_to_iso(int(d))[:4]}Q{(int(day_to_iso(int(d))[5:7]) - 1) // 3 + 1}" if d >= 0 else ""
                for d in ds.day
            ],
            dtype=object,
        )
        table = defaultdict(Counter)
        for i in np.nonzero(flagged)[0]:
            table[q[i]][klass[i]] += 1
        used = [k for k in CLASSES if any(table[p][k] for p in table)]
        L.append("| 四半期 | " + " | ".join(used) + " |")
        L.append("|---|" + "---|" * len(used))
        for p in sorted(table):
            L.append(f"| {p} | " + " | ".join(str(table[p][k]) for k in used) + " |")
        L.append("")
        L.append("### 得意先区分別")
        L.append("")
        table2 = defaultdict(Counter)
        for i in np.nonzero(flagged)[0]:
            table2[ccls[i]][klass[i]] += 1
        L.append("| 得意先区分 | " + " | ".join(used) + " |")
        L.append("|---|" + "---|" * len(used))
        for p in sorted(table2):
            L.append(f"| {p or '（空欄）'} | " + " | ".join(str(table2[p][k]) for k in used) + " |")
        L.append("")
    else:
        L.append("分類した見積はありません。")
        L.append("")
    if cls.rule_candidates:
        L.append("## ルールの候補（逸脱ではなく、記録されていない料金ルールの可能性）")
        L.append("")
        L.append(
            "同じ形のずれが、記録された項目の特定の値に集中しているものです。人の癖とは判定せず「判定保留」にしています。聞き取りで確かめるか、拡張で候補を足して再実行してください。"
        )
        L.append("")
        L.append("| 区分 | ずれ | 件数 | 集中している条件 | その条件の割合（候補内 / 区分全体） |")
        L.append("|---|---|---|---|---|")
        for rc in cls.rule_candidates:
            L.append(
                f"| {rc['segment']} | {rc['pattern']} | {rc['count']} | {rc['where']} | {rc['share']:.0%} / {rc['base']:.0%} |"
            )
        L.append("")
    L.append("## 判定保留（abstained）の理由")
    L.append("")
    reasons = Counter()
    for r in cls.rows:
        if r.status == "abstained":
            reasons[r.evidence.split("（")[0]] += 1
    if reasons:
        L.append("| 理由 | 件数 |")
        L.append("|---|---|")
        for k, v in reasons.most_common():
            L.append(f"| {k} | {v:,} |")
    else:
        L.append("なし")
    L.append("")
    stopped = set(st.get("segments_stopped", []))
    if st.get("global_stop"):
        stopped = set(c.seg)
    # every segment with unreproduced quotes gets the hints (stopped segments first)
    targets = []
    for s in sorted(set(c.seg), key=lambda s: (s not in stopped, s)):
        rows = np.nonzero(c.seg == s)[0]
        if len(rows) and (s in stopped or exact[rows].mean() < 0.95):
            targets.append(s)
    if targets:
        L.append("## 規則が足りない箇所の手がかり")
        L.append("")
        L.append(
            "再現できない見積がどこに集中しているかの集計です（担当者の列は使っていません）。"
            "ここに出た条件の料金ルールを聞き取るか、拡張（extensions）で候補を足して再実行してください。"
        )
        L.append("")
        for s in targets:
            rows = np.nonzero(c.seg == s)[0]
            lines = diagnostics(c, exact, rows, diag_columns)
            mark = "（判定停止）" if s in stopped else ""
            L.append(f"### {s}（再現率 {exact[rows].mean():.1%}）{mark}")
            L.append("")
            L.extend(lines or ["- 目立つ偏りは見つかりませんでした"])
            L.append("")
    L.append("## 要聞き取り（履歴から決められない値）")
    L.append("")
    nid = [p for p in meta.get("params", []) if p.get("status") == "not_identifiable"]
    mins = [(s, m) for s, m in prog.min_charge.items() if m.value is None]
    if not nid and not mins:
        L.append("なし")
    for s, m in mins:
        hi = m.bounds[1]
        L.append(
            f"- {s} の最低料金: 履歴で発動した例がなく判定不能"
            + (f"（あるとしても {fmt_num(hi)}円以下）" if hi is not None else "")
        )
    for p in nid:
        L.append(
            f"- {p['term']} / {p['level'] or '—'}（版 {p['version'] + 1}）: 該当 {p['rows']}件、再現できた見積なし"
        )
    L.append("")
    return "\n".join(L) + "\n"
