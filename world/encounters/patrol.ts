import type { DayPhase, VecXZ } from '../../contracts';
import { GAME_CONFIG } from '../../config';
import { hash } from '../generation/random';
import type { WorldDefinition } from '../generation/world';
import { canOccupy } from '../collision/collision';

/** How far a restless creature strays from the spot it was generated on. */
export const PATROL_RADIUS = 12;
/**
 * v4: a calm creature drifts too, but only around its own patch and at a quarter of the pace.
 * In v3 anything non-aggressive stood perfectly still, which made a region read as a diorama —
 * the only things that moved were the ones about to attack you.
 */
export const GRAZE_RADIUS = 4;
/** One lap around its patch, in ticks; the hash spreads the phase so a region never marches in step. */
export const PATROL_PERIOD = Math.round(24 / GAME_CONFIG.fixedStep);
export const GRAZE_PERIOD = PATROL_PERIOD * 4;
/**
 * Where a creature is right now. Pure: the same seed, entity and world tick always give the
 * same spot, so a reload puts every creature back exactly where it was.
 */
export function patrolPosition(world: WorldDefinition, entityId: string, home: VecXZ, worldTick: number, aggressive: boolean): VecXZ {
  const spread = hash(world.seed, `patrol:${entityId}`, 0);
  const reach = aggressive ? PATROL_RADIUS : GRAZE_RADIUS;
  const period = aggressive ? PATROL_PERIOD : GRAZE_PERIOD;
  const radius = reach * (.35 + (spread % 100) / 160);
  const phase = (spread % 1000) / 1000 * Math.PI * 2;
  const angle = phase + (worldTick % period) / period * Math.PI * 2;
  const wander = { x: home.x + Math.cos(angle) * radius, z: home.z + Math.sin(angle) * radius * .6 };
  // A creature never walks into terrain it could not stand on; then it simply stays home.
  return canOccupy(world, wander) ? Object.freeze(wander) : home;
}
/** The warning a calm approach gives, and the one an ambush leaves. Neither is ever zero. */
export const WARNING_TICKS = Math.round(1.2 / GAME_CONFIG.fixedStep);
export const AMBUSH_WARNING_TICKS = Math.round(.35 / GAME_CONFIG.fixedStep);
/** Night and deep regions make an ambush likelier; the camp and the meadow never ambush. */
export function ambushChance(level: number, phase: DayPhase): number {
  if (!Number.isFinite(level) || level <= 4) return 0;
  const deep = Math.min(.18, (level - 4) * .006);
  return Math.min(.3, deep + (phase === 'night' ? .12 : 0));
}
/**
 * Whether this creature springs on the player instead of warning them. One deterministic draw
 * per entity and per warning window, so the same approach always plays out the same way.
 */
export function ambushes(world: WorldDefinition, entityId: string, level: number, phase: DayPhase, window: number): boolean {
  const chance = ambushChance(level, phase);
  if (chance <= 0) return false;
  return (hash(world.seed, `ambush:${entityId}`, window) % 10_000) / 10_000 < chance;
}
