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

type ToneSfxSignature = {
  outputGain: number;
  transientGain: number;
  transientHighpassHz: number;
  limiterDb: number;
  compressorThreshold: number;
  compressorRatio: number;
  reverbDecay: number;
  reverbWet: number;
  delayTime: string;
  delayFeedback: number;
  delayWet: number;
  sparkleHarmonicity: number;
  sparkleModulationIndex: number;
  sparkleAttack: number;
  sparkleRelease: number;
  bodyHarmonicity: number;
  bodyAttack: number;
  bodyDecay: number;
  bodySustain: number;
  bodyRelease: number;
  pluckDampening: number;
  punchOscillator: 'sine' | 'triangle' | 'square' | 'sawtooth';
  punchBaseFrequency: number;
  punchOctaves: number;
  clickHarmonicity: number;
  clickModulationIndex: number;
  clickResonance: number;
  clickOctaves: number;
  clickDecay: number;
  snapNoise: 'white' | 'pink' | 'brown';
  tapOffsets: [number, number];
  correctOffsets: [number, number, number];
  missOffsets: [number, number, number];
  clearOffsetsA: [number, number, number];
  clearOffsetsB: [number, number, number];
  finalOffset: number;
  tapAccentChance: number;
  tapAccentDelaySec: number;
  clearTagChance: number;
  syncNudgeSec: number;
  disposeMs: number;
};

type ToneMasterStageConfig = {
  tapeDrive: number;
  tapeWet: number;
  colorCutoffHz: number;
  colorQ: number;
  eqLowDb: number;
  eqMidDb: number;
  eqHighDb: number;
  eqLowFrequencyHz: number;
  eqHighFrequencyHz: number;
  busCompThreshold: number;
  busCompRatio: number;
  busCompAttack: number;
  busCompRelease: number;
  multibandLowThreshold: number;
  multibandLowRatio: number;
  multibandMidThreshold: number;
  multibandMidRatio: number;
  multibandHighThreshold: number;
  multibandHighRatio: number;
  stereoWidth: number;
  limiterDb: number;
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

function shiftNoteOctave(note: string, octaveShift: number): string {
  const match = note.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) return note;
  const [, pitch, octaveText] = match;
  return `${pitch}${Number(octaveText) + octaveShift}`;
}

function pickScaleNote(scale: string[], offset: number): string {
  const fallbackScale = ['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'E5'];
  const source = scale.length > 0 ? scale : fallbackScale;
  const length = source.length;
  const index = ((offset % length) + length) % length;
  const octaveShift = Math.floor(offset / length);
  return shiftNoteOctave(source[index] ?? 'C4', octaveShift);
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

const BASE_SFX_SIGNATURE: ToneSfxSignature = {
  outputGain: 0.86,
  transientGain: 0.92,
  transientHighpassHz: 6800,
  limiterDb: -1.2,
  compressorThreshold: -24,
  compressorRatio: 3.2,
  reverbDecay: 2.8,
  reverbWet: 0.26,
  delayTime: '8n',
  delayFeedback: 0.24,
  delayWet: 0.16,
  sparkleHarmonicity: 1.38,
  sparkleModulationIndex: 6.4,
  sparkleAttack: 0.008,
  sparkleRelease: 0.35,
  bodyHarmonicity: 1.52,
  bodyAttack: 0.005,
  bodyDecay: 0.18,
  bodySustain: 0.08,
  bodyRelease: 0.3,
  pluckDampening: 4800,
  punchOscillator: 'triangle',
  punchBaseFrequency: 70,
  punchOctaves: 3.1,
  clickHarmonicity: 6.8,
  clickModulationIndex: 26,
  clickResonance: 1600,
  clickOctaves: 1.6,
  clickDecay: 0.09,
  snapNoise: 'white',
  tapOffsets: [2, 4],
  correctOffsets: [1, 3, 5],
  missOffsets: [1, 0, 2],
  clearOffsetsA: [0, 2, 4],
  clearOffsetsB: [1, 3, 5],
  finalOffset: 6,
  tapAccentChance: 0.25,
  tapAccentDelaySec: 0.065,
  clearTagChance: 0.35,
  syncNudgeSec: 0,
  disposeMs: 2400,
};

const TONE_SFX_SIGNATURE_LIBRARY: Record<TonePresetId, ToneSfxSignature> = {
  lofi_cafe: {
    ...BASE_SFX_SIGNATURE,
    transientHighpassHz: 6400,
    pluckDampening: 4300,
    snapNoise: 'pink',
    tapAccentChance: 0.22,
  },
  lofi_rain: {
    ...BASE_SFX_SIGNATURE,
    outputGain: 0.82,
    transientGain: 0.85,
    transientHighpassHz: 5200,
    reverbDecay: 3.8,
    reverbWet: 0.34,
    delayFeedback: 0.32,
    delayWet: 0.23,
    sparkleRelease: 0.48,
    bodyRelease: 0.42,
    pluckDampening: 3600,
    snapNoise: 'pink',
    tapOffsets: [1, 3],
    correctOffsets: [0, 2, 4],
    clearTagChance: 0.44,
    disposeMs: 3000,
  },
  lofi_jersey: {
    ...BASE_SFX_SIGNATURE,
    outputGain: 0.9,
    transientHighpassHz: 7600,
    compressorRatio: 3.8,
    delayTime: '16n',
    delayWet: 0.14,
    sparkleHarmonicity: 1.56,
    sparkleModulationIndex: 7.4,
    bodyHarmonicity: 1.62,
    pluckDampening: 5100,
    punchOscillator: 'square',
    punchBaseFrequency: 62,
    punchOctaves: 3.4,
    clickHarmonicity: 7.2,
    clickModulationIndex: 28,
    clickResonance: 2100,
    clickOctaves: 1.8,
    tapOffsets: [2, 5],
    correctOffsets: [2, 4, 6],
    missOffsets: [2, 1, 0],
    clearOffsetsA: [1, 3, 5],
    clearOffsetsB: [2, 4, 6],
    tapAccentChance: 0.72,
    tapAccentDelaySec: 0.058,
    syncNudgeSec: 0.01,
    disposeMs: 2200,
  },
  lofi_2step: {
    ...BASE_SFX_SIGNATURE,
    outputGain: 0.88,
    transientHighpassHz: 7000,
    delayTime: '8t',
    delayFeedback: 0.27,
    delayWet: 0.18,
    pluckDampening: 4600,
    punchOscillator: 'square',
    punchBaseFrequency: 66,
    punchOctaves: 3.2,
    clickDecay: 0.08,
    tapOffsets: [1, 5],
    correctOffsets: [1, 4, 6],
    clearOffsetsA: [0, 3, 5],
    clearOffsetsB: [1, 4, 6],
    tapAccentChance: 0.55,
    tapAccentDelaySec: 0.05,
    clearTagChance: 0.48,
    syncNudgeSec: 0.014,
  },
  uk_garage_neon: {
    ...BASE_SFX_SIGNATURE,
    outputGain: 0.89,
    transientHighpassHz: 7400,
    reverbDecay: 2.6,
    reverbWet: 0.2,
    delayTime: '16n',
    delayWet: 0.14,
    sparkleHarmonicity: 1.5,
    sparkleModulationIndex: 7.2,
    pluckDampening: 5000,
    punchOscillator: 'square',
    punchBaseFrequency: 64,
    punchOctaves: 3.35,
    clickHarmonicity: 7.4,
    clickModulationIndex: 30,
    clickResonance: 2200,
    clickOctaves: 1.85,
    tapOffsets: [1, 4],
    correctOffsets: [1, 4, 5],
    missOffsets: [2, 0, 1],
    clearOffsetsA: [0, 3, 5],
    clearOffsetsB: [1, 4, 6],
    tapAccentChance: 0.64,
    tapAccentDelaySec: 0.055,
    syncNudgeSec: 0.008,
    disposeMs: 2200,
  },
  future_garage_mist: {
    ...BASE_SFX_SIGNATURE,
    outputGain: 0.8,
    transientGain: 0.84,
    transientHighpassHz: 4600,
    compressorThreshold: -26,
    compressorRatio: 2.4,
    reverbDecay: 4.8,
    reverbWet: 0.36,
    delayFeedback: 0.35,
    delayWet: 0.28,
    sparkleHarmonicity: 1.14,
    sparkleModulationIndex: 3.8,
    sparkleAttack: 0.018,
    sparkleRelease: 0.62,
    bodyHarmonicity: 1.2,
    bodyAttack: 0.012,
    bodyDecay: 0.24,
    bodySustain: 0.16,
    bodyRelease: 0.48,
    pluckDampening: 3000,
    punchOscillator: 'triangle',
    punchBaseFrequency: 58,
    punchOctaves: 2.5,
    clickHarmonicity: 3.8,
    clickModulationIndex: 18,
    clickResonance: 1200,
    clickOctaves: 1.2,
    clickDecay: 0.06,
    snapNoise: 'pink',
    tapOffsets: [1, 5],
    correctOffsets: [0, 3, 5],
    clearOffsetsA: [0, 2, 5],
    clearOffsetsB: [1, 4, 6],
    finalOffset: 5,
    tapAccentChance: 0.3,
    tapAccentDelaySec: 0.07,
    clearTagChance: 0.52,
    syncNudgeSec: 0.004,
    disposeMs: 3400,
  },
  dubstep_nightbus: {
    ...BASE_SFX_SIGNATURE,
    outputGain: 0.82,
    transientGain: 0.86,
    transientHighpassHz: 5200,
    compressorThreshold: -25,
    compressorRatio: 2.8,
    reverbDecay: 3.9,
    reverbWet: 0.3,
    delayFeedback: 0.31,
    delayWet: 0.24,
    sparkleHarmonicity: 1.22,
    sparkleModulationIndex: 4.7,
    sparkleAttack: 0.016,
    sparkleRelease: 0.45,
    bodyHarmonicity: 1.28,
    bodyAttack: 0.01,
    bodyDecay: 0.22,
    bodySustain: 0.14,
    bodyRelease: 0.38,
    pluckDampening: 2800,
    punchOscillator: 'sawtooth',
    punchBaseFrequency: 54,
    punchOctaves: 2.2,
    clickHarmonicity: 4.2,
    clickModulationIndex: 20,
    clickResonance: 1300,
    clickOctaves: 1.35,
    clickDecay: 0.07,
    snapNoise: 'pink',
    tapOffsets: [0, 3],
    correctOffsets: [0, 2, 4],
    missOffsets: [2, 1, 0],
    clearOffsetsA: [0, 2, 4],
    clearOffsetsB: [1, 3, 5],
    finalOffset: 4,
    tapAccentChance: 0.38,
    tapAccentDelaySec: 0.062,
    clearTagChance: 0.4,
    syncNudgeSec: 0.003,
    disposeMs: 3200,
  },
  ambient_stars: {
    ...BASE_SFX_SIGNATURE,
    outputGain: 0.7,
    transientGain: 0.72,
    transientHighpassHz: 4200,
    compressorThreshold: -28,
    compressorRatio: 2.1,
    reverbDecay: 6.4,
    reverbWet: 0.48,
    delayFeedback: 0.34,
    delayWet: 0.26,
    sparkleHarmonicity: 1.08,
    sparkleModulationIndex: 3.2,
    sparkleAttack: 0.02,
    sparkleRelease: 0.9,
    bodyHarmonicity: 1.1,
    bodyAttack: 0.015,
    bodyDecay: 0.28,
    bodySustain: 0.24,
    bodyRelease: 0.78,
    pluckDampening: 2600,
    punchBaseFrequency: 62,
    punchOctaves: 2.4,
    clickHarmonicity: 3.2,
    clickModulationIndex: 18,
    clickResonance: 900,
    clickOctaves: 1.1,
    clickDecay: 0.05,
    snapNoise: 'pink',
    tapOffsets: [2, 5],
    tapAccentChance: 0.18,
    tapAccentDelaySec: 0.075,
    clearTagChance: 0.55,
    disposeMs: 3800,
  },
  ambient_dream: {
    ...BASE_SFX_SIGNATURE,
    outputGain: 0.68,
    transientGain: 0.7,
    transientHighpassHz: 4000,
    compressorThreshold: -29,
    compressorRatio: 2,
    reverbDecay: 7.2,
    reverbWet: 0.54,
    delayFeedback: 0.37,
    delayWet: 0.3,
    sparkleHarmonicity: 1.04,
    sparkleModulationIndex: 2.8,
    sparkleAttack: 0.024,
    sparkleRelease: 1,
    bodyHarmonicity: 1.05,
    bodyAttack: 0.018,
    bodyDecay: 0.3,
    bodySustain: 0.26,
    bodyRelease: 0.84,
    pluckDampening: 2400,
    punchOscillator: 'sine',
    punchBaseFrequency: 60,
    punchOctaves: 2.2,
    clickHarmonicity: 2.8,
    clickModulationIndex: 15,
    clickResonance: 760,
    clickOctaves: 1.05,
    clickDecay: 0.045,
    snapNoise: 'brown',
    tapOffsets: [1, 4],
    correctOffsets: [0, 2, 4],
    finalOffset: 5,
    tapAccentChance: 0.14,
    tapAccentDelaySec: 0.08,
    clearTagChance: 0.62,
    disposeMs: 4000,
  },
};

const TONE_MASTER_STAGE_LIBRARY: Record<TonePresetId, ToneMasterStageConfig> = {
  lofi_cafe: {
    tapeDrive: 0.12,
    tapeWet: 0.2,
    colorCutoffHz: 5600,
    colorQ: 1.4,
    eqLowDb: 1.1,
    eqMidDb: 0.35,
    eqHighDb: -0.4,
    eqLowFrequencyHz: 190,
    eqHighFrequencyHz: 3600,
    busCompThreshold: -20,
    busCompRatio: 3.2,
    busCompAttack: 0.016,
    busCompRelease: 0.18,
    multibandLowThreshold: -24,
    multibandLowRatio: 2.8,
    multibandMidThreshold: -22,
    multibandMidRatio: 2.4,
    multibandHighThreshold: -19,
    multibandHighRatio: 1.8,
    stereoWidth: 0.56,
    limiterDb: -1.1,
  },
  lofi_rain: {
    tapeDrive: 0.1,
    tapeWet: 0.22,
    colorCutoffHz: 5000,
    colorQ: 1.1,
    eqLowDb: 1.3,
    eqMidDb: -0.1,
    eqHighDb: -0.9,
    eqLowFrequencyHz: 180,
    eqHighFrequencyHz: 3200,
    busCompThreshold: -21,
    busCompRatio: 3,
    busCompAttack: 0.02,
    busCompRelease: 0.22,
    multibandLowThreshold: -25,
    multibandLowRatio: 2.9,
    multibandMidThreshold: -22,
    multibandMidRatio: 2.2,
    multibandHighThreshold: -20,
    multibandHighRatio: 1.9,
    stereoWidth: 0.58,
    limiterDb: -1.2,
  },
  lofi_jersey: {
    tapeDrive: 0.15,
    tapeWet: 0.24,
    colorCutoffHz: 6200,
    colorQ: 1.5,
    eqLowDb: 1,
    eqMidDb: 0.9,
    eqHighDb: 0.8,
    eqLowFrequencyHz: 200,
    eqHighFrequencyHz: 4200,
    busCompThreshold: -19,
    busCompRatio: 3.5,
    busCompAttack: 0.012,
    busCompRelease: 0.14,
    multibandLowThreshold: -23,
    multibandLowRatio: 3.1,
    multibandMidThreshold: -21,
    multibandMidRatio: 2.5,
    multibandHighThreshold: -18,
    multibandHighRatio: 2.1,
    stereoWidth: 0.66,
    limiterDb: -1,
  },
  lofi_2step: {
    tapeDrive: 0.13,
    tapeWet: 0.22,
    colorCutoffHz: 6000,
    colorQ: 1.35,
    eqLowDb: 1.2,
    eqMidDb: 0.6,
    eqHighDb: 0.45,
    eqLowFrequencyHz: 195,
    eqHighFrequencyHz: 4000,
    busCompThreshold: -19.5,
    busCompRatio: 3.4,
    busCompAttack: 0.013,
    busCompRelease: 0.15,
    multibandLowThreshold: -23,
    multibandLowRatio: 3,
    multibandMidThreshold: -21,
    multibandMidRatio: 2.4,
    multibandHighThreshold: -18.5,
    multibandHighRatio: 2,
    stereoWidth: 0.64,
    limiterDb: -1.05,
  },
  uk_garage_neon: {
    tapeDrive: 0.14,
    tapeWet: 0.23,
    colorCutoffHz: 6400,
    colorQ: 1.55,
    eqLowDb: 0.9,
    eqMidDb: 1.1,
    eqHighDb: 1,
    eqLowFrequencyHz: 210,
    eqHighFrequencyHz: 4600,
    busCompThreshold: -18.5,
    busCompRatio: 3.7,
    busCompAttack: 0.01,
    busCompRelease: 0.13,
    multibandLowThreshold: -22,
    multibandLowRatio: 3.1,
    multibandMidThreshold: -20.5,
    multibandMidRatio: 2.6,
    multibandHighThreshold: -17.5,
    multibandHighRatio: 2.2,
    stereoWidth: 0.68,
    limiterDb: -0.95,
  },
  future_garage_mist: {
    tapeDrive: 0.09,
    tapeWet: 0.16,
    colorCutoffHz: 4600,
    colorQ: 1,
    eqLowDb: 1.4,
    eqMidDb: -0.4,
    eqHighDb: -0.2,
    eqLowFrequencyHz: 170,
    eqHighFrequencyHz: 3000,
    busCompThreshold: -22,
    busCompRatio: 2.7,
    busCompAttack: 0.024,
    busCompRelease: 0.24,
    multibandLowThreshold: -26,
    multibandLowRatio: 2.7,
    multibandMidThreshold: -23,
    multibandMidRatio: 2,
    multibandHighThreshold: -21,
    multibandHighRatio: 1.7,
    stereoWidth: 0.72,
    limiterDb: -1.2,
  },
  dubstep_nightbus: {
    tapeDrive: 0.08,
    tapeWet: 0.14,
    colorCutoffHz: 4200,
    colorQ: 1.2,
    eqLowDb: 2,
    eqMidDb: -0.55,
    eqHighDb: -0.65,
    eqLowFrequencyHz: 160,
    eqHighFrequencyHz: 2800,
    busCompThreshold: -21,
    busCompRatio: 2.9,
    busCompAttack: 0.018,
    busCompRelease: 0.26,
    multibandLowThreshold: -27,
    multibandLowRatio: 3.2,
    multibandMidThreshold: -24,
    multibandMidRatio: 2.1,
    multibandHighThreshold: -22,
    multibandHighRatio: 1.8,
    stereoWidth: 0.62,
    limiterDb: -1.15,
  },
  ambient_stars: {
    tapeDrive: 0.035,
    tapeWet: 0.1,
    colorCutoffHz: 7600,
    colorQ: 0.85,
    eqLowDb: 0.45,
    eqMidDb: -0.15,
    eqHighDb: 0.8,
    eqLowFrequencyHz: 220,
    eqHighFrequencyHz: 5200,
    busCompThreshold: -24,
    busCompRatio: 2,
    busCompAttack: 0.03,
    busCompRelease: 0.32,
    multibandLowThreshold: -28,
    multibandLowRatio: 2.2,
    multibandMidThreshold: -25,
    multibandMidRatio: 1.8,
    multibandHighThreshold: -23,
    multibandHighRatio: 1.6,
    stereoWidth: 0.76,
    limiterDb: -1.3,
  },
  ambient_dream: {
    tapeDrive: 0.03,
    tapeWet: 0.08,
    colorCutoffHz: 7000,
    colorQ: 0.8,
    eqLowDb: 0.35,
    eqMidDb: -0.25,
    eqHighDb: 0.95,
    eqLowFrequencyHz: 210,
    eqHighFrequencyHz: 5000,
    busCompThreshold: -25,
    busCompRatio: 1.9,
    busCompAttack: 0.032,
    busCompRelease: 0.35,
    multibandLowThreshold: -29,
    multibandLowRatio: 2.1,
    multibandMidThreshold: -26,
    multibandMidRatio: 1.7,
    multibandHighThreshold: -24,
    multibandHighRatio: 1.5,
    stereoWidth: 0.79,
    limiterDb: -1.35,
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
  private bgmVolume = 0.65;
  private sfxVolume = 0.8;

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
    const normalized = clamp01(nextVolume);
    this.bgmVolume = normalized;
    this.sfxVolume = normalized;
    const next = curvedVolume(this.bgmVolume);
    if (this.assetAudio) this.assetAudio.volume = next;
    if (this.toneGain?.gain?.rampTo) {
      this.toneGain.gain.rampTo(next * 0.9, 0.08);
    }
  }

  setBgmVolume(nextVolume: number) {
    this.bgmVolume = clamp01(nextVolume);
    const next = curvedVolume(this.bgmVolume);
    if (this.assetAudio) this.assetAudio.volume = next;
    if (this.toneGain?.gain?.rampTo) {
      this.toneGain.gain.rampTo(next * 0.9, 0.08);
    }
  }

  setSfxVolume(nextVolume: number) {
    this.sfxVolume = clamp01(nextVolume);
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
    this.assetAudio.volume = curvedVolume(this.bgmVolume);
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
    const signature = TONE_SFX_SIGNATURE_LIBRARY[presetId];
    const scale = preset.sfxScale;
    const tapMain = pickScaleNote(scale, signature.tapOffsets[0]);
    const tapColor = pickScaleNote(scale, signature.tapOffsets[1]);
    const correctA = pickScaleNote(scale, signature.correctOffsets[0]);
    const correctB = pickScaleNote(scale, signature.correctOffsets[1]);
    const correctC = pickScaleNote(scale, signature.correctOffsets[2]);
    const missA = noteAtOctave(pickScaleNote(scale, signature.missOffsets[0]), 2);
    const missB = noteAtOctave(pickScaleNote(scale, signature.missOffsets[1]), 2);
    const missC = noteAtOctave(pickScaleNote(scale, signature.missOffsets[2]), 2);
    const clearA = pickScaleNote(scale, signature.clearOffsetsA[0]);
    const clearB = pickScaleNote(scale, signature.clearOffsetsA[1]);
    const clearC = pickScaleNote(scale, signature.clearOffsetsA[2]);
    const clearD = pickScaleNote(scale, signature.clearOffsetsB[0]);
    const clearE = pickScaleNote(scale, signature.clearOffsetsB[1]);
    const clearF = pickScaleNote(scale, signature.clearOffsetsB[2]);
    const finalNote = pickScaleNote(scale, signature.finalOffset);
    const now = tone.now();
    const output = new tone.Gain(curvedVolume(this.sfxVolume) * signature.outputGain).toDestination();
    const limiter = new tone.Limiter(signature.limiterDb);
    const comp = new tone.Compressor(signature.compressorThreshold, signature.compressorRatio);
    const tonalBus = new tone.Gain(1);
    const transientBus = new tone.Gain(signature.transientGain);
    const transientShape = new tone.Filter(signature.transientHighpassHz, 'highpass');

    tonalBus.connect(comp);
    transientBus.connect(comp);
    comp.connect(limiter);
    limiter.connect(output);
    transientShape.connect(transientBus);

    const reverb = new tone.Reverb({
      decay: signature.reverbDecay,
      wet: signature.reverbWet,
    });
    reverb.connect(tonalBus);
    const delay = new tone.FeedbackDelay(signature.delayTime, signature.delayFeedback);
    delay.wet.value = signature.delayWet;
    delay.connect(tonalBus);

    const sparkle = new tone.PolySynth(tone.FMSynth, {
      harmonicity: signature.sparkleHarmonicity,
      modulationIndex: signature.sparkleModulationIndex,
      envelope: {
        attack: signature.sparkleAttack,
        decay: 0.2,
        sustain: 0.15,
        release: signature.sparkleRelease,
      },
    });
    sparkle.connect(reverb);
    sparkle.connect(delay);

    const body = new tone.PolySynth(tone.AMSynth, {
      harmonicity: signature.bodyHarmonicity,
      envelope: {
        attack: signature.bodyAttack,
        decay: signature.bodyDecay,
        sustain: signature.bodySustain,
        release: signature.bodyRelease,
      },
    });
    body.connect(tonalBus);

    const pluck = new tone.PluckSynth({
      attackNoise: 0.7,
      dampening: signature.pluckDampening,
      resonance: 0.9,
    });
    pluck.connect(delay);
    pluck.connect(tonalBus);

    const punch = new tone.MonoSynth({
      oscillator: { type: signature.punchOscillator },
      envelope: { attack: 0.004, decay: 0.2, sustain: 0.09, release: 0.24 },
      filterEnvelope: {
        attack: 0.008,
        decay: 0.16,
        sustain: 0.08,
        release: 0.14,
        baseFrequency: signature.punchBaseFrequency,
        octaves: signature.punchOctaves,
      },
    });
    punch.connect(tonalBus);

    const snap = new tone.NoiseSynth({
      noise: { type: signature.snapNoise },
      envelope: { attack: 0.001, decay: 0.07, sustain: 0 },
    });
    snap.connect(transientShape);

    const click = new tone.MetalSynth({
      envelope: { attack: 0.001, decay: signature.clickDecay, release: 0.03 },
      harmonicity: signature.clickHarmonicity,
      modulationIndex: signature.clickModulationIndex,
      resonance: signature.clickResonance,
      octaves: signature.clickOctaves,
    });
    click.connect(transientShape);

    const rise = new tone.Synth({
      oscillator: { type: signature.punchOscillator === 'square' ? 'triangle' : signature.punchOscillator },
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
    const garageAccent = signature.tapAccentChance >= 0.5;
    const syncNudge = signature.syncNudgeSec;
    const velocityHuman = (base: number, spread: number) => Math.max(0, base + randomBetween(-spread, spread));
    const tapAccent = garageAccent && shouldTrigger(signature.tapAccentChance);

    if (sfxId === 'tap') {
      click.triggerAttackRelease('64n', now, velocityHuman(0.14, 0.02));
      snap.triggerAttackRelease('128n', now + 0.004, velocityHuman(0.05, 0.01));
      pluck.triggerAttack(tapMain, now + 0.01);
      body.triggerAttackRelease([tapColor], '16n', now + 0.03 + syncNudge, velocityHuman(0.18, 0.03));
      if (tapAccent) {
        click.triggerAttackRelease('64n', now + signature.tapAccentDelaySec, velocityHuman(0.1, 0.02));
      }
      if (signature.disposeMs >= 3200) {
        sparkle.triggerAttackRelease([correctC], '8n', now + 0.08, velocityHuman(0.1, 0.03));
      }
    } else if (sfxId === 'correct') {
      const burstOffset = Math.max(0.056, signature.tapAccentDelaySec + 0.012);
      sparkle.triggerAttackRelease([correctA], '16n', now, velocityHuman(0.2, 0.03));
      sparkle.triggerAttackRelease([correctB], '16n', now + burstOffset, velocityHuman(0.23, 0.03));
      sparkle.triggerAttackRelease([correctC], '8n', now + burstOffset * 2, velocityHuman(0.22, 0.03));
      body.triggerAttackRelease([tapMain, tapColor], '8n', now + 0.02, velocityHuman(0.16, 0.02));
      pluck.triggerAttack(correctB, now + 0.12 + syncNudge);
      click.triggerAttackRelease('64n', now + 0.015, velocityHuman(0.12, 0.02));
      snap.triggerAttackRelease('32n', now + 0.2, velocityHuman(0.09, 0.02));
      if (preset.rhythmProfile === 'dubstep') {
        punch.triggerAttackRelease(missA, '8n', now + 0.04, velocityHuman(0.18, 0.03));
      }
    } else if (sfxId === 'miss') {
      punch.triggerAttackRelease(missB, '8n', now, velocityHuman(0.22, 0.03));
      punch.triggerAttackRelease(missA, '8n', now + 0.1 + syncNudge, velocityHuman(0.17, 0.03));
      punch.triggerAttackRelease(missC, '16n', now + 0.18 + syncNudge, velocityHuman(0.1, 0.02));
      snap.triggerAttackRelease('16n', now + 0.01, velocityHuman(0.08, 0.02));
      sparkle.triggerAttackRelease([tapMain], '16n', now + 0.07, velocityHuman(0.11, 0.02));
      if (shouldTrigger(0.42)) {
        click.triggerAttackRelease('64n', now + 0.13, velocityHuman(0.08, 0.02));
      }
    } else {
      sparkle.triggerAttackRelease([clearA, clearB, clearC], '8n', now, velocityHuman(0.2, 0.03));
      sparkle.triggerAttackRelease([clearD, clearE, clearF], '4n', now + 0.14, velocityHuman(0.21, 0.03));
      body.triggerAttackRelease([correctB, correctC], '8n', now + 0.08, velocityHuman(0.14, 0.02));
      pluck.triggerAttack(finalNote, now + 0.26 + syncNudge);
      punch.triggerAttackRelease(missA, '8n', now + 0.02, velocityHuman(0.15, 0.02));
      rise.triggerAttackRelease(finalNote, '8n', now + 0.22, velocityHuman(0.14, 0.03));
      click.triggerAttackRelease('64n', now + 0.28, velocityHuman(0.13, 0.03));
      snap.triggerAttackRelease('32n', now + 0.34, velocityHuman(0.09, 0.02));
      if (shouldTrigger(signature.clearTagChance)) {
        click.triggerAttackRelease('64n', now + 0.41, velocityHuman(0.11, 0.02));
      }
    }

    window.setTimeout(() => {
      disposeList.forEach((node) => node.dispose());
    }, signature.disposeMs);
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
    const masterStage = TONE_MASTER_STAGE_LIBRARY[presetId];

    tone.Transport.stop();
    tone.Transport.cancel(0);
    tone.Transport.position = 0;
    tone.Transport.bpm.value = preset.bpm;
    tone.Transport.swing = preset.swing;
    tone.Transport.swingSubdivision = isClubPreset || isUkg ? '8n' : '16n';
    tone.Destination.volume.value = -9;

    const master = this.registerNode(new tone.Gain(curvedVolume(this.bgmVolume) * preset.masterGain).toDestination());
    this.toneGain = master;
    const limiter = this.registerNode(new tone.Limiter(masterStage.limiterDb));
    const stereo = this.registerNode(new tone.StereoWidener(masterStage.stereoWidth));
    const multiband = this.registerNode(
      new tone.MultibandCompressor({
        lowFrequency: masterStage.eqLowFrequencyHz,
        highFrequency: masterStage.eqHighFrequencyHz,
        low: {
          threshold: masterStage.multibandLowThreshold,
          ratio: masterStage.multibandLowRatio,
          attack: 0.03,
          release: 0.22,
        },
        mid: {
          threshold: masterStage.multibandMidThreshold,
          ratio: masterStage.multibandMidRatio,
          attack: 0.02,
          release: 0.16,
        },
        high: {
          threshold: masterStage.multibandHighThreshold,
          ratio: masterStage.multibandHighRatio,
          attack: 0.012,
          release: 0.12,
        },
      }),
    );
    const busComp = this.registerNode(new tone.Compressor(masterStage.busCompThreshold, masterStage.busCompRatio));
    busComp.attack.value = masterStage.busCompAttack;
    busComp.release.value = masterStage.busCompRelease;
    const eq = this.registerNode(
      new tone.EQ3({
        low: masterStage.eqLowDb,
        mid: masterStage.eqMidDb,
        high: masterStage.eqHighDb,
        lowFrequency: masterStage.eqLowFrequencyHz,
        highFrequency: masterStage.eqHighFrequencyHz,
      }),
    );
    const color = this.registerNode(new tone.Filter(masterStage.colorCutoffHz, 'lowpass'));
    color.Q.value = masterStage.colorQ;
    const tape = this.registerNode(new tone.Distortion(masterStage.tapeDrive));
    tape.wet.value = masterStage.tapeWet;
    const sidechain = this.registerNode(new tone.Gain(1));
    const bus = this.registerNode(new tone.Gain(1));
    bus.connect(sidechain);
    sidechain.connect(tape);
    tape.connect(color);
    color.connect(eq);
    eq.connect(busComp);
    busComp.connect(multiband);
    multiband.connect(stereo);
    stereo.connect(limiter);
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
        min: Math.max(900, masterStage.colorCutoffHz - (isAmbient ? 2400 : isDubstep ? 1800 : 2000)),
        max: masterStage.colorCutoffHz + (isAmbient ? 900 : isDubstep ? 500 : 700),
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
    const stereoDrift = this.registerNode(
      new tone.LFO({
        frequency: isAmbient ? 0.035 : isFutureGarage ? 0.08 : 0.12,
        min: Math.max(0.42, masterStage.stereoWidth - 0.08),
        max: Math.min(0.88, masterStage.stereoWidth + 0.08),
      }).start(),
    );
    stereoDrift.connect(stereo.width);

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
    const leadDouble = this.registerNode(
      new tone.PolySynth(tone.Synth, {
        volume: -10,
        oscillator: { type: isAmbient || isFutureGarage ? 'triangle' : 'sawtooth' },
        envelope: { attack: isAmbient ? 0.02 : 0.012, decay: 0.14, sustain: isAmbient ? 0.12 : 0.08, release: isAmbient || isFutureGarage ? 0.38 : 0.26 },
      }),
    );
    const leadAttack = this.registerNode(
      new tone.PluckSynth({
        attackNoise: isAmbient || isFutureGarage ? 0.28 : 0.42,
        dampening: isAmbient || isFutureGarage ? 2600 : 4300,
        resonance: 0.84,
      }),
    );
    const leadToneBus = this.registerNode(new tone.Gain(1));
    const leadColor = this.registerNode(new tone.Filter(isAmbient ? 2600 : isFutureGarage ? 3000 : isDubstep ? 2200 : 3600, 'bandpass'));
    leadColor.Q.value = isAmbient || isFutureGarage ? 1.05 : isDubstep ? 1.22 : 1.35;
    const leadSaturator = this.registerNode(new tone.Distortion(isAmbient ? 0.03 : isDubstep ? 0.055 : 0.085));
    leadSaturator.wet.value = isAmbient ? 0.08 : isDubstep ? 0.14 : 0.2;
    const leadSpread = this.registerNode(new tone.StereoWidener(isAmbient || isFutureGarage ? 0.68 : 0.58));
    const leadFormant = this.registerNode(
      new tone.LFO({
        frequency: isAmbient ? 0.08 : isFutureGarage ? 0.14 : isDubstep ? 0.11 : 0.2,
        min: isAmbient ? 1800 : isFutureGarage ? 2200 : isDubstep ? 1700 : 2600,
        max: isAmbient ? 4200 : isFutureGarage ? 5000 : isDubstep ? 4200 : 6200,
      }).start(),
    );
    leadFormant.connect(leadColor.frequency);
    lead.connect(leadToneBus);
    leadDouble.connect(leadToneBus);
    leadAttack.connect(leadToneBus);
    leadToneBus.connect(leadColor);
    leadColor.connect(leadSaturator);
    leadSaturator.connect(leadSpread);
    leadSpread.connect(bus);
    leadSpread.connect(delay);
    leadSpread.connect(chorus);

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

    const padShimmer = this.registerNode(
      new tone.PolySynth(tone.FMSynth, {
        harmonicity: isAmbient || isFutureGarage ? 1.12 : 1.42,
        modulationIndex: isAmbient || isFutureGarage ? 2.9 : 4.8,
        envelope: {
          attack: isAmbient ? 0.16 : 0.11,
          decay: 0.22,
          sustain: isAmbient ? 0.38 : 0.3,
          release: isAmbient || isFutureGarage ? 1.25 : 0.92,
        },
      }),
    );
    padShimmer.connect(reverb);
    padShimmer.connect(chorus);

    const keyBody = this.registerNode(
      new tone.PolySynth(tone.Synth, {
        oscillator: { type: isAmbient || isFutureGarage ? 'triangle' : 'sine' },
        envelope: {
          attack: isAmbient ? 0.014 : 0.008,
          decay: isAmbient || isFutureGarage ? 0.2 : 0.14,
          sustain: isAmbient ? 0.16 : 0.1,
          release: isAmbient ? 0.32 : 0.22,
        },
      }),
    );
    keyBody.connect(bus);
    keyBody.connect(chorus);
    const keyHammerFilter = this.registerNode(new tone.Filter(isAmbient ? 2600 : 3200, 'highpass'));
    const keyHammer = this.registerNode(
      new tone.NoiseSynth({
        noise: { type: isAmbient ? 'pink' : 'white' },
        envelope: { attack: 0.001, decay: isAmbient ? 0.018 : 0.026, sustain: 0 },
      }),
    );
    keyHammer.connect(keyHammerFilter);
    keyHammerFilter.connect(bus);

    const leadBody = this.registerNode(
      new tone.PolySynth(tone.Synth, {
        oscillator: { type: isAmbient || isFutureGarage ? 'sine' : 'triangle' },
        envelope: {
          attack: isAmbient ? 0.02 : 0.012,
          decay: isAmbient ? 0.24 : 0.16,
          sustain: isAmbient ? 0.16 : 0.11,
          release: isAmbient || isFutureGarage ? 0.48 : 0.32,
        },
      }),
    );
    leadBody.connect(leadToneBus);
    leadBody.connect(reverb);
    const leadBreathFilter = this.registerNode(new tone.Filter(isAmbient || isFutureGarage ? 3400 : 4800, 'highpass'));
    const leadBreath = this.registerNode(
      new tone.NoiseSynth({
        noise: { type: isAmbient || isFutureGarage ? 'pink' : 'white' },
        envelope: { attack: 0.001, decay: isAmbient ? 0.05 : 0.035, sustain: 0 },
      }),
    );
    leadBreath.connect(leadBreathFilter);
    leadBreathFilter.connect(leadSpread);
    leadBreathFilter.connect(reverb);

    const bassBody = this.registerNode(
      new tone.MonoSynth({
        oscillator: { type: isDubstep ? 'triangle' : 'sine' },
        envelope: { attack: 0.008, decay: 0.18, sustain: 0.14, release: 0.1 },
        filterEnvelope: {
          attack: 0.01,
          decay: 0.12,
          sustain: 0.12,
          release: 0.08,
          baseFrequency: isDubstep ? 64 : 78,
          octaves: isDubstep ? 1.8 : 2.2,
        },
      }),
    );
    bassBody.connect(bus);
    const bassFingerFilter = this.registerNode(new tone.Filter(isDubstep ? 2200 : 3000, 'highpass'));
    const bassFinger = this.registerNode(
      new tone.NoiseSynth({
        noise: { type: 'pink' },
        envelope: { attack: 0.001, decay: 0.02, sustain: 0 },
      }),
    );
    bassFinger.connect(bassFingerFilter);
    bassFingerFilter.connect(bus);

    const kickClickFilter = this.registerNode(new tone.Filter(2100, 'highpass'));
    const kickClick = this.registerNode(
      new tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.012, sustain: 0 },
      }),
    );
    kickClick.connect(kickClickFilter);
    kickClickFilter.connect(bus);

    const snareTone = this.registerNode(
      new tone.Synth({
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.001, decay: isAmbient ? 0.08 : 0.12, sustain: 0, release: 0.02 },
      }),
    );
    snareTone.connect(bus);
    const snareSnapFilter = this.registerNode(new tone.Filter(isAmbient ? 2200 : 2600, 'highpass'));
    const snareSnap = this.registerNode(
      new tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: isAmbient ? 0.045 : 0.065, sustain: 0 },
      }),
    );
    snareSnap.connect(snareSnapFilter);
    snareSnapFilter.connect(bus);

    const hatOpen = this.registerNode(
      new tone.MetalSynth({
        envelope: { attack: 0.001, decay: isAmbient ? 0.08 : 0.12, release: 0.06 },
        harmonicity: isAmbient ? 3.2 : 4.8,
        modulationIndex: isAmbient ? 12 : 18,
        resonance: isAmbient ? 1200 : 1800,
        octaves: isAmbient ? 1.1 : 1.3,
      }),
    );
    hatOpen.connect(bus);
    hatOpen.connect(reverb);

    const percussionWood = this.registerNode(
      new tone.PluckSynth({
        attackNoise: 0.5,
        dampening: isAmbient ? 2600 : 4200,
        resonance: 0.86,
      }),
    );
    percussionWood.connect(bus);

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
          ? masterStage.colorCutoffHz + section * 520
          : isDubstep
            ? masterStage.colorCutoffHz + section * 260
            : isFutureGarage
              ? masterStage.colorCutoffHz + section * 320
              : masterStage.colorCutoffHz + section * 440;
        color.frequency.setTargetAtTime(colorTarget + (isFillBar ? 260 : 0), time, 0.4);
        delay.wet.setTargetAtTime(Math.min(0.62, preset.delayWet + sectionTexture * (isFutureGarage || isDubstep ? 0.44 : 0.35)), time, 0.7);
        delay.feedback.setTargetAtTime(Math.min(0.52, (isAmbient ? 0.28 : isDubstep ? 0.26 : 0.2) + sectionTexture * 0.38), time, 0.8);
        reverb.wet.setTargetAtTime(Math.min(0.7, preset.reverbWet + sectionTexture * 0.26), time, 1.1);
        ambienceGain.gain.setTargetAtTime((isAmbient ? 0.014 : isFutureGarage ? 0.012 : isDubstep ? 0.011 : 0.009) + sectionTexture * (isAmbient || isFutureGarage || isDubstep ? 0.024 : 0.012), time, 1.2);
        eq.low.setTargetAtTime(masterStage.eqLowDb + sectionTexture * (isHalfTimeBass ? 1.3 : 0.8), time, 0.9);
        eq.mid.setTargetAtTime(masterStage.eqMidDb + (isLiftSection ? 0.22 : 0), time, 0.9);
        eq.high.setTargetAtTime(masterStage.eqHighDb + sectionTexture * (isAmbient ? 0.65 : isDubstep ? 0.35 : 0.5), time, 0.9);
      }

      if (stepInBar === 0 && bar % preset.padStrideBars === 0) {
        pad.triggerAttackRelease(chord, preset.padDuration, humanizedTime(0.7), velocityHuman(preset.padVelocity * sectionEnergy, 0.03));
        const shimmerChord = chord.map((note) => tone.Frequency(note).transpose(12).toNote());
        padShimmer.triggerAttackRelease(
          shimmerChord,
          isAmbient || isFutureGarage ? '2n' : '1m',
          humanizedTime(0.6),
          velocityHuman(preset.padVelocity * 0.36 * sectionEnergy, 0.03),
        );
        if (isLiftSection && shouldTrigger(isAmbient ? 0.45 : 0.3)) {
          const counterChord = chord.map((note) => tone.Frequency(note).transpose(12).toNote());
          counterLead.triggerAttackRelease(counterChord, isFutureGarage || isDubstep ? '8n' : '4n', humanizedTime(0.6), velocityHuman(isAmbient || isFutureGarage ? 0.12 : 0.1, 0.03));
        }
      }

      const keyVelocity = patternValue(isLiftSection ? keyLiftPattern : preset.keyPattern, stepInBar);
      if (keyVelocity > 0) {
        const keyTime = humanizedTime();
        const keyMainVelocity = velocityHuman(keyVelocity * (0.84 + section * 0.07), 0.05);
        keys.triggerAttackRelease(chord, '16n', keyTime, keyMainVelocity);
        keyBody.triggerAttackRelease(chord, '16n', keyTime + 0.004, velocityHuman(keyMainVelocity * 0.72, 0.04));
        if (shouldTrigger(isAmbient ? 0.52 : 0.74)) {
          keyHammer.triggerAttackRelease('128n', keyTime, velocityHuman(keyMainVelocity * 0.28, 0.03));
        }
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
          const leadTime = humanizedTime();
          const leadVelocity = velocityHuman(preset.leadVelocity * (0.9 + section * 0.08), 0.06);
          const leadFrequency = tone.Frequency(note).toFrequency();
          const leadDetuneCents = randomBetween(-7, 7);
          const leadDoubleDetuneCents = randomBetween(9, 16) * (Math.random() > 0.5 ? 1 : -1);
          const leadPrimaryHz = leadFrequency * Math.pow(2, leadDetuneCents / 1200);
          const leadDoubleHz = leadFrequency * Math.pow(2, leadDoubleDetuneCents / 1200);
          lead.triggerAttackRelease(leadPrimaryHz, preset.leadDuration, leadTime, leadVelocity);
          leadDouble.triggerAttackRelease(leadDoubleHz, isAmbient || isFutureGarage ? '8n' : '16n', leadTime + 0.006, velocityHuman(leadVelocity * 0.54, 0.04));
          const bodyNote = tone.Frequency(note).transpose(isAmbient ? -12 : 0).toNote();
          const bodyFrequency = tone.Frequency(bodyNote).toFrequency() * Math.pow(2, randomBetween(-3, 3) / 1200);
          leadBody.triggerAttackRelease(bodyFrequency, isAmbient ? '8n' : '16n', leadTime + 0.01, velocityHuman(leadVelocity * 0.58, 0.04));
          if (shouldTrigger(isAmbient || isFutureGarage ? 0.52 : 0.38)) {
            leadAttack.triggerAttack(note, leadTime + 0.004);
          }
          const leadColorTarget = (isAmbient ? 2100 : isFutureGarage ? 2600 : isDubstep ? 2000 : 3200) + leadVelocity * 3400 + sectionTexture * 1200;
          leadColor.frequency.setTargetAtTime(leadColorTarget, leadTime, 0.06);
          leadSaturator.wet.setTargetAtTime(
            Math.min(0.36, (isAmbient ? 0.08 : isDubstep ? 0.14 : 0.2) + leadVelocity * (isDubstep ? 0.12 : 0.1)),
            leadTime,
            0.09,
          );
          if (shouldTrigger(isAmbient || isFutureGarage ? 0.34 : 0.18)) {
            leadBreath.triggerAttackRelease('64n', leadTime + 0.012, velocityHuman(leadVelocity * 0.2, 0.03));
          }
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
        const bassTime = humanizedTime(0.6);
        const bassVelocity = velocityHuman(bassBase * (0.9 + section * 0.06), 0.05);
        bass.triggerAttackRelease(bassNote, preset.bassDuration, bassTime, bassVelocity);
        bassBody.triggerAttackRelease(bassNote, '16n', bassTime + 0.006, velocityHuman(bassVelocity * 0.45, 0.03));
        if (shouldTrigger(isDubstep ? 0.46 : 0.28)) {
          bassFinger.triggerAttackRelease('128n', bassTime + 0.003, velocityHuman(bassVelocity * 0.2, 0.02));
        }
      }

      const subVelocity = patternValue(isLiftSection ? subLiftPattern : preset.subPattern, stepInBar);
      if (subVelocity > 0 && stepInBar % 8 === 0) {
        sub.triggerAttackRelease(noteAtOctave(chord[0], 2), '8n', humanizedTime(0.5), velocityHuman(subVelocity * (0.92 + section * 0.05), 0.03));
      }

      const kickVelocity = patternValue(isLiftSection ? kickLiftPattern : kickBasePattern, stepInBar);
      if (kickVelocity > 0 && !isDropBar) {
        const kickTime = humanizedTime(0.4);
        const kickPower = velocityHuman(kickVelocity * (0.9 + section * 0.06), 0.04);
        kick.triggerAttackRelease('C1', isDubstep ? '4n' : '8n', kickTime, kickPower);
        kickClick.triggerAttackRelease('128n', kickTime, velocityHuman(kickPower * 0.32, 0.03));
        const duckDepth = Math.min(0.36, sidechainDepthBase + (isLiftSection ? 0.03 : 0) + (isFillBar ? 0.02 : 0));
        sidechain.gain.cancelScheduledValues(kickTime);
        sidechain.gain.setValueAtTime(1, kickTime);
        sidechain.gain.linearRampToValueAtTime(Math.max(0.58, 1 - duckDepth), kickTime + 0.012);
        sidechain.gain.exponentialRampToValueAtTime(1, kickTime + (isAmbient ? 0.33 : isDubstep ? 0.29 : 0.24));
      }

      const clapVelocity = patternValue(isLiftSection ? clapLiftPattern : clapBasePattern, stepInBar);
      if (clapVelocity > 0) {
        const clapTime = humanizedTime(0.35);
        const clapPower = velocityHuman(clapVelocity * (0.92 + section * 0.05), 0.05);
        clap.triggerAttackRelease('16n', clapTime, clapPower);
        snareSnap.triggerAttackRelease('32n', clapTime, velocityHuman(clapPower * 0.52, 0.04));
        snareTone.triggerAttackRelease(isAmbient ? 'D3' : 'E3', '32n', clapTime + 0.004, velocityHuman(clapPower * 0.42, 0.04));
      }

      const hatVelocity = patternValue(isLiftSection ? hatLiftPattern : hatBasePattern, stepInBar);
      if (hatVelocity > 0 && shouldTrigger(isAmbient ? 0.62 : isFutureGarage || isDubstep ? 0.74 : 0.87)) {
        const hatTime = humanizedTime(0.28);
        const hatPower = velocityHuman(hatVelocity * (0.88 + section * 0.06), 0.04);
        hat.triggerAttackRelease('32n', hatTime, hatPower);
        if (shouldTrigger(isClubPreset || isUkg ? 0.2 : 0.1)) {
          hatOpen.triggerAttackRelease('16n', hatTime + 0.02, velocityHuman(hatPower * 0.32, 0.03));
        }
      }

      const ghostVelocity = patternValue(isLiftSection ? ghostLiftPattern : ghostBasePattern, stepInBar);
      if (ghostVelocity > 0 && shouldTrigger(isAmbient ? 0.52 : isFutureGarage ? 0.86 : isDubstep ? 0.66 : 0.78)) {
        const ghostTime = humanizedTime(0.2);
        const ghostPower = velocityHuman(ghostVelocity, 0.03);
        ghost.triggerAttackRelease('64n', ghostTime, ghostPower);
        if (shouldTrigger(0.28)) {
          percussionWood.triggerAttack(noteAtOctave(chord[1], 5), ghostTime + 0.006);
        }
      }

      const openHatVelocity = preset.openHatPattern[stepInBar];
      if (openHatVelocity > 0) {
        hatOpen.triggerAttackRelease('8n', humanizedTime(0.2), velocityHuman(openHatVelocity * (0.9 + section * 0.05), 0.03));
      }

      const textureVelocity = patternValue(isLiftSection ? textureLiftPattern : preset.texturePattern, stepInBar);
      if (textureVelocity > 0 && shouldTrigger(isAmbient ? 0.8 : isFutureGarage || isDubstep ? 0.84 : 0.7)) {
        texture.triggerAttackRelease('32n', humanizedTime(0.5), velocityHuman(textureVelocity, 0.03));
      }

      if (preset.genre === 'lofi' && isFillBar && (stepInBar === 14 || stepInBar === 15)) {
        const fillTime = humanizedTime(0.2);
        clap.triggerAttackRelease('64n', fillTime, velocityHuman(0.12, 0.02));
        snareTone.triggerAttackRelease('F3', '64n', fillTime + 0.004, velocityHuman(0.1, 0.02));
      }

      if (preset.id === 'lofi_jersey' && isFillBar && (stepInBar === 13 || stepInBar === 15)) {
        kick.triggerAttackRelease('C1', '16n', humanizedTime(0.2), velocityHuman(0.52, 0.03));
      }

      if (isUkg && isFillBar && (stepInBar === 13 || stepInBar === 15) && shouldTrigger(0.62)) {
        const ukgFillTime = humanizedTime(0.2);
        clap.triggerAttackRelease('64n', ukgFillTime, velocityHuman(0.16, 0.02));
        snareSnap.triggerAttackRelease('64n', ukgFillTime + 0.004, velocityHuman(0.11, 0.02));
      }

      if (preset.id === 'lofi_2step' && isLiftSection && (stepInBar === 3 || stepInBar === 11) && shouldTrigger(0.46)) {
        const twoStepGhostTime = humanizedTime(0.2);
        clap.triggerAttackRelease('64n', twoStepGhostTime, velocityHuman(0.14, 0.02));
        percussionWood.triggerAttack(noteAtOctave(chord[2], 5), twoStepGhostTime + 0.006);
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
