import { graftCapacity, LOADOUT_SIZE, type MoveLoadout, type SavePort } from '../contracts';
import { ContentError, contentTransaction, type ContentState } from './alchemy';
import { creatureById, moveById, movesOf } from './catalog';
import { SUPPORT_EFFECTS } from './schema';

/**
 * v4 separates what a species *knows* from what it *carries*. A learn set is eight moves spread
 * over twelve unlock tiers; a loadout is the four it fights with. v3 had no such split — every
 * species had exactly four moves, all learnable by level ten, which is why the forty levels
 * above that unlocked nothing at all.
 */

/**
 * The four a creature carries before the player has chosen. Slot order is the convention the
 * whole game reads: an attack in the opener, the support move in slot 2, and the highest-tier
 * pick as the finisher in slot 3 — which is also the slot the first graft overwrites.
 */
export function defaultLoadout(speciesId: string): readonly string[] {
  const known = movesOf(speciesId);
  if (!known.length) return Object.freeze([]);
  const support = known.find((move) => SUPPORT_EFFECTS.some((effect) => effect === move.effect));
  const attacks = known.filter((move) => !SUPPORT_EFFECTS.some((effect) => effect === move.effect));
  // Two openers a level-one creature can actually press, plus a finisher it grows into: the
  // strongest move in its first ten levels. That is the slot the first graft overwrites, and
  // the one that makes the unlock level visible on the battle card.
  const early = attacks.filter((move) => move.unlockLevel === 1);
  const finisher = attacks.filter((move) => move.unlockLevel > 1 && move.unlockLevel <= 10)
    .sort((a, b) => b.power - a.power || a.id.localeCompare(b.id))[0]
    ?? attacks.filter((move) => !early.includes(move))[0];
  const picked = [...early.slice(0, 2), finisher].filter((move): move is NonNullable<typeof move> => !!move);
  const slots = [picked[0]?.id, picked[1]?.id, support?.id, picked[2]?.id]
    .filter((id): id is string => typeof id === 'string');
  // A species with too few attacks falls back to its earliest moves rather than a short set.
  for (const move of known) { if (slots.length >= LOADOUT_SIZE) break; if (!slots.includes(move.id)) slots.push(move.id); }
  return Object.freeze(slots.slice(0, LOADOUT_SIZE));
}
/** Which moves this creature could put in a slot right now; a tier it has not reached is not offered. */
export function learnable(speciesId: string, level: number): readonly string[] {
  return Object.freeze(movesOf(speciesId).filter((move) => move.unlockLevel <= level).map((move) => move.id));
}
/** Why a loadout is refused, or null when it may be saved. */
export function loadoutRefusal(speciesId: string, level: number, moveIds: readonly string[]): string | null {
  if (!creatureById(speciesId)) return 'Bu tür bilinmiyor';
  if (moveIds.length !== LOADOUT_SIZE) return 'Tam dört hareket seçilmeli';
  if (new Set(moveIds).size !== moveIds.length) return 'Aynı hareket iki slota konulamaz';
  const known = new Set(movesOf(speciesId).map((move) => move.id));
  for (const id of moveIds) {
    if (!moveById(id)) return 'Bilinmeyen hareket';
    if (!known.has(id)) return 'Bu yaratık o hareketi bilmiyor';
    if (moveById(id)!.unlockLevel > level) return `Bu hareket seviye ${moveById(id)!.unlockLevel}'te açılır`;
  }
  return null;
}
/** The stored choice for one creature, or its default when it has never been edited. */
export function loadoutFor(loadouts: readonly MoveLoadout[] | undefined, creatureId: string, speciesId: string): readonly string[] {
  const stored = (loadouts ?? []).find((entry) => entry.creatureId === creatureId);
  const known = new Set(movesOf(speciesId).map((move) => move.id));
  // A stored loadout that no longer matches the catalogue falls back rather than breaking a fight.
  if (stored && stored.moveIds.length === LOADOUT_SIZE && stored.moveIds.every((id) => known.has(id))) {
    return Object.freeze([...stored.moveIds]);
  }
  return defaultLoadout(speciesId);
}
/**
 * The four slots a creature actually fights with: its loadout, with each graft taking one slot
 * from the end. A creature never loses its opener, and the number of grafts it may hold grows
 * with its level.
 */
export const GRAFT_SLOTS: readonly number[] = Object.freeze([3, 1, 2, 0]);
export function equippedMoveIds(base: readonly string[], grafted: readonly string[], level: number): readonly string[] {
  const slots = [...base];
  grafted.slice(0, graftCapacity(level)).forEach((moveId, index) => {
    const slot = GRAFT_SLOTS[index];
    if (moveById(moveId) && slot !== undefined && !base.includes(moveId)) slots[slot] = moveId;
  });
  return Object.freeze(slots);
}

/** The projection choosing a loadout needs: the collection and the stored choices. */
export interface LoadoutState {
  mode: string;
  atCamp: boolean;
  creatures: { id: string; speciesId?: string; level?: number }[];
  loadouts?: MoveLoadout[];
}
/**
 * One transaction: the creature's four slots change together or not at all. Choosing is a camp
 * activity, like grafting — a fight is no place to rebuild a move set.
 */
export function setLoadout<T extends LoadoutState>(
  save: SavePort<T>, commandId: string, creatureId: string, moveIds: readonly string[],
): Promise<T> {
  return contentTransaction(save as unknown as SavePort<ContentState>, commandId, (raw) => {
    const draft = raw as unknown as T;
    if (!draft.atCamp || (draft.mode !== 'exploring' && draft.mode !== 'panel')) {
      throw new ContentError('context', 'Hareketler yalnız kampta seçilir.');
    }
    const owner = draft.creatures.find((creature) => creature.id === creatureId);
    if (!owner?.speciesId || owner.level === undefined) throw new ContentError('invalid-target', 'Bu yaratık koleksiyonda yok');
    const refusal = loadoutRefusal(owner.speciesId, owner.level, moveIds);
    if (refusal) throw new ContentError('invalid-item', refusal);
    const rest = (draft.loadouts ?? []).filter((entry) => entry.creatureId !== creatureId);
    draft.loadouts = [...rest, { creatureId, moveIds: [...moveIds] }]
      .sort((a, b) => (a.creatureId < b.creatureId ? -1 : 1));
  }) as unknown as Promise<T>;
}
