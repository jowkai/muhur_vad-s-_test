import type { SavePort } from '../contracts';
import { ContentError, contentTransaction } from '../content/alchemy';
import { bestMountRole, mountRefusal } from '../game/roles';
import type { WorldDefinition } from './generation/world';
import { validateWorldState, type WorldState } from './persistence/world-save';

/**
 * Climbs onto a travelling creature. One transaction: either the record says the player is
 * riding and which way, or nothing changed at all.
 */
export function mountCreature<T extends WorldState>(world: WorldDefinition, save: SavePort<T>, commandId: string, creatureId: string): Promise<T> {
  return contentTransaction(save, commandId, (s) => {
    validateWorldState(world, s);
    if (s.mode !== 'exploring' || s.battle) throw new ContentError('context', 'Şu anda binilemez.');
    const creature = s.creatures.find((entry) => entry.id === creatureId);
    const refusal = mountRefusal({ creature, party: s.party });
    if (refusal) throw new ContentError('invalid-target', `${refusal}.`);
    const role = bestMountRole(creature!)!;
    s.mount = { creatureId, role };
    validateWorldState(world, s);
  });
}
/** Gets off. Always allowed, and doing it twice is the same as doing it once. */
export function dismount<T extends WorldState>(world: WorldDefinition, save: SavePort<T>, commandId: string): Promise<T> {
  return contentTransaction(save, commandId, (s) => {
    validateWorldState(world, s);
    s.mount = null;
    validateWorldState(world, s);
  });
}
