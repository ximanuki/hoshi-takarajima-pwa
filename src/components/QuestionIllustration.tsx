import type { Question } from '../types';
import { getQuestionVisual } from '../utils/questionVisuals';

type Props = {
  question: Question;
};

function toPoint(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
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

export function QuestionIllustration({ question }: Props) {
  const visual = getQuestionVisual(question);
  if (!visual) return null;

  if (visual.kind === 'clock') {
    return <ClockIllustration hour={visual.hour} minute={visual.minute} label={visual.label} />;
  }

  return null;
}
