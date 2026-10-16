import { useId } from 'react';
import {
  COST_COMPONENT_JA,
  COST_COMPONENTS,
  type CostComponent,
  PROPOSAL_METHOD_JA,
  type ProposalMethod,
  type Rounding,
} from '../../engine/index.ts';
import { BarList } from '../components/Charts.tsx';
import { Card, Kpi, NeedsData, Notice, PageHeader } from '../components/ui.tsx';
import { pct, ratio, wareki, yen } from '../format.ts';
import { useApp } from '../model/AppState.tsx';
import { defaultEffectiveDate } from '../model/proposal.ts';
import type { GuardSettings, ScenarioSettings } from '../model/settings.ts';

function PctSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 30,
  step = 0.5,
  unit = '%',
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="slider">
      <label htmlFor={id} className="slider-label">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={`${value}${unit}`}
      />
      <span className="slider-number">
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={`${label}（${unit}）`}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
          }}
        />
        {unit}
      </span>
      {hint && <p className="slider-hint small muted">{hint}</p>}
    </div>
  );
}

export function ScenarioScreen() {
  const app = useApp();
  const { loaded, settings, proposal, simulation } = app;
  if (!loaded?.diagnosis) {
    return (
      <>
        <PageHeader step={3} title="シナリオ" />
        <NeedsData />
      </>
    );
  }
  const ds = loaded.ws.dataset;
  const sc = settings.scenario;
  const g = settings.guard;
  const setSc = (patch: Partial<ScenarioSettings>) =>
    app.updateSettings((s) => ({ ...s, scenario: { ...s.scenario, ...patch } }));
  const setG = (patch: Partial<GuardSettings>) =>
    app.updateSettings((s) => ({ ...s, guard: { ...s.guard, ...patch } }));
  const setShock = (c: CostComponent, v: number) => setSc({ shock: { ...sc.shock, [c]: v } });
  const setCatShock = (cat: string, c: CostComponent, raw: string) => {
    const next = { ...sc.categoryShocks };
    const row = { ...next[cat] };
    if (raw.trim() === '') delete row[c];
    else {
      const v = Number(raw);
      if (!Number.isFinite(v)) return;
      row[c] = v;
    }
    if (Object.keys(row).length === 0) delete next[cat];
    else next[cat] = row;
    setSc({ categoryShocks: next });
  };
  const asOf = loaded.asOf ?? '';
  const notices = ds.supplierNotices.filter((n) => n.status === '予定' && n.effective > asOf);
  const noticeSuppliers = new Set(notices.map((n) => n.supplier)).size;
  const effective = sc.effectiveDate ?? defaultEffectiveDate(loaded) ?? '';
  const t = simulation?.total;
  const costBase = t ? t.salesYen - t.grossProfitBeforeYen : 0;
  const floorDefault = ds.settings.marginFloorBp / 100;

  return (
    <>
      <PageHeader
        step={3}
        title="シナリオ"
        lead={
          <p>
            原材料・労務費・エネルギーがどれだけ上がるかを決め、値上げ案の作り方と守るべき条件（ガードレール）を設定します。商品ごとの原価構成比に上昇率を掛けて、原価の上昇額を計算します。
          </p>
        }
      />
      <div className="split">
        <div className="split-main">
          <Card title="原価の上昇">
            {COST_COMPONENTS.map((c) => (
              <PctSlider
                key={c}
                label={COST_COMPONENT_JA[c]}
                value={sc.shock[c]}
                onChange={(v) => setShock(c, v)}
              />
            ))}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={sc.useNotices}
                onChange={(e) => setSc({ useNotices: e.target.checked })}
              />
              仕入先の値上げ通知（予定）がある商品は、通知の改定率を使う（{noticeSuppliers}社・
              {notices.length.toLocaleString('ja-JP')}
              品目）
            </label>
            <details className="details">
              <summary>カテゴリごとに上昇率を変える</summary>
              <p className="small muted">空欄は上の値を使います（%）。</p>
              <div className="table-wrap">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th scope="col">カテゴリ</th>
                      {COST_COMPONENTS.map((c) => (
                        <th scope="col" key={c} className="num">
                          {COST_COMPONENT_JA[c]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...ds.categories.values()].map((cat) => (
                      <tr key={cat.code}>
                        <th scope="row">
                          {cat.name}
                          <span className="muted small block">
                            構成比 {cat.costShare.material}/{cat.costShare.labor}/{cat.costShare.energy}/
                            {cat.costShare.other}
                          </span>
                        </th>
                        {COST_COMPONENTS.map((c) => (
                          <td key={c} className="num">
                            <input
                              className="input-narrow"
                              type="number"
                              step={0.5}
                              min={0}
                              max={100}
                              aria-label={`${cat.name} の${COST_COMPONENT_JA[c]}（%）`}
                              placeholder={String(sc.shock[c])}
                              value={sc.categoryShocks[cat.code]?.[c] ?? ''}
                              onChange={(e) => setCatShock(cat.code, c, e.target.value)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Card>

          <Card title="値上げ案の作り方">
            <fieldset className="radio-group">
              <legend>新しい定価の決め方</legend>
              {(['pass_through_amount', 'keep_margin_rate', 'fixed_list'] as ProposalMethod[]).map((m) => (
                <label key={m} className="radio">
                  <input
                    type="radio"
                    name="method"
                    value={m}
                    checked={sc.method === m}
                    disabled={m === 'fixed_list' && loaded.ws.newListPrices.length === 0}
                    onChange={() => setSc({ method: m })}
                  />
                  {PROPOSAL_METHOD_JA[m]}
                  {m === 'fixed_list' && loaded.ws.newListPrices.length === 0 && (
                    <span className="muted small">（新定価表のファイルが必要です）</span>
                  )}
                </label>
              ))}
            </fieldset>
            {sc.method !== 'fixed_list' && (
              <PctSlider
                label="原価の上昇分のうち、価格に転嫁する割合"
                value={sc.passThroughPct}
                min={0}
                max={100}
                step={5}
                onChange={(v) => setSc({ passThroughPct: v })}
              />
            )}
            <div className="form-row">
              <label className="field">
                適用日
                <input
                  type="date"
                  value={effective}
                  onChange={(e) => setSc({ effectiveDate: e.target.value || null })}
                />
              </label>
              <p className="small muted">
                {wareki(effective)}から。現在の単価と原価は {wareki(loaded.asOf)}{' '}
                時点（売上明細の最終月の末日）です。
              </p>
            </div>
          </Card>

          <Card title="ガードレール（守る条件）">
            <div className="form-grid">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={g.capEnabled}
                  onChange={(e) => setG({ capEnabled: e.target.checked })}
                />
                値上げ率に上限を設ける
              </label>
              {g.capEnabled && (
                <PctSlider
                  label="値上げ率の上限（得意先×商品ごと）"
                  value={g.maxIncreasePct}
                  min={1}
                  max={50}
                  step={1}
                  onChange={(v) => setG({ maxIncreasePct: v })}
                />
              )}
              <PctSlider
                label="最小値上げ率（これより小さい値上げは見送る）"
                value={g.minIncreasePct}
                min={0}
                max={10}
                step={0.5}
                onChange={(v) => setG({ minIncreasePct: v })}
              />
              <PctSlider
                label="粗利率の下限"
                value={g.marginFloorPct ?? floorDefault}
                min={0}
                max={40}
                step={0.5}
                onChange={(v) => setG({ marginFloorPct: v })}
              />
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={g.raiseToMarginFloor}
                  onChange={(e) => setG({ raiseToMarginFloor: e.target.checked })}
                />
                粗利率が下限を下回る品目は、上限と掛率ランクの範囲内で下限まで引き上げる
              </label>
              <fieldset className="radio-group">
                <legend>期間内の特値がある品目</legend>
                <label className="radio">
                  <input
                    type="radio"
                    name="specials"
                    checked={g.specials === 'exclude'}
                    onChange={() => setG({ specials: 'exclude' })}
                  />
                  提案から外して個別に協議する
                </label>
                <label className="radio">
                  <input
                    type="radio"
                    name="specials"
                    checked={g.specials === 'scale'}
                    onChange={() => setG({ specials: 'scale' })}
                  />
                  定価と同じ率で上げる
                </label>
              </fieldset>
              <fieldset className="radio-group">
                <legend>定価の端数処理</legend>
                <div className="form-row">
                  {(['1,000円未満', '1万円未満', '1万円以上'] as const).map((label, i) => (
                    <label key={label} className="field">
                      {label}
                      <select
                        value={g.units[i]}
                        onChange={(e) => {
                          const units = [...g.units] as [number, number, number];
                          units[i] = Number(e.target.value);
                          setG({ units });
                        }}
                      >
                        {[1, 10, 50, 100, 500, 1000].map((u) => (
                          <option key={u} value={u}>
                            {u.toLocaleString('ja-JP')}円単位
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <label className="field">
                    丸め方
                    <select value={g.mode} onChange={(e) => setG({ mode: e.target.value as Rounding })}>
                      <option value="ceil">切り上げ</option>
                      <option value="round">四捨五入</option>
                      <option value="floor">切り捨て</option>
                    </select>
                  </label>
                  <label className="field">
                    末尾をそろえる
                    <select
                      value={g.ending ?? ''}
                      onChange={(e) =>
                        setG({ ending: e.target.value === '' ? null : Number(e.target.value) })
                      }
                    >
                      <option value="">そろえない</option>
                      {[0, 5, 8, 9, 80, 90, 98].map((v) => (
                        <option key={v} value={v}>
                          …{v}円
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="small muted">
                  定価は通常、1,000円未満は10円、1万円未満は50円、それ以上は100円単位にそろえます。
                </p>
              </fieldset>
            </div>
          </Card>
        </div>

        <aside className="split-side" aria-label="シミュレーション結果">
          <Card title="転嫁シミュレーション（年間）" className={app.computing ? 'is-stale' : ''}>
            {proposal && !proposal.ok && (
              <Notice tone="critical" title="計算できません">
                <p>{proposal.error}</p>
              </Notice>
            )}
            {app.computing && (
              <p className="small muted" role="status">
                計算しています…
              </p>
            )}
            {t && (
              <>
                <div className="kpi-grid">
                  <Kpi
                    label="原価の上昇額"
                    value={yen(t.costIncreaseYen)}
                    sub={costBase > 0 ? `原価の ${ratio(t.costIncreaseYen, costBase)} 上昇` : undefined}
                  />
                  <Kpi
                    label="値上げ額（依頼どおり）"
                    value={yen(t.requestedIncreaseYen)}
                    sub={`${t.proposedPairs.toLocaleString('ja-JP')}組に提案`}
                  />
                  <Kpi label="転嫁率（依頼どおり）" value={pct(t.passThroughRequestedBp)} emphasis />
                  <Kpi
                    label="転嫁率（見込み）"
                    value={pct(t.passThroughExpectedBp)}
                    sub="協議記録の回答と、下の受け入れ見込みから"
                  />
                </div>
                <BarList
                  caption="粗利の比較（年間）"
                  rows={[
                    {
                      key: 'before',
                      label: '今の粗利',
                      value: t.grossProfitBeforeYen,
                      display: yen(t.grossProfitBeforeYen),
                    },
                    {
                      key: 'none',
                      label: '値上げしない場合',
                      value: t.grossProfitNoActionYen,
                      display: yen(t.grossProfitNoActionYen),
                    },
                    {
                      key: 'requested',
                      label: '依頼どおり通った場合',
                      value: t.grossProfitRequestedYen,
                      display: yen(t.grossProfitRequestedYen),
                    },
                    {
                      key: 'expected',
                      label: '見込み',
                      value: t.grossProfitExpectedYen,
                      display: yen(t.grossProfitExpectedYen),
                    },
                  ]}
                />
                <p className="small">
                  回復する粗利（見込み）：<strong className="num">{yen(t.recoveredGrossProfitYen)}</strong>
                </p>
                <PctSlider
                  label="受け入れの見込み（協議記録に回答がない得意先）"
                  value={sc.acceptancePct}
                  min={0}
                  max={100}
                  step={5}
                  onChange={(v) => setSc({ acceptancePct: v })}
                />
                {t.passThroughRequestedBp !== null && t.passThroughRequestedBp > 10000 && (
                  <Notice tone="info" title="転嫁率が100%を超えています">
                    <p>
                      定価を10円・50円・100円単位に切り上げる分や、粗利率の下限まで引き上げる分が含まれるためです。
                      {sc.method === 'keep_margin_rate' &&
                        '「粗利率を保つ」では、原価の上昇率と同じ率で定価を上げるので、値上げ額が原価の上昇額より大きくなります。原価の上昇額だけを転嫁するなら「粗利額を保つ」を選んでください。'}
                    </p>
                  </Notice>
                )}
                <details className="details">
                  <summary>計算の前提</summary>
                  <ul className="small">
                    {simulation?.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                    <li>転嫁率 ＝ 値上げ額 ÷ 原価の上昇額。回復する粗利 ＝ 見込みの値上げ額です。</li>
                  </ul>
                </details>
              </>
            )}
          </Card>
          {simulation && (
            <Card title="カテゴリ別">
              <div className="table-wrap">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th scope="col">カテゴリ</th>
                      <th scope="col" className="num">
                        原価の上昇額
                      </th>
                      <th scope="col" className="num">
                        値上げ額
                      </th>
                      <th scope="col" className="num">
                        転嫁率
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {simulation.byCategory.map((r) => (
                      <tr key={r.key}>
                        <th scope="row">{ds.categories.get(r.key)?.name ?? r.key}</th>
                        <td className="num">{yen(r.costIncreaseYen)}</td>
                        <td className="num">{yen(r.requestedIncreaseYen)}</td>
                        <td className="num">{pct(r.passThroughRequestedBp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="button-row">
                <a className="btn btn-primary" href="#/proposal">
                  得意先ごとの提案を見る
                </a>
              </p>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
