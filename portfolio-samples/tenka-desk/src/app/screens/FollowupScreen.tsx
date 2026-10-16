import { useMemo, useState } from 'react';
import {
  checkFollowup,
  FOLLOWUP_STATUS_JA,
  type FollowupResult,
  type FollowupStatus,
  type PriceMasterRow,
  toCompactDate,
  toCsv,
} from '../../engine/index.ts';
import { DropZone } from '../components/DropZone.tsx';
import { Card, downloadFile, Icon, Kpi, NeedsData, Notice, PageHeader } from '../components/ui.tsx';
import { num, todayJst, wareki, warekiRange, yen } from '../format.ts';
import { useApp } from '../model/AppState.tsx';
import { readPriceMasterFile, readSalesFile, usePriceMaster } from '../model/outputs.ts';
import { href } from '../router.ts';
import { fetchSample, sampleFollowupNames } from '../sample.ts';

const PAGE = 100;

export function FollowupScreen() {
  const app = useApp();
  const { loaded, followup } = app;
  const built = usePriceMaster();
  const [shown, setShown] = useState(PAGE);
  const [showOther, setShowOther] = useState(true);
  const [sampleError, setSampleError] = useState<string | null>(null);

  const ds = loaded?.ws.dataset;
  const computed = useMemo(():
    | { ok: true; result: FollowupResult; master: PriceMasterRow[]; salesIssues: number }
    | { ok: false; error: string }
    | null => {
    if (!ds || !followup.salesFile) return null;
    try {
      const master =
        followup.masterSource === 'file' && followup.masterFile
          ? readPriceMasterFile(followup.masterFile)
          : built.rows;
      if (master.length === 0) return { ok: false, error: '新単価マスタが空です。' };
      const sales = readSalesFile(followup.salesFile);
      const result = checkFollowup(ds, master, ds.resolveLines(sales.lines));
      return { ok: true, result, master, salesIssues: sales.issues };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [ds, followup, built.rows]);

  if (!loaded || !ds || ds.customers.size === 0) {
    return (
      <>
        <PageHeader step={8} title="反映チェック" />
        <NeedsData what="得意先マスタと商品マスタ" />
      </>
    );
  }

  const trySample = async () => {
    setSampleError(null);
    try {
      const names = sampleFollowupNames('A');
      const [master, sales] = await Promise.all([fetchSample(names.master), fetchSample(names.sales)]);
      app.setFollowup({
        masterSource: 'file',
        masterFile: { name: names.master, bytes: master },
        salesFile: { name: names.sales, bytes: sales },
      });
    } catch (e) {
      setSampleError(e instanceof Error ? e.message : String(e));
    }
  };

  const flagged =
    computed?.ok === true
      ? computed.result.lines.filter(
          (x) => x.status === 'still_old_price' || (showOther && x.status === 'other_diff'),
        )
      : [];

  const exportCsv = () => {
    if (!computed?.ok) return;
    const rows = computed.result.lines
      .filter((x) => x.status === 'still_old_price' || x.status === 'other_diff')
      .map((x) => [
        x.line.date,
        x.line.id,
        x.line.cust,
        ds.customers.get(x.line.cust)?.name ?? x.line.custName,
        x.line.sku ?? x.line.rawSku,
        x.line.itemName,
        x.line.qty,
        x.line.unitPrice,
        x.expected ?? '',
        x.shortfallYen,
        FOLLOWUP_STATUS_JA[x.status],
        x.explanation,
      ]);
    const csv = toCsv(
      [
        '売上日',
        '伝票番号-行',
        '得意先コード',
        '得意先名',
        '商品コード',
        '商品名',
        '数量',
        '請求単価',
        '新単価マスタの単価',
        '不足額',
        '判定',
        '説明',
      ],
      rows,
      { bom: true, eol: '\r\n', quoteAll: false },
    );
    downloadFile(`反映チェック_${toCompactDate(todayJst())}.csv`, csv, 'text/csv;charset=utf-8');
  };

  const r = computed?.ok ? computed.result : null;
  const counts = r ? (Object.entries(r.counts).filter(([, n]) => n > 0) as [FollowupStatus, number][]) : [];
  const period =
    r && r.lines.length > 0
      ? r.lines.reduce(
          (p, x) => ({
            first: x.line.date < p.first ? x.line.date : p.first,
            last: x.line.date > p.last ? x.line.date : p.last,
          }),
          { first: r.lines[0]?.line.date ?? '', last: r.lines[0]?.line.date ?? '' },
        )
      : null;

  return (
    <>
      <PageHeader
        step={8}
        title="反映チェック"
        lead={
          <p>
            新しい単価に切り替えた後の売上明細を読み込み、適用開始日を過ぎても旧単価のまま請求している行を探します。
          </p>
        }
        actions={
          r && (
            <button type="button" className="btn" onClick={exportCsv}>
              <Icon name="download" /> 結果をCSVで保存
            </button>
          )
        }
      />
      <div className="grid-2">
        <Card title="1. 新単価マスタ">
          <fieldset className="radio-group">
            <legend className="visually-hidden">新単価マスタの出どころ</legend>
            <label className="radio">
              <input
                type="radio"
                name="master-src"
                checked={followup.masterSource === 'built'}
                onChange={() => app.setFollowup({ ...followup, masterSource: 'built' })}
              />
              書き出しで作った新単価マスタ（{num(built.rows.length)}行）
            </label>
            <label className="radio">
              <input
                type="radio"
                name="master-src"
                checked={followup.masterSource === 'file'}
                disabled={followup.masterFile === null}
                onChange={() => app.setFollowup({ ...followup, masterSource: 'file' })}
              />
              ファイル：{followup.masterFile?.name ?? '（下から読み込んでください）'}
            </label>
          </fieldset>
          <DropZone
            multiple={false}
            label="新単価マスタのCSVをドロップ"
            hint="得意先別単価マスタ（A形式・B形式）"
            onFiles={(files) => {
              const f = files[0];
              if (f) app.setFollowup({ ...followup, masterSource: 'file', masterFile: f });
            }}
          />
          {built.rows.length === 0 && followup.masterSource === 'built' && (
            <p className="small muted">
              <a href={href('export')}>書き出し</a>で新単価マスタを作るか、ファイルを読み込んでください。
            </p>
          )}
        </Card>
        <Card title="2. 切り替え後の売上明細">
          {followup.salesFile && <p className="small">読み込み中：{followup.salesFile.name}</p>}
          <DropZone
            multiple={false}
            label="売上明細のCSVをドロップ"
            hint="販売管理A形式・B形式"
            onFiles={(files) => {
              const f = files[0];
              if (f) app.setFollowup({ ...followup, salesFile: f });
            }}
          />
          {loaded.isSample && (
            <div className="form-block">
              <button type="button" className="btn btn-primary" onClick={trySample}>
                サンプル（令和8年12月分・架空）で試す
              </button>
              <p className="small muted">
                デモ用の新単価マスタ（令和8年12月1日適用）と、12月分の売上明細2,770行（どちらも架空）を読み込みます。
              </p>
            </div>
          )}
          {sampleError && (
            <Notice tone="critical">
              <p>{sampleError}</p>
            </Notice>
          )}
        </Card>
      </div>

      {computed && !computed.ok && (
        <Notice tone="critical" title="チェックできません">
          <p>{computed.error}</p>
        </Notice>
      )}

      {r && computed?.ok && (
        <>
          <Card title="結果">
            <p className="small muted">
              売上明細 {num(r.lines.length)}行{period ? `（${warekiRange(period.first, period.last)}）` : ''}
              ・新単価マスタ {num(computed.master.length)}行で確認しました。
              {computed.salesIssues > 0 && ` 読めなかった行が${num(computed.salesIssues)}行あります。`}
            </p>
            <div className="kpi-row">
              <Kpi
                label="旧単価のまま"
                value={`${num(r.stillOld.lines)}行`}
                sub={`${num(r.stillOld.pairs)}組・${num(r.stillOld.customers)}社`}
                emphasis
              />
              <Kpi label="不足額" value={yen(r.stillOld.shortfallYen)} sub="新単価との差 × 数量" />
              <Kpi label="新単価で請求" value={`${num(r.counts.ok_new_price)}行`} />
              <Kpi label="その他の差異（要確認）" value={`${num(r.counts.other_diff)}行`} />
            </div>
            <details className="details">
              <summary>判定の内訳</summary>
              <table className="table compact">
                <tbody>
                  {counts.map(([s, n]) => (
                    <tr key={s}>
                      <th scope="row">{FOLLOWUP_STATUS_JA[s]}</th>
                      <td className="num">{num(n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </Card>

          {r.byCustomer.length > 0 && (
            <Card title="得意先ごと（旧単価のまま）">
              <div className="table-wrap">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th scope="col">得意先</th>
                      <th scope="col" className="num">
                        行
                      </th>
                      <th scope="col" className="num">
                        品目
                      </th>
                      <th scope="col">期間</th>
                      <th scope="col" className="num">
                        不足額
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.byCustomer.map((c) => (
                      <tr key={c.cust}>
                        <td>
                          {c.custName}
                          <span className="muted small block">{c.cust}</span>
                        </td>
                        <td className="num">{num(c.lines)}</td>
                        <td className="num">{num(c.pairs)}</td>
                        <td className="nowrap small">{warekiRange(c.firstDate, c.lastDate)}</td>
                        <td className="num">{yen(c.shortfallYen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card title="確認が必要な行">
            <label className="checkbox">
              <input type="checkbox" checked={showOther} onChange={(e) => setShowOther(e.target.checked)} />
              「その他の差異」も表示する
            </label>
            {flagged.length === 0 ? (
              <Notice tone="good" title="旧単価のままの請求は見つかりませんでした" />
            ) : (
              <div className="table-wrap">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th scope="col">売上日</th>
                      <th scope="col">得意先</th>
                      <th scope="col">商品</th>
                      <th scope="col" className="num">
                        数量
                      </th>
                      <th scope="col" className="num">
                        請求単価
                      </th>
                      <th scope="col" className="num">
                        新単価
                      </th>
                      <th scope="col" className="num">
                        不足額
                      </th>
                      <th scope="col">説明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flagged.slice(0, shown).map((x) => (
                      <tr key={x.line.id}>
                        <td className="nowrap">{wareki(x.line.date)}</td>
                        <td>
                          {ds.customers.get(x.line.cust)?.name ?? x.line.custName}
                          <span className="muted small block">{x.line.id}</span>
                        </td>
                        <td>
                          {x.line.sku
                            ? (ds.products.get(x.line.sku)?.name ?? x.line.itemName)
                            : x.line.itemName}
                          <span className="muted small block">{x.line.sku ?? x.line.rawSku}</span>
                        </td>
                        <td className="num">{num(x.line.qty)}</td>
                        <td className="num">{yen(x.line.unitPrice)}</td>
                        <td className="num">{x.expected !== null ? yen(x.expected) : '—'}</td>
                        <td className="num">{yen(x.shortfallYen)}</td>
                        <td className="small">{x.explanation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {shown < flagged.length && (
              <button type="button" className="btn" onClick={() => setShown(shown + PAGE)}>
                さらに表示（残り{num(flagged.length - shown)}行）
              </button>
            )}
          </Card>
        </>
      )}
    </>
  );
}
