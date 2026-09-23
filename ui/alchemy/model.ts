import { itemById, recipeById, recipes } from '../../content/catalog';
import { itemAssets } from '../../content/asset-manifest';
import { planInventory, type ContentState } from '../../content/alchemy';
import type { Ingredient } from '../../content/schema';
import { effectText } from '../inventory/model';

export interface IngredientSlot {
  readonly itemId: string; readonly name: string; readonly need: number; readonly have: number;
  readonly enough: boolean; readonly missing: number; readonly iconUrl: string; readonly text: string;
}
export interface RecipeRow {
  readonly recipeId: string; readonly name: string; readonly unlocked: boolean;
  readonly outputId: string | null; readonly outputQuantity: number | null;
  readonly craftable: boolean; readonly reason: string | null;
}
export interface CraftPreview {
  readonly recipeId: string; readonly name: string; readonly slots: readonly IngredientSlot[];
  readonly outputId: string; readonly outputName: string; readonly outputQuantity: number;
  readonly outputIconUrl: string; readonly effect: string | null;
  readonly craftable: boolean; readonly reason: string | null;
  readonly resultingFreeSlots: number | null; readonly intent: { readonly type: 'craft'; readonly recipeId: string };
}
export interface AlchemyView {
  readonly rows: readonly RecipeRow[]; readonly preview: CraftPreview | null;
  readonly unlockedCount: number; readonly totalCount: number; readonly note: string;
}
const LOCKED_NAME = 'Keşfedilmemiş tarif';
function counts(inventory: ContentState['inventory']): Map<string, number> {
  const total = new Map<string, number>();
  for (const stack of inventory) if (stack) total.set(stack.itemId, (total.get(stack.itemId) ?? 0) + stack.quantity);
  return total;
}
function slots(inputs: readonly Ingredient[], stock: Map<string, number>): IngredientSlot[] {
  return inputs.map((input) => {
    const have = stock.get(input.itemId) ?? 0;
    const name = itemById(input.itemId)?.name ?? input.itemId;
    return Object.freeze({
      itemId: input.itemId, name, need: input.quantity, have, enough: have >= input.quantity,
      missing: Math.max(0, input.quantity - have), iconUrl: itemAssets[input.itemId as keyof typeof itemAssets] ?? '',
      text: have >= input.quantity ? `${name} ${have}/${input.quantity}` : `${name} ${have}/${input.quantity} · ${input.quantity - have} eksik`,
    });
  });
}
/**
 * Craft preview asks the same `planInventory` the domain uses, so the button can never promise a
 * craft the atomic command would reject, and nothing is consumed while previewing.
 */
export function craftPreview(state: Pick<ContentState, 'inventory' | 'unlockedRecipeIds'>, recipeId: string): CraftPreview | null {
  const recipe = recipeById(recipeId);
  if (!recipe) return null;
  const unlocked = state.unlockedRecipeIds.includes(recipeId);
  const ingredients = slots(recipe.inputs, counts(state.inventory));
  const output = itemById(recipe.output.itemId)!;
  let reason: string | null = unlocked ? null : 'Bu tarif henüz keşfedilmedi';
  let free: number | null = null;
  if (!reason) {
    const missing = ingredients.filter((slot) => !slot.enough);
    if (missing.length) reason = missing.map((slot) => `${slot.name} ${slot.missing} eksik`).join(' · ');
    else {
      try {
        const planned = planInventory(state.inventory, recipe.inputs, [recipe.output]);
        free = planned.filter((stack) => stack === null).length;
      } catch (error) { reason = error instanceof Error ? error.message : 'Üretilemiyor'; }
    }
  }
  return Object.freeze({
    recipeId, name: output.name, slots: Object.freeze(ingredients),
    outputId: output.id, outputName: output.name, outputQuantity: recipe.output.quantity,
    outputIconUrl: itemAssets[output.id as keyof typeof itemAssets] ?? '',
    effect: effectText(output.id), craftable: !reason, reason, resultingFreeSlots: free,
    intent: Object.freeze({ type: 'craft' as const, recipeId }),
  });
}
/** Undiscovered recipes are listed as locked rows; their name, inputs and secret stay hidden. */
export function alchemyView(state: Pick<ContentState, 'inventory' | 'unlockedRecipeIds'>, selectedId: string | null = null): AlchemyView {
  const rows = recipes.map((recipe): RecipeRow => {
    const unlocked = state.unlockedRecipeIds.includes(recipe.id);
    const preview = unlocked ? craftPreview(state, recipe.id) : null;
    return Object.freeze({
      recipeId: recipe.id, name: unlocked ? itemById(recipe.output.itemId)!.name : LOCKED_NAME, unlocked,
      outputId: unlocked ? recipe.output.itemId : null, outputQuantity: unlocked ? recipe.output.quantity : null,
      craftable: !!preview?.craftable, reason: unlocked ? preview?.reason ?? null : 'Bu tarif henüz keşfedilmedi',
    });
  });
  const selected = selectedId && state.unlockedRecipeIds.includes(selectedId) ? craftPreview(state, selectedId) : null;
  const unlockedCount = rows.filter((row) => row.unlocked).length;
  return Object.freeze({
    rows: Object.freeze(rows), preview: selected, unlockedCount, totalCount: rows.length,
    note: `${unlockedCount}/${rows.length} tarif keşfedildi`,
  });
}
