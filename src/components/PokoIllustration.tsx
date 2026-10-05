import { hamcheeSrc, type PokoMood } from '../utils/hamchee';

export type { PokoMood };
export type PokoPose = 'stand' | 'jump';

type Props = {
  mood?: PokoMood;
  pose?: PokoPose;
  comment?: string;
  showCaption?: boolean;
};

export function PokoIllustration({ mood = 'normal', pose = 'stand', comment, showCaption = true }: Props) {
  const jumping = pose === 'jump';

  return (
    <div className="poko-wrap" aria-live="polite">
      {comment ? <p className="hamchee-bubble">{comment}</p> : null}
      <div className={`poko-stage ${jumping ? 'jump' : ''}`}>
        <img
          className={`poko-image ${jumping ? 'jump' : ''}`}
          src={hamcheeSrc(mood)}
          alt={`あいぼう はむちー ${mood}`}
          width={512}
          height={512}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      </div>
      {jumping ? <p className="poko-note">ジャンプ素材は未追加なので、今は座り絵を表示しています。</p> : null}
      {showCaption ? <p className="question-illustration-caption">あいぼう「はむちー」が みまもっているよ。</p> : null}
    </div>
  );
}
