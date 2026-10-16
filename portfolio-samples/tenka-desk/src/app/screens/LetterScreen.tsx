import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  buildEvidence,
  buildLetter,
  type Company,
  type EffectiveBasis,
  EVIDENCE_TOPIC_JA,
  type EvidenceItem,
  type EvidenceTopic,
  type LetterData,
  seriesForCategory,
  toWareki,
} from '../../engine/index.ts';
import { LineChart } from '../components/Charts.tsx';
import { Card, Icon, NeedsData, Notice, PageHeader } from '../components/ui.tsx';
import { nowJst, num, todayJst, yen } from '../format.ts';
import { useApp } from '../model/AppState.tsx';
import { statusOf } from '../model/negotiation.ts';
import { href, navigate, useRoute } from '../router.ts';
import { loadStats, type StatsLoad } from '../sample.ts';

const TOPICS: EvidenceTopic[] = ['material', 'energy', 'logistics', 'labor', 'general'];

function useStats(): StatsLoad | null {
  const [stats, setStats] = useState<StatsLoad | null>(null);
  useEffect(() => {
    let alive = true;
    loadStats()
      .then((s) => {
        if (alive) setStats(s);
      })
      .catch(() => {
        if (alive) setStats({ bundle: {}, guideline: null, errors: ['公表統計を読み込めませんでした'] });
      });
    return () => {
      alive = false;
    };
  }, []);
  return stats;
}

/** Decimals the series is published with (0–2), so every point is shown the same way. */
function decimalsOf(points: readonly { value: number }[]): number {
  let d = 0;
  for (const p of points) {
    while (d < 2 && Math.abs(p.value * 10 ** d - Math.round(p.value * 10 ** d)) > 1e-9) d++;
  }
  return d;
}

function chartFormat(unit: string, points: readonly { value: number }[]): (v: number) => string {
  const d = decimalsOf(points);
  if (unit.startsWith('円')) return (v) => `${v.toLocaleString('ja-JP')}円`;
  if (unit === '％' || unit === '%') return (v) => `${v.toFixed(Math.max(1, d))}%`;
  return (v) => v.toFixed(Math.max(1, d));
}

export function LetterScreen() {
  const app = useApp();
  const route = useRoute();
  const stats = useStats();
  const { loaded, proposal, settings } = app;
  const ls = settings.letter;
  const candidates = useMemo(
    () => (proposal?.ok ? proposal.customers.filter((c) => c.proposedItems > 0) : []),
    [proposal],
  );
  const cust =
    route.arg && candidates.some((c) => c.cust === route.arg) ? route.arg : (candidates[0]?.cust ?? null);
  const [recorded, setRecorded] = useState<string | null>(null);

  const ds = loaded?.ws.dataset;
  const customer = cust && ds ? ds.customers.get(cust) : undefined;
  const issueDate = ls.issueDate ?? todayJst();

  const letter = useMemo((): { data: LetterData; evidence: EvidenceItem[] } | { error: string } | null => {
    if (!ds || !proposal?.ok || !cust || !customer || !stats) return null;
    const cats = new Set(
      proposal.pairs.filter((p) => p.cust === cust && p.status === 'proposed').map((p) => p.category),
    );
    const materialSeries: string[] = [];
    if (stats.bundle.cgpi) {
      for (const code of cats) {
        const cat = ds.categories.get(code);
        if (cat)
          for (const s of seriesForCategory(cat, stats.bundle.cgpi))
            if (!materialSeries.includes(s)) materialSeries.push(s);
      }
    }
    const evidence = buildEvidence(stats.bundle, {
      asOf: issueDate,
      materialSeries,
      prefecture: customer.prefecture,
      include: ls.topics,
    });
    try {
      const data = buildLetter(ds, cust, proposal.pairs, evidence, app.company, {
        issueDate,
        effectiveDate: proposal.effectiveDate,
        basis: ls.basis,
        ...(ls.replyDays !== null ? { replyBy: addDays(issueDate, ls.replyDays) } : {}),
        contact: {
          branch: customer.branch,
          person: customer.salesRep,
          ...(app.company.tel ? { tel: app.company.tel } : {}),
        },
        ...(ls.documentPrefix.trim() ? { documentNo: `${ls.documentPrefix.trim()}-${cust}` } : {}),
      });
      return { data, evidence };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [ds, proposal, cust, customer, stats, issueDate, ls, app.company]);

  if (!loaded?.diagnosis || !proposal) {
    return (
      <>
        <PageHeader step={5} title="申入書（価格改定のお願い）" />
        <NeedsData />
      </>
    );
  }
  if (!proposal.ok || candidates.length === 0 || !cust || !customer) {
    return (
      <>
        <PageHeader step={5} title="申入書（価格改定のお願い）" />
        <Notice tone="info" title="申入書を作れる得意先がありません">
          <p>
            提案に値上げの品目がある得意先について作ります。<a href={href('scenario')}>シナリオ</a>
            を見直してください。
          </p>
        </Notice>
      </>
    );
  }

  const idx = candidates.findIndex((c) => c.cust === cust);
  const setLetter = (patch: Partial<typeof ls>) =>
    app.updateSettings((s) => ({ ...s, letter: { ...s.letter, ...patch } }));
  const setCompany = (patch: Partial<Company>) =>
    app.updateSettings((s) => ({ ...s, company: { ...app.company, ...patch } }));
  const status = statusOf(app.logs, cust);
  const items = candidates[idx]?.proposedItems ?? 0;

  const print = () => {
    const old = document.title;
    document.title = `価格改定のお願い_${customer.name}_${issueDate.replace(/-/g, '')}`;
    window.print();
    document.title = old;
  };
  const record = () => {
    const err = app.appendLog(cust, {
      at: nowJst(),
      kind: 'letter_sent',
      author: customer.salesRep || '担当者',
      summary: `価格改定のお願い（${toWareki(issueDate)}付・${items}品目・${toWareki(proposal.effectiveDate)}${ls.basis}より）を送付`,
      ...(status === '申入れ前' ? { status: '申入れ済' as const } : {}),
    });
    setRecorded(err ?? `${customer.name} の協議記録に「申入書送付」を追加しました。`);
  };

  return (
    <>
      <div className="no-print">
        <PageHeader
          step={5}
          title="申入書（価格改定のお願い）"
          lead={
            <p>
              得意先ごとの申入書の下書きです。対象品目の一覧と、公表統計による参考資料を付けます。自社の原価の内訳は載せません。内容は送付前に必ず確認してください。
            </p>
          }
          actions={
            <button type="button" className="btn btn-primary" onClick={print}>
              <Icon name="print" /> 印刷・PDFで保存
            </button>
          }
        />
        <Card>
          <div className="letter-controls">
            <label className="field">
              得意先（{num(candidates.length)}社）
              <select value={cust} onChange={(e) => navigate('letter', e.target.value)}>
                {candidates.map((c) => (
                  <option key={c.cust} value={c.cust}>
                    {c.name}（{c.cust}・{c.proposedItems}品目・{yen(c.requestedYen)}）
                  </option>
                ))}
              </select>
            </label>
            <div className="button-row tight">
              <button
                type="button"
                className="btn btn-small"
                disabled={idx <= 0}
                onClick={() => navigate('letter', candidates[idx - 1]?.cust)}
              >
                前の得意先
              </button>
              <button
                type="button"
                className="btn btn-small"
                disabled={idx >= candidates.length - 1}
                onClick={() => navigate('letter', candidates[idx + 1]?.cust)}
              >
                次の得意先
              </button>
            </div>
            <label className="field">
              発行日
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setLetter({ issueDate: e.target.value || null })}
              />
            </label>
            <label className="field">
              改定の基準
              <select
                value={ls.basis}
                onChange={(e) => setLetter({ basis: e.target.value as EffectiveBasis })}
              >
                <option value="出荷分">出荷分より</option>
                <option value="受注分">受注分より</option>
                <option value="納品分">納品分より</option>
              </select>
            </label>
            <label className="field">
              ご回答のお願い
              <select
                value={ls.replyDays ?? ''}
                onChange={(e) =>
                  setLetter({ replyDays: e.target.value === '' ? null : Number(e.target.value) })
                }
              >
                <option value="">書かない</option>
                <option value="14">発行日から2週間後</option>
                <option value="21">発行日から3週間後</option>
                <option value="30">発行日から30日後</option>
              </select>
            </label>
            <label className="field">
              文書番号の頭
              <input
                type="text"
                value={ls.documentPrefix}
                placeholder="例：営発2026"
                onChange={(e) => setLetter({ documentPrefix: e.target.value })}
              />
            </label>
          </div>
          <fieldset className="topic-row">
            <legend>参考資料に入れる統計</legend>
            {TOPICS.map((t) => (
              <label key={t} className="checkbox">
                <input
                  type="checkbox"
                  checked={ls.topics[t]}
                  onChange={(e) => setLetter({ topics: { ...ls.topics, [t]: e.target.checked } })}
                />
                {EVIDENCE_TOPIC_JA[t]}
              </label>
            ))}
          </fieldset>
          <details className="details">
            <summary>差出人（自社）の情報</summary>
            <div className="form-grid-2">
              {(
                [
                  ['name', '会社名'],
                  ['representative', '代表者'],
                  ['address', '住所'],
                  ['tel', '電話番号'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="field">
                  {label}
                  <input
                    type="text"
                    value={app.company[k]}
                    onChange={(e) => setCompany({ [k]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          </details>
          <div className="button-row">
            <button type="button" className="btn" onClick={record}>
              協議記録に「申入書送付」を記録
            </button>
            <span className="small muted">
              今の状況：{status}
              {recorded && <span role="status"> — {recorded}</span>}
            </span>
          </div>
          {stats?.guideline && (
            <details className="details">
              <summary>参考：{stats.guideline.title}</summary>
              <ul className="small">
                {stats.guideline.summary.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <p className="small muted">出典：{stats.guideline.url}</p>
            </details>
          )}
          {stats && stats.errors.length > 0 && (
            <Notice tone="warning" title="一部の公表統計を読み込めませんでした">
              <ul className="small">
                {stats.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Notice>
          )}
        </Card>
        {loaded.isSample && (
          <p className="small muted sample-note">
            この申入書は架空のサンプルデータから作ったものです。会社名・得意先名・価格はすべて架空です。
          </p>
        )}
      </div>

      {!letter && <p role="status">申入書を作っています…</p>}
      {letter && 'error' in letter && (
        <Notice tone="critical" title="申入書を作れません">
          <p>{letter.error}</p>
        </Notice>
      )}
      {letter && 'data' in letter && <LetterSheets data={letter.data} />}
    </>
  );
}

function LetterSheets({ data }: { data: LetterData }) {
  return (
    <div className="sheets" data-testid="letter">
      <article className="sheet letter" aria-label="申入書">
        <div className="letter-meta">
          {data.documentNo && <p>{data.documentNo}</p>}
          <p>{data.issueDateText}</p>
        </div>
        <p className="letter-to">
          {data.addressee.company}
          <br />
          {data.addressee.department && <span>{data.addressee.department}　</span>}
          {data.addressee.honorific}
        </p>
        <div className="letter-from">
          <p>{data.sender.company}</p>
          <p>{data.sender.representative}</p>
          <p className="small">{data.sender.address}</p>
          {data.sender.tel && <p className="small">TEL {data.sender.tel}</p>}
        </div>
        <h2 className="letter-title">{data.title}</h2>
        <p className="letter-salutation">{data.salutation}</p>
        {data.body.map((p) => (
          <p key={p} className="letter-para">
            {p}
          </p>
        ))}
        <p className="letter-close">{data.complimentaryClose}</p>
        <p className="letter-ki">記</p>
        <dl className="letter-record">
          {data.record.map((r) => (
            <div key={r.label}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
        <p className="letter-ijo">以上</p>
      </article>

      <article className="sheet" aria-label="別紙 価格改定対象品目一覧">
        <p className="sheet-tag">別紙</p>
        <h2 className="sheet-title">{data.itemsTitle}</h2>
        <p className="sheet-to">
          {data.addressee.company} {data.addressee.honorific}　／　{data.effectiveDateText}より
        </p>
        <table className="items-table">
          <thead>
            <tr>
              <th scope="col">No.</th>
              <th scope="col">商品コード</th>
              <th scope="col">商品名</th>
              <th scope="col">単位</th>
              <th scope="col" className="num">
                現行単価
              </th>
              <th scope="col" className="num">
                改定後単価
              </th>
              <th scope="col" className="num">
                改定額
              </th>
              <th scope="col" className="num">
                改定率
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it, i) => (
              <tr key={it.sku}>
                <td className="num">{i + 1}</td>
                <td className="nowrap">{it.sku}</td>
                <td>{it.name}</td>
                <td className="nowrap">{it.unit}</td>
                <td className="num">{it.currentPriceText}</td>
                <td className="num">{it.newPriceText}</td>
                <td className="num">{it.changeText}</td>
                <td className="num">{it.rateText}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="sheet-notes">
          {data.itemsNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </article>

      {data.evidence.items.length > 0 && (
        <article className="sheet evidence" aria-label={data.evidence.heading}>
          <p className="sheet-tag">参考資料</p>
          <h2 className="sheet-title">{data.evidence.heading}</h2>
          <p className="sheet-intro">{data.evidence.intro}</p>
          <div className="evidence-grid">
            {data.evidence.items.map((e) => (
              <figure key={e.id} className="evidence-item">
                <figcaption>
                  <span className="evidence-topic">{EVIDENCE_TOPIC_JA[e.topic]}</span>
                  <span className="evidence-title">{e.title}</span>
                </figcaption>
                {e.chart && (
                  <LineChart
                    points={e.chart.points}
                    title={e.chart.label}
                    unit={e.chart.unit}
                    format={chartFormat(e.chart.unit, e.chart.points)}
                  />
                )}
                <p className="evidence-statement">{e.statement}</p>
                <dl className="evidence-figures">
                  {e.figures.map((f) => (
                    <div key={f.label}>
                      <dt>{f.label}</dt>
                      <dd className="num">{f.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="evidence-source">
                  出典：{e.source.publisher}「{e.source.title}」（{e.source.url}、
                  {e.source.retrievedAt.slice(0, 10)}取得）
                </p>
              </figure>
            ))}
          </div>
          <div className="evidence-foot">
            <ul>
              {data.evidence.disclaimer.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            <ul className="credits">
              {data.evidence.sources.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </article>
      )}
    </div>
  );
}
