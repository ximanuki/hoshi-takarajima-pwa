import { Fragment, useMemo, useState } from 'react';
import { changeBp, EXCLUSION_REASON_JA, LEAK_LABEL_JA, pairKey } from '../../engine/index.ts';
import { Badge, Card, Kpi, NeedsData, Notice, PageHeader } from '../components/ui.tsx';
import { num, pct, pctDelta, wareki, yen } from '../format.ts';
import { useApp } from '../model/AppState.tsx';
import { statusOf } from '../model/negotiation.ts';
import { type AppPair, type CustomerProposal, checkOverride } from '../model/proposal.ts';
import { href, useRoute } from '../router.ts';

const PAGE = 50;

export function ProposalScreen() {
  const app = useApp();
  const route = useRoute();
  const { loaded, proposal } = app;
  const [query, setQuery] = useState('');
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(route.arg);

  const list = useMemo(() => {
    if (!proposal?.ok) return [];
    const q = query.normalize('NFKC').trim().toLowerCase();
    return proposal.customers
      .filter((c) => c.proposedItems > 0 || c.overrides > 0)
      .filter((c) => !onlyAttention || c.attention > 0)
      .filter((c) => q === '' || `${c.cust} ${c.name}`.normalize('NFKC').toLowerCase().includes(q));
  }, [proposal, query, onlyAttention]);

  if (!loaded?.diagnosis || !proposal) {
    return (
      <>
        <PageHeader step={4} title="提案（得意先ごと）" />
        <NeedsData />
      </>
    );
  }
  if (!proposal.ok) {
    return (
      <>
        <PageHeader step={4} title="提案（得意先ごと）" />
        <Notice tone="critical" title="提案を計算できません">
          <p>{proposal.error}</p>
          <p>
            <a href={href('scenario')}>シナリオの設定</a>を見直してください。
          </p>
        </Notice>
      </>
    );
  }

  const proposedPairs = proposal.pairs.filter((p) => p.status === 'proposed');
  const requested = proposedPairs.reduce((s, p) => s + p.changeYen * p.qty, 0);
  const base = proposedPairs.reduce((s, p) => s + p.currentPrice * p.qty, 0);
  const attention = proposal.customers.reduce((s, c) => s + c.attention, 0);
  const customersWithItems = proposal.customers.filter((c) => c.proposedItems > 0).length;
  const excluded = proposal.pairs.length - proposedPairs.length;
  const rejectedOverrides = proposal.pairs.filter((p) => p.overrideRejected !== null);

  return (
    <>
      <PageHeader
        step={4}
        title="提案（得意先ごと）"
        lead={
          <p>
            得意先 × 商品ごとの新しい単価です。新しい定価 ×
            得意先の掛率で計算するので、掛率ランクの関係はそのまま保たれます。単価は手で変えられますが、ガードレール（値上げ率の上限・掛率ランク）を外れる値は使えません。適用日：
            {wareki(proposal.effectiveDate)}
          </p>
        }
      />
      <div className="kpi-row">
        <Kpi
          label="提案する得意先"
          value={`${num(customersWithItems)}社`}
          sub={`${num(proposedPairs.length)}組（得意先×商品）`}
        />
        <Kpi label="値上げ額（年間・依頼どおり）" value={yen(requested)} emphasis />
        <Kpi
          label="平均の改定率"
          value={base > 0 ? pctDelta(changeBp(base + requested, base)) : '—'}
          sub="直近12か月の数量で加重"
        />
        <Kpi label="要確認" value={`${num(attention)}組`} sub={`提案から外した組 ${num(excluded)}`} />
      </div>
      {rejectedOverrides.length > 0 && (
        <Notice tone="warning" title="手入力の単価のうち、今の設定では使えないものがあります">
          <p>
            {num(rejectedOverrides.length)}
            組は提案単価に戻して計算しています。ガードレールを変えたときに起きます。下の一覧で確認してください。
          </p>
        </Notice>
      )}
      <Card title="得意先ごとの提案">
        <div className="filters">
          <label className="field field-inline">
            <span>検索</span>
            <input
              type="search"
              placeholder="得意先名・コード"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShown(PAGE);
              }}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={onlyAttention}
              onChange={(e) => setOnlyAttention(e.target.checked)}
            />
            要確認がある得意先だけ
          </label>
        </div>
        <div className="table-wrap">
          <table className="table">
            <caption className="visually-hidden">得意先ごとの提案（値上げ額の大きい順）</caption>
            <thead>
              <tr>
                <th scope="col">得意先</th>
                <th scope="col">ランク</th>
                <th scope="col" className="num">
                  提案品目
                </th>
                <th scope="col" className="num">
                  値上げ額（年間）
                </th>
                <th scope="col" className="num">
                  平均改定率
                </th>
                <th scope="col">確認</th>
                <th scope="col">交渉</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, shown).map((c) => (
                <Fragment key={c.cust}>
                  <tr className={open === c.cust ? 'is-open' : ''}>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        aria-expanded={open === c.cust}
                        onClick={() => setOpen(open === c.cust ? null : c.cust)}
                      >
                        {c.name}
                      </button>
                      <span className="muted small block">{c.cust}</span>
                    </td>
                    <td>
                      {c.rank}
                      <span className="muted small block">{(c.ratePm / 10).toFixed(1)}%</span>
                    </td>
                    <td className="num">{num(c.proposedItems)}</td>
                    <td className="num">{yen(c.requestedYen)}</td>
                    <td className="num">{pctDelta(c.changeBp)}</td>
                    <td>
                      {c.attention > 0 && <Badge tone="warning">要確認 {c.attention}</Badge>}{' '}
                      {c.ongoingLeaks > 0 && <Badge tone="critical">請求ミスの可能性 {c.ongoingLeaks}</Badge>}{' '}
                      {c.overrides > 0 && <Badge tone="info">手入力 {c.overrides}</Badge>}
                    </td>
                    <td className="nowrap">{statusOf(app.logs, c.cust)}</td>
                  </tr>
                  {open === c.cust && (
                    <tr className="detail-row">
                      <td colSpan={7}>
                        <CustomerPairs c={c} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          {num(list.length)}社中 {num(Math.min(shown, list.length))}社を表示
        </p>
        {shown < list.length && (
          <button type="button" className="btn" onClick={() => setShown(shown + PAGE)}>
            さらに表示
          </button>
        )}
      </Card>
    </>
  );
}

function CustomerPairs({ c }: { c: CustomerProposal }) {
  const { loaded } = useApp();
  const ds = loaded?.ws.dataset;
  const pairs = [...c.pairs].sort((a, b) =>
    a.status === b.status ? b.changeYen * b.qty - a.changeYen * a.qty : a.status === 'proposed' ? -1 : 1,
  );
  return (
    <div className="pair-detail">
      <div className="button-row">
        <a className="btn btn-small" href={href('letter', c.cust)}>
          申入書を見る
        </a>
        <a className="btn btn-small" href={href('negotiation', c.cust)}>
          交渉の記録
        </a>
        <span className="small muted">
          直近12か月の数量で計算しています。原価の上昇額（年間）：{yen(c.costIncreaseYen)}
        </span>
      </div>
      <div className="table-wrap scroll-y">
        <table className="table compact">
          <caption className="visually-hidden">{c.name} の品目ごとの提案</caption>
          <thead>
            <tr>
              <th scope="col">商品</th>
              <th scope="col" className="num">
                数量
              </th>
              <th scope="col" className="num">
                現単価
              </th>
              <th scope="col" className="num">
                定価（現→新）
              </th>
              <th scope="col" className="num">
                新単価
              </th>
              <th scope="col" className="num">
                改定率
              </th>
              <th scope="col" className="num">
                粗利率（今→据置→新）
              </th>
              <th scope="col">メモ</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p) => (
              <tr key={p.sku} className={p.status === 'excluded' ? 'is-muted' : ''}>
                <td>
                  {ds?.products.get(p.sku)?.name ?? p.sku}
                  <span className="muted small block">
                    {p.sku}・{ds?.categories.get(p.category)?.name ?? p.category}
                  </span>
                </td>
                <td className="num">{num(p.qty)}</td>
                <td className="num">{yen(p.currentPrice)}</td>
                <td className="num nowrap">
                  {yen(p.currentList)} → {yen(p.newList)}
                </td>
                <td className="num">
                  <PriceEditor p={p} />
                </td>
                <td className="num">{p.status === 'proposed' ? pctDelta(p.changeBp) : '—'}</td>
                <td className="num nowrap">
                  {pct(p.marginCurrentBp)} → {pct(p.marginNoActionBp)} → {pct(p.marginNewBp)}
                </td>
                <td className="memo">
                  {p.status === 'excluded' && p.excludedReason && (
                    <span className="block">{EXCLUSION_REASON_JA[p.excludedReason]}</span>
                  )}
                  {p.guardrails.map((h) => (
                    <span
                      key={h.rule + h.message}
                      className={`block ${h.rule === 'margin_floor_unmet' || h.rule === 'tier_conflict' ? 'text-warning' : ''}`}
                    >
                      {h.message}
                    </span>
                  ))}
                  {p.ongoingLeak && (
                    <span className="block text-critical">
                      請求ミスの可能性（{LEAK_LABEL_JA[p.ongoingLeak]}）：今の請求は {yen(p.lastBilledPrice)}
                    </span>
                  )}
                  {p.overrideRejected && <span className="block text-warning">{p.overrideRejected}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PriceEditor({ p }: { p: AppPair }) {
  const app = useApp();
  const shownPrice = p.status === 'proposed' ? p.newPrice : p.currentPrice;
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'warning'; text: string } | null>(null);
  const key = pairKey(p.cust, p.sku);
  const msgId = `msg-${key.replace(/[^A-Za-z0-9]/g, '-')}`;
  const apply = () => {
    if (draft === null) return;
    const v = Number(draft.replace(/[,，\s円¥]/g, ''));
    const verdict = checkOverride(p.bounds, v);
    if (!verdict.ok) {
      setMessage({ tone: 'error', text: verdict.error });
      return;
    }
    setMessage(verdict.warnings.length > 0 ? { tone: 'warning', text: verdict.warnings.join(' ') } : null);
    app.updateSettings((s) => {
      const overrides = { ...s.overrides };
      if (v === p.enginePrice && p.enginePriceStatus === 'proposed') delete overrides[key];
      else overrides[key] = v;
      return { ...s, overrides };
    });
    setDraft(null);
  };
  const reset = () => {
    app.updateSettings((s) => {
      const overrides = { ...s.overrides };
      delete overrides[key];
      return { ...s, overrides };
    });
    setDraft(null);
    setMessage(null);
  };
  return (
    <form
      className="price-editor"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <input
        type="text"
        inputMode="numeric"
        className={`input-price${p.override !== null ? ' is-override' : ''}`}
        aria-label={`新単価（${p.sku}）`}
        aria-describedby={message ? msgId : undefined}
        aria-invalid={message?.tone === 'error'}
        value={draft ?? String(shownPrice)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== String(shownPrice)) apply();
          else setDraft(null);
        }}
      />
      {p.override !== null && (
        <button type="button" className="btn btn-tiny btn-ghost" onClick={reset}>
          戻す（{num(p.enginePrice)}）
        </button>
      )}
      {message && (
        <span
          id={msgId}
          className={`block small ${message.tone === 'error' ? 'text-critical' : 'text-warning'}`}
          role="alert"
        >
          {message.text}
        </span>
      )}
    </form>
  );
}
