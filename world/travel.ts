import type { SavePort } from '../contracts';
import { GAME_CONFIG } from '../config';
import { ContentError, contentTransaction } from '../content/alchemy';
import { canOccupy } from './collision/collision';
import type { WorldDefinition } from './generation/world';
import { travelAnchors } from './shrines/shrines';
import { advanceDayTick } from './daynight';
import { validateWorldState, type WorldState } from './persistence/world-save';
import { MAX_INCUBATION_TICKS } from '../game/combat/rewards';

/** Sixty seconds of world time pass on the road; the clock is the fixed 1/60 s step. */
export const TRAVEL_TICKS = 60 * 60;

export interface TravelAnchorView {
  readonly id: string; readonly name: string; readonly distance: number;
  readonly here: boolean; readonly enabled: boolean; readonly note: string;
}
/** What the panel shows: the camp plus every shrine already read, never an unvisited one. */
export function travelOptions(world: WorldDefinition, state: WorldState): readonly TravelAnchorView[] {
  const open = state.mode === 'exploring' && state.battle === null;
  return Object.freeze(travelAnchors(world, state.shrines).map((anchor) => {
    const distance = Math.hypot(anchor.position.x - state.playerPosition.x, anchor.position.z - state.playerPosition.z);
    const here = distance <= GAME_CONFIG.cellSize;
    return Object.freeze({
      id: anchor.id, name: anchor.name, distance, here,
      enabled: open && !here,
      note: here ? 'Zaten buradasın' : !open ? 'Şu anda seyahat edilemez' : `${Math.round(distance)} m · 60 sn`,
    });
  }));
}
/**
 * Fast travel in one transaction: position, world clock, cooldowns, respawns and incubation all
 * move together or not at all. A failed write leaves the player exactly where they were, so a
 * storage error can never hand movement a half-applied trip.
 */
export function travelTo<T extends WorldState>(world: WorldDefinition, save: SavePort<T>, commandId: string, anchorId: string): Promise<T> {
  return contentTransaction(save, commandId, (s) => {
    validateWorldState(world, s);
    const anchor = travelAnchors(world, s.shrines).find((entry) => entry.id === anchorId);
    if (!anchor) throw new ContentError('invalid-target', 'Bu çapa henüz açılmadı.');
    if (s.mode !== 'exploring' || s.battle) throw new ContentError('context', 'Savaş veya panel açıkken seyahat edilemez.');
    if (!canOccupy(world, anchor.position)) throw new ContentError('invalid-target', 'Çapa noktası kapalı.');
    s.playerPosition = { ...anchor.position };
    s.lastSafePosition = { ...anchor.position };
    s.worldTick += TRAVEL_TICKS;
    s.dayTick = advanceDayTick(s.dayTick, TRAVEL_TICKS);
    s.atCamp = Math.hypot(anchor.position.x - world.camp.x, anchor.position.z - world.camp.z) <= GAME_CONFIG.safeCampRadius;
    // Sixty seconds of waiting count: cooldowns run down and due respawns come back.
    s.entityCooldowns = s.entityCooldowns
      .map((entry) => ({ ...entry, ticks: entry.ticks - TRAVEL_TICKS }))
      .filter((entry) => entry.ticks > 0);
    const due = s.respawns.filter((entry) => entry.tick <= s.worldTick).map((entry) => entry.entityId);
    if (due.length) {
      s.respawns = s.respawns.filter((entry) => entry.tick > s.worldTick);
      s.consumedEntityIds = s.consumedEntityIds.filter((entityId) => !due.includes(entityId));
    }
    // Eggs only mature in the safe camp, so the trip counts for them when it ends there.
    if (s.atCamp) s.eggs = s.eggs.map((egg) => ({ ...egg, activeTicks: Math.min(MAX_INCUBATION_TICKS, egg.activeTicks + TRAVEL_TICKS) }));
    validateWorldState(world, s);
  });
}
