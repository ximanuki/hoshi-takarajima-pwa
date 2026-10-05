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

const SPARKLES = Array.from({ length: 26 }, (_, index) => ({
  x: seeded(index, 1) * VIEW_W,
  y: seeded(index, 2) * VIEW_H,
  r: 3 + seeded(index, 3) * 4,
  delay: seeded(index, 4) * 3,
  color: ['#ffffff', '#ffd45c', '#ffb3d6', '#bfe9ff'][index % 4],
}));

const SPRINKLE_COLORS = ['#ff7eb6', '#ffd45c', '#5fd0b8', '#8fd3ff', '#b9a3ff', '#ffffff'];

/** 4つの とがりが ある キラキラ */
function sparklePath(x: number, y: number, r: number): string {
  const k = r * 0.28;
  return `M ${x} ${y - r} Q ${x + k} ${y - k} ${x + r} ${y} Q ${x + k} ${y + k} ${x} ${y + r} Q ${x - k} ${y + k} ${x - r} ${y} Q ${x - k} ${y - k} ${x} ${y - r} Z`;
}

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
          <linearGradient id="milkSea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#c9f1ff" />
            <stop offset="55%" stopColor="#e4dcff" />
            <stop offset="100%" stopColor="#ffd9ec" />
          </linearGradient>
        </defs>

        <rect x={0} y={0} width={VIEW_W} height={VIEW_H} rx={36} fill="url(#milkSea)" />

        {/* にじ と くも */}
        <g aria-hidden="true">
          {['#ffb3d6', '#ffe08a', '#bdf0d8', '#bfe2ff', '#d9c8ff'].map((color, index) => (
            <path
              d={`M ${236 + index * 7} 92 A ${70 - index * 7} ${70 - index * 7} 0 0 1 ${376 - index * 7} 92`}
              fill="none"
              key={color}
              stroke={color}
              strokeLinecap="round"
              strokeWidth={8}
            />
          ))}
          <g fill="#fff" stroke="#6a3d73" strokeWidth={3}>
            <path d="M 214 98 a 16 16 0 0 1 22 -18 a 20 20 0 0 1 36 6 a 14 14 0 0 1 4 26 h -54 a 14 14 0 0 1 -8 -14 Z" />
            <path d="M 338 100 a 14 14 0 0 1 20 -14 a 16 16 0 0 1 28 8 a 12 12 0 0 1 -2 22 h -40 a 10 10 0 0 1 -6 -16 Z" />
          </g>
        </g>

        {SPARKLES.map((sparkle, index) => (
          <path
            className="twinkle"
            d={sparklePath(sparkle.x, sparkle.y, sparkle.r)}
            fill={sparkle.color}
            key={index}
            style={{ animationDelay: `${sparkle.delay}s` }}
          />
        ))}

        {WAVES.map((wave, index) => (
          <path
            className="wave"
            d={`M ${wave.x} ${wave.y} q 6 -5 12 0 t 12 0`}
            fill="none"
            key={index}
            stroke="#ffffff"
            strokeLinecap="round"
            strokeOpacity={0.9}
            strokeWidth={2.5}
            style={{ animationDelay: `${wave.delay}s` }}
          />
        ))}

        <path d={ROUTE} fill="none" stroke="#ff9fc9" strokeDasharray="2 12" strokeLinecap="round" strokeOpacity={0.8} strokeWidth={4} />

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
                <path d={blobPath(x, y + 10, ISLAND_R * 1.28, seed)} fill="#ffffff" fillOpacity={0.55} />
                {/* クッキーの だい */}
                <path d={blobPath(x, y + 8, ISLAND_R * 1.02, seed)} fill="#f6cf94" stroke="#6a3d73" strokeWidth={3} />
                {/* クリーム（しまの いろ） */}
                <path d={blobPath(x, y - 2, ISLAND_R * 0.84, seed + 1)} fill={`hsl(${h} 90% 84%)`} stroke="#6a3d73" strokeWidth={3} />
                {[-0.55, -0.15, 0.25, 0.6].map((offset, dripIndex) => (
                  <ellipse
                    cx={x + offset * ISLAND_R}
                    cy={y + ISLAND_R * 0.52 + (dripIndex % 2) * 5}
                    fill={`hsl(${h} 90% 84%)`}
                    key={offset}
                    rx={7}
                    ry={9 + (dripIndex % 2) * 4}
                    stroke="#6a3d73"
                    strokeWidth={2.5}
                  />
                ))}
                <path d={blobPath(x - 10, y - 12, ISLAND_R * 0.36, seed + 2)} fill="#ffffff" fillOpacity={0.55} />
                {/* スプリンクル */}
                {Array.from({ length: 9 }, (_, sprinkleIndex) => {
                  const angle = seeded(sprinkleIndex, seed) * Math.PI * 2;
                  const dist = 0.3 + seeded(sprinkleIndex, seed + 9) * 0.42;
                  const sx = x + Math.cos(angle) * ISLAND_R * dist * 1.2;
                  const sy = y - 2 + Math.sin(angle) * ISLAND_R * dist * 0.62;
                  return (
                    <rect
                      fill={SPRINKLE_COLORS[(sprinkleIndex + index) % SPRINKLE_COLORS.length]}
                      height={3.5}
                      key={sprinkleIndex}
                      rx={1.75}
                      transform={`rotate(${seeded(sprinkleIndex, seed + 3) * 180} ${sx} ${sy})`}
                      width={10}
                      x={sx - 5}
                      y={sy - 1.75}
                    />
                  );
                })}
                {/* ペロペロキャンディの き */}
                <g transform={`translate(${x - ISLAND_R * 0.86} ${y - 18})`}>
                  <rect x={-1.5} y={0} width={3} height={18} rx={1.5} fill="#fff" stroke="#6a3d73" strokeWidth={1.5} />
                  <circle cx={0} cy={-2} r={9} fill={`hsl(${(h + 60) % 360} 90% 80%)`} stroke="#6a3d73" strokeWidth={2} />
                  <path d="M 0 -2 m -5 0 a 5 5 0 1 1 5 5" fill="none" stroke="#fff" strokeWidth={2} />
                </g>
                <text x={x + 4} y={y + 8} fontSize={40} textAnchor="middle">
                  {info.emoji}
                </text>
              </g>

              <rect className="island-label" x={x - 70} y={y + ISLAND_R * 0.86} width={140} height={46} rx={16} />
              <text className="island-label-text" x={x} y={y + ISLAND_R * 0.86 + 20}>
                {info.island}
              </text>
              <text className="island-label-sub" x={x} y={y + ISLAND_R * 0.86 + 37}>
                {info.label} ★ {stars.earned}/{stars.max}
              </text>
            </g>
          );
        })}

        <g transform={`translate(${boatX} ${boatY})`} aria-hidden="true">
          <g className="boat">
          <path d="M 0 40 L 58 40 L 48 56 L 10 56 Z" fill="#ff9fc9" stroke="#6a3d73" strokeWidth={3} strokeLinejoin="round" />
          <rect x={27} y={2} width={3.5} height={38} fill="#6a3d73" />
          <path d="M 31 6 C 36 -2, 50 2, 44 12 C 52 12, 54 26, 31 34 Z" fill="#fff" stroke="#6a3d73" strokeWidth={2.5} strokeLinejoin="round" />
          <path d="M 38 14 c 2 -3 6 -2 5 1 c -1 3 -5 5 -5 5 c 0 0 -4 -2 -5 -5 c -1 -3 3 -4 5 -1 Z" fill="#ff7eb6" />
          <image href={hamcheeSrc('happy')} x={-2} y={8} width={34} height={34} />
          </g>
        </g>
      </svg>
    </div>
  );
}
