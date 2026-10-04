import { useEffect } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import type { PropsWithChildren } from 'react';
import { useAppStore } from '../store/useAppStore';
import { levelProgress } from '../utils/progression';
import { SoundController } from './SoundController';

const NAV_ITEMS = [
  { to: '/', label: 'ホーム', icon: '🏝️', end: true },
  { to: '/mission', label: 'ぼうけん', icon: '🧭', end: false },
  { to: '/collection', label: 'コレクション', icon: '🏅', end: false },
  { to: '/settings', label: 'せってい', icon: '⚙️', end: false },
];

export function AppShell({ children }: PropsWithChildren) {
  const xp = useAppStore((state) => state.xp);
  const stars = useAppStore((state) => state.stars);
  const streakDays = useAppStore((state) => state.streakDays);
  const theme = useAppStore((state) => state.settings.theme);
  const largeText = useAppStore((state) => state.settings.largeText);
  const location = useLocation();
  const progress = levelProgress(xp);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (largeText) root.dataset.text = 'large';
    else delete root.dataset.text;
  }, [largeText]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="app-frame">
      <SoundController />
      <header className="topbar">
        <div className="topbar-row">
          <Link to="/" className="logo" aria-label="ほしのたからじま ホームへ">
            <span className="logo-mark" aria-hidden="true">
              ⭐
            </span>
            ほしのたからじま
          </Link>
          <div className="top-stats">
            <span className="stat-pill level" aria-label={`レベル ${progress.level}`}>
              Lv.{progress.level}
            </span>
            <span className="stat-pill stars" aria-label={`ほし ${stars}こ`}>
              ⭐ {stars}
            </span>
            <span className="stat-pill streak" aria-label={`れんぞく ${streakDays}にち`}>
              🔥 {streakDays}
            </span>
          </div>
        </div>
        <div
          className="xp-strip"
          role="progressbar"
          aria-label="つぎの レベルまで"
          aria-valuemin={0}
          aria-valuemax={progress.needed}
          aria-valuenow={progress.current}
        >
          <div className="xp-strip-fill" style={{ width: `${progress.ratio * 100}%` }} />
        </div>
      </header>

      <main className="page">{children}</main>

      <nav className="bottom-nav" aria-label="メインナビゲーション">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end}>
            <span className="nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
