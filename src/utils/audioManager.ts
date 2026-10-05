import type { Settings } from '../types';
import type { AudioPerformanceProfile, SfxKitId, SfxPlayer, ToneSfxId } from './sfxPlayer';

export type AudioScene = 'home' | 'mission' | 'play' | 'result';
export type SoundEffect = 'tap' | 'correct' | 'wrong' | 'combo' | 'clear';

type AudioSettings = Pick<Settings, 'soundEnabled' | 'sfxVolume'>;

const DEFAULT_SETTINGS: AudioSettings = {
  soundEnabled: true,
  sfxVolume: 0.8,
};

// がめんごとに SE の ねいろを かえる
const SCENE_SFX_KITS: Record<AudioScene, SfxKitId> = {
  home: 'ambient_stars',
  mission: 'uk_garage_neon',
  play: 'future_garage_mist',
  result: 'lofi_jersey',
};

const EFFECT_TO_TONE: Record<SoundEffect, ToneSfxId> = {
  tap: 'tap',
  correct: 'correct',
  wrong: 'miss',
  combo: 'clear',
  clear: 'clear',
};

const EFFECT_COOLDOWN_MS: Partial<Record<SoundEffect, number>> = {
  tap: 65,
  combo: 820,
  clear: 420,
};

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function detectPerformanceProfile(): AudioPerformanceProfile {
  if (typeof navigator === 'undefined') return 'full';
  const ua = navigator.userAgent.toLowerCase();
  const isMobile =
    /android|iphone|ipad|ipod|mobile/.test(ua) ||
    (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 900px)').matches);

  const cores = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : 8;
  const memory = typeof (navigator as Navigator & { deviceMemory?: number }).deviceMemory === 'number'
    ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
    : 8;
  const isLowSpec = cores <= 4 || memory <= 4;

  return isMobile || isLowSpec ? 'lite' : 'full';
}

class AudioManager {
  private player: SfxPlayer | null = null;
  private playerLoadPromise: Promise<SfxPlayer> | null = null;
  private performanceProfile: AudioPerformanceProfile = detectPerformanceProfile();
  private tonePrewarmed = false;
  private unlocked = false;
  private settings: AudioSettings = DEFAULT_SETTINGS;
  private scene: AudioScene = 'home';
  private lastEffectAt: Partial<Record<SoundEffect, number>> = {};

  setScene(scene: AudioScene) {
    this.scene = scene;
  }

  setSettings(next: AudioSettings) {
    this.settings = {
      soundEnabled: Boolean(next.soundEnabled),
      sfxVolume: clamp01(next.sfxVolume),
    };
    this.player?.setSfxVolume(this.settings.sfxVolume);
  }

  async unlock() {
    if (!this.settings.soundEnabled) return;
    const player = await this.ensurePlayer();
    if (!this.tonePrewarmed) {
      this.tonePrewarmed = true;
      void player.prewarmTone();
    }
    this.unlocked = true;
  }

  playSfx(effect: SoundEffect) {
    if (!this.unlocked || !this.settings.soundEnabled) return;

    const nowMs = performance.now();
    const cooldown = EFFECT_COOLDOWN_MS[effect] ?? 0;
    const lastAt = this.lastEffectAt[effect] ?? -Infinity;
    if (nowMs - lastAt < cooldown) return;
    this.lastEffectAt[effect] = nowMs;

    void this.ensurePlayer().then((player) => player.playToneSfx(EFFECT_TO_TONE[effect], SCENE_SFX_KITS[this.scene]));
  }

  private async ensurePlayer(): Promise<SfxPlayer> {
    if (this.player) return this.player;
    if (this.playerLoadPromise) return this.playerLoadPromise;

    this.playerLoadPromise = import('./sfxPlayer')
      .then((module) => {
        const nextPlayer = new module.SfxPlayer();
        nextPlayer.setSfxVolume(this.settings.sfxVolume);
        nextPlayer.setPerformanceProfile(this.performanceProfile);
        this.player = nextPlayer;
        return nextPlayer;
      })
      .finally(() => {
        this.playerLoadPromise = null;
      });

    return this.playerLoadPromise;
  }
}

export const audioManager = new AudioManager();
