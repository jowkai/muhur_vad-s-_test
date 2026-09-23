import type { GameMode, SavePort } from '../contracts';
import { itemById, recipeById } from './catalog';
import type { Ingredient } from './schema';

/** Content-owned projection. Integration may extend this with world/combat save fields. */
export interface ContentState {
  mode: GameMode;
  atCamp: boolean;
  inventory: ({ itemId: string; quantity: number } | null)[];
  unlockedRecipeIds: string[];
  creatures: { id: string; hp: number; maxHp: number }[];
}
export type ContentErrorCode = 'invalid-state' | 'invalid-recipe' | 'locked' | 'missing-items' | 'full' | 'context' | 'invalid-item' | 'invalid-target';
export class ContentError extends Error {
  constructor(readonly code: ContentErrorCode, message: string) { super(message); this.name = 'ContentError'; }
}
export function validateContentState(value: unknown): asserts value is ContentState {
  const fail = () => { throw new ContentError('invalid-state', 'Envanter veya yaratık verisi geçersiz.'); };
  if (!value || typeof value !== 'object') return fail();
  const state = value as ContentState;
  if (!['boot', 'exploring', 'panel', 'encounter', 'battle', 'committing', 'recovery'].includes(state.mode) || typeof state.atCamp !== 'boolean' ||
    !Array.isArray(state.inventory) || !state.inventory.length || !Array.isArray(state.creatures) || !Array.isArray(state.unlockedRecipeIds)) return fail();
  // Explicit iteration catches sparse slots too: only null is an empty slot.
  for (const stack of state.inventory) {
    if (stack === null) continue;
    if (!stack || typeof stack !== 'object') return fail();
    const item = itemById(stack.itemId);
    if (!item || !Number.isSafeInteger(stack.quantity) || stack.quantity <= 0 || stack.quantity > item.stackLimit) return fail();
  }
  const ids = new Set<string>();
  for (const creature of state.creatures) {
    if (!creature || typeof creature.id !== 'string' || !creature.id.trim() || ids.has(creature.id) ||
      !Number.isSafeInteger(creature.hp) || !Number.isSafeInteger(creature.maxHp) || creature.maxHp <= 0 || creature.hp < 0 || creature.hp > creature.maxHp) return fail();
    ids.add(creature.id);
  }
  if (new Set(state.unlockedRecipeIds).size !== state.unlockedRecipeIds.length || state.unlockedRecipeIds.some((id) => !recipeById(id))) return fail();
}

/** Pure planning: consumes inputs on a copy, fills partial stacks, then vacant slots. */
export function planInventory(inventory: ContentState['inventory'], inputs: readonly Ingredient[], outputs: readonly Ingredient[]): ContentState['inventory'] {
  const result = structuredClone(inventory);
  for (const input of inputs) {
    if (!itemById(input.itemId) || !Number.isSafeInteger(input.quantity) || input.quantity <= 0) throw new ContentError('invalid-item', 'Geçersiz eşya miktarı.');
    let remaining = input.quantity;
    for (let i = 0; i < result.length && remaining > 0; i++) {
      const stack = result[i];
      if (stack?.itemId !== input.itemId) continue;
      const taken = Math.min(stack.quantity, remaining);
      stack.quantity -= taken; remaining -= taken;
      if (!stack.quantity) result[i] = null;
    }
    if (remaining) throw new ContentError('missing-items', `${itemById(input.itemId)!.name} yeterli değil.`);
  }
  for (const output of outputs) {
    const item = itemById(output.itemId);
    if (!item || !Number.isSafeInteger(output.quantity) || output.quantity <= 0) throw new ContentError('invalid-item', 'Geçersiz çıktı.');
    let remaining = output.quantity;
    for (const stack of result) {
      if (stack?.itemId !== output.itemId) continue;
      const added = Math.min(item.stackLimit - stack.quantity, remaining);
      stack.quantity += added; remaining -= added;
    }
    for (let i = 0; i < result.length && remaining > 0; i++) {
      if (result[i] !== null) continue;
      const added = Math.min(item.stackLimit, remaining);
      result[i] = { itemId: output.itemId, quantity: added }; remaining -= added;
    }
    if (remaining) throw new ContentError('full', 'Çıktı için çantada yer yok.');
  }
  return result;
}

/** Preserve domain rejection messages while keeping storage failures distinguishable. */
export async function contentTransaction<T extends ContentState>(save: SavePort<T>, commandId: string, mutate: (draft: T) => void): Promise<T> {
  let domainError: ContentError | undefined;
  try {
    return await save.transact(commandId, (draft) => {
      try { validateContentState(draft); mutate(draft); }
      catch (error) { if (error instanceof ContentError) domainError = error; throw error; }
    });
  } catch (error) { throw domainError ?? error; }
}

export function craft<T extends ContentState>(save: SavePort<T>, commandId: string, recipeId: string): Promise<T> {
  return contentTransaction(save, commandId, (draft) => {
    if (draft.mode !== 'exploring' && draft.mode !== 'panel') throw new ContentError('context', 'Bu durumda simya yapılamaz.');
    const recipe = recipeById(recipeId);
    if (!recipe || !recipe.enabledInMvp) throw new ContentError('invalid-recipe', 'Tarif bulunamadı.');
    if (!draft.unlockedRecipeIds.includes(recipeId)) throw new ContentError('locked', 'Bu tarif henüz keşfedilmedi.');
    draft.inventory = planInventory(draft.inventory, recipe.inputs, [recipe.output]);
  });
}
