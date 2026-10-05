// こうかおん（SE）せんようの プレイヤー。Tone.js は さいしょの タップで はじめて よみこむ。
// もとは audioLabPlayer.ts（BGM ラボ）に あった SE ぶぶんだけを とりだしたもの。

export type AudioPerformanceProfile = 'full' | 'lite';
export type ToneSfxId = 'tap' | 'correct' | 'miss' | 'clear';
/** がめんごとの SE キット（むかしの BGM プリセットの なごり） */
export type SfxKitId = 'ambient_stars' | 'uk_garage_neon' | 'future_garage_mist' | 'lofi_jersey';

type ToneModule = typeof import('tone');

type SfxKit = {
  rhythmProfile: 'lofi' | 'jersey' | 'ukg' | 'future_garage' | 'dubstep' | 'ambient';
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

const SFX_KITS: Record<SfxKitId, SfxKit> = {
  ambient_stars: { rhythmProfile: 'ambient', sfxScale: ['C4', 'E4', 'G4', 'B4', 'D5', 'E5', 'G5'] },
  uk_garage_neon: { rhythmProfile: 'ukg', sfxScale: ['A4', 'B4', 'C5', 'E5', 'F5', 'G5', 'A5'] },
  future_garage_mist: { rhythmProfile: 'future_garage', sfxScale: ['C4', 'D#4', 'F4', 'G4', 'A#4', 'C5', 'D5'] },
  lofi_jersey: { rhythmProfile: 'jersey', sfxScale: ['F4', 'G4', 'A4', 'C5', 'D5', 'F5', 'A5'] },
};

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

function noteAtOctave(note: string, octave: number): string {
  return note.replace(/\d+/, String(octave));
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

const TONE_SFX_SIGNATURE_LIBRARY: Record<SfxKitId, ToneSfxSignature> = {
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
};

export class SfxPlayer {
  private tone: ToneModule | null = null;
  private toneLoadPromise: Promise<ToneModule> | null = null;
  private sfxVolume = 0.8;
  private performanceProfile: AudioPerformanceProfile = 'full';

  setSfxVolume(nextVolume: number) {
    this.sfxVolume = clamp01(nextVolume);
  }

  setPerformanceProfile(profile: AudioPerformanceProfile) {
    this.performanceProfile = profile;
  }

  async prewarmTone() {
    const tone = await this.loadTone();
    try {
      await tone.start();
    } catch {
      // Ignore; next user gesture will retry unlock path.
    }
  }

  async playToneSfx(sfxId: ToneSfxId, presetId: SfxKitId) {
    const tone = await this.loadTone();
    try {
      await tone.start();
    } catch {
      return;
    }

    if (this.performanceProfile === 'lite') {
      this.playToneSfxLite(tone, sfxId, presetId);
      return;
    }

    const preset = SFX_KITS[presetId];
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

  private playToneSfxLite(tone: ToneModule, sfxId: ToneSfxId, presetId: SfxKitId) {
    const preset = SFX_KITS[presetId];
    const scale = preset.sfxScale;
    const a = pickScaleNote(scale, 0);
    const b = pickScaleNote(scale, 2);
    const c = pickScaleNote(scale, 4);
    const lowA = noteAtOctave(a, 2);
    const lowB = noteAtOctave(b, 2);
    const now = tone.now();

    const output = new tone.Gain(curvedVolume(this.sfxVolume) * 0.72).toDestination();
    const limiter = new tone.Limiter(-1.6);
    const comp = new tone.Compressor(-28, 2.2);
    const reverb = new tone.Reverb({ decay: 1.8, wet: 0.12 });
    const synth = new tone.PolySynth(tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.006, decay: 0.14, sustain: 0.08, release: 0.22 },
    });
    const low = new tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.004, decay: 0.16, sustain: 0.04, release: 0.12 },
    });
    const click = new tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.04, release: 0.02 },
      harmonicity: 4.8,
      modulationIndex: 16,
      resonance: 1100,
      octaves: 1.1,
    });

    synth.connect(comp);
    synth.connect(reverb);
    low.connect(comp);
    click.connect(comp);
    reverb.connect(comp);
    comp.connect(limiter);
    limiter.connect(output);

    if (sfxId === 'tap') {
      click.triggerAttackRelease('64n', now, 0.08);
      synth.triggerAttackRelease([b], '32n', now + 0.01, 0.1);
    } else if (sfxId === 'correct') {
      synth.triggerAttackRelease([a], '16n', now, 0.15);
      synth.triggerAttackRelease([b], '16n', now + 0.06, 0.16);
      synth.triggerAttackRelease([c], '8n', now + 0.12, 0.18);
      click.triggerAttackRelease('64n', now + 0.02, 0.09);
    } else if (sfxId === 'miss') {
      low.triggerAttackRelease(lowB, '8n', now, 0.14);
      low.triggerAttackRelease(lowA, '8n', now + 0.1, 0.11);
      synth.triggerAttackRelease([a], '16n', now + 0.08, 0.08);
    } else {
      synth.triggerAttackRelease([a, b], '8n', now, 0.16);
      synth.triggerAttackRelease([b, c], '8n', now + 0.12, 0.16);
      low.triggerAttackRelease(lowA, '8n', now + 0.02, 0.11);
      click.triggerAttackRelease('64n', now + 0.24, 0.1);
    }

    window.setTimeout(() => {
      output.dispose();
      limiter.dispose();
      comp.dispose();
      reverb.dispose();
      synth.dispose();
      low.dispose();
      click.dispose();
    }, 1200);
  }

  private async loadTone(): Promise<ToneModule> {
    if (this.tone) return this.tone;
    if (this.toneLoadPromise) return this.toneLoadPromise;

    this.toneLoadPromise = import('tone')
      .then((tone) => {
        this.tone = tone;
        return tone;
      })
      .finally(() => {
        this.toneLoadPromise = null;
      });

    return this.toneLoadPromise;
  }
}
