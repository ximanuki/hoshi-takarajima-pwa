import type { Settings } from '../types';

export type SoundEffect = 'correct' | 'wrong' | 'clear';

const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  bgmVolume: 0.6,
  sfxVolume: 0.8,
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
  private settings: Settings = DEFAULT_SETTINGS;

  setSettings(next: Settings) {
    this.settings = {
      soundEnabled: Boolean(next.soundEnabled),
      bgmVolume: clamp01(next.bgmVolume),
      sfxVolume: clamp01(next.sfxVolume),
    };

    if (!this.context) return;
    this.applyGainValues(this.context.currentTime);

    if (!this.settings.soundEnabled) {
      this.stopBgm();
      return;
    }

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
    const now = this.context.currentTime;

    if (effect === 'correct') {
      this.playTone({ at: now, duration: 0.14, frequency: 523, gain: 0.16, type: 'triangle', output: this.sfxGain });
      this.playTone({
        at: now + 0.13,
        duration: 0.18,
        frequency: 659,
        gain: 0.15,
        type: 'triangle',
        output: this.sfxGain,
      });
      return;
    }

    if (effect === 'wrong') {
      this.playTone({ at: now, duration: 0.16, frequency: 340, gain: 0.14, type: 'sawtooth', output: this.sfxGain });
      this.playTone({
        at: now + 0.12,
        duration: 0.2,
        frequency: 240,
        gain: 0.12,
        type: 'sawtooth',
        output: this.sfxGain,
      });
      return;
    }

    this.playTone({ at: now, duration: 0.14, frequency: 523, gain: 0.16, type: 'triangle', output: this.sfxGain });
    this.playTone({
      at: now + 0.12,
      duration: 0.14,
      frequency: 659,
      gain: 0.16,
      type: 'triangle',
      output: this.sfxGain,
    });
    this.playTone({
      at: now + 0.24,
      duration: 0.22,
      frequency: 784,
      gain: 0.17,
      type: 'triangle',
      output: this.sfxGain,
    });
  }

  private ensureContext(): boolean {
    if (typeof window === 'undefined') return false;
    if (this.context) return true;

    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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

  private applyGainValues(atTime: number) {
    if (!this.bgmGain || !this.sfxGain) return;

    const bgmTarget = this.settings.soundEnabled && this.unlocked ? curveVolume(this.settings.bgmVolume) * 0.42 : 0;
    const sfxTarget = this.settings.soundEnabled && this.unlocked ? curveVolume(this.settings.sfxVolume) * 0.9 : 0;

    this.bgmGain.gain.cancelScheduledValues(atTime);
    this.bgmGain.gain.setTargetAtTime(bgmTarget, atTime, 0.12);

    this.sfxGain.gain.cancelScheduledValues(atTime);
    this.sfxGain.gain.setTargetAtTime(sfxTarget, atTime, 0.06);
  }

  private startBgm() {
    if (!this.context || !this.bgmGain || !this.settings.soundEnabled) return;
    if (this.bgmLoopTimer !== null) return;
    this.scheduleBgmLoop();
  }

  private stopBgm() {
    if (this.bgmLoopTimer !== null) {
      window.clearTimeout(this.bgmLoopTimer);
      this.bgmLoopTimer = null;
    }

    if (!this.context || !this.bgmGain) return;
    const now = this.context.currentTime;
    this.bgmGain.gain.cancelScheduledValues(now);
    this.bgmGain.gain.setTargetAtTime(0, now, 0.08);
  }

  private scheduleBgmLoop() {
    if (!this.context || !this.bgmGain || !this.settings.soundEnabled || !this.unlocked) {
      this.stopBgm();
      return;
    }

    const bgmGain = this.bgmGain;
    const beat = 0.32;
    const melody = [392, 440, 523, 440, 392, 349, 392, 330];
    const startAt = this.context.currentTime + 0.05;

    melody.forEach((frequency, index) => {
      this.playTone({
        at: startAt + beat * index,
        duration: beat * 0.8,
        frequency,
        gain: 0.09,
        type: 'sine',
        output: bgmGain,
      });
    });

    const loopMs = Math.round(melody.length * beat * 1000);
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
    envelope.gain.linearRampToValueAtTime(gain, at + Math.min(0.03, duration * 0.45));
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    oscillator.connect(envelope);
    envelope.connect(output);

    oscillator.start(at);
    oscillator.stop(at + duration + 0.03);
  }
}

export const audioManager = new AudioManager();
