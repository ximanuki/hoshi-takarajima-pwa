import type { Settings } from '../types';
import { AudioLabPlayer, type TonePresetId, type ToneSfxId } from './audioLabPlayer';

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

class AudioManager {
  private player = new AudioLabPlayer();
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
      this.player.stop();
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

    this.player.setBgmVolume(this.settings.bgmVolume);
    this.player.setSfxVolume(this.settings.sfxVolume);

    if (!this.settings.soundEnabled) {
      this.sceneGeneration += 1;
      this.player.stop();
      return;
    }

    void this.startSceneIfReady();
  }

  async unlock() {
    try {
      await this.player.unlock();
    } catch {
      return;
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
    void this.player.playToneSfx(toneEffect, presetId);
  }

  private async startSceneIfReady() {
    if (!this.unlocked || this.bgmSuppressed || !this.settings.soundEnabled) return;

    const generation = ++this.sceneGeneration;
    const presetId = SCENE_PRESETS[this.scene];

    try {
      await this.player.playTone(presetId);
    } catch {
      return;
    }

    if (generation !== this.sceneGeneration) {
      // Ignore stale starts caused by rapid scene changes.
      return;
    }
  }
}

export const audioManager = new AudioManager();
