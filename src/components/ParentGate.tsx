import { useEffect, useRef, useState } from 'react';

const HOLD_MS = 3000;
const RING_R = 76;
const RING_C = 2 * Math.PI * RING_R;

type Props = { onPass: () => void };

/** こどもが まちがって はいらないように「3びょう ながおし」で ひらく */
export function ParentGate({ onPass }: Props) {
  const [progress, setProgress] = useState(0);
  const frame = useRef<number | null>(null);
  const startedAt = useRef<number | null>(null);

  const stop = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    startedAt.current = null;
    setProgress(0);
  };

  const tick = (now: number) => {
    if (startedAt.current === null) startedAt.current = now;
    const ratio = Math.min(1, (now - startedAt.current) / HOLD_MS);
    setProgress(ratio);
    if (ratio >= 1) {
      frame.current = null;
      onPass();
      return;
    }
    frame.current = requestAnimationFrame(tick);
  };

  const start = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(tick);
  };

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return (
    <div className="gate on-night">
      <h1>おとなの へや</h1>
      <p className="muted on-night">おうちの ひとは まんなかの ボタンを 3びょう ながおし してください</p>
      <button
        aria-label="3びょう ながおしで ひらく"
        className="gate-btn"
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') start();
        }}
        onKeyUp={stop}
        onPointerCancel={stop}
        onPointerDown={start}
        onPointerLeave={stop}
        onPointerUp={stop}
      >
        <svg className="gate-ring" viewBox="0 0 180 180" aria-hidden="true">
          <circle cx={90} cy={90} r={RING_R} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={8} />
          <circle
            cx={90}
            cy={90}
            fill="none"
            r={RING_R}
            stroke="#ffc94a"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - progress)}
            strokeLinecap="round"
            strokeWidth={8}
          />
        </svg>
        🔐
      </button>
    </div>
  );
}
