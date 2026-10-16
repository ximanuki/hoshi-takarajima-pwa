import { useId, useMemo, useState } from 'react';
import { type FileKind, LAYOUTS, mapColumns, toWareki } from '../../engine/index.ts';
import { DropZone } from '../components/DropZone.tsx';
import { Badge, Card, Icon, Kpi, Notice, PageHeader } from '../components/ui.tsx';
import { num, warekiRange } from '../format.ts';
import { useApp } from '../model/AppState.tsx';
import { type ColumnChoice, FILE_CHECKS, type FileInfo } from '../model/load.ts';

export function ImportScreen() {
  const app = useApp();
  const { loaded, inputs } = app;
  const [mapping, setMappingFor] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        step={1}
        title="取り込み"
        lead={
          <p>
            販売管理システムから書き出した売上明細とマスタを読み込みます。ファイルはこのブラウザの中だけで読み、外部には送信しません。
          </p>
        }
      />

      <div className="grid-2">
        <Card title="サンプルデータで試す（架空）">
          <p>
            架空の卸売会社「架空商事株式会社」の得意先300社・商品2,000点・売上明細2年分（約5.6万行）です。会社名・得意先名・取引はすべて作り物で、実在の企業とは関係ありません。
          </p>
          <div className="button-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => app.loadSample('A')}
              disabled={app.busy !== null}
            >
              サンプルデータで試す（A形式）
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => app.loadSample('B')}
              disabled={app.busy !== null}
            >
              B形式で試す
            </button>
          </div>
          <p className="muted small">
            A形式は全角の商品コードと和暦の日付、B形式は半角カナと品番の書きゆれ入りです。中身は同じで、どちらを読んでも同じ結果になります。
          </p>
        </Card>
        <Card title="自社のファイルを読み込む">
          <DropZone
            testId="file-input"
            label="CSVファイルをここにドロップ"
            hint="UTF-8・Shift_JIS のどちらでも読めます。列の見出しから、売上明細・得意先マスタ・特値一覧などの種類を判別します。"
            onFiles={(files) => app.addFiles(files)}
          />
          <p className="muted small">
            自社の販売データだけを使う前提です。他社の価格情報を読み込んだり、他社と比べたりする機能はありません。
          </p>
          {inputs?.source === 'sample' && (
            <p className="muted small">
              ファイルを読み込むと、サンプルデータは外して自社のファイルだけで計算し直します。
            </p>
          )}
        </Card>
      </div>

      {loaded && (
        <>
          <Card title="読み込んだデータ">
            <div className="kpi-row">
              <Kpi
                label="売上明細"
                value={`${num(loaded.lines.length)}行`}
                sub={loaded.period ? warekiRange(loaded.period.first, loaded.period.last) : '—'}
              />
              <Kpi label="得意先" value={`${num(loaded.ws.dataset.customers.size)}社`} />
              <Kpi label="商品" value={`${num(loaded.ws.dataset.products.size)}点`} />
              <Kpi
                label="特値"
                value={`${num([...loaded.ws.dataset.specials.values()].reduce((s, l) => s + l.length, 0))}件`}
              />
            </div>
            {loaded.isSample && (
              <p className="small">
                <Badge tone="info">サンプルデータ（架空）</Badge>{' '}
                {inputs?.source === 'sample' ? `販売管理${inputs.layout}形式` : ''}
              </p>
            )}
            {loaded.diagnosis ? (
              <p className="button-row">
                <a className="btn btn-primary" href="#/diagnosis">
                  診断を見る <Icon name="arrow" />
                </a>
              </p>
            ) : (
              <Notice tone="warning" title="まだ診断できません">
                <p>売上明細・得意先マスタ・商品マスタがそろうと診断します。</p>
              </Notice>
            )}
          </Card>

          <FileChecklist kinds={loaded.kinds} />

          <Card title="ファイル">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">ファイル</th>
                    <th scope="col">種類</th>
                    <th scope="col">文字コード</th>
                    <th scope="col" className="num">
                      行数
                    </th>
                    <th scope="col" className="num">
                      読めなかった行
                    </th>
                    {inputs?.source === 'upload' && <th scope="col">操作</th>}
                  </tr>
                </thead>
                <tbody>
                  {loaded.files.map((f) => (
                    <FileRow
                      key={f.name}
                      f={f}
                      canEdit={inputs?.source === 'upload'}
                      onRemove={() => app.removeFile(f.name)}
                      onMap={() => setMappingFor(f.name)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {mapping && (
              <ColumnMapper
                file={loaded.files.find((f) => f.name === mapping) ?? null}
                current={
                  inputs?.source === 'upload'
                    ? (inputs.files.find((f) => f.name === mapping)?.mapping ?? null)
                    : null
                }
                onApply={async (choice) => {
                  await app.setMapping(mapping, choice);
                  setMappingFor(null);
                }}
                onClose={() => setMappingFor(null)}
              />
            )}
          </Card>

          <DataNotes />
        </>
      )}
    </>
  );
}

function FileRow({
  f,
  canEdit,
  onRemove,
  onMap,
}: {
  f: FileInfo;
  canEdit: boolean;
  onRemove: () => void;
  onMap: () => void;
}) {
  return (
    <tr>
      <td>
        <span className="filename">{f.name}</span>
        {f.issueCount > 0 && (
          <details className="issues">
            <summary>読めなかった行を見る（{num(f.issueCount)}件）</summary>
            <ul>
              {f.issues.map((i) => (
                <li key={`${i.row}-${i.field ?? ''}-${i.message}`}>
                  {i.row}行目{i.field ? `「${i.field}」` : ''}：{i.message}
                  {i.value !== undefined ? `（${i.value}）` : ''}
                </li>
              ))}
              {f.issueCount > f.issues.length && <li>ほか {num(f.issueCount - f.issues.length)}件</li>}
            </ul>
          </details>
        )}
        {f.error && f.status !== 'json' && <p className="small text-critical">{f.error}</p>}
      </td>
      <td>
        {f.status === 'ok' ? (
          <>
            {f.label}
            {f.mapped && <Badge tone="info">列を指定</Badge>}
          </>
        ) : f.status === 'json' ? (
          f.label
        ) : (
          <Badge tone="critical">{f.label}</Badge>
        )}
      </td>
      <td>{f.encoding || '—'}</td>
      <td className="num">{f.status === 'ok' ? num(f.rows) : '—'}</td>
      <td className="num">{f.status === 'ok' ? num(f.issueCount) : '—'}</td>
      {canEdit && (
        <td>
          <div className="button-row tight">
            {(f.status === 'unrecognised' || f.mapped) && (
              <button type="button" className="btn btn-small" onClick={onMap}>
                列を指定
              </button>
            )}
            <button
              type="button"
              className="btn btn-small btn-ghost"
              onClick={onRemove}
              aria-label={`${f.name} を外す`}
            >
              <Icon name="trash" size={16} /> 外す
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

function FileChecklist({ kinds }: { kinds: ReadonlySet<FileKind> }) {
  const missingImportant = FILE_CHECKS.filter((c) => c.need !== 'optional' && !kinds.has(c.kind));
  return (
    <Card title="必要なファイル">
      {missingImportant.length > 0 && (
        <Notice tone="warning" title="結果に大きく影響するファイルがありません">
          <ul>
            {missingImportant.map((c) => (
              <li key={c.kind}>
                <strong>{c.label}</strong>：{c.why}
              </li>
            ))}
          </ul>
        </Notice>
      )}
      <ul className="checklist">
        {FILE_CHECKS.map((c) => {
          const has = kinds.has(c.kind);
          return (
            <li key={c.kind} className={has ? 'is-done' : ''}>
              <span className="check-mark" aria-hidden="true">
                {has ? <Icon name="check" size={16} /> : null}
              </span>
              <span>
                <strong>{c.label}</strong>{' '}
                <Badge
                  tone={c.need === 'required' ? 'critical' : c.need === 'recommended' ? 'warning' : 'neutral'}
                >
                  {c.need === 'required' ? '必須' : c.need === 'recommended' ? '推奨' : '任意'}
                </Badge>{' '}
                <span className="visually-hidden">{has ? '読み込み済み' : '未読み込み'}</span>
                <span className="muted small">{c.why}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function DataNotes() {
  const app = useApp();
  const loaded = app.loaded;
  const [floor, setFloor] = useState<string>(
    app.settings.diagnosisFloorPct === null ? '' : String(app.settings.diagnosisFloorPct),
  );
  const [dates, setDates] = useState<Record<string, string>>({});
  if (!loaded) return null;
  const ds = loaded.ws.dataset;
  const agreementFiles = loaded.files.filter((f) => f.kind === 'agreements');
  const assigned = new Map(ds.revisions.map((r) => [r.date, r]));
  return (
    <Card title="読み込みの確認">
      {loaded.ws.notes.map((n) => (
        <Notice key={n} tone="info">
          <p>{n}</p>
        </Notice>
      ))}
      {loaded.duplicateLines > 0 && (
        <Notice tone="warning">
          <p>
            同じ「伝票番号-行」の売上明細が複数のファイルに {num(loaded.duplicateLines)}
            行ありました。重複分は最初のファイルの行だけを使っています。
          </p>
        </Notice>
      )}
      {ds.issues.length > 0 && (
        <details className="issues">
          <summary>マスタの確認事項（{num(ds.issues.length)}件）</summary>
          <ul>
            {ds.issues.slice(0, 50).map((i) => (
              <li key={`${i.kind}-${i.ref}-${i.message}`}>{i.message}</li>
            ))}
          </ul>
        </details>
      )}
      {agreementFiles.length > 0 && (
        <div className="form-block">
          <h3 className="h3">定価改定の合意状況</h3>
          <p className="small muted">
            合意状況のファイルが、どの定価改定（改定日）の答えなのかを決めます。今の割り当て：
            {ds.revisions.length > 0 ? ds.revisions.map((r) => r.label).join('、') : 'なし'}
          </p>
          {agreementFiles.map((f) => {
            const current =
              app.settings.revisionDates[f.name] ??
              (agreementFiles.length === 1 && ds.revisions.length === 1 ? (ds.revisions[0]?.date ?? '') : '');
            return (
              <form
                key={f.name}
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = dates[f.name] ?? current;
                  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) app.setRevisionDate(f.name, v);
                }}
              >
                <label>
                  {f.name} の改定日
                  <input
                    type="date"
                    value={dates[f.name] ?? current}
                    onChange={(e) => setDates({ ...dates, [f.name]: e.target.value })}
                  />
                </label>
                <button type="submit" className="btn btn-small">
                  この日付で計算し直す
                </button>
                {current && assigned.has(current) && (
                  <span className="small muted">{toWareki(current)}として使用中</span>
                )}
              </form>
            );
          })}
        </div>
      )}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = floor.trim() === '' ? null : Number(floor);
          if (v === null || (Number.isFinite(v) && v >= 0 && v < 100)) app.setDiagnosisFloor(v);
        }}
      >
        <label>
          診断に使う粗利率の下限（%）
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={99}
            step={0.5}
            placeholder={String(ds.settings.marginFloorBp / 100)}
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-small">
          この下限で診断し直す
        </button>
        <span className="small muted">いまの下限：{ds.settings.marginFloorBp / 100}%</span>
      </form>
    </Card>
  );
}

function ColumnMapper({
  file,
  current,
  onApply,
  onClose,
}: {
  file: FileInfo | null;
  current: ColumnChoice | null;
  onApply: (choice: ColumnChoice | null) => void;
  onClose: () => void;
}) {
  const [specId, setSpecId] = useState<string>(current?.specId ?? LAYOUTS[0]?.id ?? 'sales-A');
  const baseId = useId();
  const spec = LAYOUTS.find((l) => l.id === specId) ?? LAYOUTS[0];
  const header = file?.header ?? [];
  const initial = useMemo(() => {
    if (!spec) return {};
    const m = mapColumns(header, spec, current?.specId === specId ? current.overrides : {});
    const out: Record<string, string> = {};
    for (const col of spec.columns) {
      const i = m.mapping[col.field] ?? -1;
      if (i >= 0) out[col.field] = header[i] ?? '';
    }
    return out;
  }, [header, spec, current, specId]);
  const [choice, setChoice] = useState<Record<string, string>>(initial);
  const [shownFor, setShownFor] = useState(specId);
  if (shownFor !== specId) {
    setShownFor(specId);
    setChoice(initial);
  }
  if (!file || !spec) return null;
  const missing = spec.columns.filter((c) => c.required && !choice[c.field]);
  return (
    <section className="mapper" aria-label={`${file.name} の列の対応`}>
      <h3 className="h3">{file.name} の列を指定する</h3>
      <p className="small muted">
        ファイルの種類を選び、それぞれの項目にファイルのどの列を使うかを選んでください。見出しの名前が違うだけなら、これで読み込めます。
      </p>
      <label className="field">
        ファイルの種類
        <select value={specId} onChange={(e) => setSpecId(e.target.value)}>
          {LAYOUTS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <div className="mapper-grid">
        {spec.columns.map((col) => (
          <div key={col.field} className="field">
            <label htmlFor={`${baseId}-${col.field}`}>
              {col.headers[0]}
              {col.required && <span className="text-critical">（必須）</span>}
            </label>
            <select
              id={`${baseId}-${col.field}`}
              value={choice[col.field] ?? ''}
              onChange={(e) => setChoice({ ...choice, [col.field]: e.target.value })}
            >
              <option value="">（使わない）</option>
              {[...new Set(header)].map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {missing.length > 0 && (
        <p className="small text-critical">
          必須の項目が未指定です：{missing.map((c) => c.headers[0]).join('、')}
        </p>
      )}
      <div className="button-row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={missing.length > 0}
          onClick={() => {
            const overrides: Record<string, string> = {};
            for (const [k, v] of Object.entries(choice)) if (v) overrides[k] = v;
            onApply({ specId, overrides });
          }}
        >
          この対応で読み込む
        </button>
        {current && (
          <button type="button" className="btn" onClick={() => onApply(null)}>
            指定をやめる
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          閉じる
        </button>
      </div>
    </section>
  );
}
