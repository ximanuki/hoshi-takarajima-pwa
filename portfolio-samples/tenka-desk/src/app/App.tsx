import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog, Icon, Notice } from './components/ui.tsx';
import { AppProvider, useApp } from './model/AppState.tsx';
import { agreementsNotUsed } from './model/load.ts';
import { href, ROUTES, type RouteId, useRoute } from './router.ts';
import { DiagnosisScreen } from './screens/DiagnosisScreen.tsx';
import { ExportScreen } from './screens/ExportScreen.tsx';
import { FollowupScreen } from './screens/FollowupScreen.tsx';
import { ImportScreen } from './screens/ImportScreen.tsx';
import { LetterScreen } from './screens/LetterScreen.tsx';
import { NegotiationScreen } from './screens/NegotiationScreen.tsx';
import { ProposalScreen } from './screens/ProposalScreen.tsx';
import { ScenarioScreen } from './screens/ScenarioScreen.tsx';

const APP_NAME = '転嫁デスク（仮称）';

function Screen({ id }: { id: RouteId }) {
  switch (id) {
    case 'import':
      return <ImportScreen />;
    case 'diagnosis':
      return <DiagnosisScreen />;
    case 'scenario':
      return <ScenarioScreen />;
    case 'proposal':
      return <ProposalScreen />;
    case 'letter':
      return <LetterScreen />;
    case 'negotiation':
      return <NegotiationScreen />;
    case 'export':
      return <ExportScreen />;
    case 'followup':
      return <FollowupScreen />;
  }
}

function Shell() {
  const app = useApp();
  const route = useRoute();
  const mainRef = useRef<HTMLElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const firstRender = useRef(true);

  useEffect(() => {
    const label = ROUTES.find((r) => r.id === route.id)?.label ?? '';
    document.title = `${label} — ${APP_NAME}`;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo(0, 0);
    mainRef.current?.querySelector('h1')?.focus();
  }, [route.id]);

  const hasData = app.loaded !== null;
  // the import and diagnosis screens explain this themselves
  const agreementsUnused =
    app.loaded !== null &&
    route.id !== 'import' &&
    route.id !== 'diagnosis' &&
    agreementsNotUsed(app.loaded).length > 0;

  return (
    <div className="app">
      <button
        type="button"
        className="skip-link"
        onClick={() => mainRef.current?.querySelector('h1')?.focus()}
      >
        本文へ移動
      </button>
      <header className="topbar no-print">
        <div className="brand">
          <a className="brand-name" href={href('import')}>
            {APP_NAME}
          </a>
          <span className="brand-tag">価格協議の根拠資料づくりを支援（デモ）</span>
        </div>
        <div className="topbar-right">
          <p className="privacy-pill">
            <Icon name="lock" size={16} />
            データはこのブラウザの中だけで処理し、外部に送信しません
          </p>
          <button
            type="button"
            className="btn btn-small btn-danger-ghost"
            onClick={() => setConfirmClear(true)}
          >
            <Icon name="trash" size={16} /> データを消す
          </button>
        </div>
      </header>
      <nav className="steps no-print" aria-label="手順">
        <ol>
          {ROUTES.map((r, i) => {
            const disabled = r.id !== 'import' && !hasData;
            return (
              <li key={r.id}>
                <a
                  href={href(r.id)}
                  className={`step${route.id === r.id ? ' is-current' : ''}${disabled ? ' is-disabled' : ''}`}
                  aria-current={route.id === r.id ? 'page' : undefined}
                  aria-disabled={disabled || undefined}
                  tabIndex={disabled ? -1 : undefined}
                  onClick={(e) => {
                    if (disabled) e.preventDefault();
                  }}
                >
                  <span className="step-no">{i + 1}</span>
                  <span className="step-label">{r.label}</span>
                </a>
              </li>
            );
          })}
        </ol>
      </nav>
      <main id="main" ref={mainRef} className="main">
        {!app.storageOk && (
          <Notice tone="warning" title="このブラウザには保存できません">
            <p>データは画面を閉じるか再読み込みすると消えます（プライベートウィンドウなどで起きます）。</p>
          </Notice>
        )}
        {app.error && (
          <Notice tone="critical" title="読み込めませんでした">
            <p>{app.error}</p>
            <p>
              <button type="button" className="btn btn-small" onClick={app.clearError}>
                閉じる
              </button>
            </p>
          </Notice>
        )}
        {app.ready && agreementsUnused && (
          <div className="no-print" data-testid="agreements-unused-banner">
            <Notice tone="warning" title="合意状況のファイルを使っていません">
              <p>
                前回の改定を見送った得意先などの現行単価と、「請求ミスの可能性」の印は仮です。
                <a href={href('import')}>取り込み</a>の画面で前回の改定日を入れてください。
              </p>
            </Notice>
          </div>
        )}
        {app.ready ? <Screen id={route.id} /> : <p role="status">準備しています…</p>}
      </main>
      <footer className="footer no-print">
        <p>
          {APP_NAME}
          は、価格協議の根拠資料づくりを支援するデモです。計算はすべて決まった式で行い、AIによる推定は使っていません。読み込んだデータはこのブラウザの中（IndexedDB）にだけ保存され、「データを消す」でいつでも消せます。
        </p>
        <p>
          サンプルデータの会社・得意先・商品・取引はすべて架空です。申入書の参考資料は公表統計の写しで、出典を表示しています。この画面の内容は一般的な情報で、法的な助言ではありません。
        </p>
        <p>
          日本銀行の統計（企業物価指数・企業向けサービス価格指数）の写しは、作成時に一度だけ API
          で取得したものです（アプリの実行中は通信しません）。このサービスは、日本銀行時系列統計データ検索サイトの
          API 機能を使用しています。サービスの内容は日本銀行によって保証されたものではありません。
        </p>
      </footer>
      {app.busy && (
        <div className="busy" role="status" aria-live="polite">
          <div className="busy-box">
            <span className="spinner" aria-hidden="true" />
            {app.busy}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmClear}
        title="このブラウザのデータを消しますか"
        confirmLabel="すべて消す"
        danger
        onCancel={() => setConfirmClear(false)}
        onConfirm={async () => {
          setConfirmClear(false);
          await app.clearAll();
          window.location.hash = href('import');
        }}
      >
        <p>
          読み込んだファイル、設定、手入力の単価、協議記録をこのブラウザから消します。元に戻せません。協議記録が必要なら、先に「交渉」画面で保存（JSON・CSV）してください。
        </p>
      </ConfirmDialog>
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
