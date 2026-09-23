import type { DayPhase } from '../contracts';
import { GAME_CONFIG } from '../config';
import type { CreatureDefinition } from '../content/schema';

/** Ten minutes of world time: six of daylight, four of night. */
export const DAY_CYCLE_TICKS = Math.round(600 / GAME_CONFIG.fixedStep);
export const DAY_TICKS = Math.round(360 / GAME_CONFIG.fixedStep);
export const NIGHT_TICKS = DAY_CYCLE_TICKS - DAY_TICKS;
/** How far the world notices the player: night halves the reach of a wild creature's attention. */
export const DAY_DETECTION_RADIUS = GAME_CONFIG.proximityRadius;
export const NIGHT_DETECTION_RADIUS = 16;
/** Night makes more of what spawns hostile, on top of the region's own rate. */
export const NIGHT_AGGRO_BONUS = .15;
export type Activity = 'day' | 'night' | 'any';
/**
 * Which half of the clock a species prefers. v2 content will carry this per species; until then
 * it follows the element, so the rule is one table and never a random draw.
 */
const NOCTURNAL = new Set(['gölge', 'buz', 'kıvılcım']);
const DIURNAL = new Set(['ışık', 'çim']);
export function activityOf(species: Pick<CreatureDefinition, 'element'> & { readonly activity?: Activity }): Activity {
  if (species.activity === 'day' || species.activity === 'night' || species.activity === 'any') return species.activity;
  return NOCTURNAL.has(species.element) ? 'night' : DIURNAL.has(species.element) ? 'day' : 'any';
}
export function phaseAt(dayTick: number): DayPhase {
  if (!Number.isFinite(dayTick)) throw new RangeError('Gün saati geçersiz.');
  return normalizeDayTick(dayTick) < DAY_TICKS ? 'day' : 'night';
}
export function normalizeDayTick(dayTick: number): number {
  const wrapped = Math.floor(dayTick) % DAY_CYCLE_TICKS;
  return wrapped < 0 ? wrapped + DAY_CYCLE_TICKS : wrapped;
}
/** Advances the clock by whole ticks and wraps inside the cycle; the save keeps only this number. */
export function advanceDayTick(dayTick: number, ticks = 1): number {
  if (!Number.isSafeInteger(ticks) || ticks < 0) throw new RangeError('Gün saati ilerlemesi geçersiz.');
  return normalizeDayTick(normalizeDayTick(dayTick) + ticks);
}
export const detectionRadius = (phase: DayPhase) => phase === 'night' ? NIGHT_DETECTION_RADIUS : DAY_DETECTION_RADIUS;
/** A lit lantern keeps the daytime reach after dark. */
export const detectionRadiusWith = (phase: DayPhase, lantern: boolean) => lantern ? DAY_DETECTION_RADIUS : detectionRadius(phase);
export const aggressiveBonus = (phase: DayPhase) => phase === 'night' ? NIGHT_AGGRO_BONUS : 0;
export interface DayView {
  readonly phase: DayPhase; readonly label: string; readonly ratio: number;
  readonly secondsLeft: number; readonly detectionRadius: number;
}
/** Read-only projection for the HUD; the clock itself lives in the save as one integer. */
export function dayView(dayTick: number): DayView {
  const tick = normalizeDayTick(dayTick);
  const phase = phaseAt(tick);
  const span = phase === 'day' ? DAY_TICKS : NIGHT_TICKS;
  const into = phase === 'day' ? tick : tick - DAY_TICKS;
  return Object.freeze({
    phase, label: phase === 'day' ? 'Gündüz' : 'Gece',
    ratio: into / span, secondsLeft: Math.ceil((span - into) * GAME_CONFIG.fixedStep),
    detectionRadius: detectionRadius(phase),
  });
}
export interface SkyLight {
  readonly sky: number; readonly fog: number; readonly ambient: number; readonly sun: number;
}
const mix = (from: number, to: number, t: number) => {
  const channel = (shift: number) => Math.round((((from >> shift) & 255) * (1 - t) + ((to >> shift) & 255) * t));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
};
const DAY_SKY = 0x9fd2f0, NIGHT_SKY = 0x121a2e, DAY_FOG = 0xcfe6f5, NIGHT_FOG = 0x1b2440;
/**
 * Light for the renderer, blended over the last tenth of each half so dusk and dawn are not a
 * hard switch. Pure: the same tick always produces the same light.
 */
export function skyLight(dayTick: number): SkyLight {
  const tick = normalizeDayTick(dayTick);
  const blend = DAY_CYCLE_TICKS / 20;
  const toNight = tick < DAY_TICKS
    ? Math.max(0, tick - (DAY_TICKS - blend)) / blend
    : 1 - Math.max(0, tick - (DAY_CYCLE_TICKS - blend)) / blend;
  const t = Math.min(1, Math.max(0, toNight));
  return Object.freeze({
    sky: mix(DAY_SKY, NIGHT_SKY, t), fog: mix(DAY_FOG, NIGHT_FOG, t),
    ambient: 0.85 - 0.45 * t, sun: 1 - 0.7 * t,
  });
}
