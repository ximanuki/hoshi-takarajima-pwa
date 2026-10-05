import type { KeyboardEvent } from 'react';
import { SUBJECTS, subjectInfo } from '../../data/subjects';
import type { Subject } from '../../types';
import { hamcheeSrc } from '../../utils/hamchee';

const VIEW_W = 390;
const VIEW_H = 720;
const ISLAND_R = 60;

const ISLAND_POS: Record<Subject, { x: number; y: number; seed: number }> = {
  math: { x: 112, y: 128, seed: 1.3 },
  japanese: { x: 282, y: 236, seed: 2.7 },
  life: { x: 108, y: 366, seed: 4.1 },
  insight: { x: 284, y: 488, seed: 5.6 },
  nature: { x: 124, y: 616, seed: 0.4 },
};

/** ふちが ゆらゆらした しまの かたち */
function blobPath(cx: number, cy: number, radius: number, seed: number, squash = 0.78): string {
  const points = 14;
  const coords = Array.from({ length: points }, (_, index) => {
    const angle = (index / points) * Math.PI * 2;
    const wobble = 1 + 0.09 * Math.sin(angle * 3 + seed) + 0.05 * Math.cos(angle * 5 + seed * 2);
    return { x: cx + Math.cos(angle) * radius * wobble, y: cy + Math.sin(angle) * radius * wobble * squash };
  });
  // なめらかな きょくせん（Catmull-Rom → ベジェ）
  let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let index = 0; index < points; index += 1) {
    const p0 = coords[(index - 1 + points) % points];
    const p1 = coords[index];
    const p2 = coords[(index + 1) % points];
    const p3 = coords[(index + 2) % points];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return `${d} Z`;
}

function seeded(index: number, salt: number): number {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

const STARS = Array.from({ length: 34 }, (_, index) => ({
  x: seeded(index, 1) * VIEW_W,
  y: seeded(index, 2) * VIEW_H,
  r: 0.8 + seeded(index, 3) * 1.6,
  delay: seeded(index, 4) * 3,
}));

const WAVES = Array.from({ length: 12 }, (_, index) => ({
  x: 20 + seeded(index, 7) * (VIEW_W - 60),
  y: 40 + seeded(index, 8) * (VIEW_H - 80),
  delay: seeded(index, 9) * 4,
}));

const ROUTE = (() => {
  const points = SUBJECTS.map((subject) => ISLAND_POS[subject]);
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const next = points[index];
    const midY = (prev.y + next.y) / 2;
    d += ` C ${prev.x} ${midY + 10}, ${next.x} ${midY - 10}, ${next.x} ${next.y}`;
  }
  return d;
})();

type Props = {
  islandStars: Record<Subject, { earned: number; max: number }>;
  boatAt: Subject | null;
  onSelect: (subject: Subject) => void;
};

export function WorldMap({ islandStars, boatAt, onSelect }: Props) {
  const boatIsland = ISLAND_POS[boatAt ?? 'math'];
  const boatOnLeft = boatIsland.x > VIEW_W / 2;
  const boatX = boatOnLeft ? boatIsland.x - 132 : boatIsland.x + 74;
  const boatY = boatIsland.y - 30;

  const onKey = (event: KeyboardEvent, subject: Subject) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(subject);
    }
  };

  return (
    <div className="world">
      <svg className="world-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="group" aria-label="ぼうけんマップ">
        <defs>
          <radialGradient id="moonGlow">
            <stop offset="0%" stopColor="#fff6d6" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#fff6d6" stopOpacity="0" />
          </radialGradient>
        </defs>

        {STARS.map((star, index) => (
          <circle
            className="twinkle"
            cx={star.x}
            cy={star.y}
            fill="#fff"
            key={index}
            r={star.r}
            style={{ animationDelay: `${star.delay}s` }}
          />
        ))}

        <circle cx={348} cy={44} r={58} fill="url(#moonGlow)" />
        <path d="M 360 22 a 24 24 0 1 0 6 40 a 19 19 0 1 1 -6 -40 Z" fill="#ffe7a3" stroke="#2a2140" strokeWidth={3} />

        {WAVES.map((wave, index) => (
          <path
            className="wave"
            d={`M ${wave.x} ${wave.y} q 6 -5 12 0 t 12 0`}
            fill="none"
            key={index}
            stroke="#7fa8ff"
            strokeLinecap="round"
            strokeOpacity={0.45}
            strokeWidth={2.5}
            style={{ animationDelay: `${wave.delay}s` }}
          />
        ))}

        <path d={ROUTE} fill="none" stroke="#fff" strokeDasharray="2 12" strokeLinecap="round" strokeOpacity={0.4} strokeWidth={4} />

        {SUBJECTS.map((subject, index) => {
          const { x, y, seed } = ISLAND_POS[subject];
          const info = subjectInfo[subject];
          const stars = islandStars[subject];
          const h = info.hue;
          return (
            <g
              aria-label={`${info.island}（ほし ${stars.earned} / ${stars.max}）`}
              className="world-island"
              key={subject}
              onClick={() => onSelect(subject)}
              onKeyDown={(event) => onKey(event, subject)}
              role="button"
              tabIndex={0}
            >
              <g className="island-bob" style={{ animationDelay: `${index * 0.6}s` }}>
                <path d={blobPath(x, y + 8, ISLAND_R * 1.3, seed)} fill={`hsl(${h} 80% 72%)`} fillOpacity={0.22} />
                <path d={blobPath(x, y + 6, ISLAND_R * 1.04, seed)} fill="#f7dfa8" stroke="#2a2140" strokeWidth={3} />
                <path d={blobPath(x, y - 2, ISLAND_R * 0.8, seed + 1)} fill={`hsl(${h} 62% 58%)`} stroke="#2a2140" strokeWidth={3} />
                <path d={blobPath(x - 8, y - 8, ISLAND_R * 0.42, seed + 2)} fill={`hsl(${h} 70% 72%)`} />
                {/* ちいさな き */}
                <g transform={`translate(${x - ISLAND_R * 0.62} ${y - 6})`}>
                  <rect x={-2} y={0} width={4} height={12} rx={2} fill="#7a4a2a" />
                  <circle cx={0} cy={-2} r={8} fill={`hsl(${(h + 120) % 360} 45% 45%)`} stroke="#2a2140" strokeWidth={2} />
                </g>
                <g transform={`translate(${x + ISLAND_R * 0.6} ${y + 2})`}>
                  <rect x={-2} y={0} width={4} height={10} rx={2} fill="#7a4a2a" />
                  <circle cx={0} cy={-1} r={6.5} fill={`hsl(${(h + 120) % 360} 45% 45%)`} stroke="#2a2140" strokeWidth={2} />
                </g>
                <text x={x} y={y + 6} fontSize={38} textAnchor="middle">
                  {info.emoji}
                </text>
              </g>

              <rect className="island-label" x={x - 70} y={y + ISLAND_R * 0.86} width={140} height={46} rx={16} />
              <text className="island-label-text" x={x} y={y + ISLAND_R * 0.86 + 20}>
                {info.island}
              </text>
              <text className="island-label-sub" x={x} y={y + ISLAND_R * 0.86 + 37}>
                ★ {stars.earned} / {stars.max}
              </text>
            </g>
          );
        })}

        <g transform={`translate(${boatX} ${boatY})`} aria-hidden="true">
          <g className="boat">
          <path d="M 0 40 L 58 40 L 48 56 L 10 56 Z" fill="#b5683a" stroke="#2a2140" strokeWidth={3} strokeLinejoin="round" />
          <rect x={27} y={2} width={4} height={38} fill="#2a2140" />
          <path d="M 31 4 L 31 34 L 52 34 Z" fill="#fff8ec" stroke="#2a2140" strokeWidth={2.5} strokeLinejoin="round" />
          <image href={hamcheeSrc('happy')} x={-2} y={8} width={34} height={34} />
          </g>
        </g>
      </svg>
    </div>
  );
}
