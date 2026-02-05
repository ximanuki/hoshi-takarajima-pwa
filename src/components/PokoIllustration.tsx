export type PokoMood = 'normal' | 'happy' | 'cheer' | 'sleepy';
export type PokoPose = 'stand' | 'jump';

type Props = {
  mood?: PokoMood;
  pose?: PokoPose;
};

const HAMCHEE_IMAGE_BY_MOOD: Record<PokoMood, string> = {
  normal: 'hamchee_idle.png',
  happy: 'hamchee_happy.png',
  cheer: 'hamchee_cheer.png',
  sleepy: 'hamchee_sleepy.png',
};

export function PokoIllustration({ mood = 'normal', pose = 'stand' }: Props) {
  const jumping = pose === 'jump';
  const baseUrl = import.meta.env.BASE_URL;
  const imageName = HAMCHEE_IMAGE_BY_MOOD[mood];
  const src = `${baseUrl}assets/hamchee/${imageName}`;

  return (
    <div className="poko-wrap" aria-live="polite">
      <div className={`poko-stage ${jumping ? 'jump' : ''}`}>
        <img
          className={`poko-image ${jumping ? 'jump' : ''}`}
          src={src}
          alt={`あいぼうハムチー ${mood}`}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      </div>
      {jumping ? <p className="poko-note">ジャンプ素材は未追加なので、今は座り絵を表示しています。</p> : null}
      <p className="question-illustration-caption">あいぼう「ポコ（ハムチーモデル）」が みまもっているよ。</p>
    </div>
  );
}
