export const TELEMETRY_KEY = '__muhurTelemetry';
export interface RendererCounters {
  readonly calls: number; readonly triangles: number;
  readonly geometries: number; readonly textures: number; readonly programs: number;
}
export interface FrameInput {
  readonly frameMs: number; readonly simMs: number; readonly queryMs: number;
  readonly drawMs: number; readonly steps: number; readonly counters: RendererCounters;
}
export interface Distribution { readonly p50: number; readonly p95: number; readonly p99: number; readonly max: number; readonly mean: number }
export interface TelemetrySummary {
  readonly frames: number; readonly seconds: number; readonly fps: number;
  readonly frameMs: Distribution; readonly simMs: Distribution; readonly queryMs: Distribution;
  readonly drawMs: Distribution; readonly simPerTickMs: Distribution;
  readonly steps: number; readonly longFrames: number;
  readonly peak: RendererCounters; readonly last: RendererCounters;
  readonly maxSubsteps: number; readonly truncated: boolean;
}
const EMPTY: Distribution = { p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
/** Nearest-rank percentiles on the raw samples; no smoothing and no dropped outliers. */
function distribution(values: readonly number[]): Distribution {
  if (!values.length) return EMPTY;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
  return {
    p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted[sorted.length - 1],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}
/**
 * Frame, simulation and proximity-query timing for the performance route. It records what the
 * running app actually spent; it never estimates a frame rate and never drops samples.
 */
export class Telemetry {
  private enabled = true;
  private maxSubsteps = 0;
  private truncated = false;
  private frameMs: number[] = [];
  private simMs: number[] = [];
  private queryMs: number[] = [];
  private drawMs: number[] = [];
  private perTick: number[] = [];
  private steps = 0;
  private peak: RendererCounters = { calls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0 };
  private last: RendererCounters = this.peak;
  record(sample: FrameInput): void {
    if (!this.enabled) return;
    // Bounded opt-in diagnostics must not grow forever during normal play.
    if (this.frameMs.length >= 30_000) { this.truncated = true; return; }
    if (!Number.isFinite(sample.frameMs) || sample.frameMs <= 0) return;
    this.frameMs.push(sample.frameMs);
    this.simMs.push(sample.simMs);
    this.queryMs.push(sample.queryMs);
    this.drawMs.push(sample.drawMs);
    if (sample.steps > 0) this.perTick.push(sample.simMs / sample.steps);
    this.steps += sample.steps;
    this.maxSubsteps = Math.max(this.maxSubsteps, sample.steps);
    this.last = sample.counters;
    this.peak = {
      calls: Math.max(this.peak.calls, sample.counters.calls),
      triangles: Math.max(this.peak.triangles, sample.counters.triangles),
      geometries: Math.max(this.peak.geometries, sample.counters.geometries),
      textures: Math.max(this.peak.textures, sample.counters.textures),
      programs: Math.max(this.peak.programs, sample.counters.programs),
    };
  }
  reset(): void {
    this.frameMs = []; this.simMs = []; this.queryMs = []; this.drawMs = []; this.perTick = [];
    this.steps = 0;
    this.maxSubsteps = 0; this.truncated = false;
    this.peak = { calls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0 };
  }
  setEnabled(enabled: boolean): void { this.enabled = enabled; }
  samples(): readonly number[] { return [...this.frameMs]; }
  summary(): TelemetrySummary {
    const seconds = this.frameMs.reduce((sum, value) => sum + value, 0) / 1000;
    return {
      frames: this.frameMs.length, seconds, fps: seconds > 0 ? this.frameMs.length / seconds : 0,
      frameMs: distribution(this.frameMs), simMs: distribution(this.simMs), queryMs: distribution(this.queryMs),
      drawMs: distribution(this.drawMs), simPerTickMs: distribution(this.perTick),
      steps: this.steps, longFrames: this.frameMs.filter((value) => value > 33.4).length,
      peak: this.peak, last: this.last,
      maxSubsteps: this.maxSubsteps, truncated: this.truncated,
    };
  }
}
/** Explicit opt-in observes production gameplay; it cannot dispatch commands or mutate saves. */
export function installTelemetry(telemetry: Telemetry, snapshot: () => unknown = () => null): () => void {
  const enabled = typeof location !== 'undefined' && new URLSearchParams(location.search).get('performance') === '1';
  telemetry.setEnabled(enabled || (import.meta.env.DEV && import.meta.env.MODE !== 'production'));
  if (!enabled && (import.meta.env.MODE === 'production' || !import.meta.env.DEV)) return () => undefined;
  (globalThis as unknown as Record<string, unknown>)[TELEMETRY_KEY] = {
    summary: () => telemetry.summary(),
    reset: () => telemetry.reset(),
    samples: () => telemetry.samples(),
    snapshot: () => structuredClone(snapshot()),
  };
  return () => { delete (globalThis as unknown as Record<string, unknown>)[TELEMETRY_KEY]; };
}
