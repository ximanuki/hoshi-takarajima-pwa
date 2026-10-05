import type { Settings } from '../types';
import type { AudioPerformanceProfile, SfxKitId, SfxPlayer, ToneSfxId } from './sfxPlayer';

export type AudioScene = 'home' | 'mission' | 'play' | 'result';
export type SoundEffect = 'tap' | 'correct' | 'wrong' | 'combo' | 'clear' | 'gift';

export const SOUND_EFFECTS: readonly SoundEffect[] = ['tap', 'correct', 'wrong', 'combo', 'clear', 'gift'];

type AudioSettings = Pick<Settings, 'soundEnabled' | 'sfxVolume'>;

const DEFAULT_SETTINGS: AudioSettings = {
  soundEnabled: true,
  sfxVolume: 0.8,
};

// がめんごとに SE の ねいろを かえる
const SCENE_SFX_KITS: Record<AudioScene, SfxKitId> = {
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
  gift: 'clear',
};

const EFFECT_COOLDOWN_MS: Partial<Record<SoundEffect, number>> = {
  tap: 65,
  combo: 820,
  clear: 420,
  gift: 420,
};

// こうかおんファイル（public/sfx/）。manifest.json に のっている ものは ファイルを ならし、
// ない ものは これまでの シンセ（Tone.js）で ならす
const SFX_BASE = `${import.meta.env.BASE_URL}sfx/`;

type SfxManifest = { credit: string | null; files: Partial<Record<SoundEffect, string>> };

let sfxManifestPromise: Promise<SfxManifest> | null = null;
let sfxCredit: string | null = null;

function isSoundEffect(value: string): value is SoundEffect {
  return (SOUND_EFFECTS as readonly string[]).includes(value);
}

export function loadSfxManifest(): Promise<SfxManifest> {
  if (!sfxManifestPromise) {
    sfxManifestPromise = fetch(`${SFX_BASE}manifest.json`)
      .then((response) => (response.ok ? response.json() : {}))
      .then((data: { credit?: unknown; files?: unknown }) => {
        const files: SfxManifest['files'] = {};
        if (data.files && typeof data.files === 'object') {
          for (const [effect, file] of Object.entries(data.files as Record<string, unknown>)) {
            if (isSoundEffect(effect) && typeof file === 'string') files[effect] = file;
          }
        }
        const credit = typeof data.credit === 'string' && Object.keys(files).length > 0 ? data.credit : null;
        sfxCredit = credit;
        return { credit, files };
      })
      .catch(() => ({ credit: null, files: {} }));
  }
  return sfxManifestPromise;
}

/** こうかおんの クレジット（ファイルが あるときだけ） */
export function getSfxCredit(): string | null {
  return sfxCredit;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function detectPerformanceProfile(): AudioPerformanceProfile {
  if (typeof navigator === 'undefined') return 'full';
  const ua = navigator.userAgent.toLowerCase();
  const isMobile =
    /android|iphone|ipad|ipod|mobile/.test(ua) ||
    (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 900px)').matches);

  const cores = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : 8;
  const memory = typeof (navigator as Navigator & { deviceMemory?: number }).deviceMemory === 'number'
    ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
    : 8;
  const isLowSpec = cores <= 4 || memory <= 4;

  return isMobile || isLowSpec ? 'lite' : 'full';
}

class AudioManager {
  private player: SfxPlayer | null = null;
  private playerLoadPromise: Promise<SfxPlayer> | null = null;
  private performanceProfile: AudioPerformanceProfile = detectPerformanceProfile();
  private tonePrewarmed = false;
  private unlocked = false;
  private settings: AudioSettings = DEFAULT_SETTINGS;
  private scene: AudioScene = 'home';
  private lastEffectAt: Partial<Record<SoundEffect, number>> = {};
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private buffers: Partial<Record<SoundEffect, AudioBuffer>> = {};
  private filesLoaded = false;
  private fileEffects = new Set<SoundEffect>();

  setScene(scene: AudioScene) {
    this.scene = scene;
  }

  setSettings(next: AudioSettings) {
    this.settings = {
      soundEnabled: Boolean(next.soundEnabled),
      sfxVolume: clamp01(next.sfxVolume),
    };
    this.player?.setSfxVolume(this.settings.sfxVolume);
    if (this.gain) this.gain.gain.value = this.settings.sfxVolume;
  }

  async unlock() {
    if (!this.settings.soundEnabled) return;
    this.unlocked = true;
    this.resumeContext();
    if (!this.filesLoaded) {
      this.filesLoaded = true;
      const manifest = await loadSfxManifest();
      for (const effect of Object.keys(manifest.files) as SoundEffect[]) this.fileEffects.add(effect);
      void this.loadBuffers(manifest);
    }
    // ファイルで ぜんぶ まかなえるなら シンセ（Tone.js）は よみこまない
    if (SOUND_EFFECTS.every((effect) => this.fileEffects.has(effect))) return;
    const player = await this.ensurePlayer();
    if (!this.tonePrewarmed) {
      this.tonePrewarmed = true;
      void player.prewarmTone();
    }
  }

  playSfx(effect: SoundEffect) {
    if (!this.unlocked || !this.settings.soundEnabled) return;

    const nowMs = performance.now();
    const cooldown = EFFECT_COOLDOWN_MS[effect] ?? 0;
    const lastAt = this.lastEffectAt[effect] ?? -Infinity;
    if (nowMs - lastAt < cooldown) return;
    this.lastEffectAt[effect] = nowMs;

    const buffer = this.buffers[effect];
    if (buffer && this.playBuffer(buffer)) return;
    // ファイルが まだ よみこみちゅうなら、シンセで ならさずに まつ（おとが にじゅうに ならないように）
    if (this.fileEffects.has(effect) && !buffer) return;
    void this.ensurePlayer().then((player) => player.playToneSfx(EFFECT_TO_TONE[effect], SCENE_SFX_KITS[this.scene]));
  }

  private getContext(): AudioContext | null {
    if (this.context) return this.context;
    const Ctor = typeof window !== 'undefined'
      ? window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
    if (!Ctor) return null;
    this.context = new Ctor();
    this.gain = this.context.createGain();
    this.gain.gain.value = this.settings.sfxVolume;
    this.gain.connect(this.context.destination);
    return this.context;
  }

  private resumeContext() {
    const context = this.getContext();
    if (context && context.state !== 'running') void context.resume().catch(() => undefined);
  }

  private async loadBuffers(manifest: SfxManifest) {
    const context = this.getContext();
    if (!context) {
      this.fileEffects.clear();
      return;
    }
    await Promise.all(
      (Object.entries(manifest.files) as [SoundEffect, string][]).map(async ([effect, file]) => {
        try {
          const response = await fetch(`${SFX_BASE}${file}`);
          if (!response.ok) throw new Error(String(response.status));
          this.buffers[effect] = await context.decodeAudioData(await response.arrayBuffer());
        } catch {
          // よみこめなかった ものは シンセで ならす
          this.fileEffects.delete(effect);
          void this.ensurePlayer();
        }
      }),
    );
  }

  private playBuffer(buffer: AudioBuffer): boolean {
    const context = this.context;
    if (!context || !this.gain) return false;
    if (context.state !== 'running') void context.resume().catch(() => undefined);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    source.start();
    return true;
  }

  private async ensurePlayer(): Promise<SfxPlayer> {
    if (this.player) return this.player;
    if (this.playerLoadPromise) return this.playerLoadPromise;

    this.playerLoadPromise = import('./sfxPlayer')
      .then((module) => {
        const nextPlayer = new module.SfxPlayer();
        nextPlayer.setSfxVolume(this.settings.sfxVolume);
        nextPlayer.setPerformanceProfile(this.performanceProfile);
        this.player = nextPlayer;
        return nextPlayer;
      })
      .finally(() => {
        this.playerLoadPromise = null;
      });

    return this.playerLoadPromise;
  }
}

export const audioManager = new AudioManager();
