import { useState } from 'react';
import { exportPriceMaster } from '../../engine/index.ts';
import { DropZone } from '../components/DropZone.tsx';
import { Card, downloadFile, Icon, Kpi, NeedsData, Notice, PageHeader } from '../components/ui.tsx';
import { num, wareki, yen } from '../format.ts';
import { useApp } from '../model/AppState.tsx';
import { usePriceMaster } from '../model/outputs.ts';
import type { ExportSettings } from '../model/settings.ts';
import { href } from '../router.ts';
import { fetchSample, SAMPLE_OUTCOMES } from '../sample.ts';

const CURRENT_PRICE_HELP: Record<ExportSettings['currentPrice'], string> = {
  system: '販売管理が今請求している単価（請求ミスが続いている組は、その請求単価）。反映チェックで旧単価のままの請求を見つけるのに使います。',
  expected: '取り決めどおりの今の単価（特値、または 定価 × 掛率）。',
  last_billed: '売上明細で最後に請求した単価。',
};

export function ExportScreen() {
  const app = useApp();
  const { loaded, proposal, settings } = app;
  const master = usePriceMaster();
  const [sampleError, setSampleError] = useState<string | null>(null);
  const opts = settings.exportOpts;
  if (!loaded?.diagnosis || !proposal?.ok) {
    return (
      <>
        <PageHeader step={7} title="書き出し（新単価マスタ）" />
        <NeedsData />
      </>
    );
  }
  const ds = loaded.ws.dataset;
  const setOpts = (patch: Partial<ExportSettings>) =>
    app.updateSettings((s) => ({ ...s, exportOpts: { ...s.exportOpts, ...patch } }));
  const rows = master.rows;
  const customers = new Set(rows.map((r) => r.cust)).size;
  const effs = [...new Set(rows.map((r) => r.effective))].sort();
  const agreed = [...master.outcomes.values()].filter((o) => o.agreed).length;
  const yearly = rows.reduce((s, r) => {
    const p = proposal.pairByKey.get(`${r.cust}|${r.sku}`);
    return s + (p ? (r.newPrice - p.currentPrice) * p.qty : 0);
  }, 0);

  const save = (layout: 'A' | 'B') => {
    const out = exportPriceMaster(ds, rows, layout, { encoding: opts.encoding });
    downloadFile(out.fileName, out.bytes, `text/csv;charset=${opts.encoding === 'shift_jis' ? 'shift_jis' : 'utf-8'}`);
  };

  const useSampleOutcomes = async () => {
    try {
      const bytes = await fetchSample(SAMPLE_OUTCOMES);
      app.setOutcomesFile({ name: SAMPLE_OUTCOMES, bytes });
      setOpts({ outcomeSource: 'file' });
    } catch (e) {
      setSampleError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <PageHeader
        step={7}
        title="書き出し（新単価マスタ）"
        lead={
          <p>
            合意した得意先の新しい単価を、適用開始日つきの「得意先別単価マスタ」として書き出します。販売管理A形式・B形式のどちらでも保存できます。ファイルはこのブラウザの中で作ります。
          </p>
        }
      />
      <Card title="どの合意を使うか">
        <fieldset className="radio-group">
          <legend className="visually-hidden">合意の出どころ</legend>
          <label className="radio">
            <input
              type="radio"
              name="outcome-source"
              checked={opts.outcomeSource === 'logs'}
              onChange={() => setOpts({ outcomeSource: 'logs' })}
            />
            交渉の記録で「合意」「一部合意」になっている得意先（{num(Object.keys(app.logs).length)}
            社の記録から）
          </label>
          <label className="radio">
            <input
              type="radio"
              name="outcome-source"
              checked={opts.outcomeSource === 'file'}
              onChange={() => setOpts({ outcomeSource: 'file' })}
            />
            協議結果のファイル（得意先コード・協議結果・適用日・対象外カテゴリ）
          </label>
        </fieldset>
        {opts.outcomeSource === 'file' && (
          <div className="form-block">
            {app.outcomesFile && <p className="small">読み込み中のファイル：{app.outcomesFile.name}</p>}
            <div className="grid-2">
              <DropZone
                multiple={false}
                label="協議結果のCSVをドロップ"
                onFiles={(files) => {
                  const f = files[0];
                  if (f) app.setOutcomesFile(f);
                }}
              />
              {loaded.isSample && (
                <div>
                  <button type="button" className="btn" onClick={useSampleOutcomes}>
                    サンプルの協議結果（架空）を使う
                  </button>
                  <p className="small muted">デモ用に用意した架空の協議結果（令和8年12月改定）です。</p>
                </div>
              )}
            </div>
          </div>
        )}
        {sampleError && (
          <Notice tone="critical" title="サンプルを読み込めません">
            <p>{sampleError}</p>
          </Notice>
        )}
        {master.error && (
          <Notice tone="critical" title="協議結果を読めません">
            <p>{master.error}</p>
          </Notice>
        )}
        {opts.outcomeSource === 'logs' && agreed === 0 && (
          <Notice tone="info" title="まだ合意した得意先がありません">
            <p>
              <a href={href('negotiation')}>交渉の記録</a>で「合意」または「一部合意」を記録すると、ここに出てきます。
            </p>
          </Notice>
        )}
      </Card>

      <Card title="書き出しの設定">
        <div className="grid-2">
          <fieldset className="radio-group">
            <legend>「現単価」の列</legend>
            {(['system', 'expected', 'last_billed'] as const).map((k) => (
              <label key={k} className="radio">
                <input type="radio" name="current-price" checked={opts.currentPrice === k} onChange={() => setOpts({ currentPrice: k })} />
                {{ system: '販売管理の今の単価（おすすめ）', expected: '取り決めどおりの単価', last_billed: '最後に請求した単価' }[k]}
                <span className="block small muted">{CURRENT_PRICE_HELP[k]}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="radio-group">
            <legend>文字コード</legend>
            <label className="radio">
              <input type="radio" name="enc" checked={opts.encoding === 'utf-8'} onChange={() => setOpts({ encoding: 'utf-8' })} />
              UTF-8（A形式はBOM付き）
            </label>
            <label className="radio">
              <input
                type="radio"
                name="enc"
                checked={opts.encoding === 'shift_jis'}
                onChange={() => setOpts({ encoding: 'shift_jis' })}
              />
              Shift_JIS（Windows の Excel や古い販売管理向け）
            </label>
          </fieldset>
        </div>
      </Card>

      <Card title="新単価マスタ">
        <div className="kpi-row">
          <Kpi label="行数（得意先×商品）" value={num(rows.length)} />
          <Kpi label="得意先" value={`${num(customers)}社`} sub={`合意 ${num(agreed)}社`} />
          <Kpi label="適用開始日" value={effs.length > 0 ? effs.map((d) => wareki(d)).join('、') : '—'} />
          <Kpi label="値上げ額（年間・直近12か月の数量）" value={yen(yearly)} />
        </div>
        <div className="button-row">
          <button type="button" className="btn btn-primary" disabled={rows.length === 0} onClick={() => save('A')}>
            <Icon name="download" /> 販売管理A形式で保存
          </button>
          <button type="button" className="btn btn-primary" disabled={rows.length === 0} onClick={() => save('B')}>
            <Icon name="download" /> 販売管理B形式で保存
          </button>
        </div>
        <p className="small muted">
          A形式：全角コード・和暦（R08/12/01）・3桁区切り・CRLF。B形式：半角コード・20261201・区切りなし・LF。取り込む前に、販売管理側で内容を確認してください。
        </p>
        {rows.length > 0 && (
          <div className="table-wrap scroll-y">
            <table className="table compact">
              <caption className="visually-hidden">新単価マスタの先頭100行</caption>
              <thead>
                <tr>
                  <th scope="col">得意先</th>
                  <th scope="col">商品</th>
                  <th scope="col">適用開始日</th>
                  <th scope="col" className="num">
                    新単価
                  </th>
                  <th scope="col" className="num">
                    現単価
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((r) => (
                  <tr key={`${r.cust}|${r.sku}`}>
                    <td>
                      {ds.customers.get(r.cust)?.name ?? r.cust}
                      <span className="muted small block">{r.cust}</span>
                    </td>
                    <td>
                      {r.sku ? (ds.products.get(r.sku)?.name ?? r.sku) : r.rawSku}
                      <span className="muted small block">{r.sku}</span>
                    </td>
                    <td className="nowrap">{wareki(r.effective)}</td>
                    <td className="num">{yen(r.newPrice)}</td>
                    <td className="num">{yen(r.currentPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 100 && <p className="small muted">先頭100行を表示しています（全{num(rows.length)}行）。</p>}
        {rows.length > 0 && (
          <p className="button-row">
            <a className="btn" href={href('followup')}>
              反映チェックへ <Icon name="arrow" />
            </a>
          </p>
        )}
      </Card>
    </>
  );
}
