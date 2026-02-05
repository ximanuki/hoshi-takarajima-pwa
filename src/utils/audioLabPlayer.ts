import type {
  FeedbackDelay,
  Gain,
  MembraneSynth,
  MonoSynth,
  NoiseSynth,
  PolySynth,
  Reverb,
  Sequence,
} from 'tone';

export type AudioLabEngine = 'none' | 'asset' | 'tone';

type ToneModule = typeof import('tone');

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
  private toneReverb: Reverb | null = null;
  private toneDelay: FeedbackDelay | null = null;
  private toneSequence: Sequence<number> | null = null;
  private engine: AudioLabEngine = 'none';
  private volume = 0.65;

  getEngine(): AudioLabEngine {
    return this.engine;
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

  async playTone() {
    this.stopAsset();
    const tone = await this.loadTone();

    try {
      await tone.start();
    } catch {
      this.engine = 'none';
      return;
    }

    this.stopTone();
    this.buildToneGraph(tone);
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

  private buildToneGraph(tone: ToneModule) {
    tone.Transport.stop();
    tone.Transport.cancel(0);
    tone.Transport.position = 0;
    tone.Transport.bpm.value = 112;
    tone.Destination.volume.value = -8;

    this.toneGain = new tone.Gain(curvedVolume(this.volume) * 0.9).toDestination();
    this.toneReverb = new tone.Reverb({ decay: 1.6, wet: 0.16 }).connect(this.toneGain);
    this.toneDelay = new tone.FeedbackDelay('8n', 0.16);
    this.toneDelay.wet.value = 0.12;
    this.toneDelay.connect(this.toneGain);

    this.toneLead = new tone.PolySynth(tone.Synth, {
      oscillator: { type: 'triangle8' },
      envelope: { attack: 0.01, decay: 0.12, sustain: 0.24, release: 0.16 },
    });
    this.toneLead.connect(this.toneReverb);
    this.toneLead.connect(this.toneDelay);

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

    const melody: Array<string | null> = [
      'C5',
      null,
      'E5',
      null,
      'G5',
      null,
      'E5',
      'D5',
      'C5',
      null,
      'E5',
      null,
      'A5',
      'G5',
      'E5',
      'D5',
    ];
    const bass: Array<string | null> = ['C2', null, 'D2', null, 'E2', null, 'D2', null];
    const steps = Array.from({ length: 16 }, (_, step) => step);

    this.toneSequence = new tone.Sequence((time, step) => {
      const leadNote = melody[step];
      if (leadNote) {
        this.toneLead?.triggerAttackRelease(leadNote, '16n', time, 0.56);
      }

      const bassNote = bass[step % bass.length];
      if (bassNote) {
        this.toneBass?.triggerAttackRelease(bassNote, '8n', time, 0.7);
      }

      if (step % 4 === 0) {
        this.toneKick?.triggerAttackRelease('C1', '8n', time, 0.88);
      }

      if (step % 4 === 2) {
        this.toneHat?.triggerAttackRelease('32n', time, 0.34);
      }
    }, steps, '8n');

    this.toneSequence.start(0);
  }

  private disposeToneGraph() {
    this.toneSequence?.dispose();
    this.toneSequence = null;
    this.toneLead?.dispose();
    this.toneLead = null;
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
