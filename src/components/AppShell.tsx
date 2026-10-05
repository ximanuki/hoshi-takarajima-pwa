import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import type { PropsWithChildren } from 'react';
import { useAppStore } from '../store/useAppStore';
import { SoundController } from './SoundController';

// v3: したの タブバーは なくし、がめんごとに HUD を だす。
export function AppShell({ children }: PropsWithChildren) {
  const largeText = useAppStore((state) => state.settings.largeText);
  const location = useLocation();

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
      {children}
    </div>
  );
}
