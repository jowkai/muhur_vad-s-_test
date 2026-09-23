/**
 * Small procedural audio bed. Every sound is synthesised here — the game ships no audio files and
 * fetches nothing. It stays silent until the player interacts, and the mute control is separate.
 */
export type SoundName = 'step' | 'collect' | 'encounter' | 'hit' | 'capture' | 'fail' | 'panel';
export const MUTE_STORAGE_KEY = 'muhur:muted';
interface Voice { readonly frequency: number; readonly duration: number; readonly type: OscillatorType; readonly gain: number; readonly sweep?: number }
const VOICES: Record<SoundName, Voice> = {
  step: { frequency: 140, duration: 0.07, type: 'sine', gain: 0.05 },
  collect: { frequency: 620, duration: 0.18, type: 'triangle', gain: 0.12, sweep: 1.5 },
  encounter: { frequency: 220, duration: 0.3, type: 'sawtooth', gain: 0.1, sweep: 0.6 },
  hit: { frequency: 180, duration: 0.12, type: 'square', gain: 0.09, sweep: 0.5 },
  capture: { frequency: 440, duration: 0.45, type: 'sine', gain: 0.14, sweep: 2 },
  fail: { frequency: 160, duration: 0.35, type: 'sawtooth', gain: 0.1, sweep: 0.4 },
  panel: { frequency: 320, duration: 0.09, type: 'triangle', gain: 0.07 },
};
export interface AudioOptions { readonly context?: () => AudioContext; readonly storage?: Storage | null }
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private mutedState: boolean;
  private volume = 0.6;
  private lastPlayed = new Map<SoundName, number>();
  constructor(private readonly options: AudioOptions = {}) {
    let stored: string | null;
    // Storage can throw in private mode; a missing preference simply means "not muted".
    try { stored = (options.storage ?? globalThis.localStorage ?? null)?.getItem(MUTE_STORAGE_KEY) ?? null; } catch { stored = null; }
    this.mutedState = stored === '1';
  }
  get muted(): boolean { return this.mutedState; }
  get started(): boolean { return !!this.context; }
  /** Called from a real user gesture; browsers refuse to start audio any other way. */
  unlock(): void {
    if (this.context || this.mutedState) return;
    const factory = this.options.context ?? (() => new AudioContext());
    try {
      this.context = factory();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
    } catch { this.context = null; this.master = null; }
  }
  /** Master volume 0–1 from the settings panel; it applies live and survives an unlock. */
  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.master) this.master.gain.value = this.volume;
  }
  get level(): number { return this.volume; }
  setMuted(muted: boolean): void {
    this.mutedState = muted;
    try { (this.options.storage ?? globalThis.localStorage ?? null)?.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0'); } catch { /* private mode */ }
    if (this.master) this.master.gain.value = muted ? 0 : 0.6;
  }
  toggle(): boolean { this.setMuted(!this.mutedState); return this.mutedState; }
  play(name: SoundName, minimumGapMs = 60): void {
    if (this.mutedState || !this.context || !this.master) return;
    const now = this.context.currentTime;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < minimumGapMs / 1000) return;
    this.lastPlayed.set(name, now);
    const voice = VOICES[name];
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = voice.type;
    oscillator.frequency.setValueAtTime(voice.frequency, now);
    if (voice.sweep) oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, voice.frequency * voice.sweep), now + voice.duration);
    gain.gain.setValueAtTime(voice.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + voice.duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + voice.duration + 0.02);
  }
  dispose(): void {
    this.lastPlayed.clear();
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.master = null;
  }
}
