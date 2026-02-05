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
        <path d="M142 121 Q152 110 162 121" className="poko-eye-line" />
        <path d="M198 121 Q208 110 218 121" className="poko-eye-line" />
      </>
    );
  }

  if (mood === 'sleepy') {
    return (
      <>
        <path d="M144 121 L160 121" className="poko-eye-line" />
        <path d="M200 121 L216 121" className="poko-eye-line" />
      </>
    );
  }

  if (mood === 'cheer') {
    return (
      <>
        <path d="M150 108 L154 117 L164 118 L157 124 L159 134 L150 129 L141 134 L143 124 L136 118 L146 117 Z" className="poko-star-eye" />
        <path d="M206 108 L210 117 L220 118 L213 124 L215 134 L206 129 L197 134 L199 124 L192 118 L202 117 Z" className="poko-star-eye" />
      </>
    );
  }

  return (
    <>
      <circle cx="152" cy="121" r="8.5" className="poko-eye" />
      <circle cx="208" cy="121" r="8.5" className="poko-eye" />
      <circle cx="155" cy="118" r="2.5" className="poko-eye-shine" />
      <circle cx="211" cy="118" r="2.5" className="poko-eye-shine" />
    </>
  );
}

function PokoMouth({ mood }: { mood: PokoMood }) {
  if (mood === 'happy') {
    return <path d="M160 156 Q180 173 200 156" className="poko-mouth" />;
  }

  if (mood === 'sleepy') {
    return <path d="M169 157 Q180 163 191 157" className="poko-mouth sleepy" />;
  }

  if (mood === 'cheer') {
    return (
      <>
        <path d="M156 154 Q180 182 204 154" className="poko-mouth" />
        <path d="M170 164 Q180 174 190 164" className="poko-mouth-inner" />
      </>
    );
  }

  return <path d="M164 157 Q180 168 196 157" className="poko-mouth" />;
}

export function PokoIllustration({ mood = 'normal', pose = 'stand' }: Props) {
  const jumping = pose === 'jump';
  const liftY = jumping ? -18 : 0;
  const pawY = jumping ? 186 : 196;
  const footY = jumping ? 256 : 266;

  return (
    <div className="poko-wrap" aria-live="polite">
      <svg className="poko-svg" viewBox="0 0 360 310" role="img" aria-label={`あいぼうハムチー: ${mood} ${pose}`}>
        <defs>
          <linearGradient id="poko-fur-main" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#f9cf93" />
            <stop offset="100%" stopColor="#e9ab67" />
          </linearGradient>
          <linearGradient id="poko-fur-light" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#fff9ee" />
            <stop offset="100%" stopColor="#f7dfbe" />
          </linearGradient>
          <radialGradient id="poko-cheek" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="#ffb6aa" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#ffb6aa" stopOpacity="0.12" />
          </radialGradient>
        </defs>

        <ellipse cx="180" cy="290" rx={jumping ? 56 : 72} ry="12" className="poko-shadow" />

        <g transform={`translate(0 ${liftY})`}>
          <circle cx="122" cy="88" r="29" className="poko-ear" />
          <circle cx="238" cy="88" r="29" className="poko-ear" />
          <circle cx="122" cy="88" r="14" className="poko-ear-inner" />
          <circle cx="238" cy="88" r="14" className="poko-ear-inner" />

          <ellipse cx="180" cy="208" rx="108" ry="88" className="poko-body" />
          <ellipse cx="180" cy="132" rx="90" ry="78" className="poko-head" />

          <ellipse cx="107" cy="204" rx="28" ry="34" className="poko-side-fur" />
          <ellipse cx="253" cy="204" rx="28" ry="34" className="poko-side-fur" />
          <ellipse cx="272" cy="226" rx="11" ry="18" className="poko-tail" />

          <path d="M126 82 L132 74 L138 82 L144 72 L150 80 L156 70 L162 78 L168 69 L174 77 L180 68 L186 77 L192 69 L198 78 L204 70 L210 80 L216 72 L222 82" className="poko-fur-spike" />

          <ellipse cx="180" cy="154" rx="58" ry="38" className="poko-muzzle" />
          <ellipse cx="180" cy="221" rx="63" ry="55" className="poko-belly" />

          <PokoEyes mood={mood} />

          <circle cx="118" cy="136" r="14" className="poko-cheek" />
          <circle cx="242" cy="136" r="14" className="poko-cheek" />

          <path d="M176 139 Q180 132 184 139 Q180 145 176 139 Z" className="poko-nose" />
          <PokoMouth mood={mood} />

          <path d="M108 140 L80 132" className="poko-whisker" />
          <path d="M111 149 L78 150" className="poko-whisker" />
          <path d="M252 140 L280 132" className="poko-whisker" />
          <path d="M249 149 L282 150" className="poko-whisker" />

          <path d={`M126 ${pawY - 8} C112 ${pawY - 2} 111 ${pawY + 13} 126 ${pawY + 18} C141 ${pawY + 22} 150 ${pawY + 11} 149 ${pawY - 1} C148 ${pawY - 9} 139 ${pawY - 12} 126 ${pawY - 8} Z`} className="poko-paw" />
          <path d={`M234 ${pawY - 8} C248 ${pawY - 2} 249 ${pawY + 13} 234 ${pawY + 18} C219 ${pawY + 22} 210 ${pawY + 11} 211 ${pawY - 1} C212 ${pawY - 9} 221 ${pawY - 12} 234 ${pawY - 8} Z`} className="poko-paw" />

          <ellipse cx="146" cy={footY} rx="19" ry="12" className="poko-foot" />
          <ellipse cx="214" cy={footY} rx="19" ry="12" className="poko-foot" />

          <path d="M130 204 Q180 234 230 204 L223 219 Q180 251 137 219 Z" className="poko-bandana" />
          <circle cx="180" cy="223" r="7" className="poko-bandana-knot" />
          <path d="M180 215 L184 223 L193 224 L186 230 L188 239 L180 234 L172 239 L174 230 L167 224 L176 223 Z" className="poko-star" />

          {mood === 'sleepy' ? <text x="282" y="72" className="poko-emote">すや…</text> : null}
          {mood === 'cheer' ? <text x="279" y="72" className="poko-emote">キラッ！</text> : null}
        </g>
      </svg>
      <p className="question-illustration-caption">
        あいぼう「ポコ（ハムチーモデル）」{jumping ? 'が ジャンプ中！' : 'が みまもっているよ。'}
      </p>
    </div>
  );
}
