import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { audioManager } from '../utils/audioManager';

export function SoundController() {
  const settings = useAppStore((state) => state.settings);

  useEffect(() => {
    audioManager.setSettings(settings);
  }, [settings]);

  useEffect(() => {
    const unlockAudio = () => {
      void audioManager.unlock();
    };

    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio);
    window.addEventListener('touchstart', unlockAudio, { passive: true });

    const onVisible = () => {
      if (!document.hidden) {
        void audioManager.unlock();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return null;
}
