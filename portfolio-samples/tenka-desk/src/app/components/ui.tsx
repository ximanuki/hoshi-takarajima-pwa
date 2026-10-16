/** Small shared UI pieces. */

import { type ReactNode, useEffect, useId, useRef } from 'react';
import { useApp } from '../model/AppState.tsx';
import { FILE_CHECKS } from '../model/load.ts';

type IconName = 'lock' | 'alert' | 'info' | 'check' | 'download' | 'print' | 'upload' | 'trash' | 'arrow';

const PATHS: Record<IconName, string> = {
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v10H5z',
  alert: 'M12 3 2 20h20L12 3zM12 9v5M12 17v.5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5',
  check: 'M4 12.5 9.5 18 20 6',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  upload: 'M12 20V9M7 13l5-5 5 5M5 4h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  arrow: 'M5 12h14M13 6l6 6-6 6',
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'critical' | 'good';
  title?: string;
  children?: ReactNode;
}) {
  const icon: IconName = tone === 'good' ? 'check' : tone === 'info' ? 'info' : 'alert';
  const label = { info: 'お知らせ', warning: '注意', critical: '要確認', good: '完了' }[tone];
  return (
    <div className={`notice notice-${tone}`} role={tone === 'critical' ? 'alert' : undefined}>
      <span className="notice-icon">
        <Icon name={icon} />
        <span className="visually-hidden">{label}：</span>
      </span>
      <div className="notice-body">
        {title && <p className="notice-title">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function Kpi({
  label,
  value,
  sub,
  emphasis = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className={`kpi${emphasis ? ' kpi-emphasis' : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub !== undefined && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'info' | 'warning' | 'critical' | 'good';
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function PageHeader({
  step,
  title,
  lead,
  actions,
}: {
  step?: number;
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {step !== undefined && <p className="page-step">ステップ {step}</p>}
        <h1 className="page-title" tabIndex={-1}>
          {title}
        </h1>
        {lead && <div className="page-lead">{lead}</div>}
      </div>
      {actions && <div className="page-actions no-print">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  children,
  actions,
  className,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section className={`card${className ? ` ${className}` : ''}`} aria-labelledby={title ? id : undefined}>
      {(title || actions) && (
        <div className="card-head">
          {title && (
            <h2 className="card-title" id={id}>
              {title}
            </h2>
          )}
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** 架空 label printed on every sheet made from the sample data. */
export const SAMPLE_TAG = 'サンプル（架空データ）— 実在の企業・取引とは関係ありません';

export function SampleTag({ sample }: { sample: boolean }) {
  return sample ? <p className="sheet-sample">{SAMPLE_TAG}</p> : null;
}

/**
 * Shown on a screen that needs data the user has not loaded yet. When some files
 * are loaded but the diagnosis cannot run, it names the files still missing.
 */
export function NeedsData({ what = '売上明細とマスタ' }: { what?: string }) {
  const { loaded } = useApp();
  if (loaded) {
    const missing = FILE_CHECKS.filter((c) => c.need === 'required' && !loaded.kinds.has(c.kind));
    return (
      <Notice
        tone="warning"
        title={
          missing.length > 0
            ? `診断に必要なファイルが足りません：${missing.map((c) => c.label).join('・')}`
            : '読み込んだファイルでは診断できません'
        }
      >
        <p>
          {missing.length > 0
            ? '売上明細・得意先マスタ・商品マスタがそろうと、この画面を使えます。'
            : '売上明細の行を1行も読めていない可能性があります。取り込みの画面で、ファイルごとの確認事項を見てください。'}{' '}
          <a href="#/import">取り込みに戻る</a>
        </p>
      </Notice>
    );
  }
  return (
    <Notice tone="info" title="データがまだありません">
      <p>
        先に「取り込み」で{what}を読み込むか、<a href="#/import">サンプルデータ（架空）で試して</a>ください。
      </p>
    </Notice>
  );
}

/** Modal confirmation built on the native dialog element (focus is trapped by the browser). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onCancel={onCancel} onClose={onCancel}>
      <h2 id={titleId} className="dialog-title">
        {title}
      </h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>
          やめる
        </button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

/** Save bytes as a file the user downloads (created in the browser; nothing is uploaded). */
export function downloadFile(name: string, data: Uint8Array | string, type: string): void {
  const part: BlobPart = typeof data === 'string' ? data : new Uint8Array(data);
  const blob = new Blob([part], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
