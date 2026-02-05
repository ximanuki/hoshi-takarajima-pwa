import type { FeedbackDelay, Gain, MembraneSynth, MonoSynth, NoiseSynth, PolySynth, Reverb, Sequence } from 'tone';

export type AudioLabEngine = 'none' | 'asset' | 'tone';
export type TonePresetId = 'lofi_cafe' | 'lofi_rain' | 'ambient_stars' | 'ambient_dream';
export type ToneSfxId = 'tap' | 'correct' | 'miss' | 'clear';

type ToneModule = typeof import('tone');

type TonePresetMeta = {
  id: TonePresetId;
  name: string;
  description: string;
  genre: 'lofi' | 'ambient';
};

type TonePresetConfig = TonePresetMeta & {
  bpm: number;
  bars: number;
  barChords: string[][];
  leadMotifs: Array<Array<string | null>>;
  bassMotifs: Array<Array<string | null>>;
  kickMotif: number[];
  snareMotif: number[];
  hatMotif: number[];
  crackleMotif: number[];
  leadDuration: string;
  bassDuration: string;
  padDuration: string;
  leadVelocity: number;
  bassVelocity: number;
  padVelocity: number;
  kickVelocity: number;
  snareVelocity: number;
  hatVelocity: number;
  crackleVelocity: number;
  reverbWet: number;
  delayWet: number;
  masterGain: number;
  padStrideBars: number;
};

const STEPS_PER_BAR = 8;
const LOOP_BARS = 32;

const TONE_PRESET_LIBRARY: Record<TonePresetId, TonePresetConfig> = {
  lofi_cafe: {
    id: 'lofi_cafe',
    name: 'Lo-fi 1: ほうかごカフェ',
    description: 'Lo-fi beats / 32小節ループ / あたたかい放課後',
    genre: 'lofi',
    bpm: 78,
    bars: LOOP_BARS,
    barChords: [
      ['C4', 'E4', 'G4', 'B4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['D4', 'F4', 'A4', 'C5'],
      ['G3', 'B3', 'D4', 'F4'],
      ['C4', 'E4', 'G4', 'B4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['F3', 'A3', 'C4', 'E4'],
      ['G3', 'B3', 'D4', 'F4'],
      ['E3', 'G3', 'B3', 'D4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['D4', 'F4', 'A4', 'C5'],
      ['G3', 'B3', 'D4', 'F4'],
      ['C4', 'E4', 'G4', 'B4'],
      ['B3', 'D4', 'F4', 'A4'],
      ['E3', 'G3', 'B3', 'D4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['F3', 'A3', 'C4', 'E4'],
      ['G3', 'B3', 'D4', 'F4'],
      ['E3', 'G3', 'B3', 'D4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['D4', 'F4', 'A4', 'C5'],
      ['G3', 'B3', 'D4', 'F4'],
      ['C4', 'E4', 'G4', 'B4'],
      ['G3', 'B3', 'D4', 'F4'],
      ['C4', 'E4', 'G4', 'B4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['D4', 'F4', 'A4', 'C5'],
      ['G3', 'B3', 'D4', 'F4'],
      ['F3', 'A3', 'C4', 'E4'],
      ['E3', 'G3', 'B3', 'D4'],
      ['D4', 'F4', 'A4', 'C5'],
      ['G3', 'B3', 'D4', 'F4'],
    ],
    leadMotifs: [
      [null, 'E4', null, 'G4', null, 'A4', null, 'G4'],
      [null, 'D4', null, 'E4', null, 'G4', null, 'E4'],
      [null, 'G4', null, 'A4', null, 'B4', null, 'A4'],
      [null, 'E4', null, 'D4', null, 'C4', null, null],
    ],
    bassMotifs: [
      ['C2', null, null, null, 'G1', null, null, null],
      ['A1', null, null, null, 'E2', null, null, null],
      ['D2', null, null, null, 'A1', null, null, null],
      ['G1', null, null, null, 'D2', null, null, null],
    ],
    kickMotif: [0, 5],
    snareMotif: [4],
    hatMotif: [1, 3, 5, 7],
    crackleMotif: [2, 6],
    leadDuration: '8n',
    bassDuration: '4n',
    padDuration: '1m',
    leadVelocity: 0.34,
    bassVelocity: 0.58,
    padVelocity: 0.2,
    kickVelocity: 0.64,
    snareVelocity: 0.2,
    hatVelocity: 0.12,
    crackleVelocity: 0.05,
    reverbWet: 0.2,
    delayWet: 0.16,
    masterGain: 0.85,
    padStrideBars: 1,
  },
  lofi_rain: {
    id: 'lofi_rain',
    name: 'Lo-fi 2: あめのとしょしつ',
    description: 'Lo-fi beats / 32小節ループ / 雨音みたいな質感',
    genre: 'lofi',
    bpm: 72,
    bars: LOOP_BARS,
    barChords: [
      ['D4', 'F4', 'A4', 'C5'],
      ['G3', 'B3', 'D4', 'F4'],
      ['C4', 'E4', 'G4', 'B4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['D4', 'F4', 'A4', 'C5'],
      ['G3', 'B3', 'D4', 'F4'],
      ['F3', 'A3', 'C4', 'E4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['E3', 'G3', 'B3', 'D4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['D4', 'F4', 'A4', 'C5'],
      ['G3', 'B3', 'D4', 'F4'],
      ['C4', 'E4', 'G4', 'B4'],
      ['B3', 'D4', 'F4', 'A4'],
      ['E3', 'G3', 'B3', 'D4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['F3', 'A3', 'C4', 'E4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['D4', 'F4', 'A4', 'C5'],
      ['G3', 'B3', 'D4', 'F4'],
      ['E3', 'G3', 'B3', 'D4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['D4', 'F4', 'A4', 'C5'],
      ['G3', 'B3', 'D4', 'F4'],
      ['D4', 'F4', 'A4', 'C5'],
      ['G3', 'B3', 'D4', 'F4'],
      ['C4', 'E4', 'G4', 'B4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['F3', 'A3', 'C4', 'E4'],
      ['E3', 'G3', 'B3', 'D4'],
      ['D4', 'F4', 'A4', 'C5'],
      ['A3', 'C4', 'E4', 'G4'],
    ],
    leadMotifs: [
      [null, null, 'F4', null, null, 'A4', null, null],
      [null, 'E4', null, null, 'G4', null, null, null],
      [null, null, 'D4', null, null, 'F4', null, null],
      [null, 'C4', null, null, 'E4', null, null, null],
    ],
    bassMotifs: [
      ['D2', null, null, null, null, null, 'A1', null],
      ['G1', null, null, null, null, null, 'D2', null],
      ['C2', null, null, null, null, null, 'G1', null],
      ['A1', null, null, null, null, null, 'E2', null],
    ],
    kickMotif: [0],
    snareMotif: [4],
    hatMotif: [2, 6],
    crackleMotif: [1, 5],
    leadDuration: '8n',
    bassDuration: '2n',
    padDuration: '1m',
    leadVelocity: 0.3,
    bassVelocity: 0.55,
    padVelocity: 0.22,
    kickVelocity: 0.58,
    snareVelocity: 0.18,
    hatVelocity: 0.1,
    crackleVelocity: 0.06,
    reverbWet: 0.24,
    delayWet: 0.14,
    masterGain: 0.82,
    padStrideBars: 1,
  },
  ambient_stars: {
    id: 'ambient_stars',
    name: 'Ambient 1: ほしぞらのうみ',
    description: 'Ambient / 32小節ループ / ひろがる空間',
    genre: 'ambient',
    bpm: 64,
    bars: LOOP_BARS,
    barChords: [
      ['C4', 'G4', 'B4', 'D5'],
      ['A3', 'E4', 'G4', 'C5'],
      ['F3', 'C4', 'E4', 'A4'],
      ['G3', 'D4', 'F4', 'A4'],
      ['C4', 'G4', 'B4', 'E5'],
      ['A3', 'E4', 'G4', 'C5'],
      ['F3', 'C4', 'E4', 'A4'],
      ['G3', 'D4', 'F4', 'B4'],
      ['E3', 'B3', 'D4', 'G4'],
      ['A3', 'E4', 'G4', 'C5'],
      ['D4', 'A4', 'C5', 'F5'],
      ['G3', 'D4', 'F4', 'A4'],
      ['C4', 'G4', 'B4', 'D5'],
      ['G3', 'D4', 'F4', 'B4'],
      ['E3', 'B3', 'D4', 'G4'],
      ['A3', 'E4', 'G4', 'C5'],
      ['F3', 'C4', 'E4', 'A4'],
      ['G3', 'D4', 'F4', 'B4'],
      ['C4', 'G4', 'B4', 'E5'],
      ['A3', 'E4', 'G4', 'C5'],
      ['D4', 'A4', 'C5', 'F5'],
      ['G3', 'D4', 'F4', 'A4'],
      ['E3', 'B3', 'D4', 'G4'],
      ['A3', 'E4', 'G4', 'C5'],
      ['C4', 'G4', 'B4', 'D5'],
      ['A3', 'E4', 'G4', 'C5'],
      ['F3', 'C4', 'E4', 'A4'],
      ['G3', 'D4', 'F4', 'A4'],
      ['E3', 'B3', 'D4', 'G4'],
      ['A3', 'E4', 'G4', 'C5'],
      ['D4', 'A4', 'C5', 'F5'],
      ['C4', 'G4', 'B4', 'E5'],
    ],
    leadMotifs: [
      ['G5', null, null, null, 'E5', null, null, null],
      [null, null, 'A5', null, null, null, 'G5', null],
      ['F5', null, null, null, 'D5', null, null, null],
      [null, null, 'E5', null, null, null, 'C5', null],
    ],
    bassMotifs: [
      ['C2', null, null, null, null, null, null, null],
      ['A1', null, null, null, null, null, null, null],
      ['F1', null, null, null, null, null, null, null],
      ['G1', null, null, null, null, null, null, null],
    ],
    kickMotif: [],
    snareMotif: [],
    hatMotif: [],
    crackleMotif: [3],
    leadDuration: '2n',
    bassDuration: '1m',
    padDuration: '2m',
    leadVelocity: 0.24,
    bassVelocity: 0.34,
    padVelocity: 0.25,
    kickVelocity: 0,
    snareVelocity: 0,
    hatVelocity: 0,
    crackleVelocity: 0.025,
    reverbWet: 0.36,
    delayWet: 0.24,
    masterGain: 0.74,
    padStrideBars: 2,
  },
  ambient_dream: {
    id: 'ambient_dream',
    name: 'Ambient 2: ゆめみるしんかい',
    description: 'Ambient / 32小節ループ / 深く静かな浮遊感',
    genre: 'ambient',
    bpm: 58,
    bars: LOOP_BARS,
    barChords: [
      ['A3', 'E4', 'G4', 'C5'],
      ['F3', 'C4', 'E4', 'A4'],
      ['D3', 'A3', 'C4', 'F4'],
      ['G3', 'D4', 'F4', 'A4'],
      ['A3', 'E4', 'G4', 'C5'],
      ['F3', 'C4', 'E4', 'A4'],
      ['E3', 'B3', 'D4', 'G4'],
      ['G3', 'D4', 'F4', 'A4'],
      ['C4', 'G4', 'B4', 'D5'],
      ['A3', 'E4', 'G4', 'C5'],
      ['F3', 'C4', 'E4', 'A4'],
      ['D3', 'A3', 'C4', 'F4'],
      ['E3', 'B3', 'D4', 'G4'],
      ['G3', 'D4', 'F4', 'A4'],
      ['A3', 'E4', 'G4', 'C5'],
      ['F3', 'C4', 'E4', 'A4'],
      ['D3', 'A3', 'C4', 'F4'],
      ['G3', 'D4', 'F4', 'A4'],
      ['C4', 'G4', 'B4', 'D5'],
      ['A3', 'E4', 'G4', 'C5'],
      ['F3', 'C4', 'E4', 'A4'],
      ['D3', 'A3', 'C4', 'F4'],
      ['E3', 'B3', 'D4', 'G4'],
      ['G3', 'D4', 'F4', 'A4'],
      ['A3', 'E4', 'G4', 'C5'],
      ['F3', 'C4', 'E4', 'A4'],
      ['D3', 'A3', 'C4', 'F4'],
      ['G3', 'D4', 'F4', 'A4'],
      ['E3', 'B3', 'D4', 'G4'],
      ['A3', 'E4', 'G4', 'C5'],
      ['F3', 'C4', 'E4', 'A4'],
      ['A3', 'E4', 'G4', 'C5'],
    ],
    leadMotifs: [
      [null, null, 'C5', null, null, null, 'E5', null],
      [null, null, 'B4', null, null, null, 'D5', null],
      [null, null, 'A4', null, null, null, 'C5', null],
      [null, null, 'G4', null, null, null, 'B4', null],
    ],
    bassMotifs: [
      ['A1', null, null, null, null, null, null, null],
      ['F1', null, null, null, null, null, null, null],
      ['D1', null, null, null, null, null, null, null],
      ['G1', null, null, null, null, null, null, null],
    ],
    kickMotif: [],
    snareMotif: [],
    hatMotif: [],
    crackleMotif: [5],
    leadDuration: '2n',
    bassDuration: '1m',
    padDuration: '2m',
    leadVelocity: 0.22,
    bassVelocity: 0.32,
    padVelocity: 0.24,
    kickVelocity: 0,
    snareVelocity: 0,
    hatVelocity: 0,
    crackleVelocity: 0.02,
    reverbWet: 0.42,
    delayWet: 0.28,
    masterGain: 0.72,
    padStrideBars: 2,
  },
};

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function curvedVolume(value: number): number {
  return Math.pow(clamp01(value), 1.3);
}

export class AudioLabPlayer {
  private assetAudio: HTMLAudioElement | null = null;
  private tone: ToneModule | null = null;
  private toneLoadPromise: Promise<ToneModule> | null = null;
  private toneLoading = false;
  private toneGain: Gain | null = null;
  private toneLead: PolySynth | null = null;
  private toneBass: MonoSynth | null = null;
  private toneKick: MembraneSynth | null = null;
  private toneSnare: NoiseSynth | null = null;
  private toneHat: NoiseSynth | null = null;
  private toneCrackle: NoiseSynth | null = null;
  private tonePad: PolySynth | null = null;
  private toneReverb: Reverb | null = null;
  private toneDelay: FeedbackDelay | null = null;
  private toneSequence: Sequence<number> | null = null;
  private currentTonePreset: TonePresetId = 'lofi_cafe';
  private engine: AudioLabEngine = 'none';
  private volume = 0.65;

  getEngine(): AudioLabEngine {
    return this.engine;
  }

  getTonePresets(): TonePresetMeta[] {
    return (Object.keys(TONE_PRESET_LIBRARY) as TonePresetId[]).map((id) => {
      const { name, description, genre } = TONE_PRESET_LIBRARY[id];
      return { id, name, description, genre };
    });
  }

  getCurrentTonePreset(): TonePresetId {
    return this.currentTonePreset;
  }

  isToneLoading(): boolean {
    return this.toneLoading;
  }

  setVolume(nextVolume: number) {
    this.volume = clamp01(nextVolume);
    const next = curvedVolume(this.volume);
    if (this.assetAudio) this.assetAudio.volume = next;
    if (this.toneGain?.gain?.rampTo) {
      this.toneGain.gain.rampTo(next * 0.9, 0.08);
    }
  }

  async unlock() {
    const tone = await this.loadTone();
    try {
      await tone.start();
    } catch {
      // Ignore rejected autoplay unlock and retry on next interaction.
    }
  }

  async playAsset() {
    this.stopTone();
    this.ensureAssetAudio();
    if (!this.assetAudio) return;

    this.assetAudio.currentTime = 0;
    this.assetAudio.volume = curvedVolume(this.volume);
    this.engine = 'asset';

    try {
      await this.assetAudio.play();
    } catch {
      await this.unlock();
      try {
        await this.assetAudio.play();
      } catch {
        this.engine = 'none';
      }
    }
  }

  async playTone(presetId: TonePresetId = this.currentTonePreset) {
    this.stopAsset();
    const tone = await this.loadTone();

    try {
      await tone.start();
    } catch {
      this.engine = 'none';
      return;
    }

    this.stopTone();
    this.currentTonePreset = presetId;
    this.buildToneGraph(tone, presetId);
    tone.Transport.start('+0.04');
    this.engine = 'tone';
  }

  async playToneSfx(sfxId: ToneSfxId, presetId: TonePresetId = this.currentTonePreset) {
    const tone = await this.loadTone();
    try {
      await tone.start();
    } catch {
      return;
    }

    const preset = TONE_PRESET_LIBRARY[presetId];
    const now = tone.now();
    const output = new tone.Gain(curvedVolume(this.volume) * 0.8).toDestination();
    const reverb = new tone.Reverb({ decay: preset.genre === 'ambient' ? 4.8 : 2.2, wet: preset.genre === 'ambient' ? 0.34 : 0.2 });
    reverb.connect(output);
    const delay = new tone.FeedbackDelay('16n', preset.genre === 'ambient' ? 0.3 : 0.18);
    delay.wet.value = preset.genre === 'ambient' ? 0.22 : 0.12;
    delay.connect(output);

    const disposables: Array<{ dispose: () => void }> = [output, reverb, delay];

    if (presetId === 'lofi_cafe') {
      if (sfxId === 'tap') {
        const pluck = new tone.PluckSynth({ attackNoise: 0.8, dampening: 3600, resonance: 0.7 }).connect(delay);
        pluck.triggerAttack('E5', now);
        disposables.push(pluck);
      } else if (sfxId === 'correct') {
        const chord = new tone.PolySynth(tone.Synth, {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.01, decay: 0.12, sustain: 0.25, release: 0.16 },
        });
        chord.connect(reverb);
        chord.triggerAttackRelease(['C5', 'E5', 'G5'], '8n', now, 0.32);
        disposables.push(chord);
      } else if (sfxId === 'miss') {
        const mono = new tone.MonoSynth({
          oscillator: { type: 'square' },
          envelope: { attack: 0.01, decay: 0.2, sustain: 0.1, release: 0.1 },
        }).connect(output);
        mono.triggerAttackRelease('B2', '8n', now, 0.2);
        mono.triggerAttackRelease('G2', '8n', now + 0.11, 0.17);
        disposables.push(mono);
      } else {
        const bell = new tone.PolySynth(tone.AMSynth, {
          harmonicity: 1.6,
          envelope: { attack: 0.01, decay: 0.3, sustain: 0.2, release: 0.35 },
        });
        bell.connect(reverb);
        bell.triggerAttackRelease(['C5', 'E5', 'A5'], '4n', now, 0.35);
        disposables.push(bell);
      }
    } else if (presetId === 'lofi_rain') {
      if (sfxId === 'tap') {
        const drop = new tone.Synth({
          oscillator: { type: 'sine' },
          envelope: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.14 },
        }).connect(delay);
        drop.triggerAttackRelease('D5', '16n', now, 0.28);
        disposables.push(drop);
      } else if (sfxId === 'correct') {
        const soft = new tone.PolySynth(tone.Synth, {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.01, decay: 0.26, sustain: 0.15, release: 0.24 },
        });
        soft.connect(reverb);
        soft.triggerAttackRelease(['D5', 'F5', 'A5'], '8n', now, 0.28);
        disposables.push(soft);
      } else if (sfxId === 'miss') {
        const noise = new tone.NoiseSynth({
          noise: { type: 'pink' },
          envelope: { attack: 0.001, decay: 0.12, sustain: 0 },
        }).connect(output);
        noise.triggerAttackRelease('16n', now, 0.14);
        disposables.push(noise);
      } else {
        const swell = new tone.PolySynth(tone.AMSynth, {
          harmonicity: 1.25,
          envelope: { attack: 0.02, decay: 0.25, sustain: 0.2, release: 0.32 },
        });
        swell.connect(reverb);
        swell.triggerAttackRelease(['A4', 'C5', 'E5'], '4n', now, 0.3);
        disposables.push(swell);
      }
    } else if (presetId === 'ambient_stars') {
      if (sfxId === 'tap') {
        const blip = new tone.FMSynth({
          harmonicity: 2,
          modulationIndex: 4,
          envelope: { attack: 0.005, decay: 0.2, sustain: 0, release: 0.22 },
        }).connect(reverb);
        blip.triggerAttackRelease('G5', '8n', now, 0.23);
        disposables.push(blip);
      } else if (sfxId === 'correct') {
        const shimmer = new tone.PolySynth(tone.FMSynth, {
          harmonicity: 1.2,
          modulationIndex: 6,
          envelope: { attack: 0.06, decay: 0.3, sustain: 0.2, release: 0.8 },
        });
        shimmer.connect(reverb);
        shimmer.triggerAttackRelease(['C5', 'E5', 'G5', 'B5'], '2n', now, 0.24);
        disposables.push(shimmer);
      } else if (sfxId === 'miss') {
        const low = new tone.MonoSynth({
          oscillator: { type: 'sine' },
          envelope: { attack: 0.02, decay: 0.25, sustain: 0.12, release: 0.45 },
        }).connect(reverb);
        low.triggerAttackRelease('E2', '4n', now, 0.12);
        disposables.push(low);
      } else {
        const clear = new tone.PolySynth(tone.Synth, {
          oscillator: { type: 'sine' },
          envelope: { attack: 0.08, decay: 0.2, sustain: 0.28, release: 1 },
        });
        clear.connect(reverb);
        clear.triggerAttackRelease(['C5', 'G5', 'D6'], '1n', now, 0.22);
        disposables.push(clear);
      }
    } else {
      if (sfxId === 'tap') {
        const pulse = new tone.Synth({
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.01, decay: 0.18, sustain: 0.06, release: 0.26 },
        }).connect(reverb);
        pulse.triggerAttackRelease('A4', '8n', now, 0.2);
        disposables.push(pulse);
      } else if (sfxId === 'correct') {
        const dream = new tone.PolySynth(tone.AMSynth, {
          harmonicity: 1.1,
          envelope: { attack: 0.05, decay: 0.28, sustain: 0.24, release: 0.9 },
        });
        dream.connect(reverb);
        dream.triggerAttackRelease(['A4', 'C5', 'E5', 'G5'], '2n', now, 0.24);
        disposables.push(dream);
      } else if (sfxId === 'miss') {
        const hollow = new tone.MonoSynth({
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.02, decay: 0.2, sustain: 0.08, release: 0.35 },
        }).connect(reverb);
        hollow.triggerAttackRelease('D2', '4n', now, 0.12);
        hollow.triggerAttackRelease('C2', '8n', now + 0.2, 0.1);
        disposables.push(hollow);
      } else {
        const rise = new tone.PolySynth(tone.FMSynth, {
          harmonicity: 1.3,
          modulationIndex: 3.8,
          envelope: { attack: 0.09, decay: 0.2, sustain: 0.2, release: 1.1 },
        });
        rise.connect(reverb);
        rise.triggerAttackRelease(['E5', 'A5', 'C6'], '1n', now, 0.2);
        disposables.push(rise);
      }
    }

    window.setTimeout(() => {
      disposables.forEach((node) => node.dispose());
    }, preset.genre === 'ambient' ? 2600 : 1500);
  }

  stop() {
    this.stopAsset();
    this.stopTone();
    this.engine = 'none';
  }

  destroy() {
    this.stop();
    this.tone = null;
    this.toneLoadPromise = null;
  }

  private ensureAssetAudio() {
    if (this.assetAudio || typeof window === 'undefined') return;
    this.assetAudio = new Audio(`${import.meta.env.BASE_URL}assets/audio/bgm_asset_loop.wav`);
    this.assetAudio.loop = true;
    this.assetAudio.preload = 'auto';
  }

  private async loadTone(): Promise<ToneModule> {
    if (this.tone) return this.tone;
    if (this.toneLoadPromise) return this.toneLoadPromise;

    this.toneLoading = true;
    this.toneLoadPromise = import('tone')
      .then((tone) => {
        this.tone = tone;
        return tone;
      })
      .finally(() => {
        this.toneLoading = false;
      });

    return this.toneLoadPromise;
  }

  private stopAsset() {
    if (!this.assetAudio) return;
    this.assetAudio.pause();
    this.assetAudio.currentTime = 0;
  }

  private stopTone() {
    if (!this.tone) {
      this.disposeToneGraph();
      return;
    }

    this.tone.Transport.stop();
    this.tone.Transport.cancel(0);
    this.tone.Transport.position = 0;
    if (this.toneGain?.gain?.rampTo) {
      this.toneGain.gain.rampTo(0.0001, 0.05);
    }
    this.disposeToneGraph();
  }

  private buildToneGraph(tone: ToneModule, presetId: TonePresetId) {
    const preset = TONE_PRESET_LIBRARY[presetId];
    const totalSteps = preset.bars * STEPS_PER_BAR;

    tone.Transport.stop();
    tone.Transport.cancel(0);
    tone.Transport.position = 0;
    tone.Transport.bpm.value = preset.bpm;
    tone.Destination.volume.value = -9;
    tone.Transport.swing = preset.genre === 'lofi' ? 0.12 : 0;
    tone.Transport.swingSubdivision = '8n';

    this.toneGain = new tone.Gain(curvedVolume(this.volume) * preset.masterGain).toDestination();
    this.toneReverb = new tone.Reverb({ decay: preset.genre === 'ambient' ? 4.6 : 2.2, wet: preset.reverbWet }).connect(
      this.toneGain,
    );
    this.toneDelay = new tone.FeedbackDelay('8n', preset.genre === 'ambient' ? 0.26 : 0.18);
    this.toneDelay.wet.value = preset.delayWet;
    this.toneDelay.connect(this.toneGain);

    this.toneLead = new tone.PolySynth(tone.AMSynth, {
      harmonicity: preset.genre === 'ambient' ? 1.2 : 1.45,
      envelope: { attack: preset.genre === 'ambient' ? 0.08 : 0.02, decay: 0.2, sustain: 0.28, release: 0.4 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.01, decay: 0.18, sustain: 0.2, release: 0.3 },
    });
    this.toneLead.connect(this.toneReverb);
    this.toneLead.connect(this.toneDelay);

    this.tonePad = new tone.PolySynth(tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.14, decay: 0.35, sustain: 0.5, release: 0.9 },
    }).connect(this.toneReverb);

    this.toneBass = new tone.MonoSynth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.02, decay: 0.2, sustain: 0.22, release: 0.12 },
      filterEnvelope: { attack: 0.02, decay: 0.16, sustain: 0.05, release: 0.08, baseFrequency: 90, octaves: 2.2 },
    }).connect(this.toneGain);

    this.toneKick = new tone.MembraneSynth({
      pitchDecay: 0.03,
      octaves: 6,
      envelope: { attack: 0.001, decay: 0.12, sustain: 0 },
    }).connect(this.toneGain);

    this.toneSnare = new tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.12, sustain: 0 },
    }).connect(this.toneGain);

    this.toneHat = new tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0 },
    }).connect(this.toneGain);

    this.toneCrackle = new tone.NoiseSynth({
      noise: { type: 'brown' },
      envelope: { attack: 0.001, decay: 0.03, sustain: 0 },
    }).connect(this.toneGain);

    const steps = Array.from({ length: totalSteps }, (_, step) => step);
    this.toneSequence = new tone.Sequence((time, step) => {
      const bar = Math.floor(step / STEPS_PER_BAR);
      const section = Math.floor(bar / 8);
      const stepInBar = step % STEPS_PER_BAR;

      const leadMotif = preset.leadMotifs[(bar + section) % preset.leadMotifs.length];
      const leadNote = leadMotif[stepInBar];
      if (leadNote) {
        this.toneLead?.triggerAttackRelease(leadNote, preset.leadDuration, time, preset.leadVelocity);
      }

      const bassMotif = preset.bassMotifs[bar % preset.bassMotifs.length];
      const bassNote = bassMotif[stepInBar];
      if (bassNote) {
        this.toneBass?.triggerAttackRelease(bassNote, preset.bassDuration, time, preset.bassVelocity);
      }

      if (stepInBar === 0 && bar % preset.padStrideBars === 0) {
        const chord = preset.barChords[bar % preset.barChords.length];
        this.tonePad?.triggerAttackRelease(chord, preset.padDuration, time, preset.padVelocity);
      }

      if (preset.kickMotif.includes(stepInBar)) {
        this.toneKick?.triggerAttackRelease('C1', '8n', time, preset.kickVelocity);
      }

      if (preset.snareMotif.includes(stepInBar)) {
        this.toneSnare?.triggerAttackRelease('16n', time, preset.snareVelocity);
      }

      if (preset.hatMotif.includes(stepInBar)) {
        this.toneHat?.triggerAttackRelease('32n', time, preset.hatVelocity);
      }

      if (preset.crackleMotif.includes(stepInBar)) {
        this.toneCrackle?.triggerAttackRelease('64n', time, preset.crackleVelocity);
      }
    }, steps, '8n');

    this.toneSequence.start(0);
  }

  private disposeToneGraph() {
    this.toneSequence?.dispose();
    this.toneSequence = null;
    this.toneLead?.dispose();
    this.toneLead = null;
    this.tonePad?.dispose();
    this.tonePad = null;
    this.toneBass?.dispose();
    this.toneBass = null;
    this.toneKick?.dispose();
    this.toneKick = null;
    this.toneSnare?.dispose();
    this.toneSnare = null;
    this.toneHat?.dispose();
    this.toneHat = null;
    this.toneCrackle?.dispose();
    this.toneCrackle = null;
    this.toneDelay?.dispose();
    this.toneDelay = null;
    this.toneReverb?.dispose();
    this.toneReverb = null;
    this.toneGain?.dispose();
    this.toneGain = null;
  }
}
