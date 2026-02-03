import { badgeMaster } from '../data/badges';
import { useAppStore } from '../store/useAppStore';

export function CollectionPage() {
  const badges = useAppStore((state) => state.badges);

  return (
    <section className="stack">
      <h1>コレクション</h1>
      <div className="badge-grid">
        {badgeMaster.map((badge) => {
          const unlocked = badges.includes(badge.id);
          return (
            <article className={`card badge-card ${unlocked ? '' : 'locked'}`} key={badge.id}>
              <p className="badge-title">{unlocked ? badge.name : '？？？'}</p>
              <p>{unlocked ? badge.description : 'まだ みつけていないバッジ'}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
