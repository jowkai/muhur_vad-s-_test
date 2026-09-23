import { ContentError, planInventory } from '../content/alchemy';
import type { SavePort } from '../contracts';
import { activeTank, TANK_BONUS_SLOTS } from '../game/roles';
import type { WorldState } from '../world/persistence/world-save';

/** Called inside the existing save transaction, never from rendering or a second write. */
export function reconcileRoleCapacity(state: WorldState): void {
  const previous = state.tankBonusSlots ?? 0;
  const next = activeTank(state.creatures, state.activeCreatureId) ? TANK_BONUS_SLOTS : 0;
  if (previous === next) return;
  if (next > previous) state.inventory.push(...Array.from({ length: next - previous }, () => null));
  else {
    const overflow = state.inventory.splice(state.inventory.length - previous);
    for (const stack of overflow) {
      if (!stack) continue;
      for (let unit = 0; unit < stack.quantity; unit++) {
        try { state.inventory = planInventory(state.inventory, [], [{ itemId: stack.itemId, quantity: 1 }]); }
        catch (error) {
          if (!(error instanceof ContentError) || error.code !== 'full') throw error;
          state.deliveryBox.push({ kind: 'item', itemId: stack.itemId, quantity: stack.quantity - unit });
          break;
        }
      }
    }
  }
  state.tankBonusSlots = next;
}
export function withRoleCapacity(save: SavePort<WorldState>): SavePort<WorldState> {
  return {
    load: () => save.load(),
    transact: (commandId, mutate) => save.transact(commandId, (draft) => {
      reconcileRoleCapacity(draft);
      mutate(draft);
      reconcileRoleCapacity(draft);
    }),
  };
}
