import { Fragment, useMemo, useState } from 'react';
import {
  type Finding,
  LEAK_LABEL_JA,
  LEAK_SHORT_JA,
  LEAK_TYPES,
  type LeakType,
  LINE_STATUS_JA,
  type LineStatus,
  toCompactDate,
  toCsv,
} from '../../engine/index.ts';
import { BarList } from '../components/Charts.tsx';
import { Badge, Card, downloadFile, Icon, NeedsData, Notice, PageHeader } from '../components/ui.tsx';
import { num, ratio, wareki, warekiRange, yen } from '../format.ts';
import { useApp } from '../model/AppState.tsx';
import { href } from '../router.ts';

const TYPE_HELP: Record<LeakType, string> = {
  old_price: '定価改定のあと、合意どおりなら新しい単価のはずなのに、旧定価 × 掛率 のまま請求している行です。',
  expired_special: '特値（期間つきの得意先別単価）の期間が終わった後も、同じ単価で請求している行です。',
  rate_out_of_tier: '請求単価が、定価 × 得意先の掛率ランクの範囲（下限〜上限）の外にある行です。',
  below_margin_floor:
    '粗利率が設定した下限を下回っている行です。請求ミスではありませんが、値上げの検討対象です。',
};

const PAGE = 50;

export function DiagnosisScreen() {
  const { loaded } = useApp();
  const [type, setType] = useState<LeakType | 'all'>('all');
  const [query, setQuery] = useState('');
  const [onlyOngoing, setOnlyOngoing] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const d = loaded?.diagnosis ?? null;
  const filtered = useMemo(() => {
    if (!d) return [];
    const q = query.normalize('NFKC').trim().toLowerCase();
    return d.findings
      .filter((f) => type === 'all' || f.type === type)
      .filter((f) => !onlyOngoing || f.ongoing)
      .filter(
        (f) =>
          q === '' ||
          `${f.cust} ${f.custName} ${f.sku} ${f.itemName} ${f.id}`
            .normalize('NFKC')
            .toLowerCase()
            .includes(q),
      )
      .sort((a, b) => b.annualImpactYen - a.annualImpactYen || (a.id < b.id ? -1 : 1));
  }, [d, type, query, onlyOngoing]);

  if (!loaded || !d) {
    return (
      <>
        <PageHeader step={2} title="診断（利益漏れ）" />
        <NeedsData />
      </>
    );
  }

  const total = d.summary.reduce((s, x) => s + x.annualImpactYen, 0);
  const resetFilters = () => {
    setType('all');
    setQuery('');
    setOnlyOngoing(false);
    setShown(PAGE);
  };
  const wholeCustomers = d.customers.filter((c) => c.wholeCustomer);
  const kinds = loaded.kinds;
  const counts = Object.entries(d.statusCounts).filter(([, n]) => n > 0) as [LineStatus, number][];

  const exportCsv = () => {
    const rows = d.findings.map((f) => [
      f.id,
      LEAK_LABEL_JA[f.type],
      f.cust,
      f.custName,
      f.sku,
      f.itemName,
      f.firstDate,
      f.lastDate,
      f.ongoing ? '続いている' : '解消済み',
      f.lines,
      f.linesInWindow,
      f.annualImpactYen,
      f.shortfallTotalYen,
      f.explanation.join(' '),
    ]);
    const csv = toCsv(
      [
        'ID',
        '種類',
        '得意先コード',
        '得意先名',
        '商品コード',
        '商品名',
        '最初の日付',
        '最後の日付',
        '状態',
        '行数',
        '直近12か月の行数',
        '直近12か月の影響額(円)',
        '全期間の不足額(円)',
        '説明',
      ],
      rows,
      { bom: true, eol: '\r\n', quoteAll: false },
    );
    downloadFile(`利益漏れ診断_${toCompactDate(d.window.end)}.csv`, csv, 'text/csv;charset=utf-8');
  };

  return (
    <>
      <PageHeader
        step={2}
        title="診断（利益漏れ）"
        lead={
          <p>
            売上明細の1行ごとに、取り決めどおりの単価（期間内の特値、または 定価 ×
            掛率）と比べました。影響額は直近12か月（
            {warekiRange(d.window.start, d.window.end)}）の実際の不足額で、予測ではありません。
          </p>
        }
        actions={
          <button type="button" className="btn" onClick={exportCsv}>
            <Icon name="download" /> 診断結果をCSVで保存
          </button>
        }
      />

      {!kinds.has('agreements') && (
        <Notice tone="warning" title="前回改定の合意状況が読み込まれていません">
          <p>
            見送り・据え置き・適用日前の正しい旧価格も「反映漏れ」として表示されます。合意状況のファイルを読み込むと正しく見分けられます。
          </p>
        </Notice>
      )}
      {!kinds.has('specials') && (
        <Notice tone="warning" title="特値一覧が読み込まれていません">
          <p>期間内の特値も「掛率ランク外」として表示され、期限切れの特値は見つけられません。</p>
        </Notice>
      )}
      {!kinds.has('listPriceHistory') && (
        <Notice tone="warning" title="定価の履歴が読み込まれていません">
          <p>定価改定の前後を比べられないため、「反映漏れ」は判定していません。</p>
        </Notice>
      )}

      <section className="card hero-card" aria-labelledby="leak-total">
        <div className="hero">
          <h2 id="leak-total" className="hero-label">
            直近12か月の利益漏れ（4種類の合計）
          </h2>
          <p className="hero-value" data-testid="leak-total">
            {yen(total)}
          </p>
          <p className="hero-sub">
            同じ期間の売上 {yen(d.salesInWindowYen)} の {ratio(total, d.salesInWindowYen, 2)}・得意先×商品{' '}
            {num(d.findings.length)}組
          </p>
        </div>
        <BarList
          caption="種類ごとの年間影響額"
          max={Math.max(1, ...d.summary.map((s) => s.annualImpactYen))}
          rows={d.summary.map((s) => ({
            key: s.type,
            label: s.label,
            value: s.annualImpactYen,
            display: yen(s.annualImpactYen),
            sub: `${num(s.pairs)}組・${num(s.customers)}社・続いている ${num(s.ongoingPairs)}組`,
          }))}
        />
        <p className="small muted">
          粗利下限割れは請求ミスではなく、粗利率の下限（{loaded.ws.dataset.settings.marginFloorBp / 100}
          %）を満たす単価との差です。1行に複数の問題があるときは、反映漏れ → 特値の期限切れ → 掛率ランク外 →
          粗利下限割れ の順で1つに数えています。
        </p>
        <div className="next-step">
          <p className="small">
            請求ミス（反映漏れ・特値の期限切れ・掛率ランク外）は、取り決めどおりの単価に直すものです。原価の上昇分は、次のシナリオで値上げとして申し入れます。提案画面では、請求ミスの可能性がある品目に印が付きます。
          </p>
          <a className="btn btn-primary" href={href('scenario')}>
            次へ：値上げのシナリオを作る <Icon name="arrow" />
          </a>
        </div>
      </section>

      {d.overcharges.lines > 0 && (
        <Notice tone="info" title="取り決めより高く請求している行があります（利益漏れには含めていません）">
          <p>
            {num(d.overcharges.lines)}行（{num(d.overcharges.pairs)}組・{num(d.overcharges.customers)}
            社）、直近12か月で
            {yen(d.overcharges.amountInWindowYen)}
            多く請求しています。定価の値下げが反映されていない、またはランクの上限を超えた単価の可能性があります。得意先への過大な請求になっていないか確認してください。下の「全行の判定の内訳」の「基準より高い請求」の行です。
          </p>
        </Notice>
      )}

      {wholeCustomers.length > 0 && (
        <Card title="得意先単位で起きている可能性があるもの">
          <p className="small muted">
            その得意先の対象品目のほとんどで同じ問題が出ています。1品目ずつではなく、得意先マスタや得意先単価の登録をまとめて確認してください。
          </p>
          <ul className="callout-list">
            {wholeCustomers.map((c) => (
              <li key={`${c.cust}-${c.type}`}>
                <strong>{c.custName}</strong>（{c.cust}）：{LEAK_LABEL_JA[c.type]}が {num(c.eligiblePairs)}
                品目中 {num(c.affectedPairs)}品目（{warekiRange(c.firstDate, c.lastDate)}）・直近12か月{' '}
                {yen(c.annualImpactYen)}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="見つかった漏れ（得意先×商品ごと）">
        <div className="filters">
          <fieldset className="segmented">
            <legend className="visually-hidden">種類で絞り込む</legend>
            {(['all', ...LEAK_TYPES] as const).map((t) => (
              <label key={t} className={type === t ? 'is-on' : ''}>
                <input
                  type="radio"
                  name="leak-type"
                  value={t}
                  checked={type === t}
                  onChange={() => {
                    setType(t);
                    setShown(PAGE);
                  }}
                />
                {t === 'all' ? 'すべて' : LEAK_LABEL_JA[t]}（
                {num(t === 'all' ? d.findings.length : d.findings.filter((f) => f.type === t).length)}）
              </label>
            ))}
          </fieldset>
          <label className="field field-inline">
            <span>検索</span>
            <input
              type="search"
              placeholder="得意先・商品・ID"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShown(PAGE);
              }}
            />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={onlyOngoing} onChange={(e) => setOnlyOngoing(e.target.checked)} />
            続いているものだけ
          </label>
        </div>
        {type !== 'all' && <p className="small muted">{TYPE_HELP[type]}</p>}
        <div className="table-wrap">
          <table className="table findings">
            <caption className="visually-hidden">見つかった漏れの一覧（年間影響額の大きい順）</caption>
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">種類</th>
                <th scope="col">得意先</th>
                <th scope="col">商品</th>
                <th scope="col">期間</th>
                <th scope="col">状態</th>
                <th scope="col" className="num">
                  行数
                </th>
                <th scope="col" className="num">
                  年間影響額
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-row">
                    <span>条件に合う漏れはありません。</span>{' '}
                    <button type="button" className="btn btn-small" onClick={resetFilters}>
                      絞り込みを解除
                    </button>
                  </td>
                </tr>
              )}
              {filtered.slice(0, shown).map((f) => (
                <Fragment key={f.id}>
                  <tr className={open === f.id ? 'is-open' : ''}>
                    <td className="nowrap">
                      <button
                        type="button"
                        className="link-button"
                        aria-expanded={open === f.id}
                        aria-controls={`detail-${f.id}`}
                        onClick={() => setOpen(open === f.id ? null : f.id)}
                      >
                        {f.id}
                      </button>
                    </td>
                    <td>
                      <span className="type-badge" title={LEAK_LABEL_JA[f.type]}>
                        {LEAK_SHORT_JA[f.type]}
                      </span>
                    </td>
                    <td>
                      {f.custName}
                      <span className="muted small block">{f.cust}</span>
                    </td>
                    <td>
                      {f.itemName}
                      <span className="muted small block">{f.sku}</span>
                    </td>
                    <td className="nowrap small">
                      {wareki(f.firstDate)}
                      <br />〜{wareki(f.lastDate)}
                    </td>
                    <td>{f.ongoing ? <Badge tone="warning">続いている</Badge> : <Badge>解消済み</Badge>}</td>
                    <td className="num">{num(f.lines)}</td>
                    <td className="num">{yen(f.annualImpactYen)}</td>
                  </tr>
                  {open === f.id && (
                    <tr className="detail-row" id={`detail-${f.id}`}>
                      <td colSpan={8}>
                        <FindingDetail f={f} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          {num(filtered.length)}件中 {num(Math.min(shown, filtered.length))}件を表示
        </p>
        {shown < filtered.length && (
          <button type="button" className="btn" onClick={() => setShown(shown + PAGE)}>
            さらに{Math.min(PAGE, filtered.length - shown)}件表示
          </button>
        )}
      </Card>

      <Card title="全行の判定の内訳">
        <div className="table-wrap status-table">
          <table className="table compact">
            <thead>
              <tr>
                <th scope="col">判定</th>
                <th scope="col" className="num">
                  行数
                </th>
              </tr>
            </thead>
            <tbody>
              {counts.map(([s, n]) => (
                <tr key={s}>
                  <td>{LINE_STATUS_JA[s]}</td>
                  <td className="num">{num(n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.statusCounts.price_mismatch > 0 && (
          <p className="small muted">
            「価格差（原因不明・要確認）」は、取り決めの単価より安いのに、旧定価・期限切れの特値・掛率ランク外のどれにも当てはまらない行です。担当者が個別に確認してください。
          </p>
        )}
      </Card>
    </>
  );
}

function FindingDetail({ f }: { f: Finding }) {
  const { loaded } = useApp();
  const lines = f.lineIds
    .map((id) => loaded?.lineById.get(id))
    .filter((x) => x !== undefined)
    .reverse();
  return (
    <div className="finding-detail">
      <h3 className="h3">根拠</h3>
      <ul className="explain">
        {f.explanation.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <div className="table-wrap scroll-y">
        <table className="table compact">
          <caption className="visually-hidden">該当する売上明細（新しい順）</caption>
          <thead>
            <tr>
              <th scope="col">売上日</th>
              <th scope="col">伝票番号-行</th>
              <th scope="col" className="num">
                数量
              </th>
              <th scope="col" className="num">
                請求単価
              </th>
              <th scope="col" className="num">
                基準単価
              </th>
              <th scope="col" className="num">
                不足額
              </th>
              <th scope="col" className="num">
                元ファイルの行
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.line.id}>
                <td className="nowrap">{wareki(l.line.date)}</td>
                <td>{l.line.id}</td>
                <td className="num">{num(l.line.qty)}</td>
                <td className="num">{yen(l.line.unitPrice)}</td>
                <td className="num">{l.expected ? yen(l.expected.price) : '—'}</td>
                <td className="num">{yen(l.shortfallYen)}</td>
                <td className="num">{l.line.sourceRow}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
