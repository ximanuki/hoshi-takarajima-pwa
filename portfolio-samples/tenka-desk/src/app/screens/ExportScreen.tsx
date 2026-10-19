import { useState } from 'react';
import { exportPriceMaster, UnmappableCharacterError } from '../../engine/index.ts';
import { DropZone } from '../components/DropZone.tsx';
import { Card, downloadFile, Icon, Kpi, NeedsData, Notice, PageHeader } from '../components/ui.tsx';
import { num, wareki, yen } from '../format.ts';
import { useApp } from '../model/AppState.tsx';
import { usePriceMaster } from '../model/outputs.ts';
import type { ExportSettings } from '../model/settings.ts';
import { href } from '../router.ts';
import { fetchSample, SAMPLE_OUTCOMES } from '../sample.ts';

const CURRENT_PRICE_LABEL: Record<ExportSettings['currentPrice'], string> = {
  system: '販売管理の今の単価',
  expected: '取り決めどおりの単価',
  last_billed: '最後に請求した単価',
};

const CURRENT_PRICE_HELP: Record<ExportSettings['currentPrice'], string> = {
  system:
    '販売管理が今請求している単価（請求ミスが続いている組は、その請求単価）。反映チェックで旧単価のままの請求を見つけるのに使います。',
  expected: '取り決めどおりの今の単価（特値、または 定価 × 掛率）。',
  last_billed: '売上明細で最後に請求した単価。',
};

export function ExportScreen() {
  const app = useApp();
  const { loaded, proposal, settings } = app;
  const master = usePriceMaster();
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [saveProblem, setSaveProblem] = useState<{ layout: 'A' | 'B'; characters: string[] } | null>(null);
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
  const custsByDate = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = custsByDate.get(r.effective) ?? new Set<string>();
    set.add(r.cust);
    custsByDate.set(r.effective, set);
  }
  const effs = [...custsByDate.keys()].sort();
  const agreedOutcomes = [...master.outcomes.values()].filter((o) => o.agreed);
  const partial = agreedOutcomes.filter((o) => o.partial).length;
  const full = agreedOutcomes.length - partial;
  const yearly = rows.reduce((s, r) => {
    const p = proposal.pairByKey.get(`${r.cust}|${r.sku}`);
    return s + (p ? (r.newPrice - p.currentPrice) * p.qty : 0);
  }, 0);

  const save = (layout: 'A' | 'B', onUnmappable: 'error' | 'replace' = 'error', encoding = opts.encoding) => {
    try {
      const out = exportPriceMaster(ds, rows, layout, { encoding, onUnmappable });
      downloadFile(
        out.fileName,
        out.bytes,
        `text/csv;charset=${encoding === 'shift_jis' ? 'shift_jis' : 'utf-8'}`,
      );
      setSaveProblem(null);
    } catch (e) {
      if (e instanceof UnmappableCharacterError) setSaveProblem({ layout, characters: e.characters });
      else setSampleError(e instanceof Error ? e.message : String(e));
    }
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
      <Card title="新単価マスタ">
        <div className="kpi-row">
          <Kpi label="行数（得意先×商品）" value={num(rows.length)} />
          <Kpi
            label="得意先"
            value={`${num(customers)}社`}
            sub={`合意 ${num(full)}社・一部合意 ${num(partial)}社`}
          />
          <Kpi
            label="適用開始日"
            value={effs.length > 0 ? wareki(effs[0]) : '—'}
            sub={
              effs.length > 0
                ? effs.map((d) => `${wareki(d)}（${num(custsByDate.get(d)?.size ?? 0)}社）`).join('・')
                : undefined
            }
          />
          <Kpi label="値上げ額（年間・直近12か月の数量）" value={yen(yearly)} emphasis />
        </div>
        <div className="button-row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={rows.length === 0}
            onClick={() => save('A')}
          >
            <Icon name="download" /> 販売管理A形式で保存
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={rows.length === 0}
            onClick={() => save('B')}
          >
            <Icon name="download" /> 販売管理B形式で保存
          </button>
          <span className="small muted">
            文字コード：{opts.encoding === 'shift_jis' ? 'Shift_JIS' : 'UTF-8'}・現単価：
            {CURRENT_PRICE_LABEL[opts.currentPrice]}（下の「書き出しの設定」で変えられます）
          </span>
        </div>
        {master.error && (
          <Notice tone="critical" title="協議結果のファイルを直すまで、保存できません">
            <p>理由は、下の「どの合意を使うか」に出しています。</p>
          </Notice>
        )}
        {saveProblem && (
          <Notice tone="warning" title="Shift_JIS で表せない文字があるため、保存していません">
            <p>
              表せない文字：<strong>{saveProblem.characters.join('　')}</strong>
              （商品名・得意先名に含まれています）。UTF-8で保存するか、その文字を「?」に置き換えて Shift_JIS
              で保存できます。
            </p>
            <div className="button-row">
              <button
                type="button"
                className="btn btn-small"
                onClick={() => save(saveProblem.layout, 'error', 'utf-8')}
              >
                UTF-8で保存
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => save(saveProblem.layout, 'replace')}
              >
                「?」に置き換えて Shift_JIS で保存
              </button>
            </div>
          </Notice>
        )}
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
        {rows.length > 100 && (
          <p className="small muted">先頭100行を表示しています（全{num(rows.length)}行）。</p>
        )}
        {rows.length > 0 && (
          <p className="button-row">
            <a className="btn" href={href('followup')}>
              反映チェックへ <Icon name="arrow" />
            </a>
          </p>
        )}
      </Card>

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
            {app.outcomesFile && (
              <p className="small">読み込んだファイル：{app.outcomesFile.name.replace(/^.*\//, '')}</p>
            )}
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
        {opts.outcomeSource === 'file' && master.interpreted.length > 0 && (
          <Notice
            tone="warning"
            title={`協議結果の書き方から判断した行が ${num(master.interpreted.length)}件あります`}
          >
            <p className="small">
              決まった言葉（合意・一部合意・協議中・見送り
              など）以外の書き方は、次のように読みました。合意していない得意先は新単価マスタに入れていません。違う場合はファイルの表記を直してください。
            </p>
            <ul className="small">
              {master.interpreted.slice(0, 20).map((x) => (
                <li key={x}>{x}</li>
              ))}
              {master.interpreted.length > 20 && <li>ほか {num(master.interpreted.length - 20)}件</li>}
            </ul>
          </Notice>
        )}
        {sampleError && (
          <Notice tone="critical" title="読み込めません">
            <p>{sampleError}</p>
          </Notice>
        )}
        {master.error && (
          <Notice tone="critical" title="協議結果を読めません">
            <p>{master.error}</p>
            {master.problems.length > 0 && (
              <>
                <p className="small">
                  このまま書き出すと、新単価マスタが協議結果と合わなくなる（読めない行や適用日が未定の得意先が抜ける、据え置くはずのカテゴリが新単価になる）ため、書き出していません。ファイルを直して読み込み直すか、上の「交渉の記録」を選んでください。
                </p>
                <ul className="small">
                  {master.problems.slice(0, 20).map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                  {master.problems.length > 20 && <li>ほか {num(master.problems.length - 20)}件</li>}
                </ul>
              </>
            )}
          </Notice>
        )}
        {opts.outcomeSource === 'logs' && agreedOutcomes.length === 0 && (
          <Notice tone="info" title="まだ合意した得意先がありません">
            <p>
              <a href={href('negotiation')}>交渉の記録</a>
              で「合意」または「一部合意」を記録すると、ここに出てきます。
            </p>
          </Notice>
        )}
      </Card>

      <details className="card details">
        <summary>書き出しの設定（おすすめの設定になっています）</summary>
        <div className="grid-2">
          <fieldset className="radio-group">
            <legend>「現単価」の列</legend>
            {(['system', 'expected', 'last_billed'] as const).map((k) => (
              <label key={k} className="radio">
                <input
                  type="radio"
                  name="current-price"
                  checked={opts.currentPrice === k}
                  onChange={() => setOpts({ currentPrice: k })}
                />
                <span>
                  {CURRENT_PRICE_LABEL[k]}
                  {k === 'system' && '（おすすめ）'}
                  <span className="block small muted">{CURRENT_PRICE_HELP[k]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset className="radio-group">
            <legend>文字コード</legend>
            <label className="radio">
              <input
                type="radio"
                name="enc"
                checked={opts.encoding === 'utf-8'}
                onChange={() => setOpts({ encoding: 'utf-8' })}
              />
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
      </details>
    </>
  );
}
