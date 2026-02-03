import { Link, NavLink } from 'react-router-dom';
import type { PropsWithChildren } from 'react';
import { useAppStore } from '../store/useAppStore';

export function AppShell({ children }: PropsWithChildren) {
  const { level, stars, streakDays } = useAppStore((state) => ({
    level: state.level,
    stars: state.stars,
    streakDays: state.streakDays,
  }));

  return (
    <div className="app-frame">
      <header className="topbar">
        <Link to="/" className="logo">
          ほしのたからじま
        </Link>
        <div className="top-stats">
          <span>Lv.{level}</span>
          <span>⭐ {stars}</span>
          <span>🔥 {streakDays}</span>
        </div>
      </header>

      <main className="page">{children}</main>

      <nav className="bottom-nav" aria-label="メインナビゲーション">
        <NavLink to="/" end>
          ホーム
        </NavLink>
        <NavLink to="/mission">ぼうけん</NavLink>
        <NavLink to="/collection">コレクション</NavLink>
        <NavLink to="/settings">せってい</NavLink>
      </nav>
    </div>
  );
}
