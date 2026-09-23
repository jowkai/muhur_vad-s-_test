import type { SavePort } from '../../contracts';
import { ContentError, contentTransaction, planInventory } from '../../content/alchemy';
import { recipesForBiome, secretIdFor } from '../../content/secrets';
import { recipeById } from '../../content/catalog';
import type { WorldDefinition } from '../generation/world';
import { explorationAllowed, validateWorldState, type WorldState } from '../persistence/world-save';
import { SHRINE_VISIT_RADIUS, shrineById, shrineChest, visitedShrine } from './shrines';

function fail(message: string): never { throw new ContentError('invalid-state', message); }

/**
 * Reading a gardener's shrine for the first time: the region's recipe is taught with no dice,
 * the story fragment is kept, the chest is handed over once and the anchor opens. A later visit
 * changes nothing at all — the anchor it already opened is the whole reward.
 */
export function visitShrine<T extends WorldState>(world: WorldDefinition, save: SavePort<T>, commandId: string, shrineId: string): Promise<T> {
  return contentTransaction(save, commandId, (s) => {
    validateWorldState(world, s);
    const shrine = shrineById(world, shrineId);
    if (!shrine) throw new ContentError('invalid-target', 'Böyle bir tapınak yok.');
    if (!explorationAllowed(s) && s.mode !== 'panel') throw new ContentError('context', 'Tapınak şu anda okunamaz.');
    const distance = Math.hypot(s.playerPosition.x - shrine.position.x, s.playerPosition.z - shrine.position.z);
    if (distance > SHRINE_VISIT_RADIUS) throw new ContentError('invalid-target', 'Tapınağa yeterince yakın değilsin.');
    if (visitedShrine(s.shrines, shrine.biomeId)) return;
    const taught = recipesForBiome(shrine.biomeId);
    if (taught.length !== 2 || taught.some((recipeId) => !recipeById(recipeId))) fail('Bölge tarifi bulunamadı');
    s.shrines = [...s.shrines, { biomeId: shrine.biomeId, visitedTick: s.worldTick, chestTaken: true }];
    for (const recipeId of taught) {
      if (!s.unlockedRecipeIds.includes(recipeId)) s.unlockedRecipeIds = [...s.unlockedRecipeIds, recipeId];
    }
    const secretId = secretIdFor(shrine.biomeId);
    if (!s.secretFlags.includes(secretId)) s.secretFlags = [...s.secretFlags, secretId];
    // A full bag never loses the chest: what does not fit waits in the delivery box.
    for (const part of shrineChest(shrine.biomeId)) {
      for (let unit = 0; unit < part.quantity; unit++) {
        try { s.inventory = planInventory(s.inventory, [], [{ itemId: part.itemId, quantity: 1 }]); }
        catch (error) {
          if (!(error instanceof ContentError) || error.code !== 'full') throw error;
          s.deliveryBox = [...s.deliveryBox, { kind: 'item', itemId: part.itemId, quantity: part.quantity - unit }];
          break;
        }
      }
    }
    validateWorldState(world, s);
  });
}
