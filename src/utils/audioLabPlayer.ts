import type { Gain, Sequence } from 'tone';

export type AudioLabEngine = 'none' | 'asset' | 'tone';
export type TonePresetId = 'lofi_cafe' | 'lofi_rain' | 'lofi_jersey' | 'lofi_2step' | 'ambient_stars' | 'ambient_dream';
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
  swing: number;
  humanizeSec: number;
  chordProgression: string[][];
  leadMotifs: Array<Array<string | null>>;
  bassMotifs: Array<Array<string | null>>;
  keyPattern: number[];
  kickPattern: number[];
  clapPattern: number[];
  hatPattern: number[];
  ghostPattern: number[];
  openHatPattern: number[];
  texturePattern: number[];
  subPattern: number[];
  padStrideBars: number;
  padDuration: string;
  leadDuration: string;
  bassDuration: string;
  leadVelocity: number;
  bassVelocity: number;
  padVelocity: number;
  masterGain: number;
  reverbWet: number;
  delayWet: number;
  sfxScale: string[];
};

const STEPS_PER_BAR = 16;
const LOOP_BARS = 32;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function curvedVolume(value: number): number {
  return Math.pow(clamp01(value), 1.3);
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pattern(indices: number[], velocity: number): number[] {
  const result = Array.from({ length: STEPS_PER_BAR }, () => 0);
  indices.forEach((step) => {
    result[((step % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR] = velocity;
  });
  return result;
}

function rotateChord(chord: string[], shift: number): string[] {
  const normalized = ((shift % chord.length) + chord.length) % chord.length;
  return [...chord.slice(normalized), ...chord.slice(0, normalized)];
}

function noteAtOctave(note: string, octave: number): string {
  return note.replace(/\d+/, String(octave));
}

const TONE_PRESET_LIBRARY: Record<TonePresetId, TonePresetConfig> = {
  lofi_cafe: {
    id: 'lofi_cafe',
    name: 'Lo-fi 1: ほうかごカフェ',
    description: 'Lo-fi / Boom Bap / 32小節',
    genre: 'lofi',
    bpm: 84,
    bars: LOOP_BARS,
    swing: 0.14,
    humanizeSec: 0.012,
    chordProgression: [
      ['C4', 'E4', 'G4', 'B4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['D4', 'F4', 'A4', 'C5'],
      ['G3', 'B3', 'D4', 'F4'],
      ['E3', 'G3', 'B3', 'D4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['F3', 'A3', 'C4', 'E4'],
      ['G3', 'B3', 'D4', 'F4'],
    ],
    leadMotifs: [
      [null, null, 'E4', null, 'G4', null, 'A4', null, null, 'G4', null, 'E4', null, 'D4', null, null],
      [null, 'D4', null, 'E4', null, 'G4', null, null, null, 'A4', null, 'G4', null, 'E4', null, null],
      [null, null, 'G4', null, 'A4', null, 'B4', null, null, 'A4', null, 'G4', null, 'E4', null, null],
      [null, 'E4', null, 'D4', null, 'C4', null, null, null, 'D4', null, 'E4', null, 'G4', null, null],
    ],
    bassMotifs: [
      ['C2', null, null, null, null, null, 'G1', null, null, null, null, null, 'A1', null, null, null],
      ['A1', null, null, null, null, null, 'E2', null, null, null, null, null, 'G1', null, null, null],
      ['D2', null, null, null, null, null, 'A1', null, null, null, null, null, 'G1', null, null, null],
      ['G1', null, null, null, null, null, 'D2', null, null, null, null, null, 'F2', null, null, null],
    ],
    keyPattern: pattern([2, 6, 10, 14], 0.2),
    kickPattern: pattern([0, 7, 10], 0.72),
    clapPattern: pattern([4, 12], 0.28),
    hatPattern: pattern([2, 6, 8, 10, 14], 0.18),
    ghostPattern: pattern([3, 11, 15], 0.12),
    openHatPattern: pattern([15], 0.22),
    texturePattern: pattern([1, 5, 9, 13], 0.08),
    subPattern: pattern([0, 8], 0.2),
    padStrideBars: 2,
    padDuration: '1m',
    leadDuration: '16n',
    bassDuration: '8n',
    leadVelocity: 0.36,
    bassVelocity: 0.55,
    padVelocity: 0.24,
    masterGain: 0.88,
    reverbWet: 0.18,
    delayWet: 0.16,
    sfxScale: ['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'E5'],
  },
  lofi_rain: {
    id: 'lofi_rain',
    name: 'Lo-fi 2: あめのとしょしつ',
    description: 'Lo-fi / Rainy Groove / 32小節',
    genre: 'lofi',
    bpm: 76,
    bars: LOOP_BARS,
    swing: 0.1,
    humanizeSec: 0.013,
    chordProgression: [
      ['D4', 'F4', 'A4', 'C5'],
      ['G3', 'B3', 'D4', 'F4'],
      ['C4', 'E4', 'G4', 'B4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['F3', 'A3', 'C4', 'E4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['E3', 'G3', 'B3', 'D4'],
      ['G3', 'B3', 'D4', 'F4'],
    ],
    leadMotifs: [
      [null, null, 'F4', null, null, 'A4', null, null, null, 'G4', null, 'F4', null, 'E4', null, null],
      [null, 'E4', null, null, 'G4', null, null, null, null, 'A4', null, null, 'G4', null, null, null],
      [null, null, 'D4', null, null, 'F4', null, null, null, 'E4', null, 'D4', null, 'C4', null, null],
      [null, 'C4', null, null, 'E4', null, null, null, null, 'F4', null, null, 'E4', null, null, null],
    ],
    bassMotifs: [
      ['D2', null, null, null, null, null, null, null, 'A1', null, null, null, null, null, null, null],
      ['G1', null, null, null, null, null, null, null, 'D2', null, null, null, null, null, null, null],
      ['C2', null, null, null, null, null, null, null, 'G1', null, null, null, null, null, null, null],
      ['A1', null, null, null, null, null, null, null, 'E2', null, null, null, null, null, null, null],
    ],
    keyPattern: pattern([3, 7, 11, 15], 0.16),
    kickPattern: pattern([0, 9], 0.65),
    clapPattern: pattern([4, 12], 0.24),
    hatPattern: pattern([2, 6, 10, 14], 0.14),
    ghostPattern: pattern([7, 15], 0.1),
    openHatPattern: pattern([15], 0.18),
    texturePattern: pattern([3, 11], 0.1),
    subPattern: pattern([0, 8], 0.18),
    padStrideBars: 2,
    padDuration: '1m',
    leadDuration: '8n',
    bassDuration: '4n',
    leadVelocity: 0.31,
    bassVelocity: 0.5,
    padVelocity: 0.23,
    masterGain: 0.84,
    reverbWet: 0.24,
    delayWet: 0.14,
    sfxScale: ['D4', 'E4', 'F4', 'A4', 'C5', 'D5', 'F5'],
  },
  lofi_jersey: {
    id: 'lofi_jersey',
    name: 'Lo-fi 3: Jersey Mellow',
    description: 'Lo-fi + Jersey Clubニュアンス / 32小節',
    genre: 'lofi',
    bpm: 136,
    bars: LOOP_BARS,
    swing: 0.03,
    humanizeSec: 0.007,
    chordProgression: [
      ['F3', 'A3', 'C4', 'E4'],
      ['G3', 'B3', 'D4', 'F4'],
      ['E3', 'G3', 'B3', 'D4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['D3', 'F3', 'A3', 'C4'],
      ['G3', 'B3', 'D4', 'F4'],
      ['C4', 'E4', 'G4', 'B4'],
      ['A3', 'C4', 'E4', 'G4'],
    ],
    leadMotifs: [
      ['A4', null, null, 'C5', null, null, 'D5', null, 'C5', null, null, 'A4', null, null, 'G4', null],
      ['G4', null, null, 'A4', null, null, 'C5', null, 'A4', null, null, 'G4', null, null, 'F4', null],
      ['C5', null, null, 'D5', null, null, 'E5', null, 'D5', null, null, 'C5', null, null, 'A4', null],
      ['A4', null, null, 'G4', null, null, 'E4', null, 'G4', null, null, 'A4', null, null, 'C5', null],
    ],
    bassMotifs: [
      ['F1', null, null, null, 'C2', null, null, null, 'F1', null, null, null, 'C2', null, null, null],
      ['G1', null, null, null, 'D2', null, null, null, 'G1', null, null, null, 'D2', null, null, null],
      ['E1', null, null, null, 'B1', null, null, null, 'E1', null, null, null, 'B1', null, null, null],
      ['A1', null, null, null, 'E2', null, null, null, 'A1', null, null, null, 'E2', null, null, null],
    ],
    keyPattern: pattern([2, 6, 10, 14], 0.22),
    kickPattern: pattern([0, 3, 6, 8, 11, 13, 14], 0.62),
    clapPattern: pattern([4, 12], 0.26),
    hatPattern: pattern([2, 6, 10, 14], 0.16),
    ghostPattern: pattern([1, 7, 9, 15], 0.12),
    openHatPattern: pattern([15], 0.24),
    texturePattern: pattern([5, 13], 0.1),
    subPattern: pattern([0, 8], 0.22),
    padStrideBars: 1,
    padDuration: '1m',
    leadDuration: '16n',
    bassDuration: '8n',
    leadVelocity: 0.32,
    bassVelocity: 0.52,
    padVelocity: 0.2,
    masterGain: 0.83,
    reverbWet: 0.16,
    delayWet: 0.12,
    sfxScale: ['F4', 'G4', 'A4', 'C5', 'D5', 'F5', 'A5'],
  },
  lofi_2step: {
    id: 'lofi_2step',
    name: 'Lo-fi 4: Night 2step',
    description: 'Lo-fi + 2stepガレージニュアンス / 32小節',
    genre: 'lofi',
    bpm: 132,
    bars: LOOP_BARS,
    swing: 0.06,
    humanizeSec: 0.009,
    chordProgression: [
      ['E3', 'G3', 'B3', 'D4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['D3', 'F3', 'A3', 'C4'],
      ['G3', 'B3', 'D4', 'F4'],
      ['C4', 'E4', 'G4', 'B4'],
      ['A3', 'C4', 'E4', 'G4'],
      ['F3', 'A3', 'C4', 'E4'],
      ['G3', 'B3', 'D4', 'F4'],
    ],
    leadMotifs: [
      [null, 'B4', null, null, 'D5', null, 'E5', null, null, 'D5', null, 'B4', null, 'A4', null, null],
      [null, 'A4', null, null, 'C5', null, 'D5', null, null, 'C5', null, 'A4', null, 'G4', null, null],
      [null, 'G4', null, null, 'B4', null, 'C5', null, null, 'B4', null, 'G4', null, 'E4', null, null],
      [null, 'A4', null, null, 'D5', null, 'E5', null, null, 'D5', null, 'A4', null, 'G4', null, null],
    ],
    bassMotifs: [
      ['E1', null, null, null, null, null, 'B1', null, null, null, 'E2', null, null, null, null, null],
      ['A1', null, null, null, null, null, 'E2', null, null, null, 'A1', null, null, null, null, null],
      ['D1', null, null, null, null, null, 'A1', null, null, null, 'D2', null, null, null, null, null],
      ['G1', null, null, null, null, null, 'D2', null, null, null, 'G1', null, null, null, null, null],
    ],
    keyPattern: pattern([1, 5, 9, 13], 0.2),
    kickPattern: pattern([0, 7, 10], 0.64),
    clapPattern: pattern([5, 13], 0.28),
    hatPattern: pattern([1, 3, 6, 8, 11, 14, 15], 0.16),
    ghostPattern: pattern([4, 9, 12], 0.13),
    openHatPattern: pattern([15], 0.22),
    texturePattern: pattern([2, 10], 0.08),
    subPattern: pattern([0, 8], 0.2),
    padStrideBars: 1,
    padDuration: '1m',
    leadDuration: '16n',
    bassDuration: '8n',
    leadVelocity: 0.31,
    bassVelocity: 0.52,
    padVelocity: 0.2,
    masterGain: 0.84,
    reverbWet: 0.17,
    delayWet: 0.14,
    sfxScale: ['E4', 'G4', 'A4', 'B4', 'D5', 'E5', 'G5'],
  },
  ambient_stars: {
    id: 'ambient_stars',
    name: 'Ambient 1: ほしぞらのうみ',
    description: 'Ambient / 32小節 / シネマティック',
    genre: 'ambient',
    bpm: 68,
    bars: LOOP_BARS,
    swing: 0,
    humanizeSec: 0.018,
    chordProgression: [
      ['C4', 'G4', 'B4', 'D5'],
      ['A3', 'E4', 'G4', 'C5'],
      ['F3', 'C4', 'E4', 'A4'],
      ['G3', 'D4', 'F4', 'B4'],
      ['E3', 'B3', 'D4', 'G4'],
      ['A3', 'E4', 'G4', 'C5'],
      ['D4', 'A4', 'C5', 'F5'],
      ['G3', 'D4', 'F4', 'A4'],
    ],
    leadMotifs: [
      ['G5', null, null, null, null, null, 'E5', null, null, null, null, null, 'D5', null, null, null],
      [null, null, 'A5', null, null, null, null, null, null, null, 'G5', null, null, null, null, null],
      ['F5', null, null, null, null, null, 'D5', null, null, null, null, null, 'C5', null, null, null],
      [null, null, 'E5', null, null, null, null, null, null, null, 'C5', null, null, null, null, null],
    ],
    bassMotifs: [
      ['C2', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      ['A1', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      ['F1', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      ['G1', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    ],
    keyPattern: pattern([4, 12], 0.12),
    kickPattern: pattern([], 0),
    clapPattern: pattern([], 0),
    hatPattern: pattern([7], 0.06),
    ghostPattern: pattern([], 0),
    openHatPattern: pattern([], 0),
    texturePattern: pattern([0, 4, 8, 12], 0.09),
    subPattern: pattern([0, 8], 0.16),
    padStrideBars: 2,
    padDuration: '2m',
    leadDuration: '4n',
    bassDuration: '1m',
    leadVelocity: 0.24,
    bassVelocity: 0.26,
    padVelocity: 0.24,
    masterGain: 0.75,
    reverbWet: 0.36,
    delayWet: 0.24,
    sfxScale: ['C4', 'E4', 'G4', 'B4', 'D5', 'E5', 'G5'],
  },
  ambient_dream: {
    id: 'ambient_dream',
    name: 'Ambient 2: ゆめみるしんかい',
    description: 'Ambient / 32小節 / 深いゆらぎ',
    genre: 'ambient',
    bpm: 60,
    bars: LOOP_BARS,
    swing: 0,
    humanizeSec: 0.02,
    chordProgression: [
      ['A3', 'E4', 'G4', 'C5'],
      ['F3', 'C4', 'E4', 'A4'],
      ['D3', 'A3', 'C4', 'F4'],
      ['G3', 'D4', 'F4', 'A4'],
      ['C4', 'G4', 'B4', 'D5'],
      ['A3', 'E4', 'G4', 'C5'],
      ['E3', 'B3', 'D4', 'G4'],
      ['F3', 'C4', 'E4', 'A4'],
    ],
    leadMotifs: [
      [null, null, 'C5', null, null, null, null, null, null, null, 'E5', null, null, null, null, null],
      [null, null, 'B4', null, null, null, null, null, null, null, 'D5', null, null, null, null, null],
      [null, null, 'A4', null, null, null, null, null, null, null, 'C5', null, null, null, null, null],
      [null, null, 'G4', null, null, null, null, null, null, null, 'B4', null, null, null, null, null],
    ],
    bassMotifs: [
      ['A1', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      ['F1', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      ['D1', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      ['G1', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    ],
    keyPattern: pattern([6, 14], 0.1),
    kickPattern: pattern([], 0),
    clapPattern: pattern([], 0),
    hatPattern: pattern([], 0),
    ghostPattern: pattern([], 0),
    openHatPattern: pattern([], 0),
    texturePattern: pattern([2, 10], 0.1),
    subPattern: pattern([0, 8], 0.14),
    padStrideBars: 2,
    padDuration: '2m',
    leadDuration: '2n',
    bassDuration: '1m',
    leadVelocity: 0.22,
    bassVelocity: 0.24,
    padVelocity: 0.25,
    masterGain: 0.73,
    reverbWet: 0.42,
    delayWet: 0.28,
    sfxScale: ['A3', 'C4', 'E4', 'G4', 'A4', 'C5', 'E5'],
  },
};

export class AudioLabPlayer {
  private assetAudio: HTMLAudioElement | null = null;
  private tone: ToneModule | null = null;
  private toneLoadPromise: Promise<ToneModule> | null = null;
  private toneLoading = false;
  private toneGain: Gain | null = null;
  private toneSequence: Sequence<number> | null = null;
  private activeNodes: Array<{ dispose: () => void }> = [];
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
    const [n1 = 'C4', n2 = 'D4', n3 = 'E4', n4 = 'G4', n5 = 'A4', n6 = 'C5', n7 = 'E5'] = preset.sfxScale;
    const now = tone.now();
    const output = new tone.Gain(curvedVolume(this.volume) * (preset.genre === 'ambient' ? 0.6 : 0.78)).toDestination();
    const reverb = new tone.Reverb({ decay: preset.genre === 'ambient' ? 5.4 : 2.4, wet: preset.genre === 'ambient' ? 0.42 : 0.24 });
    reverb.connect(output);
    const delay = new tone.FeedbackDelay('16n', preset.genre === 'ambient' ? 0.33 : 0.2);
    delay.wet.value = preset.genre === 'ambient' ? 0.24 : 0.14;
    delay.connect(output);

    const bell = new tone.PolySynth(tone.FMSynth, {
      harmonicity: preset.genre === 'ambient' ? 1.15 : 1.6,
      modulationIndex: preset.genre === 'ambient' ? 4 : 6,
      envelope: { attack: 0.01, decay: 0.22, sustain: 0.2, release: preset.genre === 'ambient' ? 0.8 : 0.34 },
    }).connect(reverb);
    const pluck = new tone.PluckSynth({ attackNoise: 0.9, dampening: preset.genre === 'ambient' ? 2800 : 4200, resonance: 0.85 }).connect(
      delay,
    );
    const thud = new tone.MonoSynth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.006, decay: 0.18, sustain: 0.08, release: 0.22 },
      filterEnvelope: { attack: 0.01, decay: 0.14, sustain: 0.1, release: 0.12, baseFrequency: 80, octaves: 2.4 },
    }).connect(output);
    const noise = new tone.NoiseSynth({
      noise: { type: preset.genre === 'ambient' ? 'brown' : 'pink' },
      envelope: { attack: 0.001, decay: 0.08, sustain: 0 },
    }).connect(output);

    const disposeList: Array<{ dispose: () => void }> = [output, reverb, delay, bell, pluck, thud, noise];
    const lowN1 = noteAtOctave(n1, 2);
    const lowN2 = noteAtOctave(n2, 2);

    if (sfxId === 'tap') {
      pluck.triggerAttack(n3, now);
      noise.triggerAttackRelease('64n', now + 0.005, preset.genre === 'ambient' ? 0.04 : 0.06);
      bell.triggerAttackRelease([n5], '16n', now + 0.04, preset.genre === 'ambient' ? 0.14 : 0.18);
    } else if (sfxId === 'correct') {
      bell.triggerAttackRelease([n2], '16n', now, 0.2);
      bell.triggerAttackRelease([n4], '16n', now + 0.09, 0.22);
      bell.triggerAttackRelease([n6], '8n', now + 0.18, 0.2);
      pluck.triggerAttack(n5, now + 0.14);
      noise.triggerAttackRelease('32n', now + 0.22, 0.07);
    } else if (sfxId === 'miss') {
      thud.triggerAttackRelease(lowN2, '8n', now, 0.2);
      thud.triggerAttackRelease(lowN1, '8n', now + 0.12, 0.16);
      noise.triggerAttackRelease('16n', now + 0.02, 0.08);
      bell.triggerAttackRelease([n3], '16n', now + 0.08, 0.12);
    } else {
      bell.triggerAttackRelease([n1, n3, n5], '8n', now, 0.2);
      bell.triggerAttackRelease([n2, n4, n6], '4n', now + 0.16, 0.21);
      pluck.triggerAttack(n7, now + 0.28);
      thud.triggerAttackRelease(lowN1, '8n', now + 0.02, 0.14);
      noise.triggerAttackRelease('32n', now + 0.34, 0.08);
    }

    window.setTimeout(
      () => {
        disposeList.forEach((node) => node.dispose());
      },
      preset.genre === 'ambient' ? 2900 : 1900,
    );
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

  private registerNode<T extends { dispose: () => void }>(node: T): T {
    this.activeNodes.push(node);
    return node;
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
    tone.Transport.swing = preset.swing;
    tone.Transport.swingSubdivision = '16n';
    tone.Destination.volume.value = -9;

    const master = this.registerNode(new tone.Gain(curvedVolume(this.volume) * preset.masterGain).toDestination());
    this.toneGain = master;
    const comp = this.registerNode(new tone.Compressor(-20, preset.genre === 'ambient' ? 2 : 3.2));
    const color = this.registerNode(new tone.Filter(preset.genre === 'ambient' ? 7600 : 5200, 'lowpass'));
    color.Q.value = preset.genre === 'ambient' ? 0.8 : 1.3;
    const bus = this.registerNode(new tone.Gain(1));
    bus.connect(color);
    color.connect(comp);
    comp.connect(master);

    const reverb = this.registerNode(new tone.Reverb({ decay: preset.genre === 'ambient' ? 6.2 : 2.6, wet: preset.reverbWet }));
    reverb.connect(master);
    const delay = this.registerNode(new tone.FeedbackDelay('8n', preset.genre === 'ambient' ? 0.32 : 0.22));
    delay.wet.value = preset.delayWet;
    delay.connect(master);
    const chorus = this.registerNode(new tone.Chorus(2.8, 2.2, preset.genre === 'ambient' ? 0.42 : 0.2).start());
    chorus.connect(master);
    const wobble = this.registerNode(
      new tone.LFO({
        frequency: preset.genre === 'ambient' ? 0.07 : 0.16,
        min: preset.genre === 'ambient' ? 2600 : 1700,
        max: preset.genre === 'ambient' ? 8200 : 5000,
      }).start(),
    );
    wobble.connect(color.frequency);

    const pad = this.registerNode(
      new tone.PolySynth(tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.12, decay: 0.3, sustain: 0.52, release: 0.95 },
      }),
    );
    pad.connect(bus);
    pad.connect(reverb);

    const keys = this.registerNode(
      new tone.PolySynth(tone.AMSynth, {
        harmonicity: preset.genre === 'ambient' ? 1.15 : 1.5,
        envelope: { attack: 0.01, decay: 0.12, sustain: 0.18, release: 0.22 },
      }),
    );
    keys.connect(bus);
    keys.connect(delay);

    const lead = this.registerNode(
      new tone.PolySynth(tone.FMSynth, {
        harmonicity: preset.genre === 'ambient' ? 1.1 : 1.4,
        modulationIndex: preset.genre === 'ambient' ? 3.5 : 5.5,
        envelope: { attack: preset.genre === 'ambient' ? 0.05 : 0.012, decay: 0.2, sustain: 0.28, release: 0.5 },
      }),
    );
    lead.connect(bus);
    lead.connect(delay);
    lead.connect(chorus);

    const bass = this.registerNode(
      new tone.MonoSynth({
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.01, decay: 0.22, sustain: 0.2, release: 0.12 },
        filterEnvelope: { attack: 0.01, decay: 0.15, sustain: 0.1, release: 0.1, baseFrequency: 85, octaves: 2.6 },
      }),
    );
    bass.connect(bus);

    const sub = this.registerNode(
      new tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.005, decay: 0.18, sustain: 0.06, release: 0.12 },
      }),
    );
    sub.connect(bus);

    const kick = this.registerNode(
      new tone.MembraneSynth({
        pitchDecay: 0.03,
        octaves: 6,
        envelope: { attack: 0.001, decay: 0.14, sustain: 0 },
      }),
    );
    kick.connect(bus);

    const clap = this.registerNode(
      new tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.09, sustain: 0 },
      }),
    );
    clap.connect(bus);
    clap.connect(reverb);

    const hat = this.registerNode(
      new tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.04, release: 0.02 },
        harmonicity: 5.1,
        modulationIndex: 20,
        resonance: 1600,
        octaves: 1.2,
      }),
    );
    hat.connect(bus);

    const ghost = this.registerNode(
      new tone.NoiseSynth({
        noise: { type: 'pink' },
        envelope: { attack: 0.001, decay: 0.045, sustain: 0 },
      }),
    );
    ghost.connect(bus);

    const texture = this.registerNode(
      new tone.NoiseSynth({
        noise: { type: preset.genre === 'ambient' ? 'brown' : 'pink' },
        envelope: { attack: 0.001, decay: 0.06, sustain: 0 },
      }),
    );
    texture.connect(chorus);
    texture.connect(reverb);

    const steps = Array.from({ length: totalSteps }, (_, step) => step);
    this.toneSequence = new tone.Sequence((time, step) => {
      const bar = Math.floor(step / STEPS_PER_BAR);
      const section = Math.floor(bar / 8);
      const stepInBar = step % STEPS_PER_BAR;
      const humanizedTime = (multiplier: number = 1) => time + randomBetween(-preset.humanizeSec, preset.humanizeSec) * multiplier;
      const velocityHuman = (base: number, spread: number) => Math.max(0, base + randomBetween(-spread, spread));

      const chordBase = preset.chordProgression[(bar + (section % 2)) % preset.chordProgression.length];
      const chord = section % 2 === 1 && bar % 2 === 0 ? rotateChord(chordBase, 1) : chordBase;

      if (stepInBar === 0 && bar % preset.padStrideBars === 0) {
        pad.triggerAttackRelease(chord, preset.padDuration, humanizedTime(0.7), velocityHuman(preset.padVelocity, 0.03));
      }

      const keyVelocity = preset.keyPattern[stepInBar];
      if (keyVelocity > 0) {
        keys.triggerAttackRelease(chord, '16n', humanizedTime(), velocityHuman(keyVelocity, 0.05));
      }

      const leadMotif = preset.leadMotifs[(bar + section) % preset.leadMotifs.length];
      const leadNote = leadMotif[stepInBar];
      if (leadNote) {
        const note =
          preset.genre === 'lofi' && bar % 8 === 7 && stepInBar >= 12
            ? tone.Frequency(leadNote).transpose(12).toNote()
            : leadNote;
        lead.triggerAttackRelease(note, preset.leadDuration, humanizedTime(), velocityHuman(preset.leadVelocity, 0.06));
      }

      const bassMotif = preset.bassMotifs[(bar + section * 2) % preset.bassMotifs.length];
      const bassNote = bassMotif[stepInBar];
      if (bassNote) {
        bass.triggerAttackRelease(bassNote, preset.bassDuration, humanizedTime(0.6), velocityHuman(preset.bassVelocity, 0.05));
      }

      const subVelocity = preset.subPattern[stepInBar];
      if (subVelocity > 0 && stepInBar % 8 === 0) {
        sub.triggerAttackRelease(noteAtOctave(chord[0], 2), '8n', humanizedTime(0.5), velocityHuman(subVelocity, 0.03));
      }

      const kickVelocity = preset.kickPattern[stepInBar];
      if (kickVelocity > 0) {
        kick.triggerAttackRelease('C1', '8n', humanizedTime(0.4), velocityHuman(kickVelocity, 0.04));
      }

      const clapVelocity = preset.clapPattern[stepInBar];
      if (clapVelocity > 0) {
        clap.triggerAttackRelease('16n', humanizedTime(0.4), velocityHuman(clapVelocity, 0.05));
      }

      const hatVelocity = preset.hatPattern[stepInBar];
      if (hatVelocity > 0) {
        hat.triggerAttackRelease('32n', humanizedTime(0.3), velocityHuman(hatVelocity, 0.04));
      }

      const ghostVelocity = preset.ghostPattern[stepInBar];
      if (ghostVelocity > 0 && Math.random() > 0.2) {
        ghost.triggerAttackRelease('64n', humanizedTime(0.2), velocityHuman(ghostVelocity, 0.03));
      }

      const openHatVelocity = preset.openHatPattern[stepInBar];
      if (openHatVelocity > 0) {
        hat.triggerAttackRelease('8n', humanizedTime(0.2), velocityHuman(openHatVelocity, 0.03));
      }

      const textureVelocity = preset.texturePattern[stepInBar];
      if (textureVelocity > 0 && Math.random() > 0.25) {
        texture.triggerAttackRelease('32n', humanizedTime(0.5), velocityHuman(textureVelocity, 0.03));
      }

      if (preset.genre === 'lofi' && bar % 8 === 7 && (stepInBar === 14 || stepInBar === 15)) {
        clap.triggerAttackRelease('64n', humanizedTime(0.2), 0.12);
      }
    }, steps, '16n');

    this.toneSequence.start(0);
  }

  private disposeToneGraph() {
    this.toneSequence?.dispose();
    this.toneSequence = null;
    this.activeNodes.forEach((node) => node.dispose());
    this.activeNodes = [];
    this.toneGain = null;
  }
}
