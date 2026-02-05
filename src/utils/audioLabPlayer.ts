import type { Gain, Sequence } from 'tone';

export type AudioLabEngine = 'none' | 'asset' | 'tone';
export type TonePresetId =
  | 'lofi_cafe'
  | 'lofi_rain'
  | 'lofi_jersey'
  | 'lofi_2step'
  | 'uk_garage_neon'
  | 'future_garage_mist'
  | 'dubstep_nightbus'
  | 'ambient_stars'
  | 'ambient_dream';
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
  rhythmProfile: 'lofi' | 'jersey' | 'ukg' | 'future_garage' | 'dubstep' | 'ambient';
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

function rotatePattern(base: number[], shift: number): number[] {
  const normalized = ((shift % base.length) + base.length) % base.length;
  return [...base.slice(normalized), ...base.slice(0, normalized)];
}

function accentPattern(base: number[], accents: number[], boost: number, accentVelocity: number): number[] {
  const next = base.map((value) => Math.min(1, value * boost));
  accents.forEach((step) => {
    const index = ((step % base.length) + base.length) % base.length;
    next[index] = Math.max(next[index], accentVelocity);
  });
  return next;
}

function patternValue(pattern: number[], step: number): number {
  return pattern[((step % pattern.length) + pattern.length) % pattern.length] ?? 0;
}

function getSectionEnergy(section: number, barInSection: number, genre: 'lofi' | 'ambient'): number {
  const table = genre === 'ambient' ? [0.82, 0.92, 1.01, 1.08] : [0.88, 0.98, 1.08, 1.16];
  const base = table[Math.min(section, table.length - 1)];
  const fillLift = barInSection === 7 ? (genre === 'ambient' ? 0.04 : 0.08) : 0;
  return base + fillLift;
}

function getSectionTexture(section: number, genre: 'lofi' | 'ambient'): number {
  if (genre === 'ambient') return [0.12, 0.18, 0.24, 0.3][Math.min(section, 3)];
  return [0.16, 0.22, 0.3, 0.36][Math.min(section, 3)];
}

function shouldTrigger(probability: number): boolean {
  return Math.random() <= clamp01(probability);
}

const TONE_PRESET_LIBRARY: Record<TonePresetId, TonePresetConfig> = {
  lofi_cafe: {
    id: 'lofi_cafe',
    name: 'Lo-fi 1: ほうかごカフェ',
    description: 'Lo-fi / Boom Bap / 32小節',
    genre: 'lofi',
    rhythmProfile: 'lofi',
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
    rhythmProfile: 'lofi',
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
    rhythmProfile: 'jersey',
    bpm: 138,
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
    kickPattern: pattern([0, 4, 8, 11, 14], 0.66),
    clapPattern: pattern([8, 11], 0.28),
    hatPattern: pattern([2, 6, 10, 14], 0.2),
    ghostPattern: pattern([1, 7, 10, 15], 0.13),
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
    rhythmProfile: 'lofi',
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
  uk_garage_neon: {
    id: 'uk_garage_neon',
    name: 'UK Garage 1: Neon Skip',
    description: 'UK Garage / 2-step Shuffle / 32小節',
    genre: 'lofi',
    rhythmProfile: 'ukg',
    bpm: 132,
    bars: LOOP_BARS,
    swing: 0.17,
    humanizeSec: 0.01,
    chordProgression: [
      ['A3', 'C4', 'E4', 'G4'],
      ['F3', 'A3', 'C4', 'E4'],
      ['G3', 'B3', 'D4', 'F4'],
      ['E3', 'G3', 'B3', 'D4'],
      ['D3', 'F3', 'A3', 'C4'],
      ['G3', 'B3', 'D4', 'F4'],
      ['C4', 'E4', 'G4', 'B4'],
      ['E3', 'G3', 'B3', 'D4'],
    ],
    leadMotifs: [
      [null, 'E4', null, null, 'G4', null, 'A4', null, null, 'G4', null, 'E4', null, 'D4', null, null],
      [null, 'D4', null, null, 'F4', null, 'G4', null, null, 'F4', null, 'D4', null, 'C4', null, null],
      [null, 'G4', null, null, 'A4', null, 'B4', null, null, 'A4', null, 'G4', null, 'E4', null, null],
      [null, 'E4', null, null, 'D4', null, 'C4', null, null, 'D4', null, 'E4', null, 'G4', null, null],
    ],
    bassMotifs: [
      ['A1', null, null, null, null, null, 'E2', null, null, null, 'A1', null, null, null, null, null],
      ['F1', null, null, null, null, null, 'C2', null, null, null, 'F1', null, null, null, null, null],
      ['G1', null, null, null, null, null, 'D2', null, null, null, 'G1', null, null, null, null, null],
      ['E1', null, null, null, null, null, 'B1', null, null, null, 'E2', null, null, null, null, null],
    ],
    keyPattern: pattern([1, 5, 9, 13], 0.24),
    kickPattern: pattern([0, 6, 10], 0.66),
    clapPattern: pattern([4, 12], 0.3),
    hatPattern: pattern([1, 3, 6, 8, 10, 14], 0.18),
    ghostPattern: pattern([7, 11, 15], 0.13),
    openHatPattern: pattern([15], 0.2),
    texturePattern: pattern([2, 10], 0.08),
    subPattern: pattern([0, 8], 0.2),
    padStrideBars: 1,
    padDuration: '1m',
    leadDuration: '16n',
    bassDuration: '8n',
    leadVelocity: 0.33,
    bassVelocity: 0.54,
    padVelocity: 0.2,
    masterGain: 0.84,
    reverbWet: 0.14,
    delayWet: 0.13,
    sfxScale: ['A4', 'B4', 'C5', 'E5', 'F5', 'G5', 'A5'],
  },
  future_garage_mist: {
    id: 'future_garage_mist',
    name: 'Future Garage: Mist Echo',
    description: 'Future Garage / Off-kilter / 32小節',
    genre: 'lofi',
    rhythmProfile: 'future_garage',
    bpm: 134,
    bars: LOOP_BARS,
    swing: 0.11,
    humanizeSec: 0.014,
    chordProgression: [
      ['C4', 'D#4', 'G4', 'A#4'],
      ['G3', 'A#3', 'D4', 'F4'],
      ['A#3', 'D4', 'F4', 'A4'],
      ['F3', 'A3', 'C4', 'D#4'],
      ['D#3', 'G3', 'A#3', 'D4'],
      ['G3', 'A#3', 'D4', 'F4'],
      ['C4', 'D#4', 'G4', 'A#4'],
      ['F3', 'A3', 'C4', 'D#4'],
    ],
    leadMotifs: [
      [null, null, 'D#5', null, null, null, null, null, null, null, 'C5', null, null, null, null, null],
      [null, null, 'D5', null, null, null, null, null, null, null, 'A#4', null, null, null, null, null],
      [null, null, 'F5', null, null, null, null, null, null, null, 'D5', null, null, null, null, null],
      [null, null, 'C5', null, null, null, null, null, null, null, 'A#4', null, null, null, null, null],
    ],
    bassMotifs: [
      ['C2', null, null, null, null, null, null, null, 'G1', null, null, null, null, null, null, null],
      ['G1', null, null, null, null, null, null, null, 'D2', null, null, null, null, null, null, null],
      ['A#1', null, null, null, null, null, null, null, 'F1', null, null, null, null, null, null, null],
      ['F1', null, null, null, null, null, null, null, 'C2', null, null, null, null, null, null, null],
    ],
    keyPattern: pattern([3, 11], 0.14),
    kickPattern: pattern([0, 9], 0.62),
    clapPattern: pattern([8], 0.26),
    hatPattern: pattern([2, 6, 10, 14], 0.13),
    ghostPattern: pattern([7, 11, 15], 0.12),
    openHatPattern: pattern([15], 0.16),
    texturePattern: pattern([0, 4, 8, 12], 0.12),
    subPattern: pattern([0, 8], 0.24),
    padStrideBars: 2,
    padDuration: '2m',
    leadDuration: '8n',
    bassDuration: '4n',
    leadVelocity: 0.24,
    bassVelocity: 0.58,
    padVelocity: 0.23,
    masterGain: 0.8,
    reverbWet: 0.26,
    delayWet: 0.2,
    sfxScale: ['C4', 'D#4', 'F4', 'G4', 'A#4', 'C5', 'D5'],
  },
  dubstep_nightbus: {
    id: 'dubstep_nightbus',
    name: 'UK Dubstep: Night Bus',
    description: 'UK Dubstep / Burial Mood / 32小節',
    genre: 'lofi',
    rhythmProfile: 'dubstep',
    bpm: 140,
    bars: LOOP_BARS,
    swing: 0.08,
    humanizeSec: 0.012,
    chordProgression: [
      ['F3', 'G#3', 'C4', 'D#4'],
      ['D#3', 'G3', 'A#3', 'D4'],
      ['C3', 'D#3', 'G3', 'A#3'],
      ['A#2', 'D3', 'F3', 'A3'],
      ['F3', 'G#3', 'C4', 'D#4'],
      ['D#3', 'G3', 'A#3', 'D4'],
      ['G3', 'A#3', 'D4', 'F4'],
      ['A#2', 'D3', 'F3', 'A3'],
    ],
    leadMotifs: [
      [null, null, null, null, 'C5', null, null, null, null, null, null, null, 'A#4', null, null, null],
      [null, null, null, null, 'D5', null, null, null, null, null, null, null, 'C5', null, null, null],
      [null, null, null, null, 'A#4', null, null, null, null, null, null, null, 'G4', null, null, null],
      [null, null, null, null, 'F4', null, null, null, null, null, null, null, 'D4', null, null, null],
    ],
    bassMotifs: [
      ['F1', null, null, null, null, null, null, null, 'C2', null, null, null, null, null, null, null],
      ['D#1', null, null, null, null, null, null, null, 'A#1', null, null, null, null, null, null, null],
      ['C1', null, null, null, null, null, null, null, 'G1', null, null, null, null, null, null, null],
      ['A#0', null, null, null, null, null, null, null, 'F1', null, null, null, null, null, null, null],
    ],
    keyPattern: pattern([6, 14], 0.12),
    kickPattern: pattern([0, 6, 11], 0.68),
    clapPattern: pattern([8], 0.3),
    hatPattern: pattern([3, 7, 11, 15], 0.15),
    ghostPattern: pattern([14], 0.1),
    openHatPattern: pattern([15], 0.17),
    texturePattern: pattern([2, 10], 0.09),
    subPattern: pattern([0, 8], 0.28),
    padStrideBars: 2,
    padDuration: '2m',
    leadDuration: '8n',
    bassDuration: '4n',
    leadVelocity: 0.2,
    bassVelocity: 0.62,
    padVelocity: 0.2,
    masterGain: 0.81,
    reverbWet: 0.21,
    delayWet: 0.19,
    sfxScale: ['F4', 'G4', 'A#4', 'C5', 'D5', 'F5', 'G5'],
  },
  ambient_stars: {
    id: 'ambient_stars',
    name: 'Ambient 1: ほしぞらのうみ',
    description: 'Ambient / 32小節 / シネマティック',
    genre: 'ambient',
    rhythmProfile: 'ambient',
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
    rhythmProfile: 'ambient',
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
    const profile = preset.rhythmProfile;
    const isAmbientProfile = profile === 'ambient';
    const isJerseyProfile = profile === 'jersey';
    const isUkgProfile = profile === 'ukg';
    const isFutureGarageProfile = profile === 'future_garage';
    const isDubstepProfile = profile === 'dubstep';
    const [n1 = 'C4', n2 = 'D4', n3 = 'E4', n4 = 'G4', n5 = 'A4', n6 = 'C5', n7 = 'E5'] = preset.sfxScale;
    const now = tone.now();
    const output = new tone.Gain(curvedVolume(this.volume) * (isAmbientProfile ? 0.7 : isDubstepProfile ? 0.82 : 0.86)).toDestination();
    const limiter = new tone.Limiter(-1.2);
    const comp = new tone.Compressor(-24, isAmbientProfile ? 2.1 : isDubstepProfile ? 2.6 : 3.4);
    const tonalBus = new tone.Gain(1);
    const transientBus = new tone.Gain(0.92);
    const transientShape = new tone.Filter(isAmbientProfile ? 4200 : isDubstepProfile ? 5200 : 6800, 'highpass');

    tonalBus.connect(comp);
    transientBus.connect(comp);
    comp.connect(limiter);
    limiter.connect(output);
    transientShape.connect(transientBus);

    const reverb = new tone.Reverb({
      decay: isAmbientProfile ? 6.2 : isFutureGarageProfile || isDubstepProfile ? 3.4 : 2.8,
      wet: isAmbientProfile ? 0.46 : isFutureGarageProfile ? 0.32 : isDubstepProfile ? 0.28 : 0.26,
    });
    reverb.connect(tonalBus);
    const delay = new tone.FeedbackDelay('8n', isAmbientProfile ? 0.34 : isDubstepProfile ? 0.31 : 0.24);
    delay.wet.value = isAmbientProfile ? 0.26 : isFutureGarageProfile ? 0.2 : isDubstepProfile ? 0.22 : 0.16;
    delay.connect(tonalBus);

    const sparkle = new tone.PolySynth(tone.FMSynth, {
      harmonicity: isAmbientProfile ? 1.08 : isDubstepProfile ? 1.22 : 1.38,
      modulationIndex: isAmbientProfile ? 3.2 : isDubstepProfile ? 4.5 : 6.4,
      envelope: {
        attack: isAmbientProfile ? 0.02 : isDubstepProfile ? 0.016 : 0.008,
        decay: 0.2,
        sustain: 0.15,
        release: isAmbientProfile ? 0.9 : isFutureGarageProfile ? 0.52 : isDubstepProfile ? 0.44 : 0.35,
      },
    });
    sparkle.connect(reverb);
    sparkle.connect(delay);

    const body = new tone.PolySynth(tone.AMSynth, {
      harmonicity: isAmbientProfile ? 1.1 : isDubstepProfile ? 1.25 : 1.52,
      envelope: {
        attack: isAmbientProfile ? 0.015 : isDubstepProfile ? 0.012 : 0.005,
        decay: isAmbientProfile ? 0.28 : isDubstepProfile ? 0.24 : 0.18,
        sustain: isAmbientProfile ? 0.24 : isFutureGarageProfile || isDubstepProfile ? 0.14 : 0.08,
        release: isAmbientProfile ? 0.78 : isFutureGarageProfile ? 0.42 : isDubstepProfile ? 0.36 : 0.3,
      },
    });
    body.connect(tonalBus);

    const pluck = new tone.PluckSynth({
      attackNoise: 0.7,
      dampening: isAmbientProfile ? 2600 : isFutureGarageProfile ? 3200 : isDubstepProfile ? 2900 : 4800,
      resonance: 0.9,
    });
    pluck.connect(delay);
    pluck.connect(tonalBus);

    const punch = new tone.MonoSynth({
      oscillator: { type: isJerseyProfile || isUkgProfile || preset.id === 'lofi_2step' ? 'square' : 'triangle' },
      envelope: { attack: 0.004, decay: 0.2, sustain: 0.09, release: 0.24 },
      filterEnvelope: { attack: 0.008, decay: 0.16, sustain: 0.08, release: 0.14, baseFrequency: isDubstepProfile ? 58 : 70, octaves: isDubstepProfile ? 2.4 : 3.1 },
    });
    punch.connect(tonalBus);

    const snap = new tone.NoiseSynth({
      noise: { type: isAmbientProfile || isFutureGarageProfile ? 'pink' : 'white' },
      envelope: { attack: 0.001, decay: 0.07, sustain: 0 },
    });
    snap.connect(transientShape);

    const click = new tone.MetalSynth({
      envelope: { attack: 0.001, decay: isAmbientProfile ? 0.05 : isDubstepProfile ? 0.07 : 0.09, release: 0.03 },
      harmonicity: isAmbientProfile ? 3.2 : isDubstepProfile ? 4.2 : 6.8,
      modulationIndex: isAmbientProfile ? 18 : isDubstepProfile ? 20 : 26,
      resonance: isAmbientProfile ? 900 : isDubstepProfile ? 1300 : 1600,
      octaves: isAmbientProfile ? 1.1 : isDubstepProfile ? 1.3 : 1.6,
    });
    click.connect(transientShape);

    const rise = new tone.Synth({
      oscillator: { type: isAmbientProfile ? 'sine' : isDubstepProfile ? 'sawtooth' : 'triangle' },
      envelope: { attack: 0.02, decay: 0.35, sustain: 0, release: 0.35 },
    });
    rise.connect(delay);
    rise.connect(reverb);

    const disposeList: Array<{ dispose: () => void }> = [
      output,
      limiter,
      comp,
      tonalBus,
      transientBus,
      transientShape,
      reverb,
      delay,
      sparkle,
      body,
      pluck,
      punch,
      snap,
      click,
      rise,
    ];
    const lowN1 = noteAtOctave(n1, 2);
    const lowN2 = noteAtOctave(n2, 2);
    const lowN3 = noteAtOctave(n3, 2);
    const garageAccent = isJerseyProfile || isUkgProfile || preset.id === 'lofi_2step';
    const syncNudge = preset.id === 'lofi_2step' ? 0.014 : isJerseyProfile ? 0.01 : isUkgProfile ? 0.008 : isFutureGarageProfile ? 0.004 : 0;
    const velocityHuman = (base: number, spread: number) => Math.max(0, base + randomBetween(-spread, spread));
    const tapAccent = garageAccent && shouldTrigger(0.68);

    if (sfxId === 'tap') {
      click.triggerAttackRelease('64n', now, velocityHuman(0.14, 0.02));
      snap.triggerAttackRelease('128n', now + 0.004, velocityHuman(isAmbientProfile ? 0.04 : isDubstepProfile ? 0.05 : 0.06, 0.01));
      pluck.triggerAttack(n3, now + 0.01);
      body.triggerAttackRelease([n5], '16n', now + 0.03 + syncNudge, velocityHuman(0.18, 0.03));
      if (tapAccent) {
        click.triggerAttackRelease('64n', now + 0.065, velocityHuman(0.1, 0.02));
      }
      if (isAmbientProfile || isFutureGarageProfile) {
        sparkle.triggerAttackRelease([n6], '8n', now + 0.08, velocityHuman(0.1, 0.03));
      }
    } else if (sfxId === 'correct') {
      const burstOffset = isJerseyProfile ? 0.058 : isUkgProfile ? 0.07 : isDubstepProfile ? 0.1 : 0.085;
      sparkle.triggerAttackRelease([n2], '16n', now, velocityHuman(0.2, 0.03));
      sparkle.triggerAttackRelease([n4], '16n', now + burstOffset, velocityHuman(0.23, 0.03));
      sparkle.triggerAttackRelease([n6], '8n', now + burstOffset * 2, velocityHuman(0.22, 0.03));
      body.triggerAttackRelease([n3, n5], '8n', now + 0.02, velocityHuman(0.16, 0.02));
      pluck.triggerAttack(n5, now + 0.12 + syncNudge);
      click.triggerAttackRelease('64n', now + 0.015, velocityHuman(0.12, 0.02));
      snap.triggerAttackRelease('32n', now + 0.2, velocityHuman(0.09, 0.02));
      if (isDubstepProfile) {
        punch.triggerAttackRelease(lowN1, '8n', now + 0.04, velocityHuman(0.18, 0.03));
      }
    } else if (sfxId === 'miss') {
      punch.triggerAttackRelease(lowN2, '8n', now, velocityHuman(0.22, 0.03));
      punch.triggerAttackRelease(lowN1, '8n', now + 0.1 + syncNudge, velocityHuman(0.17, 0.03));
      punch.triggerAttackRelease(lowN3, '16n', now + 0.18 + syncNudge, velocityHuman(0.1, 0.02));
      snap.triggerAttackRelease('16n', now + 0.01, velocityHuman(0.08, 0.02));
      sparkle.triggerAttackRelease([n3], '16n', now + 0.07, velocityHuman(0.11, 0.02));
      if (shouldTrigger(0.42)) {
        click.triggerAttackRelease('64n', now + 0.13, velocityHuman(0.08, 0.02));
      }
    } else {
      sparkle.triggerAttackRelease([n1, n3, n5], '8n', now, velocityHuman(0.2, 0.03));
      sparkle.triggerAttackRelease([n2, n4, n6], '4n', now + 0.14, velocityHuman(0.21, 0.03));
      body.triggerAttackRelease([n4, n6], '8n', now + 0.08, velocityHuman(0.14, 0.02));
      pluck.triggerAttack(n7, now + 0.26 + syncNudge);
      punch.triggerAttackRelease(lowN1, '8n', now + 0.02, velocityHuman(0.15, 0.02));
      rise.triggerAttackRelease(n7, '8n', now + 0.22, velocityHuman(0.14, 0.03));
      click.triggerAttackRelease('64n', now + 0.28, velocityHuman(0.13, 0.03));
      snap.triggerAttackRelease('32n', now + 0.34, velocityHuman(0.09, 0.02));
      if (garageAccent) {
        click.triggerAttackRelease('64n', now + 0.41, velocityHuman(0.11, 0.02));
      }
    }

    window.setTimeout(
      () => {
        disposeList.forEach((node) => node.dispose());
      },
      isAmbientProfile || isFutureGarageProfile ? 3600 : isDubstepProfile ? 3200 : 2400,
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
    const profile = preset.rhythmProfile;
    const isAmbient = profile === 'ambient';
    const isJersey = profile === 'jersey';
    const isUkg = profile === 'ukg';
    const isFutureGarage = profile === 'future_garage';
    const isDubstep = profile === 'dubstep';
    const isClubPreset = isJersey || isUkg || preset.id === 'lofi_2step';
    const isHalfTimeBass = isDubstep || isFutureGarage;

    tone.Transport.stop();
    tone.Transport.cancel(0);
    tone.Transport.position = 0;
    tone.Transport.bpm.value = preset.bpm;
    tone.Transport.swing = preset.swing;
    tone.Transport.swingSubdivision = isClubPreset || isUkg ? '8n' : '16n';
    tone.Destination.volume.value = -9;

    const master = this.registerNode(new tone.Gain(curvedVolume(this.volume) * preset.masterGain).toDestination());
    this.toneGain = master;
    const limiter = this.registerNode(new tone.Limiter(-1.1));
    const comp = this.registerNode(new tone.Compressor(-20, isAmbient ? 2 : isDubstep ? 2.6 : 3.3));
    const color = this.registerNode(new tone.Filter(isAmbient ? 7600 : isDubstep ? 4800 : 5400, 'lowpass'));
    color.Q.value = isAmbient ? 0.8 : isDubstep ? 1.2 : 1.45;
    const tape = this.registerNode(new tone.Distortion(isAmbient ? 0.035 : isDubstep ? 0.05 : 0.12));
    tape.wet.value = isAmbient ? 0.1 : isDubstep ? 0.12 : 0.2;
    const sidechain = this.registerNode(new tone.Gain(1));
    const bus = this.registerNode(new tone.Gain(1));
    bus.connect(sidechain);
    sidechain.connect(tape);
    tape.connect(color);
    color.connect(comp);
    comp.connect(limiter);
    limiter.connect(master);

    const reverb = this.registerNode(new tone.Reverb({ decay: isAmbient ? 6.2 : isFutureGarage ? 4.2 : isDubstep ? 3.8 : 2.8, wet: preset.reverbWet }));
    reverb.connect(master);
    const delay = this.registerNode(new tone.FeedbackDelay('8n', isAmbient ? 0.32 : isDubstep ? 0.29 : 0.24));
    delay.wet.value = preset.delayWet;
    delay.connect(master);
    const chorus = this.registerNode(new tone.Chorus(2.8, 2.2, isAmbient ? 0.42 : isFutureGarage ? 0.3 : 0.24).start());
    chorus.connect(master);
    const wobble = this.registerNode(
      new tone.LFO({
        frequency: isAmbient ? 0.07 : isDubstep ? 0.12 : 0.16,
        min: isAmbient ? 2800 : isDubstep ? 1300 : 1800,
        max: isAmbient ? 8400 : isDubstep ? 4300 : 5600,
      }).start(),
    );
    wobble.connect(color.frequency);
    const delayFlutter = this.registerNode(
      new tone.LFO({
        frequency: isAmbient ? 0.09 : isFutureGarage ? 0.13 : 0.18,
        min: isAmbient ? 0.245 : isFutureGarage ? 0.16 : 0.12,
        max: isAmbient ? 0.275 : isFutureGarage ? 0.24 : 0.17,
      }).start(),
    );
    delayFlutter.connect(delay.delayTime);

    const ambienceFilter = this.registerNode(new tone.Filter(isAmbient || isFutureGarage || isDubstep ? 5100 : 6200, 'highpass'));
    const ambienceGain = this.registerNode(new tone.Gain(isAmbient ? 0.018 : isFutureGarage ? 0.015 : isDubstep ? 0.013 : 0.011));
    const ambienceNoise = this.registerNode(new tone.Noise(isAmbient || isFutureGarage || isDubstep ? 'brown' : 'pink'));
    ambienceNoise.connect(ambienceFilter);
    ambienceFilter.connect(ambienceGain);
    ambienceGain.connect(master);
    ambienceNoise.start();

    const pad = this.registerNode(
      new tone.PolySynth(tone.Synth, {
        oscillator: { type: isAmbient || isFutureGarage ? 'triangle' : 'sine' },
        envelope: { attack: isAmbient ? 0.2 : isFutureGarage || isDubstep ? 0.16 : 0.12, decay: 0.3, sustain: isAmbient ? 0.56 : isFutureGarage ? 0.58 : 0.5, release: isAmbient ? 1.35 : isFutureGarage || isDubstep ? 1.16 : 1.02 },
      }),
    );
    pad.connect(bus);
    pad.connect(reverb);

    const keys = this.registerNode(
      new tone.PolySynth(tone.AMSynth, {
        harmonicity: isAmbient ? 1.15 : isDubstep ? 1.34 : 1.56,
        envelope: { attack: isAmbient ? 0.03 : isFutureGarage || isDubstep ? 0.02 : 0.01, decay: isAmbient ? 0.2 : isFutureGarage ? 0.18 : 0.12, sustain: isAmbient ? 0.22 : isFutureGarage ? 0.24 : 0.19, release: isAmbient ? 0.42 : isFutureGarage ? 0.32 : 0.24 },
      }),
    );
    keys.connect(bus);
    keys.connect(delay);

    const lead = this.registerNode(
      new tone.PolySynth(tone.FMSynth, {
        harmonicity: isAmbient ? 1.08 : isClubPreset ? 1.7 : isDubstep ? 1.24 : 1.42,
        modulationIndex: isAmbient ? 3.5 : isClubPreset ? 7 : isDubstep ? 4.8 : 5.6,
        envelope: { attack: isAmbient ? 0.05 : isDubstep ? 0.018 : 0.012, decay: isAmbient ? 0.24 : isDubstep ? 0.24 : 0.2, sustain: isAmbient ? 0.3 : isDubstep ? 0.2 : 0.28, release: isAmbient ? 0.65 : isFutureGarage || isDubstep ? 0.62 : 0.5 },
      }),
    );
    lead.connect(bus);
    lead.connect(delay);
    lead.connect(chorus);

    const counterLead = this.registerNode(
      new tone.PolySynth(tone.Synth, {
        oscillator: { type: isAmbient || isFutureGarage ? 'sine' : 'triangle' },
        envelope: { attack: isAmbient ? 0.04 : isFutureGarage ? 0.03 : 0.018, decay: 0.14, sustain: isAmbient ? 0.08 : isFutureGarage ? 0.12 : 0.06, release: isAmbient ? 0.5 : isFutureGarage ? 0.46 : 0.35 },
      }),
    );
    counterLead.connect(delay);
    counterLead.connect(reverb);

    const bass = this.registerNode(
      new tone.MonoSynth({
        oscillator: { type: isDubstep ? 'sawtooth' : isClubPreset ? 'square' : 'triangle' },
        envelope: { attack: 0.01, decay: 0.22, sustain: isDubstep ? 0.25 : 0.2, release: 0.12 },
        filterEnvelope: { attack: 0.01, decay: 0.15, sustain: 0.1, release: 0.1, baseFrequency: isAmbient ? 75 : isDubstep ? 58 : 90, octaves: isClubPreset ? 3.2 : isDubstep ? 2.2 : 2.7 },
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
        envelope: { attack: 0.001, decay: isAmbient ? 0.1 : 0.16, sustain: 0 },
      }),
    );
    kick.connect(bus);

    const clap = this.registerNode(
      new tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: isAmbient ? 0.06 : 0.11, sustain: 0 },
      }),
    );
    clap.connect(bus);
    clap.connect(reverb);

    const hat = this.registerNode(
      new tone.MetalSynth({
        envelope: { attack: 0.001, decay: isAmbient ? 0.03 : 0.05, release: 0.02 },
        harmonicity: isAmbient ? 3.6 : 5.3,
        modulationIndex: isAmbient ? 14 : 22,
        resonance: isAmbient ? 1100 : 1700,
        octaves: isAmbient ? 1.1 : 1.3,
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
        noise: { type: isAmbient || isFutureGarage || isDubstep ? 'brown' : 'pink' },
        envelope: { attack: 0.001, decay: isAmbient ? 0.12 : isFutureGarage ? 0.1 : isDubstep ? 0.09 : 0.07, sustain: 0 },
      }),
    );
    texture.connect(chorus);
    texture.connect(reverb);

    const kickBasePattern = preset.kickPattern;
    const kickLiftPattern = accentPattern(
      preset.id === 'lofi_2step' ? rotatePattern(kickBasePattern, 1) : kickBasePattern,
      isJersey ? [3, 7, 11, 15] : isUkg || preset.id === 'lofi_2step' ? [5, 9, 13, 15] : isFutureGarage ? [9, 15] : isDubstep ? [6, 11] : [7, 11, 14],
      1.08,
      isJersey ? 0.66 : isUkg ? 0.6 : isDubstep ? 0.62 : 0.58,
    );
    const clapBasePattern = preset.clapPattern;
    const clapLiftPattern = accentPattern(clapBasePattern, isClubPreset ? [5, 13, 15] : isFutureGarage || isDubstep ? [8, 15] : [4, 12], 1.06, isAmbient ? 0.16 : isFutureGarage || isDubstep ? 0.22 : 0.28);
    const hatBasePattern = rotatePattern(preset.hatPattern, preset.id === 'lofi_2step' ? 1 : 0);
    const hatLiftPattern = accentPattern(hatBasePattern, isClubPreset || isUkg ? [1, 7, 11, 15] : isFutureGarage || isDubstep ? [7, 15] : [6, 14], 1.1, isAmbient ? 0.1 : isFutureGarage ? 0.16 : isDubstep ? 0.14 : 0.2);
    const ghostBasePattern = preset.id === 'lofi_2step' ? rotatePattern(preset.ghostPattern, 1) : preset.ghostPattern;
    const ghostLiftPattern = accentPattern(ghostBasePattern, isDubstep ? [14, 15] : [3, 7, 11, 15], 1.05, isDubstep ? 0.11 : 0.14);
    const textureLiftPattern = accentPattern(preset.texturePattern, isFutureGarage || isDubstep ? [2, 6, 10, 14] : [0, 4, 8, 12], 1.12, isAmbient ? 0.14 : isFutureGarage || isDubstep ? 0.14 : 0.11);
    const keyLiftPattern = accentPattern(preset.keyPattern, isClubPreset || isUkg ? [1, 5, 9, 13] : [2, 6, 10, 14], 1.08, isAmbient ? 0.16 : isFutureGarage ? 0.2 : 0.24);
    const subLiftPattern = accentPattern(preset.subPattern, isHalfTimeBass ? [0, 8] : [0, 4, 8, 12], 1.1, isAmbient ? 0.18 : isDubstep ? 0.3 : 0.24);

    const sidechainDepthBase = isAmbient ? 0.05 : isDubstep ? 0.1 : 0.16;

    const steps = Array.from({ length: totalSteps }, (_, step) => step);
    this.toneSequence = new tone.Sequence((time, step) => {
      const bar = Math.floor(step / STEPS_PER_BAR);
      const section = Math.floor(bar / 8);
      const barInSection = bar % 8;
      const stepInBar = step % STEPS_PER_BAR;
      const sectionEnergy = getSectionEnergy(section, barInSection, preset.genre);
      const sectionTexture = getSectionTexture(section, preset.genre);
      const isLiftSection = section >= 2;
      const isFillBar = barInSection === 7;
      const isDropBar = (preset.id === 'lofi_2step' || isUkg) && section === 1 && barInSection === 3;
      const humanizedTime = (multiplier: number = 1) => time + randomBetween(-preset.humanizeSec, preset.humanizeSec) * multiplier;
      const velocityHuman = (base: number, spread: number) => Math.max(0, base + randomBetween(-spread, spread));

      const chordBase = preset.chordProgression[(bar + (section % 2)) % preset.chordProgression.length];
      const chord = section % 2 === 1 && bar % 2 === 0 ? rotateChord(chordBase, 1) : chordBase;

      if (stepInBar === 0) {
        const colorTarget = isAmbient
          ? 5200 + section * 850
          : isDubstep
            ? 2400 + section * 430
            : isFutureGarage
              ? 3400 + section * 520
              : 3000 + section * 720;
        color.frequency.setTargetAtTime(colorTarget + (isFillBar ? 420 : 0), time, 0.4);
        delay.wet.setTargetAtTime(Math.min(0.62, preset.delayWet + sectionTexture * (isFutureGarage || isDubstep ? 0.44 : 0.35)), time, 0.7);
        delay.feedback.setTargetAtTime(Math.min(0.52, (isAmbient ? 0.28 : isDubstep ? 0.26 : 0.2) + sectionTexture * 0.38), time, 0.8);
        reverb.wet.setTargetAtTime(Math.min(0.7, preset.reverbWet + sectionTexture * 0.26), time, 1.1);
        ambienceGain.gain.setTargetAtTime((isAmbient ? 0.014 : isFutureGarage ? 0.012 : isDubstep ? 0.011 : 0.009) + sectionTexture * (isAmbient || isFutureGarage || isDubstep ? 0.024 : 0.012), time, 1.2);
      }

      if (stepInBar === 0 && bar % preset.padStrideBars === 0) {
        pad.triggerAttackRelease(chord, preset.padDuration, humanizedTime(0.7), velocityHuman(preset.padVelocity * sectionEnergy, 0.03));
        if (isLiftSection && shouldTrigger(isAmbient ? 0.45 : 0.3)) {
          const counterChord = chord.map((note) => tone.Frequency(note).transpose(12).toNote());
          counterLead.triggerAttackRelease(counterChord, isFutureGarage || isDubstep ? '8n' : '4n', humanizedTime(0.6), velocityHuman(isAmbient || isFutureGarage ? 0.12 : 0.1, 0.03));
        }
      }

      const keyVelocity = patternValue(isLiftSection ? keyLiftPattern : preset.keyPattern, stepInBar);
      if (keyVelocity > 0) {
        keys.triggerAttackRelease(chord, '16n', humanizedTime(), velocityHuman(keyVelocity * (0.84 + section * 0.07), 0.05));
      }

      const leadMotif = preset.leadMotifs[(bar + section + (isLiftSection ? 1 : 0)) % preset.leadMotifs.length];
      const leadNote = leadMotif[stepInBar];
      if (leadNote) {
        let note = leadNote;
        if ((preset.genre === 'lofi' || isUkg || isJersey) && isFillBar && stepInBar >= 12) {
          note = tone.Frequency(leadNote).transpose(12).toNote();
        } else if ((isAmbient || isFutureGarage) && isLiftSection && shouldTrigger(0.24) && stepInBar % 4 === 2) {
          note = tone.Frequency(leadNote).transpose(7).toNote();
        }
        if (!isDropBar) {
          lead.triggerAttackRelease(note, preset.leadDuration, humanizedTime(), velocityHuman(preset.leadVelocity * (0.9 + section * 0.08), 0.06));
        }
        if ((isAmbient || isFutureGarage) && shouldTrigger(0.16)) {
          const response = tone.Frequency(note).transpose(12).toNote();
          counterLead.triggerAttackRelease(response, '8n', humanizedTime(0.6) + 0.06, velocityHuman(0.11, 0.02));
        }
      }

      const bassMotif = preset.bassMotifs[(bar + section * 2) % preset.bassMotifs.length];
      const bassNote = bassMotif[stepInBar];
      if (bassNote && !isDropBar) {
        const bassBase = preset.bassVelocity * (isClubPreset ? 1.06 : isDubstep ? 1.1 : 1);
        bass.triggerAttackRelease(bassNote, preset.bassDuration, humanizedTime(0.6), velocityHuman(bassBase * (0.9 + section * 0.06), 0.05));
      }

      const subVelocity = patternValue(isLiftSection ? subLiftPattern : preset.subPattern, stepInBar);
      if (subVelocity > 0 && stepInBar % 8 === 0) {
        sub.triggerAttackRelease(noteAtOctave(chord[0], 2), '8n', humanizedTime(0.5), velocityHuman(subVelocity * (0.92 + section * 0.05), 0.03));
      }

      const kickVelocity = patternValue(isLiftSection ? kickLiftPattern : kickBasePattern, stepInBar);
      if (kickVelocity > 0 && !isDropBar) {
        const kickTime = humanizedTime(0.4);
        kick.triggerAttackRelease('C1', isDubstep ? '4n' : '8n', kickTime, velocityHuman(kickVelocity * (0.9 + section * 0.06), 0.04));
        const duckDepth = Math.min(0.36, sidechainDepthBase + (isLiftSection ? 0.03 : 0) + (isFillBar ? 0.02 : 0));
        sidechain.gain.cancelScheduledValues(kickTime);
        sidechain.gain.setValueAtTime(1, kickTime);
        sidechain.gain.linearRampToValueAtTime(Math.max(0.58, 1 - duckDepth), kickTime + 0.012);
        sidechain.gain.exponentialRampToValueAtTime(1, kickTime + (isAmbient ? 0.33 : isDubstep ? 0.29 : 0.24));
      }

      const clapVelocity = patternValue(isLiftSection ? clapLiftPattern : clapBasePattern, stepInBar);
      if (clapVelocity > 0) {
        clap.triggerAttackRelease('16n', humanizedTime(0.35), velocityHuman(clapVelocity * (0.92 + section * 0.05), 0.05));
      }

      const hatVelocity = patternValue(isLiftSection ? hatLiftPattern : hatBasePattern, stepInBar);
      if (hatVelocity > 0 && shouldTrigger(isAmbient ? 0.62 : isFutureGarage || isDubstep ? 0.74 : 0.87)) {
        hat.triggerAttackRelease('32n', humanizedTime(0.28), velocityHuman(hatVelocity * (0.88 + section * 0.06), 0.04));
      }

      const ghostVelocity = patternValue(isLiftSection ? ghostLiftPattern : ghostBasePattern, stepInBar);
      if (ghostVelocity > 0 && shouldTrigger(isAmbient ? 0.52 : isFutureGarage ? 0.86 : isDubstep ? 0.66 : 0.78)) {
        ghost.triggerAttackRelease('64n', humanizedTime(0.2), velocityHuman(ghostVelocity, 0.03));
      }

      const openHatVelocity = preset.openHatPattern[stepInBar];
      if (openHatVelocity > 0) {
        hat.triggerAttackRelease('8n', humanizedTime(0.2), velocityHuman(openHatVelocity * (0.9 + section * 0.05), 0.03));
      }

      const textureVelocity = patternValue(isLiftSection ? textureLiftPattern : preset.texturePattern, stepInBar);
      if (textureVelocity > 0 && shouldTrigger(isAmbient ? 0.8 : isFutureGarage || isDubstep ? 0.84 : 0.7)) {
        texture.triggerAttackRelease('32n', humanizedTime(0.5), velocityHuman(textureVelocity, 0.03));
      }

      if (preset.genre === 'lofi' && isFillBar && (stepInBar === 14 || stepInBar === 15)) {
        clap.triggerAttackRelease('64n', humanizedTime(0.2), velocityHuman(0.12, 0.02));
      }

      if (preset.id === 'lofi_jersey' && isFillBar && (stepInBar === 13 || stepInBar === 15)) {
        kick.triggerAttackRelease('C1', '16n', humanizedTime(0.2), velocityHuman(0.52, 0.03));
      }

      if (isUkg && isFillBar && (stepInBar === 13 || stepInBar === 15) && shouldTrigger(0.62)) {
        clap.triggerAttackRelease('64n', humanizedTime(0.2), velocityHuman(0.16, 0.02));
      }

      if (preset.id === 'lofi_2step' && isLiftSection && (stepInBar === 3 || stepInBar === 11) && shouldTrigger(0.46)) {
        clap.triggerAttackRelease('64n', humanizedTime(0.2), velocityHuman(0.14, 0.02));
      }

      if ((isAmbient || isFutureGarage || isDubstep) && stepInBar === 15 && shouldTrigger(isDubstep ? 0.2 : 0.36)) {
        counterLead.triggerAttackRelease(chord.map((note) => tone.Frequency(note).transpose(12).toNote()), '8n', humanizedTime(0.4), velocityHuman(0.1, 0.02));
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
