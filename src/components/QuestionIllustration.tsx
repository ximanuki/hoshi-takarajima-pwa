import type { Question } from '../types';
import { resolveIconToken, resolveTokenCategory, type IllustrationCategory } from '../data/illustrationDictionary';
import { getQuestionVisual, type MoneyItem } from '../utils/questionVisuals';

type Props = {
  question: Question;
};

const MONEY_DENOMS = [1000, 500, 100, 50, 10, 5, 1] as const;

function getOddOneOutToken(item: string): { icon: string; isText: boolean; category: IllustrationCategory | 'number' } {
  const mapped = resolveIconToken(item);
  const category = resolveTokenCategory(item);
  if (mapped) {
    return { icon: mapped, isText: false, category: category ?? 'other' };
  }

  if (/^\d+$/.test(item)) {
    return { icon: item, isText: true, category: 'number' };
  }

  return { icon: item.slice(0, 2), isText: true, category: category ?? 'other' };
}

function toPoint(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

function routeKey(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/^みち/, '')
    .replace(/^ルート/, '')
    .replace(/^コース/, '')
    .replace(/みち$/, '');
}

function wedgePath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
  const start = toPoint(cx, cy, radius, startAngle);
  const end = toPoint(cx, cy, radius, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

function decomposeMoney(amount: number): MoneyItem[] {
  let remaining = Math.max(0, Math.floor(amount));
  const result: MoneyItem[] = [];

  for (const denom of MONEY_DENOMS) {
    const count = Math.floor(remaining / denom);
    if (count <= 0) continue;
    result.push({
      value: denom,
      count,
      kind: denom >= 1000 ? 'bill' : 'coin',
    });
    remaining -= denom * count;
  }

  return result;
}

type ClockProps = {
  hour: number;
  minute: 0 | 15 | 30 | 45;
  label: string;
};

function ClockIllustration({ hour, minute, label }: ClockProps) {
  const center = 100;
  const radius = 86;
  const minuteAngle = minute * 6;
  const hourAngle = ((hour % 12) + minute / 60) * 30;
  const minuteEnd = toPoint(center, center, 66, minuteAngle);
  const hourEnd = toPoint(center, center, 44, hourAngle);

  const tickMarks = Array.from({ length: 12 }, (_, index) => {
    const angle = index * 30;
    const outer = toPoint(center, center, radius, angle);
    const inner = toPoint(center, center, index % 3 === 0 ? radius - 12 : radius - 7, angle);

    return (
      <line
        key={`tick-${index + 1}`}
        className="clock-tick"
        x1={inner.x}
        y1={inner.y}
        x2={outer.x}
        y2={outer.y}
      />
    );
  });

  const numbers = Array.from({ length: 12 }, (_, index) => {
    const value = index + 1;
    const pos = toPoint(center, center, 66, value * 30);
    return (
      <text key={`num-${value}`} className="clock-number" x={pos.x} y={pos.y + 4}>
        {value}
      </text>
    );
  });

  return (
    <div className="question-illustration" aria-live="polite">
      <p className="question-illustration-title">とけいイラスト</p>
      <svg className="clock-svg" viewBox="0 0 200 200" role="img" aria-label={`${label} を しめす とけい`}>
        <circle className="clock-face" cx={center} cy={center} r={radius} />
        {tickMarks}
        {numbers}
        <line className="clock-hand hour" x1={center} y1={center} x2={hourEnd.x} y2={hourEnd.y} />
        <line className="clock-hand minute" x1={center} y1={center} x2={minuteEnd.x} y2={minuteEnd.y} />
        <circle className="clock-center" cx={center} cy={center} r={5} />
      </svg>
      <p className="question-illustration-caption">いまは「{label}」を しめしているよ。</p>
    </div>
  );
}

function MoneyTokenPile({ items }: { items: MoneyItem[] }) {
  return (
    <div className="money-pile">
      {items.map((item) => (
        <div className="money-group" key={`${item.value}-${item.count}-${item.kind}`}>
          <p className="money-group-label">
            {item.value}えん × {item.count}
          </p>
          <div className="money-token-wrap">
            {Array.from({ length: item.count }, (_, index) => (
              <span className={`money-token ${item.kind}`} key={`${item.value}-${index}`}>
                {item.value}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

type MoneyProps = {
  mode: 'value' | 'sum' | 'change';
  items: MoneyItem[];
  total: number;
  price?: number;
  paid?: number;
};

function MoneyIllustration({ mode, items, total, price, paid }: MoneyProps) {
  const paidItems = paid ? decomposeMoney(paid) : [];
  const priceItems = price ? decomposeMoney(price) : [];
  const changeItems = decomposeMoney(total);

  return (
    <div className="question-illustration" aria-live="polite">
      <p className="question-illustration-title">おかねイラスト</p>
      {mode !== 'change' ? (
        <>
          <MoneyTokenPile items={items} />
          <p className="question-illustration-caption">ごうけい {total}えん</p>
        </>
      ) : (
        <div className="money-change-board">
          <div className="money-change-row">
            <p>ねだん</p>
            <strong>{price ?? 0}えん</strong>
          </div>
          <MoneyTokenPile items={priceItems} />
          <div className="money-change-row">
            <p>しはらい</p>
            <strong>{paid ?? 0}えん</strong>
          </div>
          <MoneyTokenPile items={paidItems} />
          <div className="money-change-row result">
            <p>おつり</p>
            <strong>{total}えん</strong>
          </div>
          <MoneyTokenPile items={changeItems} />
        </div>
      )}
    </div>
  );
}

type FractionProps = {
  numerator: number;
  denominator: number;
  label: string;
};

function FractionIllustration({ numerator, denominator, label }: FractionProps) {
  const center = 90;
  const radius = 72;
  const slices = Array.from({ length: denominator }, (_, index) => {
    const start = index * (360 / denominator);
    const end = (index + 1) * (360 / denominator);
    return (
      <path
        key={`slice-${index + 1}`}
        className={`fraction-slice ${index < numerator ? 'active' : ''}`}
        d={wedgePath(center, center, radius, start, end)}
      />
    );
  });

  return (
    <div className="question-illustration" aria-live="polite">
      <p className="question-illustration-title">ぶんすうイラスト</p>
      <svg className="fraction-svg" viewBox="0 0 180 180" role="img" aria-label={`${label} の ぶんすうず`}>
        {slices}
        <circle className="fraction-outline" cx={center} cy={center} r={radius} />
      </svg>
      <p className="question-illustration-caption">
        ぜんたいを {denominator}こに わけて、{numerator}こ えらぶ = {label}
      </p>
    </div>
  );
}

type RouteProps = {
  options: Array<{ name: string; segments: number[]; distance: number }>;
  bestRoute: string;
};

function RouteIllustration({ options, bestRoute }: RouteProps) {
  const maxDistance = Math.max(...options.map((option) => option.distance), 1);
  const viewWidth = 360;
  const viewHeight = 42 + options.length * 56;
  const left = 72;
  const right = viewWidth - 28;
  const span = right - left;

  return (
    <div className="question-illustration" aria-live="polite">
      <p className="question-illustration-title">ルートマップ</p>
      <svg className="route-svg" viewBox={`0 0 ${viewWidth} ${viewHeight}`} role="img" aria-label="ルートのくらべず">
        {options.map((option, optionIndex) => {
          const y = 36 + optionIndex * 56;
          let walked = 0;
          const best = routeKey(option.name) === routeKey(bestRoute);

          const segments = option.segments.map((segment, segmentIndex) => {
            const startX = left + (walked / maxDistance) * span;
            walked += segment;
            const endX = left + (walked / maxDistance) * span;
            const midX = (startX + endX) / 2;

            return (
              <g key={`${option.name}-${segmentIndex}`}>
                <line className={`route-step ${best ? 'best' : ''}`} x1={startX} y1={y} x2={endX} y2={y} />
                <text className="route-step-label" x={midX} y={y - 10}>
                  {segment}
                </text>
                <circle className={`route-node ${best ? 'best' : ''}`} cx={endX} cy={y} r={4} />
              </g>
            );
          });

          return (
            <g key={option.name}>
              <text className={`route-name ${best ? 'best' : ''}`} x={8} y={y + 5}>
                {option.name}
              </text>
              <circle className="route-node start" cx={left} cy={y} r={4} />
              {segments}
              <text className={`route-total ${best ? 'best' : ''}`} x={right + 4} y={y + 5}>
                {option.distance}ほ
              </text>
            </g>
          );
        })}
      </svg>
      <p className="question-illustration-caption">おすすめ: {bestRoute}（みじかいルート）</p>
    </div>
  );
}

function OddOneOutIllustration({ items }: { items: string[] }) {
  return (
    <div className="question-illustration" aria-live="polite">
      <p className="question-illustration-title">なかまさがしイラスト</p>
      <div className="odd-one-out-grid">
        {items.map((item) => {
          const token = getOddOneOutToken(item);
          return (
            <div className={`odd-one-out-card cat-${token.category}`} key={item}>
              <p className={`odd-one-out-icon ${token.isText ? `text cat-${token.category}` : ''}`}>{token.icon}</p>
              <p className="odd-one-out-label">{item}</p>
            </div>
          );
        })}
      </div>
      <p className="question-illustration-caption">なかまが ちがう 1つを みつけよう。</p>
    </div>
  );
}

export function QuestionIllustration({ question }: Props) {
  const visual = getQuestionVisual(question);
  if (!visual) return null;

  if (visual.kind === 'clock') {
    return <ClockIllustration hour={visual.hour} minute={visual.minute} label={visual.label} />;
  }

  if (visual.kind === 'money') {
    return (
      <MoneyIllustration
        mode={visual.mode}
        items={visual.items}
        total={visual.total}
        price={visual.price}
        paid={visual.paid}
      />
    );
  }

  if (visual.kind === 'fraction') {
    return (
      <FractionIllustration
        numerator={visual.numerator}
        denominator={visual.denominator}
        label={visual.label}
      />
    );
  }

  if (visual.kind === 'route') {
    return <RouteIllustration options={visual.options} bestRoute={visual.bestRoute} />;
  }

  if (visual.kind === 'odd_one_out') {
    return <OddOneOutIllustration items={visual.items} />;
  }

  return null;
}
