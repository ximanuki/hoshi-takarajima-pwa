import type { FeedbackDelay, Gain, MembraneSynth, MonoSynth, NoiseSynth, PolySynth, Reverb, Sequence } from 'tone';

export type AudioLabEngine = 'none' | 'asset' | 'tone';
export type TonePresetId = 'morning' | 'adventure' | 'night';

type TonePresetMeta = {
  id: TonePresetId;
  name: string;
  description: string;
};

type TonePresetConfig = TonePresetMeta & {
  bpm: number;
  leadOsc: 'triangle8' | 'square6' | 'sine';
  leadNotes: Array<string | null>;
  bassNotes: Array<string | null>;
  chords: string[][];
  kickSteps: number[];
  hatSteps: number[];
  leadVelocity: number;
  bassVelocity: number;
  hatVelocity: number;
  reverbWet: number;
  delayWet: number;
  masterGain: number;
};

type ToneModule = typeof import('tone');

const TONE_PRESET_LIBRARY: Record<TonePresetId, TonePresetConfig> = {
  morning: {
    id: 'morning',
    name: 'ハムチーのあさ',
    description: 'かわいく明るい、朝のスタート向け',
    bpm: 112,
    leadOsc: 'triangle8',
    leadNotes: ['C5', null, 'E5', null, 'G5', null, 'E5', 'D5', 'C5', null, 'E5', null, 'A5', 'G5', 'E5', 'D5'],
    bassNotes: ['C2', null, 'D2', null, 'E2', null, 'D2', null],
    chords: [
      ['C4', 'E4', 'G4'],
      ['F4', 'A4', 'C5'],
      ['G4', 'B4', 'D5'],
      ['C4', 'E4', 'G4'],
    ],
    kickSteps: [0, 4, 8, 12],
    hatSteps: [2, 6, 10, 14],
    leadVelocity: 0.56,
    bassVelocity: 0.7,
    hatVelocity: 0.34,
    reverbWet: 0.16,
    delayWet: 0.12,
    masterGain: 0.9,
  },
  adventure: {
    id: 'adventure',
    name: 'たからじま だいぼうけん',
    description: 'テンポ速め、前に進みたくなる冒険系',
    bpm: 132,
    leadOsc: 'square6',
    leadNotes: ['E5', 'G5', 'A5', 'G5', 'B5', 'A5', 'G5', 'E5', 'F5', 'A5', 'B5', 'A5', 'C6', 'B5', 'A5', 'G5'],
    bassNotes: ['E2', null, 'E2', null, 'F2', null, 'G2', null],
    chords: [
      ['E4', 'G4', 'B4'],
      ['F4', 'A4', 'C5'],
      ['G4', 'B4', 'D5'],
      ['A4', 'C5', 'E5'],
    ],
    kickSteps: [0, 3, 4, 7, 8, 11, 12, 15],
    hatSteps: [1, 2, 5, 6, 9, 10, 13, 14],
    leadVelocity: 0.52,
    bassVelocity: 0.72,
    hatVelocity: 0.28,
    reverbWet: 0.1,
    delayWet: 0.14,
    masterGain: 0.86,
  },
  night: {
    id: 'night',
    name: 'きらぼしナイト',
    description: 'ゆったり幻想的、考える時間向け',
    bpm: 96,
    leadOsc: 'sine',
    leadNotes: ['A4', null, 'C5', null, 'E5', null, 'D5', null, 'G4', null, 'B4', null, 'E5', null, 'D5', null],
    bassNotes: ['A1', null, null, null, 'G1', null, null, null],
    chords: [
      ['A3', 'C4', 'E4'],
      ['G3', 'B3', 'D4'],
      ['F3', 'A3', 'C4'],
      ['E3', 'G3', 'B3'],
    ],
    kickSteps: [0, 8],
    hatSteps: [4, 12],
    leadVelocity: 0.5,
    bassVelocity: 0.62,
    hatVelocity: 0.2,
    reverbWet: 0.24,
    delayWet: 0.18,
    masterGain: 0.82,
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
  private toneHat: NoiseSynth | null = null;
  private tonePad: PolySynth | null = null;
  private toneReverb: Reverb | null = null;
  private toneDelay: FeedbackDelay | null = null;
  private toneSequence: Sequence<number> | null = null;
  private currentTonePreset: TonePresetId = 'morning';
  private engine: AudioLabEngine = 'none';
  private volume = 0.65;

  getEngine(): AudioLabEngine {
    return this.engine;
  }

  getTonePresets(): TonePresetMeta[] {
    return (Object.keys(TONE_PRESET_LIBRARY) as TonePresetId[]).map((id) => {
      const { name, description } = TONE_PRESET_LIBRARY[id];
      return { id, name, description };
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
    tone.Transport.stop();
    tone.Transport.cancel(0);
    tone.Transport.position = 0;
    tone.Transport.bpm.value = preset.bpm;
    tone.Destination.volume.value = -8;

    this.toneGain = new tone.Gain(curvedVolume(this.volume) * preset.masterGain).toDestination();
    this.toneReverb = new tone.Reverb({ decay: 1.6, wet: preset.reverbWet }).connect(this.toneGain);
    this.toneDelay = new tone.FeedbackDelay('8n', 0.16);
    this.toneDelay.wet.value = preset.delayWet;
    this.toneDelay.connect(this.toneGain);

    this.toneLead = new tone.PolySynth(tone.Synth, {
      oscillator: { type: preset.leadOsc },
      envelope: { attack: 0.01, decay: 0.12, sustain: 0.24, release: 0.16 },
    });
    this.toneLead.connect(this.toneReverb);
    this.toneLead.connect(this.toneDelay);

    this.tonePad = new tone.PolySynth(tone.Synth, {
      oscillator: { type: 'triangle4' },
      envelope: { attack: 0.02, decay: 0.24, sustain: 0.4, release: 0.5 },
    }).connect(this.toneReverb);

    this.toneBass = new tone.MonoSynth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.16, release: 0.1 },
      filterEnvelope: { attack: 0.01, decay: 0.16, sustain: 0.05, release: 0.08, baseFrequency: 120, octaves: 2 },
    }).connect(this.toneGain);

    this.toneKick = new tone.MembraneSynth({
      pitchDecay: 0.03,
      octaves: 7,
      envelope: { attack: 0.001, decay: 0.14, sustain: 0 },
    }).connect(this.toneGain);

    this.toneHat = new tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0 },
    }).connect(this.toneGain);

    const steps = Array.from({ length: 16 }, (_, step) => step);

    this.toneSequence = new tone.Sequence((time, step) => {
      const leadNote = preset.leadNotes[step];
      if (leadNote) {
        this.toneLead?.triggerAttackRelease(leadNote, '16n', time, preset.leadVelocity);
      }

      const bassNote = preset.bassNotes[step % preset.bassNotes.length];
      if (bassNote) {
        this.toneBass?.triggerAttackRelease(bassNote, '8n', time, preset.bassVelocity);
      }

      if (step % 4 === 0) {
        const chord = preset.chords[(step / 4) % preset.chords.length];
        this.tonePad?.triggerAttackRelease(chord, '2n', time, 0.2);
      }

      if (preset.kickSteps.includes(step)) {
        this.toneKick?.triggerAttackRelease('C1', '8n', time, 0.88);
      }

      if (preset.hatSteps.includes(step)) {
        this.toneHat?.triggerAttackRelease('32n', time, preset.hatVelocity);
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
    this.toneHat?.dispose();
    this.toneHat = null;
    this.toneDelay?.dispose();
    this.toneDelay = null;
    this.toneReverb?.dispose();
    this.toneReverb = null;
    this.toneGain?.dispose();
    this.toneGain = null;
  }
}
