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
        <path d="M108 112 Q117 102 126 112" className="poko-line" />
        <path d="M154 112 Q163 102 172 112" className="poko-line" />
      </>
    );
  }

  if (mood === 'sleepy') {
    return (
      <>
        <path d="M108 111 L126 111" className="poko-line" />
        <path d="M154 111 L172 111" className="poko-line" />
      </>
    );
  }

  if (mood === 'cheer') {
    return (
      <>
        <path d="M117 100 L120 108 L128 109 L122 114 L124 122 L117 117 L110 122 L112 114 L106 109 L114 108 Z" className="poko-star-eye" />
        <path d="M163 100 L166 108 L174 109 L168 114 L170 122 L163 117 L156 122 L158 114 L152 109 L160 108 Z" className="poko-star-eye" />
      </>
    );
  }

  return (
    <>
      <circle cx="117" cy="110" r="6" className="poko-eye" />
      <circle cx="163" cy="110" r="6" className="poko-eye" />
      <circle cx="119" cy="108" r="2" className="poko-eye-shine" />
      <circle cx="165" cy="108" r="2" className="poko-eye-shine" />
    </>
  );
}

function PokoMouth({ mood }: { mood: PokoMood }) {
  if (mood === 'happy') {
    return <path d="M122 134 Q140 152 158 134" className="poko-mouth" />;
  }

  if (mood === 'sleepy') {
    return <path d="M129 136 Q140 141 151 136" className="poko-mouth sleepy" />;
  }

  if (mood === 'cheer') {
    return (
      <>
        <path d="M120 133 Q140 158 160 133" className="poko-mouth" />
        <path d="M133 140 Q140 147 147 140" className="poko-mouth-inner" />
      </>
    );
  }

  return <path d="M126 136 Q140 146 154 136" className="poko-mouth" />;
}

export function PokoIllustration({ mood = 'normal', pose = 'stand' }: Props) {
  const jumping = pose === 'jump';

  return (
    <div className="poko-wrap" aria-live="polite">
      <svg className="poko-svg" viewBox="0 0 280 240" role="img" aria-label={`あいぼうポコ: ${mood} ${pose}`}>
        <defs>
          <linearGradient id="poko-body" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#ffe9b8" />
            <stop offset="100%" stopColor="#ffca72" />
          </linearGradient>
          <linearGradient id="poko-belly" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#fff8df" />
            <stop offset="100%" stopColor="#ffe9bc" />
          </linearGradient>
        </defs>

        <ellipse cx="140" cy="212" rx={jumping ? 44 : 58} ry="12" className="poko-shadow" />

        <g transform={jumping ? 'translate(0 -18)' : undefined}>
          <path d="M90 74 Q84 44 104 34 Q123 28 132 58" className="poko-ear" />
          <path d="M190 74 Q196 44 176 34 Q157 28 148 58" className="poko-ear" />

          <ellipse cx="140" cy="126" rx="73" ry="68" className="poko-body" />
          <ellipse cx="140" cy="137" rx="46" ry="40" className="poko-belly" />

          <circle cx="95" cy="124" r="9" className="poko-cheek" />
          <circle cx="185" cy="124" r="9" className="poko-cheek" />

          <PokoEyes mood={mood} />
          <PokoMouth mood={mood} />

          <ellipse cx="88" cy="148" rx="13" ry="10" className="poko-arm" />
          <ellipse cx="192" cy="148" rx="13" ry="10" className="poko-arm" />

          <ellipse cx="118" cy={jumping ? 187 : 196} rx="13" ry="9" className="poko-foot" />
          <ellipse cx="162" cy={jumping ? 187 : 196} rx="13" ry="9" className="poko-foot" />

          <path d="M140 72 L146 84 L160 86 L150 96 L152 110 L140 103 L128 110 L130 96 L120 86 L134 84 Z" className="poko-star" />

          <path d="M140 96 L155 107 L140 118 L125 107 Z" className="poko-scarf" />
          <circle cx="140" cy="114" r="4" className="poko-scarf-knot" />

          {mood === 'sleepy' ? <text x="204" y="60" className="poko-sleep">Zz...</text> : null}
          {mood === 'cheer' ? <text x="204" y="60" className="poko-cheer">キラッ！</text> : null}
        </g>
      </svg>
      <p className="question-illustration-caption">あいぼう「ポコ」{jumping ? 'が ジャンプ中！' : 'が みまもっているよ。'}</p>
    </div>
  );
}
