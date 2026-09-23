import { graftCapacity, type GraftRecord, type SavePort } from '../contracts';
import { ContentError, contentTransaction, planInventory, type ContentState } from './alchemy';
import { itemById, movesOf } from './catalog';
import { defaultLoadout, equippedMoveIds, GRAFT_SLOTS } from './loadout';

export { GRAFT_SLOTS };

/** The projection a graft needs: the bag, the creatures and the graft list the save keeps. */
export interface GraftState extends ContentState {
  grafts?: GraftRecord[];
  worldTick?: number;
}
/** Which move an alchemy product teaches, or null when the item is not a graft. */
export function graftMoveId(itemId: string): string | null {
  const effect = itemById(itemId)?.effect;
  return effect?.kind === 'graft' ? effect.moveId : null;
}
/**
 * The four moves a creature fights with, built from the loadout it carries rather than the whole
 * learn set. Slot mapping lives in `./loadout`, which owns the learn-set/loadout split.
 */
export function graftedMoveIds(speciesId: string, grafted: readonly string[], level = 1,
  loadout: readonly string[] = defaultLoadout(speciesId)): readonly string[] {
  if (!loadout.length) return loadout;
  return equippedMoveIds(loadout, grafted, level);
}
export const graftsOf = (grafts: readonly GraftRecord[] | undefined, creatureId: string): readonly string[] =>
  (grafts ?? []).filter((record) => record.creatureId === creatureId).map((record) => record.moveId);
/** Why a graft is refused, or null when it may go ahead. */
export function graftRefusal(state: GraftState, creatureId: string, itemId: string): string | null {
  const moveId = graftMoveId(itemId);
  if (!moveId) return 'Bu eşya bir aşı değil';
  const creature = state.creatures.find((entry) => entry.id === creatureId);
  if (!creature) return 'Bu yaratık koleksiyonda yok';
  if (!state.inventory.some((stack) => stack?.itemId === itemId && stack.quantity > 0)) return 'Çantanda bu aşı yok';
  const speciesId = (creature as { speciesId?: string }).speciesId ?? '';
  if (movesOf(speciesId).some((move) => move.id === moveId)) return 'Bu yaratık zaten bu hareketi biliyor';
  const already = graftsOf(state.grafts, creatureId);
  if (already.includes(moveId)) return 'Aynı hareket iki kez aşılanamaz';
  const level = (creature as { level?: number }).level ?? 1;
  if (already.length >= graftCapacity(level)) return `Bu seviyede en çok ${graftCapacity(level)} hareket aşılanır`;
  if (!state.atCamp || (state.mode !== 'exploring' && state.mode !== 'panel')) return 'Aşı yalnız kampta yapılır';
  return null;
}
/**
 * One transaction: the item leaves the bag and the graft joins the record, or nothing happens.
 * A refused graft never touches a single material.
 */
export function graftMove<T extends GraftState>(save: SavePort<T>, commandId: string, creatureId: string, itemId: string): Promise<T> {
  return contentTransaction(save, commandId, (draft) => {
    const refusal = graftRefusal(draft, creatureId, itemId);
    if (refusal) throw new ContentError('invalid-item', refusal);
    const moveId = graftMoveId(itemId)!;
    draft.inventory = planInventory(draft.inventory, [{ itemId, quantity: 1 }], []);
    draft.grafts = [...(draft.grafts ?? []), { creatureId, moveId, tick: draft.worldTick ?? 0 }];
  });
}
