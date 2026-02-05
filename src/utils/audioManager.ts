import type { Settings } from '../types';

export type AudioScene = 'home' | 'mission' | 'play' | 'result';
export type SoundEffect = 'tap' | 'correct' | 'wrong' | 'combo' | 'clear';

type SceneConfig = {
  beat: number;
  melody: number[];
  bass: number[];
  sparkle?: number[];
  leadType: OscillatorType;
  bassType: OscillatorType;
  sceneGain: number;
};

const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  bgmVolume: 0.6,
  sfxVolume: 0.8,
};

const SCENE_CONFIGS: Record<AudioScene, SceneConfig> = {
  home: {
    beat: 0.38,
    melody: [523, 587, 659, 587, 523, 494, 440, 494],
    bass: [131, 147, 165, 147],
    sparkle: [1047],
    leadType: 'sine',
    bassType: 'triangle',
    sceneGain: 0.86,
  },
  mission: {
    beat: 0.34,
    melody: [659, 698, 784, 698, 659, 587, 659, 784],
    bass: [165, 147, 175, 147],
    sparkle: [1175],
    leadType: 'triangle',
    bassType: 'triangle',
    sceneGain: 0.95,
  },
  play: {
    beat: 0.3,
    melody: [784, 740, 698, 659, 698, 740, 784, 659],
    bass: [196, 175, 165, 175],
    sparkle: [1319],
    leadType: 'triangle',
    bassType: 'sine',
    sceneGain: 1.04,
  },
  result: {
    beat: 0.32,
    melody: [784, 880, 988, 1175, 988, 880, 784, 988],
    bass: [196, 220, 247, 220],
    sparkle: [1319, 1568],
    leadType: 'triangle',
    bassType: 'triangle',
    sceneGain: 1.12,
  },
};

const EFFECT_COOLDOWN_MS: Partial<Record<SoundEffect, number>> = {
  tap: 70,
  combo: 900,
};

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function curveVolume(value: number): number {
  return Math.pow(clamp01(value), 1.35);
}

class AudioManager {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private unlocked = false;
  private bgmLoopTimer: number | null = null;
  private sceneSwitchTimer: number | null = null;
  private settings: Settings = DEFAULT_SETTINGS;
  private scene: AudioScene = 'home';
  private lastEffectAt: Partial<Record<SoundEffect, number>> = {};

  setScene(scene: AudioScene) {
    if (this.scene === scene) return;
    this.scene = scene;

    if (!this.context || !this.unlocked || !this.settings.soundEnabled) return;
    this.transitionScene();
  }

  setSettings(next: Settings) {
    this.settings = {
      soundEnabled: Boolean(next.soundEnabled),
      bgmVolume: clamp01(next.bgmVolume),
      sfxVolume: clamp01(next.sfxVolume),
    };

    if (!this.context) return;

    if (!this.settings.soundEnabled) {
      this.stopBgm();
      this.applyGainValues(this.context.currentTime);
      return;
    }

    this.applyGainValues(this.context.currentTime);
    if (this.unlocked) {
      this.startBgm();
    }
  }

  async unlock() {
    if (!this.ensureContext() || !this.context) return;

    if (this.context.state === 'suspended') {
      try {
        await this.context.resume();
      } catch {
        return;
      }
    }

    this.unlocked = true;
    this.applyGainValues(this.context.currentTime);
    if (this.settings.soundEnabled) {
      this.startBgm();
    }
  }

  playSfx(effect: SoundEffect) {
    if (!this.context || !this.sfxGain || !this.unlocked || !this.settings.soundEnabled) return;

    const nowMs = performance.now();
    if (!this.canPlayEffect(effect, nowMs)) return;

    const now = this.context.currentTime;
    this.duckBgm(now);

    if (effect === 'tap') {
      this.playTone({ at: now, duration: 0.045, frequency: 940, gain: 0.085, type: 'triangle', output: this.sfxGain });
      return;
    }

    if (effect === 'correct') {
      this.playTone({ at: now, duration: 0.12, frequency: 659, gain: 0.13, type: 'triangle', output: this.sfxGain });
      this.playTone({ at: now + 0.11, duration: 0.16, frequency: 880, gain: 0.14, type: 'triangle', output: this.sfxGain });
      return;
    }

    if (effect === 'wrong') {
      this.playTone({ at: now, duration: 0.13, frequency: 330, gain: 0.12, type: 'sawtooth', output: this.sfxGain });
      this.playTone({ at: now + 0.1, duration: 0.18, frequency: 247, gain: 0.11, type: 'sawtooth', output: this.sfxGain });
      return;
    }

    if (effect === 'combo') {
      this.playTone({ at: now, duration: 0.09, frequency: 784, gain: 0.13, type: 'triangle', output: this.sfxGain });
      this.playTone({ at: now + 0.08, duration: 0.1, frequency: 988, gain: 0.14, type: 'triangle', output: this.sfxGain });
      this.playTone({ at: now + 0.18, duration: 0.16, frequency: 1175, gain: 0.14, type: 'triangle', output: this.sfxGain });
      return;
    }

    this.playTone({ at: now, duration: 0.12, frequency: 784, gain: 0.13, type: 'triangle', output: this.sfxGain });
    this.playTone({ at: now + 0.11, duration: 0.16, frequency: 988, gain: 0.14, type: 'triangle', output: this.sfxGain });
    this.playTone({ at: now + 0.24, duration: 0.24, frequency: 1319, gain: 0.15, type: 'triangle', output: this.sfxGain });
  }

  private canPlayEffect(effect: SoundEffect, nowMs: number): boolean {
    const cooldown = EFFECT_COOLDOWN_MS[effect] ?? 0;
    const lastAt = this.lastEffectAt[effect] ?? -Infinity;
    if (nowMs - lastAt < cooldown) {
      return false;
    }
    this.lastEffectAt[effect] = nowMs;
    return true;
  }

  private ensureContext(): boolean {
    if (typeof window === 'undefined') return false;
    if (this.context) return true;

    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return false;

    this.context = new AudioContextCtor();
    this.masterGain = this.context.createGain();
    this.bgmGain = this.context.createGain();
    this.sfxGain = this.context.createGain();

    this.masterGain.gain.value = 0.95;
    this.masterGain.connect(this.context.destination);
    this.bgmGain.connect(this.masterGain);
    this.sfxGain.connect(this.masterGain);

    this.applyGainValues(this.context.currentTime);
    return true;
  }

  private getBgmTarget(): number {
    if (!this.settings.soundEnabled || !this.unlocked) return 0;
    const sceneGain = SCENE_CONFIGS[this.scene].sceneGain;
    return curveVolume(this.settings.bgmVolume) * 0.42 * sceneGain;
  }

  private getSfxTarget(): number {
    if (!this.settings.soundEnabled || !this.unlocked) return 0;
    return curveVolume(this.settings.sfxVolume) * 0.88;
  }

  private applyGainValues(atTime: number) {
    if (!this.bgmGain || !this.sfxGain) return;

    this.bgmGain.gain.cancelScheduledValues(atTime);
    this.bgmGain.gain.setTargetAtTime(this.getBgmTarget(), atTime, 0.12);

    this.sfxGain.gain.cancelScheduledValues(atTime);
    this.sfxGain.gain.setTargetAtTime(this.getSfxTarget(), atTime, 0.07);
  }

  private startBgm() {
    if (!this.context || !this.bgmGain || !this.settings.soundEnabled || this.bgmLoopTimer !== null) return;
    this.scheduleBgmLoop();
  }

  private stopBgm() {
    if (this.sceneSwitchTimer !== null) {
      window.clearTimeout(this.sceneSwitchTimer);
      this.sceneSwitchTimer = null;
    }

    if (this.bgmLoopTimer !== null) {
      window.clearTimeout(this.bgmLoopTimer);
      this.bgmLoopTimer = null;
    }

    if (!this.context || !this.bgmGain) return;

    const now = this.context.currentTime;
    this.bgmGain.gain.cancelScheduledValues(now);
    this.bgmGain.gain.setTargetAtTime(0, now, 0.08);
  }

  private transitionScene() {
    if (!this.context || !this.bgmGain) return;

    if (this.sceneSwitchTimer !== null) {
      window.clearTimeout(this.sceneSwitchTimer);
      this.sceneSwitchTimer = null;
    }

    if (this.bgmLoopTimer !== null) {
      window.clearTimeout(this.bgmLoopTimer);
      this.bgmLoopTimer = null;
    }

    const now = this.context.currentTime;
    this.bgmGain.gain.cancelScheduledValues(now);
    this.bgmGain.gain.setTargetAtTime(0.0001, now, 0.08);

    this.sceneSwitchTimer = window.setTimeout(() => {
      this.sceneSwitchTimer = null;
      if (!this.context || !this.bgmGain || !this.settings.soundEnabled || !this.unlocked) return;

      const startAt = this.context.currentTime;
      this.bgmGain.gain.cancelScheduledValues(startAt);
      this.bgmGain.gain.setValueAtTime(0.0001, startAt);
      this.scheduleBgmLoop();
      this.bgmGain.gain.setTargetAtTime(this.getBgmTarget(), startAt, 0.14);
    }, 210);
  }

  private duckBgm(atTime: number) {
    if (!this.bgmGain) return;

    const target = this.getBgmTarget();
    if (target <= 0.0002) return;

    const dip = Math.max(0.0001, target * 0.42);
    this.bgmGain.gain.cancelScheduledValues(atTime);
    this.bgmGain.gain.setTargetAtTime(dip, atTime, 0.015);
    this.bgmGain.gain.setTargetAtTime(target, atTime + 0.16, 0.11);
  }

  private scheduleBgmLoop() {
    if (!this.context || !this.bgmGain || !this.settings.soundEnabled || !this.unlocked) {
      this.stopBgm();
      return;
    }

    const bgmGain = this.bgmGain;
    const config = SCENE_CONFIGS[this.scene];
    const startAt = this.context.currentTime + 0.05;

    config.melody.forEach((frequency, index) => {
      const at = startAt + config.beat * index;

      this.playTone({
        at,
        duration: config.beat * 0.72,
        frequency,
        gain: 0.078,
        type: config.leadType,
        output: bgmGain,
      });

      if (index % 2 === 0) {
        const bass = config.bass[(index / 2) % config.bass.length];
        this.playTone({
          at,
          duration: config.beat * 1.35,
          frequency: bass,
          gain: 0.058,
          type: config.bassType,
          output: bgmGain,
        });
      }

      if (config.sparkle && index % 4 === 1) {
        const sparkle = config.sparkle[Math.floor(index / 4) % config.sparkle.length];
        this.playTone({
          at: at + config.beat * 0.16,
          duration: config.beat * 0.34,
          frequency: sparkle,
          gain: 0.04,
          type: 'triangle',
          output: bgmGain,
        });
      }
    });

    const loopMs = Math.round(config.melody.length * config.beat * 1000);
    this.bgmLoopTimer = window.setTimeout(() => {
      this.bgmLoopTimer = null;
      this.scheduleBgmLoop();
    }, loopMs);
  }

  private playTone({
    at,
    duration,
    frequency,
    gain,
    type,
    output,
  }: {
    at: number;
    duration: number;
    frequency: number;
    gain: number;
    type: OscillatorType;
    output: GainNode;
  }) {
    if (!this.context) return;

    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);

    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.linearRampToValueAtTime(gain, at + Math.min(0.03, duration * 0.4));
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    oscillator.connect(envelope);
    envelope.connect(output);

    oscillator.start(at);
    oscillator.stop(at + duration + 0.03);
  }
}

export const audioManager = new AudioManager();
