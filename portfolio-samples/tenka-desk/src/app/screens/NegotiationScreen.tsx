import { useMemo, useState } from 'react';
import {
  allowedNextStatuses,
  currentStatus,
  EVENT_KIND_JA,
  formatJstWareki,
  importFile,
  logToCsv,
  NEGOTIATION_STATUSES,
  type NegotiationEventKind,
  type NegotiationLog,
  type NegotiationStatus,
  parseLog,
  parseTimestamp,
  recordRows,
  serializeLog,
  toCompactDate,
  toWareki,
  verifyLog,
} from '../../engine/index.ts';
import { readFiles } from '../components/DropZone.tsx';
import { Badge, Card, downloadFile, Icon, NeedsData, Notice, PageHeader } from '../components/ui.tsx';
import { nowJst, num, todayJst, yen } from '../format.ts';
import { useApp } from '../model/AppState.tsx';
import { fillDemoOutcomes, logOf, statusOf } from '../model/negotiation.ts';
import { href, navigate, useRoute } from '../router.ts';
import { fetchSample, SAMPLE_OUTCOMES } from '../sample.ts';

const STATUS_TONE: Record<NegotiationStatus, 'neutral' | 'info' | 'warning' | 'good' | 'critical'> = {
  申入れ前: 'neutral',
  申入れ済: 'info',
  協議中: 'warning',
  合意: 'good',
  一部合意: 'good',
  見送り: 'critical',
};

export function NegotiationScreen() {
  const app = useApp();
  const route = useRoute();
  const { loaded, proposal, logs } = app;
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<{ tone: 'good' | 'warning' | 'critical'; text: string } | null>(
    null,
  );

  const customers = useMemo(() => {
    if (!proposal?.ok || !loaded) return [];
    const withItems = proposal.customers.filter((c) => c.proposedItems > 0);
    const extra = Object.keys(logs)
      .filter((c) => !proposal.customerByCode.get(c)?.proposedItems)
      .map((c) => ({
        cust: c,
        name: loaded.ws.dataset.customers.get(c)?.name ?? c,
        proposedItems: 0,
        requestedYen: 0,
      }));
    return [
      ...withItems.map((c) => ({
        cust: c.cust,
        name: c.name,
        proposedItems: c.proposedItems,
        requestedYen: c.requestedYen,
      })),
      ...extra,
    ];
  }, [proposal, loaded, logs]);

  const columns = useMemo(() => {
    const q = query.normalize('NFKC').trim().toLowerCase();
    const by = new Map<NegotiationStatus, typeof customers>(NEGOTIATION_STATUSES.map((s) => [s, []]));
    for (const c of customers) {
      if (q && !`${c.cust} ${c.name}`.normalize('NFKC').toLowerCase().includes(q)) continue;
      by.get(statusOf(logs, c.cust))?.push(c);
    }
    return by;
  }, [customers, logs, query]);

  if (!loaded?.diagnosis || !proposal?.ok) {
    return (
      <>
        <PageHeader step={6} title="交渉の記録" />
        <NeedsData />
      </>
    );
  }

  const selected = route.arg && customers.some((c) => c.cust === route.arg) ? route.arg : null;

  const fillDemo = async () => {
    try {
      const bytes = await fetchSample(SAMPLE_OUTCOMES);
      const imp = importFile(SAMPLE_OUTCOMES, bytes, { kinds: ['agreements'] });
      if (imp.data.kind !== 'agreements') throw new Error('協議結果のファイルではありません');
      const withItems = new Set(customers.filter((c) => c.proposedItems > 0).map((c) => c.cust));
      const r = fillDemoOutcomes(logs, imp.data.result.records, withItems, Date.now());
      app.replaceLogs(r.logs);
      setMessage({
        tone: 'good',
        text: `${num(r.filled)}社に、サンプルの協議結果（架空）から記録を追加しました。${r.skipped > 0 ? `すでに記録のある${num(r.skipped)}社はそのままです。` : ''}`,
      });
    } catch (e) {
      setMessage({ tone: 'critical', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const exportAll = () => {
    const json = JSON.stringify(
      { format: 'tenka-desk-negotiation-logs', version: 1, logs: Object.values(logs) },
      null,
      1,
    );
    downloadFile(`協議記録_${toCompactDate(todayJst())}.json`, json, 'application/json');
  };

  const importLogs = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const [f] = await readFiles(files);
    if (!f) return;
    try {
      const raw = JSON.parse(new TextDecoder().decode(f.bytes)) as { logs?: unknown };
      const list = Array.isArray(raw.logs) ? raw.logs : [];
      const next: Record<string, NegotiationLog> = { ...logs };
      let added = 0;
      let skipped = 0;
      const problems: string[] = [];
      for (const item of list) {
        try {
          const log = parseLog(JSON.stringify(item));
          if ((next[log.cust]?.events.length ?? 0) > 0) skipped++;
          else {
            next[log.cust] = log;
            added++;
          }
        } catch (e) {
          problems.push(e instanceof Error ? e.message : String(e));
        }
      }
      app.replaceLogs(next);
      setMessage({
        tone: problems.length > 0 ? 'warning' : 'good',
        text: `${num(added)}社の記録を読み込みました。${skipped > 0 ? `記録のある${num(skipped)}社は上書きしていません。` : ''}${problems.length > 0 ? `確認できなかった記録：${problems.join('／')}` : ''}`,
      });
    } catch {
      setMessage({ tone: 'critical', text: '協議記録のJSONとして読めません。' });
    }
  };

  return (
    <>
      <div className="no-print">
        <PageHeader
          step={6}
          title="交渉の記録"
          lead={
            <p>
              得意先ごとの交渉の状況と協議記録です。記録は追記だけで、書き換えや削除はできません。誤りは「訂正」として追記します。各記録は前の記録の確認コード（SHA-256）とつながっていて、後から変えると検出できます。
            </p>
          }
          actions={
            <>
              {loaded.isSample && (
                <button type="button" className="btn" onClick={fillDemo}>
                  サンプルの協議結果（架空）で埋める
                </button>
              )}
              <button
                type="button"
                className="btn"
                onClick={exportAll}
                disabled={Object.keys(logs).length === 0}
              >
                <Icon name="download" /> 記録を保存（JSON）
              </button>
              <label className="btn">
                <Icon name="upload" /> 記録を読み込む
                <input
                  type="file"
                  accept=".json,application/json"
                  className="visually-hidden"
                  onChange={(e) => {
                    importLogs(e.currentTarget.files);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            </>
          }
        />
        {message && (
          <Notice tone={message.tone}>
            <p role="status">{message.text}</p>
          </Notice>
        )}
        <div className="filters">
          <label className="field field-inline">
            <span>得意先を探す</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="名前・コード"
            />
          </label>
        </div>
        <div className="kanban" aria-label="状況ごとの得意先">
          {NEGOTIATION_STATUSES.map((s) => {
            const list = columns.get(s) ?? [];
            return (
              <section key={s} className="kanban-col" aria-labelledby={`col-${s}`}>
                <h2 className="kanban-head" id={`col-${s}`}>
                  <Badge tone={STATUS_TONE[s]}>{s}</Badge>
                  <span className="num">{num(list.length)}社</span>
                </h2>
                <ul className="kanban-list">
                  {list.slice(0, 200).map((c) => (
                    <li key={c.cust}>
                      <a
                        href={href('negotiation', c.cust)}
                        className={`kanban-card${selected === c.cust ? ' is-selected' : ''}`}
                        aria-current={selected === c.cust ? 'true' : undefined}
                      >
                        <span className="kanban-name">{c.name}</span>
                        <span className="kanban-meta">
                          {c.proposedItems}品目・<span className="num">{yen(c.requestedYen)}</span>
                        </span>
                      </a>
                    </li>
                  ))}
                  {list.length > 200 && (
                    <li className="small muted">ほか{num(list.length - 200)}社（検索で絞り込めます）</li>
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      {selected ? (
        <CustomerLog key={selected} cust={selected} />
      ) : (
        <p className="muted no-print">得意先を選ぶと、協議記録の確認と追記ができます。</p>
      )}
    </>
  );
}

const KINDS: NegotiationEventKind[] = [
  'meeting',
  'call',
  'email',
  'customer_reply',
  'letter_sent',
  'note',
  'correction',
];

function CustomerLog({ cust }: { cust: string }) {
  const app = useApp();
  const ds = app.loaded?.ws.dataset;
  const customer = ds?.customers.get(cust);
  const log = logOf(app.logs, cust);
  const status = currentStatus(log);
  const verify = verifyLog(log);
  const rows = recordRows(log);
  const proposalCust = app.proposal?.ok ? app.proposal.customerByCode.get(cust) : undefined;
  const categories = [
    ...new Set((proposalCust?.pairs ?? []).filter((p) => p.status === 'proposed').map((p) => p.category)),
  ];
  const effectiveDefault = app.proposal?.ok ? app.proposal.effectiveDate : todayJst();

  const [kind, setKind] = useState<NegotiationEventKind>('meeting');
  const [at, setAt] = useState(() => nowJst().slice(0, 16));
  const [author, setAuthor] = useState(customer?.salesRep ?? '');
  const [counterpart, setCounterpart] = useState('');
  const [summary, setSummary] = useState('');
  const [detail, setDetail] = useState('');
  const [nextStatus, setNextStatus] = useState<NegotiationStatus | ''>('');
  const [effective, setEffective] = useState(effectiveDefault);
  const [kept, setKept] = useState<string[]>([]);
  const [corrects, setCorrects] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const options = kind === 'correction' ? NEGOTIATION_STATUSES : allowedNextStatuses(status);
  const needsTerms = nextStatus === '合意' || nextStatus === '一部合意';

  const submit = () => {
    setDone(null);
    const err = app.appendLog(cust, {
      at: `${at}:00+09:00`,
      kind,
      author,
      summary,
      ...(detail.trim() ? { detail } : {}),
      ...(counterpart.trim() ? { counterpart } : {}),
      ...(nextStatus ? { status: nextStatus } : {}),
      ...(needsTerms ? { terms: { effective, excludedCategories: kept, itemPrices: [] } } : {}),
      ...(kind === 'correction' && corrects ? { corrects } : {}),
    });
    if (err) setError(err);
    else {
      setError(null);
      setSummary('');
      setDetail('');
      setNextStatus('');
      setCorrects('');
      setDone('記録を追加しました。');
      setAt(nowJst().slice(0, 16));
    }
  };

  const printLog = () => {
    const old = document.title;
    document.title = `協議記録_${customer?.name ?? cust}_${toCompactDate(todayJst())}`;
    window.print();
    document.title = old;
  };

  return (
    <>
      <Card
        title={`${customer?.name ?? cust}（${cust}）`}
        className="no-print"
        actions={
          <div className="button-row tight">
            <a className="btn btn-small" href={href('letter', cust)}>
              申入書
            </a>
            <button
              type="button"
              className="btn btn-small"
              onClick={printLog}
              disabled={log.events.length === 0}
            >
              <Icon name="print" size={16} /> 記録を印刷・PDF
            </button>
            <button
              type="button"
              className="btn btn-small"
              disabled={log.events.length === 0}
              onClick={() =>
                downloadFile(
                  `協議記録_${cust}_${toCompactDate(todayJst())}.csv`,
                  logToCsv(log),
                  'text/csv;charset=utf-8',
                )
              }
            >
              <Icon name="download" size={16} /> CSV
            </button>
            <button
              type="button"
              className="btn btn-small"
              disabled={log.events.length === 0}
              onClick={() => downloadFile(`協議記録_${cust}.json`, serializeLog(log), 'application/json')}
            >
              JSON
            </button>
          </div>
        }
      >
        <div className="status-line">
          <span>
            今の状況：<Badge tone={STATUS_TONE[status]}>{status}</Badge>
          </span>
          {log.events.length > 0 &&
            (verify.ok ? (
              <span className="text-good small">
                <Icon name="check" size={16} /> 記録のつながりを確認しました（{log.events.length}
                件・変更なし）
              </span>
            ) : (
              <span className="text-critical small">
                <Icon name="alert" size={16} /> {verify.seq}件目：{verify.reason}
              </span>
            ))}
          {proposalCust && (
            <span className="small muted">
              提案 {proposalCust.proposedItems}品目・値上げ額（年間）{yen(proposalCust.requestedYen)}
            </span>
          )}
        </div>
        {status !== '申入れ前' && (
          <p className="small muted">
            次に進める状況：{allowedNextStatuses(status).join('・')}
            （合意・一部合意・見送りの後でも、協議中に戻せます）
          </p>
        )}

        <ol className="timeline" aria-label="協議記録">
          {log.events.length === 0 && <li className="muted">まだ記録はありません。</li>}
          {log.events.map((e) => (
            <li key={e.id} className={`timeline-item${e.kind === 'correction' ? ' is-correction' : ''}`}>
              <div className="timeline-when">
                <span className="num">No.{e.seq}</span> {formatJstWareki(parseTimestamp(e.at) ?? 0)}
              </div>
              <div className="timeline-body">
                <p>
                  <Badge>{EVENT_KIND_JA[e.kind]}</Badge> <strong>{e.summary}</strong>
                  {e.status && (
                    <>
                      {' '}
                      <Badge tone={STATUS_TONE[e.status]}>→ {e.status}</Badge>
                    </>
                  )}
                </p>
                {e.detail && <p className="small">{e.detail}</p>}
                <p className="small muted">
                  記録者：{e.author}
                  {e.counterpart ? `／先方：${e.counterpart}` : ''}
                  {e.terms
                    ? `／適用日 ${toWareki(e.terms.effective)}${e.terms.excludedCategories.length ? `・据え置き ${e.terms.excludedCategories.map((c) => ds?.categories.get(c)?.name ?? c).join('・')}` : ''}`
                    : ''}
                  {e.corrects ? `／訂正対象 ${e.corrects}` : ''}
                  ／確認コード <code>{e.hash.slice(0, 12)}</code>
                </p>
              </div>
            </li>
          ))}
        </ol>

        <form
          className="log-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <h3 className="h3">記録を追加する</h3>
          <div className="form-grid-3">
            <label className="field">
              日時（日本時間）
              <input type="datetime-local" required value={at} onChange={(e) => setAt(e.target.value)} />
            </label>
            <label className="field">
              種類
              <select value={kind} onChange={(e) => setKind(e.target.value as NegotiationEventKind)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {EVENT_KIND_JA[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              記録者
              <input type="text" required value={author} onChange={(e) => setAuthor(e.target.value)} />
            </label>
            <label className="field">
              先方の出席者・担当者
              <input type="text" value={counterpart} onChange={(e) => setCounterpart(e.target.value)} />
            </label>
            <label className="field">
              状況の変更
              <select
                value={nextStatus}
                onChange={(e) => setNextStatus(e.target.value as NegotiationStatus | '')}
              >
                <option value="">変更しない</option>
                {options.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            {kind === 'correction' && (
              <label className="field">
                訂正する記録
                <select required value={corrects} onChange={(e) => setCorrects(e.target.value)}>
                  <option value="">選んでください</option>
                  {log.events.map((e) => (
                    <option key={e.id} value={e.id}>
                      No.{e.seq} {e.summary.slice(0, 20)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <label className="field">
            要旨
            <input
              type="text"
              required
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="例：購買部と面談。改定率について説明"
            />
          </label>
          <label className="field">
            詳細
            <textarea rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} />
          </label>
          {needsTerms && (
            <fieldset className="terms">
              <legend>合意内容</legend>
              <label className="field field-inline">
                <span>適用日</span>
                <input
                  type="date"
                  required
                  value={effective}
                  onChange={(e) => setEffective(e.target.value)}
                />
              </label>
              {categories.length > 0 && (
                <div className="topic-row">
                  <span className="small">
                    据え置くカテゴリ{nextStatus === '一部合意' ? '（一部合意では1つ以上）' : ''}：
                  </span>
                  {categories.map((c) => (
                    <label key={c} className="checkbox">
                      <input
                        type="checkbox"
                        checked={kept.includes(c)}
                        onChange={(e) =>
                          setKept(e.target.checked ? [...kept, c] : kept.filter((x) => x !== c))
                        }
                      />
                      {ds?.categories.get(c)?.name ?? c}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )}
          {error && (
            <p className="text-critical small" role="alert">
              {error}
            </p>
          )}
          {done && (
            <p className="text-good small" role="status">
              {done}
            </p>
          )}
          <div className="button-row">
            <button type="submit" className="btn btn-primary">
              追記する
            </button>
            <span className="small muted">追記した記録は変更・削除できません。</span>
          </div>
        </form>
      </Card>

      <section className="print-only log-print">
        <h1>価格協議の記録</h1>
        <p>
          得意先：{customer?.name ?? cust}（{cust}）　今の状況：{status}　出力日：{toWareki(todayJst())}
        </p>
        <p>
          {verify.ok
            ? `記録のつながりを確認しました（${log.events.length}件・後からの変更は見つかりませんでした）。`
            : `記録の確認でエラーがあります：${verify.seq}件目 ${verify.reason}`}
        </p>
        <table className="items-table">
          <thead>
            <tr>
              <th>No.</th>
              <th>日時</th>
              <th>種類</th>
              <th>記録者／先方</th>
              <th>内容</th>
              <th>状況</th>
              <th>確認コード</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.seq}>
                <td>{r.seq}</td>
                <td className="nowrap">{r.when}</td>
                <td>{r.kind}</td>
                <td>
                  {r.author}
                  {r.counterpart ? `／${r.counterpart}` : ''}
                </td>
                <td>
                  {r.summary}
                  {r.detail ? `　${r.detail}` : ''}
                  {r.terms ? `（${r.terms}）` : ''}
                  {r.corrects ? `（訂正対象：${r.corrects}）` : ''}
                </td>
                <td>{r.statusChange}</td>
                <td>
                  <code>{r.hash}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small">
          この記録は追記のみの形式で作成しています。確認コードは各記録の SHA-256
          の先頭12桁で、前の記録のコードを含めて計算しています。
        </p>
      </section>
      <div className="no-print">
        <button type="button" className="btn btn-ghost" onClick={() => navigate('negotiation')}>
          選択を外す
        </button>
      </div>
    </>
  );
}
