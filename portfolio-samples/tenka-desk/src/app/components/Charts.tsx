/**
 * Two small chart forms, drawn as plain SVG/HTML (no chart library):
 *  - BarList: magnitudes by category, one hue, every value labelled
 *  - LineChart: one series over time, with a crosshair tooltip (pointer and keyboard)
 */

import { type KeyboardEvent, type PointerEvent, useId, useMemo, useRef, useState } from 'react';

export interface BarRow {
  key: string;
  label: string;
  value: number;
  display: string;
  sub?: string;
}

export function BarList({ rows, caption, max }: { rows: readonly BarRow[]; caption: string; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <figure className="barlist">
      <figcaption className="visually-hidden">{caption}</figcaption>
      <ul>
        {rows.map((r) => {
          const w = Math.max(0, Math.min(100, (Math.abs(r.value) / top) * 100));
          return (
            <li key={r.key} className="barlist-row">
              <span className="barlist-label">
                {r.label}
                {r.sub && <span className="barlist-sub">{r.sub}</span>}
              </span>
              <span className="barlist-track" aria-hidden="true">
                <span className="barlist-bar" style={{ width: `${w}%` }} />
              </span>
              <span className="barlist-value num">{r.display}</span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

export interface LinePoint {
  period: string;
  value: number;
}

function niceStep(range: number, ticks: number): number {
  const raw = range / Math.max(1, ticks);
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

function decimalsOf(step: number): number {
  const s = String(step);
  return s.includes('.') ? (s.split('.')[1]?.length ?? 0) : 0;
}

function periodLabel(period: string): string {
  if (/^\d{4}-\d{2}$/.test(period)) return `${period.slice(0, 4)}年${Number(period.slice(5, 7))}月`;
  return `${period}年`;
}

const W = 560;
const H = 220;
const PAD = { top: 16, right: 64, bottom: 28, left: 48 };

export function LineChart({
  points,
  title,
  unit,
  format = (v) => v.toLocaleString('ja-JP'),
}: {
  points: readonly LinePoint[];
  title: string;
  unit: string;
  format?: (v: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tipId = useId();
  const geo = useMemo(() => {
    const values = points.map((p) => p.value);
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const step = niceStep(hi - lo, 4);
    const y0 = Math.floor(lo / step) * step;
    const y1 = Math.ceil(hi / step) * step;
    const ticks: number[] = [];
    for (let v = y0; v <= y1 + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
    const iw = W - PAD.left - PAD.right;
    const ih = H - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw);
    const y = (v: number) => PAD.top + ih - ((v - y0) / (y1 - y0)) * ih;
    const monthly = points.every((p) => /^\d{4}-\d{2}$/.test(p.period));
    const xTicks: number[] = [];
    if (monthly) {
      points.forEach((p, i) => {
        if (p.period.endsWith('-01')) xTicks.push(i);
      });
    } else {
      const every = Math.max(1, Math.ceil(points.length / 6));
      for (let i = points.length - 1; i >= 0; i -= every) xTicks.unshift(i);
    }
    const path = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
      .join('');
    return { ticks, x, y, xTicks, monthly, path, decimals: decimalsOf(step) };
  }, [points]);

  if (points.length === 0) return null;
  const last = points.length - 1;
  const lastPoint = points[last] as LinePoint;
  const first = points[0] as LinePoint;

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    let dist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(geo.x(i) - px);
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    setActive(best);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const cur = active ?? last;
      setActive(Math.max(0, Math.min(last, cur + (e.key === 'ArrowLeft' ? -1 : 1))));
    } else if (e.key === 'Escape') setActive(null);
  };
  const ap = active !== null ? points[active] : undefined;
  const xTickLabel = (i: number) => {
    const p = points[i] as LinePoint;
    return geo.monthly ? `${p.period.slice(0, 4)}年` : `${p.period}`;
  };

  return (
    <div className="linechart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${title}（${unit}）。${periodLabel(first.period)} ${format(first.value)} から ${periodLabel(lastPoint.period)} ${format(lastPoint.value)}。左右の矢印キーで各時点の値を読めます。`}
        aria-describedby={ap ? tipId : undefined}
        tabIndex={0}
        onPointerMove={pick}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive(last)}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
      >
        {geo.ticks.map((t) => (
          <g key={t}>
            <line className="chart-grid" x1={PAD.left} x2={W - PAD.right} y1={geo.y(t)} y2={geo.y(t)} />
            <text
              className="chart-tick"
              x={PAD.left - 6}
              y={geo.y(t)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {t.toFixed(geo.decimals)}
            </text>
          </g>
        ))}
        {geo.xTicks.map((i) => (
          <text key={i} className="chart-tick" x={geo.x(i)} y={H - 8} textAnchor="middle">
            {xTickLabel(i)}
          </text>
        ))}
        <path className="chart-line" d={geo.path} />
        <circle className="chart-dot" cx={geo.x(last)} cy={geo.y(lastPoint.value)} r={4} />
        <text
          className="chart-endlabel"
          x={geo.x(last) + 8}
          y={geo.y(lastPoint.value)}
          dominantBaseline="middle"
        >
          {format(lastPoint.value)}
        </text>
        {ap && active !== null && (
          <g className="chart-cross">
            <line x1={geo.x(active)} x2={geo.x(active)} y1={PAD.top} y2={H - PAD.bottom} />
            <circle cx={geo.x(active)} cy={geo.y(ap.value)} r={4} />
          </g>
        )}
      </svg>
      {ap && active !== null && (
        <div
          id={tipId}
          className="chart-tip"
          role="status"
          style={{
            left: `${(geo.x(active) / W) * 100}%`,
            transform: geo.x(active) > W * 0.6 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
          }}
        >
          <strong className="num">{format(ap.value)}</strong>
          <span>{periodLabel(ap.period)}</span>
        </div>
      )}
    </div>
  );
}
