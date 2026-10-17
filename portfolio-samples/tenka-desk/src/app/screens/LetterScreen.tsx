import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDays,
  buildLetter,
  type Company,
  type EffectiveBasis,
  EVIDENCE_TOPIC_JA,
  type EvidenceItem,
  type EvidenceTopic,
  LETTER_CAUSE_JA,
  LETTER_PARAGRAPH_JA,
  type LetterCause,
  type LetterData,
  toWareki,
} from '../../engine/index.ts';
import { LineChart } from '../components/Charts.tsx';
import { Badge, Card, Icon, NeedsData, Notice, PageHeader, SampleTag } from '../components/ui.tsx';
import { nowJst, num, pct, todayJst, yen } from '../format.ts';
import { useApp } from '../model/AppState.tsx';
import {
  allowedTopics,
  LETTER_CAUSES,
  letterEvidence,
  passThroughOf,
  scenarioCauses,
} from '../model/letter.ts';
import { agreementsNotUsed } from '../model/load.ts';
import { statusOf } from '../model/negotiation.ts';
import { href, navigate, useRoute } from '../router.ts';
import { loadStats, type StatsLoad } from '../sample.ts';

const TOPICS: EvidenceTopic[] = ['material', 'energy', 'logistics', 'labor', 'general'];

function useStats(): { stats: StatsLoad | null; retry: () => void } {
  const [stats, setStats] = useState<StatsLoad | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    loadStats(attempt > 0)
      .then((s) => {
        if (alive) setStats(s);
      })
      .catch(() => {
        if (alive) setStats({ bundle: {}, guideline: null, errors: ['公表統計'] });
      });
    return () => {
      alive = false;
    };
  }, [attempt]);
  const retry = useCallback(() => {
    setStats(null);
    setAttempt((a) => a + 1);
  }, []);
  return { stats, retry };
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
  const { stats, retry } = useStats();
  const { loaded, proposal, settings } = app;
  const ls = settings.letter;
  const candidates = useMemo(
    () => (proposal?.ok ? proposal.customers.filter((c) => c.proposedItems > 0) : []),
    [proposal],
  );
  const cust =
    route.arg && candidates.some((c) => c.cust === route.arg) ? route.arg : (candidates[0]?.cust ?? null);
  const [recorded, setRecorded] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const ds = loaded?.ws.dataset;
  const customer = cust && ds ? ds.customers.get(cust) : undefined;
  const issueDate = ls.issueDate ?? todayJst();
  const asOf = loaded?.asOf ?? '';
  const hasNotices = useMemo(
    () => (ds ? ds.supplierNotices.some((n) => n.status === '予定' && n.effective > asOf) : false),
    [ds, asOf],
  );
  const fromScenario = useMemo(
    () => scenarioCauses(settings.scenario, hasNotices),
    [settings.scenario, hasNotices],
  );
  const causes = ls.causes ?? fromScenario;
  const allowed = allowedTopics(causes);
  // the agreements file is not used: the 現行単価 of a declined customer is wrong, so the letter is 仮
  const provisional = loaded ? agreementsNotUsed(loaded).length > 0 : false;

  const letter = useMemo(():
    | { data: LetterData; evidence: EvidenceItem[]; notRising: EvidenceItem[] }
    | { error: string }
    | null => {
    if (!ds || !proposal?.ok || !cust || !customer || !stats) return null;
    const ev = letterEvidence(stats.bundle, ds, cust, proposal.pairs, app.company, ls, causes, issueDate);
    try {
      const data = buildLetter(ds, cust, proposal.pairs, ev.items, app.company, {
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
        causes,
        paragraphs: ls.paragraphs,
        provisional,
      });
      return { data, evidence: ev.items, notRising: ev.notRising };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [ds, proposal, cust, customer, stats, issueDate, ls, app.company, causes, provisional]);

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
  const current = candidates[idx];
  const setLetter = (patch: Partial<typeof ls>) =>
    app.updateSettings((s) => ({ ...s, letter: { ...s.letter, ...patch } }));
  const setCompany = (patch: Partial<Company>) =>
    app.updateSettings((s) => ({ ...s, company: { ...app.company, ...patch } }));
  const status = statusOf(app.logs, cust);
  const items = current?.proposedItems ?? 0;
  const pass = passThroughOf(proposal.pairs, cust);
  const billedItems =
    letter && 'data' in letter ? letter.data.items.filter((i) => i.billedPrice !== null) : [];
  const prefectures = stats?.bundle.minimumWage?.prefectures.map((p) => p.fullName) ?? [];
  const toggleCause = (c: LetterCause, on: boolean) => {
    const next = LETTER_CAUSES.filter((x) => (x === c ? on : causes.includes(x)));
    setLetter({ causes: next });
  };
  const CHECKS = [
    `本文の値上げの理由（${causes.length > 0 ? causes.map((c) => LETTER_CAUSE_JA[c]).join('・') : '諸経費'}）と、「業務の効率化や経費の削減に努め」という取組みの記載が、自社の実情と合っている`,
    '別紙の品目・現行単価・改定後単価を確認した',
    '参考資料の統計が最新の公表値か、出典の取得日を見て確認した',
  ];
  const done = CHECKS.filter((c) => checked[c]).length;

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
      <div className="no-print stack">
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
            <div className="field letter-customer">
              <label htmlFor="letter-customer">得意先（{num(candidates.length)}社）</label>
              <select id="letter-customer" value={cust} onChange={(e) => navigate('letter', e.target.value)}>
                {candidates.map((c) => (
                  <option key={c.cust} value={c.cust}>
                    {c.name}（{c.cust}）{c.proposedItems}品目
                  </option>
                ))}
              </select>
              <span className="small muted letter-customer-sub">
                値上げ額（年間）{yen(current?.requestedYen ?? 0)}・転嫁率 {pct(pass.bp)}（原価の上昇額{' '}
                {yen(pass.costIncreaseYen)}）
              </span>
            </div>
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
          {pass.bp !== null && pass.bp > 10000 && (
            <Notice tone="info" title={`この得意先への依頼額は、原価の上昇額の ${pct(pass.bp)} です`}>
              <p>
                定価の端数の切り上げや、粗利率の下限までの引き上げを含むため、原価の上昇分より大きくなっています。本文は「原価の上昇を吸収しきれない」という書き方です。依頼の大きさと本文が合っているか確認してください。
              </p>
            </Notice>
          )}
          {billedItems.length > 0 && (
            <Notice tone="warning" title={`${billedItems.length}品目は、今の請求単価が現行単価と違います`}>
              <p>
                請求ミスの可能性がある品目です（<a href={href('proposal', cust)}>提案</a>
                で確認できます）。別紙では、該当する品目に※印と今の請求単価を示し、担当者から説明すると書いています。送る前に、請求の扱いを決めてください。
              </p>
            </Notice>
          )}
          <fieldset className="topic-row">
            <legend>本文に書く値上げの理由</legend>
            {LETTER_CAUSES.map((c) => (
              <label key={c} className="checkbox">
                <input
                  type="checkbox"
                  checked={causes.includes(c)}
                  onChange={(e) => toggleCause(c, e.target.checked)}
                />
                {LETTER_CAUSE_JA[c]}
              </label>
            ))}
            {ls.causes !== null && (
              <button
                type="button"
                className="btn btn-tiny btn-ghost"
                onClick={() => setLetter({ causes: null })}
              >
                シナリオに合わせる
              </button>
            )}
            <p className="small muted block-full">
              初期値は、シナリオで上がるとした費目です（原材料・エネルギー・労務費・その他、仕入先の値上げ通知）。自社で実際に上がっている費目だけを選んでください。
            </p>
          </fieldset>
          <fieldset className="topic-row">
            <legend>参考資料に入れる統計</legend>
            {TOPICS.map((t) => (
              <label key={t} className={`checkbox${allowed.has(t) ? '' : ' is-disabled'}`}>
                <input
                  type="checkbox"
                  checked={ls.topics[t] && allowed.has(t)}
                  disabled={!allowed.has(t)}
                  onChange={(e) => setLetter({ topics: { ...ls.topics, [t]: e.target.checked } })}
                />
                {EVIDENCE_TOPIC_JA[t]}
              </label>
            ))}
            {TOPICS.some((t) => !allowed.has(t)) && (
              <p className="small muted block-full">
                値上げの理由に選んでいない費目の統計は入れません（本文の理由と参考資料をそろえるため）。
              </p>
            )}
          </fieldset>
          {letter && 'notRising' in letter && letter.notRising.length > 0 && (
            <p className="small muted">
              下がった・横ばいの統計は参考資料から外しました：
              {letter.notRising.map((e) => e.title).join('、')}
            </p>
          )}
          <details className="details">
            <summary>本文を編集する</summary>
            <p className="small muted">
              書き換えた段落は、どの得意先の申入書にも使います（日付も書き換えた文のままになります）。空にすると、自動の文に戻ります。
            </p>
            {letter && 'data' in letter && (
              <div className="paragraph-editor">
                {letter.data.paragraphs.map((p) => (
                  <label key={p.id} className="field">
                    <span>
                      {LETTER_PARAGRAPH_JA[p.id]}
                      {p.edited && <Badge tone="info">書き換え済み</Badge>}
                    </span>
                    <textarea
                      rows={3}
                      value={ls.paragraphs[p.id] ?? p.text}
                      onChange={(e) =>
                        setLetter({ paragraphs: { ...ls.paragraphs, [p.id]: e.target.value } })
                      }
                    />
                    {p.edited && (
                      <button
                        type="button"
                        className="btn btn-tiny btn-ghost"
                        onClick={() => {
                          const { [p.id]: _drop, ...rest } = ls.paragraphs;
                          setLetter({ paragraphs: rest });
                        }}
                      >
                        自動の文に戻す
                      </button>
                    )}
                  </label>
                ))}
              </div>
            )}
          </details>
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
              <label className="field">
                従業員が働く都道府県（最低賃金の引用に使います）
                <select
                  value={app.company.prefecture ?? ''}
                  onChange={(e) => setCompany({ prefecture: e.target.value })}
                >
                  <option value="">書かない（全国加重平均だけ）</option>
                  {prefectures.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
          <section className="send-check" aria-label="送る前の確認">
            <h2 className="h3">
              送る前の確認（{done}/{CHECKS.length}）
            </h2>
            <ul className="plain-list">
              {CHECKS.map((c) => (
                <li key={c}>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={checked[c] ?? false}
                      onChange={(e) => setChecked({ ...checked, [c]: e.target.checked })}
                    />
                    {c}
                  </label>
                </li>
              ))}
            </ul>
            <p className="small muted">
              印刷の画面で「ヘッダーとフッター」をオフにすると、URLや日付が紙に入りません（ページ番号は申入書の側で入れます）。
            </p>
          </section>
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
                  <li key={e}>{e}を読み込めませんでした。</li>
                ))}
              </ul>
              <p className="small">参考資料からこの統計を外して作っています。</p>
              <p>
                <button type="button" className="btn btn-small" onClick={retry}>
                  もう一度読み込む
                </button>
              </p>
            </Notice>
          )}
        </Card>
        {loaded.isSample && (
          <p className="small muted sample-note">
            この申入書は架空のサンプルデータから作ったものです。会社名・得意先名・価格はすべて架空で、印刷にも「サンプル（架空データ）」と入ります。
          </p>
        )}
      </div>

      {!letter && <p role="status">申入書を作っています…</p>}
      {letter && 'error' in letter && (
        <Notice tone="critical" title="申入書を作れません">
          <p>{letter.error}</p>
        </Notice>
      )}
      {letter && 'data' in letter && <LetterSheets data={letter.data} sample={loaded.isSample} />}
    </>
  );
}

const PROVISIONAL_TAG =
  '仮：前回改定の合意状況のファイルを使っていないため、現行単価が正しくない可能性があります。取り込みの画面で前回の改定日を入れてから送ってください';

/** Printed on every sheet while the 現行単価 is not final (LetterData.provisional). */
function ProvisionalTag({ on }: { on: boolean }) {
  return on ? (
    <p className="sheet-sample" data-testid="letter-provisional">
      {PROVISIONAL_TAG}
    </p>
  ) : null;
}

function LetterSheets({ data, sample }: { data: LetterData; sample: boolean }) {
  const fictional = sample ? '（架空）' : '';
  return (
    <div className={`sheets${sample ? ' is-sample' : ''}`} data-testid="letter">
      <article className="sheet letter" aria-label="申入書">
        <SampleTag sample={sample} />
        <ProvisionalTag on={data.provisional} />
        <div className="letter-meta">
          {data.documentNo && <p>{data.documentNo}</p>}
          <p>{data.issueDateText}</p>
        </div>
        <p className="letter-to">
          {data.addressee.company}
          {fictional}
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
        {data.paragraphs.map((p, i) => (
          <p key={p.id} className={i === 0 ? 'letter-para letter-first' : 'letter-para'}>
            {i === 0 ? `${data.salutation}　${p.text}` : p.text}
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

      <article className="sheet items" aria-label="別紙 価格改定対象品目一覧">
        <SampleTag sample={sample} />
        <ProvisionalTag on={data.provisional} />
        <p className="sheet-tag">別紙</p>
        <h2 className="sheet-title">{data.itemsTitle}</h2>
        <p className="sheet-to">
          {data.addressee.company}
          {fictional} {data.addressee.honorific}　／　{data.effectiveDateText}より
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
                <td className="num">
                  {it.currentPriceText}
                  {it.billedPriceText !== null && (
                    <span className="billed-price">※ご請求 {it.billedPriceText}</span>
                  )}
                </td>
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
          <SampleTag sample={sample} />
          <ProvisionalTag on={data.provisional} />
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
                    periodUnit={e.chart.periodUnit ?? '年'}
                    format={chartFormat(e.chart.unit, e.chart.points)}
                    width={380}
                    height={190}
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
                <p className="evidence-source">{e.source.line}</p>
              </figure>
            ))}
          </div>
          <div className="evidence-foot">
            <ul>
              {data.evidence.disclaimer.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
        </article>
      )}
    </div>
  );
}
