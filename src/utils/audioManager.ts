import type { Settings } from '../types';
import type { AudioLabPlayer } from './audioLabPlayer';

type AudioPerformanceProfile = import('./audioLabPlayer').AudioPerformanceProfile;
type AssetBgmId = import('./audioLabPlayer').AssetBgmId;
type TonePresetId = import('./audioLabPlayer').TonePresetId;
type ToneSfxId = import('./audioLabPlayer').ToneSfxId;

export type AudioScene = 'home' | 'mission' | 'play' | 'result';
export type SoundEffect = 'tap' | 'correct' | 'wrong' | 'combo' | 'clear';

const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  bgmVolume: 0.6,
  sfxVolume: 0.8,
};

const SCENE_PRESETS: Record<AudioScene, TonePresetId> = {
  home: 'ambient_stars',
  mission: 'uk_garage_neon',
  play: 'future_garage_mist',
  result: 'lofi_jersey',
};

const SCENE_ASSETS: Record<AudioScene, AssetBgmId> = {
  home: 'home',
  mission: 'mission',
  play: 'play',
  result: 'result',
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
  private player: AudioLabPlayer | null = null;
  private playerLoadPromise: Promise<AudioLabPlayer> | null = null;
  private performanceProfile: AudioPerformanceProfile = detectPerformanceProfile();
  private tonePrewarmed = false;
  private unlocked = false;
  private bgmSuppressed = false;
  private settings: Settings = DEFAULT_SETTINGS;
  private scene: AudioScene = 'home';
  private sceneGeneration = 0;
  private lastEffectAt: Partial<Record<SoundEffect, number>> = {};

  setScene(scene: AudioScene) {
    if (this.scene === scene) return;
    this.scene = scene;
    void this.startSceneIfReady();
  }

  setBgmSuppressed(suppressed: boolean) {
    this.bgmSuppressed = suppressed;
    if (suppressed) {
      this.sceneGeneration += 1;
      this.player?.stop();
      return;
    }

    void this.startSceneIfReady();
  }

  setSettings(next: Settings) {
    this.settings = {
      soundEnabled: Boolean(next.soundEnabled),
      bgmVolume: clamp01(next.bgmVolume),
      sfxVolume: clamp01(next.sfxVolume),
    };

    this.player?.setBgmVolume(this.settings.bgmVolume);
    this.player?.setSfxVolume(this.settings.sfxVolume);

    if (!this.settings.soundEnabled) {
      this.sceneGeneration += 1;
      this.player?.stop();
      return;
    }

    void this.startSceneIfReady();
  }

  async unlock() {
    if (!this.settings.soundEnabled) return;
    const player = await this.ensurePlayer();
    if (!this.tonePrewarmed) {
      this.tonePrewarmed = true;
      void player.prewarmTone();
    }
    this.unlocked = true;
    if (this.settings.soundEnabled && !this.bgmSuppressed) {
      await this.startSceneIfReady();
    }
  }

  playSfx(effect: SoundEffect) {
    if (!this.unlocked || !this.settings.soundEnabled) return;

    const nowMs = performance.now();
    const cooldown = EFFECT_COOLDOWN_MS[effect] ?? 0;
    const lastAt = this.lastEffectAt[effect] ?? -Infinity;
    if (nowMs - lastAt < cooldown) return;
    this.lastEffectAt[effect] = nowMs;

    const presetId = SCENE_PRESETS[this.scene];
    const toneEffect = EFFECT_TO_TONE[effect];
    void this.playToneEffect(toneEffect, presetId);
  }

  private async startSceneIfReady() {
    if (!this.unlocked || this.bgmSuppressed || !this.settings.soundEnabled) return;

    const generation = ++this.sceneGeneration;
    const assetId = SCENE_ASSETS[this.scene];
    const player = await this.ensurePlayer();

    try {
      await player.playAsset(assetId);
    } catch {
      return;
    }

    if (generation !== this.sceneGeneration) {
      // Ignore stale starts caused by rapid scene changes.
      return;
    }
  }

  private async playToneEffect(effect: ToneSfxId, presetId: TonePresetId) {
    const player = await this.ensurePlayer();
    await player.playToneSfx(effect, presetId);
  }

  private async ensurePlayer(): Promise<AudioLabPlayer> {
    if (this.player) return this.player;
    if (this.playerLoadPromise) return this.playerLoadPromise;

    this.playerLoadPromise = import('./audioLabPlayer')
      .then((module) => {
        const nextPlayer = new module.AudioLabPlayer();
        nextPlayer.setBgmVolume(this.settings.bgmVolume);
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
