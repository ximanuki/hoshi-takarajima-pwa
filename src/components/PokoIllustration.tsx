export type PokoMood = 'normal' | 'happy' | 'cheer' | 'sleepy';
export type PokoPose = 'stand' | 'jump';

type Props = {
  mood?: PokoMood;
  pose?: PokoPose;
};

function PokoEyes({ mood }: { mood: PokoMood }) {
  if (mood === 'happy') {
    return (
      <>
        <path d="M124 112 Q132 104 140 112" className="poko-line" />
        <path d="M180 112 Q188 104 196 112" className="poko-line" />
      </>
    );
  }

  if (mood === 'sleepy') {
    return (
      <>
        <path d="M124 111 L140 111" className="poko-line" />
        <path d="M180 111 L196 111" className="poko-line" />
      </>
    );
  }

  if (mood === 'cheer') {
    return (
      <>
        <path d="M132 98 L135 106 L143 107 L137 112 L139 120 L132 115 L125 120 L127 112 L121 107 L129 106 Z" className="poko-star-eye" />
        <path d="M188 98 L191 106 L199 107 L193 112 L195 120 L188 115 L181 120 L183 112 L177 107 L185 106 Z" className="poko-star-eye" />
      </>
    );
  }

  return (
    <>
      <circle cx="132" cy="110" r="7" className="poko-eye" />
      <circle cx="188" cy="110" r="7" className="poko-eye" />
      <circle cx="134" cy="107" r="2.2" className="poko-eye-shine" />
      <circle cx="190" cy="107" r="2.2" className="poko-eye-shine" />
    </>
  );
}

function PokoMouth({ mood }: { mood: PokoMood }) {
  if (mood === 'happy') {
    return <path d="M136 142 Q160 165 184 142" className="poko-mouth" />;
  }

  if (mood === 'sleepy') {
    return <path d="M148 142 Q160 150 172 142" className="poko-mouth sleepy" />;
  }

  if (mood === 'cheer') {
    return (
      <>
        <path d="M132 140 Q160 172 188 140" className="poko-mouth" />
        <path d="M150 150 Q160 161 170 150" className="poko-mouth-inner" />
      </>
    );
  }

  return <path d="M140 142 Q160 156 180 142" className="poko-mouth" />;
}

export function PokoIllustration({ mood = 'normal', pose = 'stand' }: Props) {
  const jumping = pose === 'jump';
  const liftY = jumping ? -18 : 0;
  const pawRaise = jumping ? -10 : 0;

  return (
    <div className="poko-wrap" aria-live="polite">
      <svg className="poko-svg" viewBox="0 0 320 260" role="img" aria-label={`あいぼうハムチー: ${mood} ${pose}`}>
        <defs>
          <linearGradient id="poko-body-fur" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#ffd793" />
            <stop offset="100%" stopColor="#efb35d" />
          </linearGradient>
          <linearGradient id="poko-cream-fur" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#fff9ea" />
            <stop offset="100%" stopColor="#ffe8bf" />
          </linearGradient>
          <radialGradient id="poko-cheek-grad" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="#ffc0b0" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#ffc0b0" stopOpacity="0.2" />
          </radialGradient>
        </defs>

        <ellipse cx="160" cy="232" rx={jumping ? 46 : 66} ry="12" className="poko-shadow" />

        <g transform={`translate(0 ${liftY})`}>
          <ellipse cx="160" cy="170" rx="84" ry="62" className="poko-body" />
          <ellipse cx="160" cy="183" rx="56" ry="42" className="poko-belly" />

          <ellipse cx="100" cy="165" rx="26" ry="34" className="poko-spot" />
          <ellipse cx="220" cy="165" rx="26" ry="34" className="poko-spot" />
          <ellipse cx="233" cy="174" rx="10" ry="17" className="poko-tail" />

          <circle cx="113" cy="76" r="25" className="poko-ear" />
          <circle cx="207" cy="76" r="25" className="poko-ear" />
          <circle cx="113" cy="76" r="13" className="poko-ear-inner" />
          <circle cx="207" cy="76" r="13" className="poko-ear-inner" />
          <circle cx="160" cy="112" r="72" className="poko-head" />

          <ellipse cx="160" cy="134" rx="50" ry="34" className="poko-muzzle" />
          <PokoEyes mood={mood} />
          <PokoMouth mood={mood} />

          <circle cx="116" cy="127" r="13" className="poko-cheek" />
          <circle cx="204" cy="127" r="13" className="poko-cheek" />

          <path d="M156 125 Q160 118 164 125 Q160 131 156 125 Z" className="poko-nose" />

          <path d="M103 128 L78 121" className="poko-whisker" />
          <path d="M105 136 L76 137" className="poko-whisker" />
          <path d="M217 128 L242 121" className="poko-whisker" />
          <path d="M215 136 L244 137" className="poko-whisker" />

          <ellipse cx="96" cy={176 + pawRaise} rx="19" ry="14" className="poko-paw" />
          <ellipse cx="224" cy={176 + pawRaise} rx="19" ry="14" className="poko-paw" />
          <ellipse cx="130" cy={jumping ? 212 : 220} rx="18" ry="12" className="poko-foot" />
          <ellipse cx="190" cy={jumping ? 212 : 220} rx="18" ry="12" className="poko-foot" />

          <path d="M120 170 Q160 197 200 170 L194 186 Q160 212 126 186 Z" className="poko-bandana" />
          <circle cx="160" cy="188" r="7" className="poko-bandana-knot" />
          <path d="M160 181 L164 188 L172 189 L166 194 L168 202 L160 198 L152 202 L154 194 L148 189 L156 188 Z" className="poko-star" />

          {mood === 'sleepy' ? <text x="245" y="60" className="poko-emote">すや…</text> : null}
          {mood === 'cheer' ? <text x="242" y="60" className="poko-emote">キラッ！</text> : null}
        </g>
      </svg>
      <p className="question-illustration-caption">
        あいぼう「ポコ（ハムチーモデル）」{jumping ? 'が ジャンプ中！' : 'が みまもっているよ。'}
      </p>
    </div>
  );
}
