import { CREATURE_ROLES, type BiomeId, type CreatureRole } from '../contracts';
import { creatureById, creaturesInBiome, itemById, recipes } from './catalog';
import { recipesForBiome, STARTING_RECIPE_ID } from './secrets';
import type { UnlockChannel } from './schema';

/**
 * How the player comes to know a recipe.
 *
 * v3 had exactly one channel — reading a gardener's shrine — which taught sixteen recipes and
 * left the other twenty-four permanently uncraftable. The catalogue has grown since, so the
 * channels have to grow with it: every recipe is reachable, and each one is reached by doing
 * the thing it is about. Gathering teaches refining, cataloguing a region teaches its
 * components, raising a creature teaches the advanced goods.
 */

/** How much of a region must be catalogued before it gives up its component recipes. */
export const REGION_CATALOGUE_TARGET = 6;
/** Which tool a role earns the right to make. */
const ROLE_TOOL: Readonly<Record<CreatureRole, string>> = Object.freeze({
  claw: 'climb_rope', swim: 'sea_mask', dig: 'mole_claw', fly: 'deep_lantern',
  tank: 'stone_pick', ride: 'trowel',
});
/** Milestone levels the advanced goods are spread across, easiest first. */
const MILESTONES: readonly number[] = Object.freeze([10, 15, 20, 25, 30, 35, 40, 45, 50]);

const tierOf = (itemId: string) => (itemById(itemId) as { craftTier?: string } | undefined)?.craftTier;
const isMaterial = (itemId: string) => !!(itemById(itemId) as { biomeId?: string } | undefined)?.biomeId;
const biomeOf = (itemId: string) => (itemById(itemId) as { biomeId?: BiomeId } | undefined)?.biomeId;

/** Every recipe taught by reading shrines, plus the one the player starts with. */
export const shrineTaught: ReadonlySet<string> = new Set(
  [STARTING_RECIPE_ID, ...(['meadow', 'forest', 'earth', 'desert', 'sea', 'ice', 'volcanic', 'flame'] as const)
    .flatMap((biomeId) => recipesForBiome(biomeId))]);

/** The recipes each channel owns. Together they cover the book exactly once. */
export function channelOf(recipeId: string): UnlockChannel {
  if (recipeId === STARTING_RECIPE_ID) return 'start';
  if (shrineTaught.has(recipeId)) return 'shrine';
  const tier = tierOf(recipeId);
  if (tier === 'refined') return 'material';
  if (tier === 'component') return 'bestiary';
  if (Object.values(ROLE_TOOL).includes(recipeId)) return 'role';
  return 'milestone';
}
/** The milestone level a given advanced product asks for; stable across builds. */
export function milestoneFor(recipeId: string): number {
  const ordered = recipes.map((recipe) => recipe.id).filter((id) => channelOf(id) === 'milestone').sort();
  const index = ordered.indexOf(recipeId);
  return index < 0 ? MILESTONES[0] : MILESTONES[Math.floor(index * MILESTONES.length / ordered.length)];
}

/** What the channels can read: the three v4 journals plus the collection. */
export interface UnlockState {
  readonly discoveredItemIds?: readonly string[];
  readonly seenSpeciesIds?: readonly string[];
  readonly creatures?: readonly { readonly speciesId: string; readonly level: number }[];
  readonly unlockedRecipeIds: readonly string[];
}
/** How many species of one region the player has laid eyes on. */
export function cataloguedIn(state: UnlockState, biomeId: BiomeId): number {
  const region = new Set(creaturesInBiome(biomeId).map((species) => species.id));
  return (state.seenSpeciesIds ?? []).filter((id) => region.has(id)).length;
}
const rolesOwned = (state: UnlockState): ReadonlySet<CreatureRole> => new Set(
  (state.creatures ?? []).flatMap((owned) => [...(creatureById(owned.speciesId)?.roles ?? [])]));
const topLevel = (state: UnlockState) => Math.max(0, ...(state.creatures ?? []).map((owned) => owned.level));

/** Whether this recipe's channel has paid out yet. Pure: the same journal always answers the same. */
export function unlocked(state: UnlockState, recipeId: string): boolean {
  const recipe = recipes.find((entry) => entry.id === recipeId);
  if (!recipe) return false;
  switch (channelOf(recipeId)) {
    case 'start': return true;
    // Shrines mutate the list directly when they are read; nothing else can grant them.
    case 'shrine': return state.unlockedRecipeIds.includes(recipeId);
    case 'material': {
      // Refining is taught by having held the things it refines.
      const discovered = new Set(state.discoveredItemIds ?? []);
      return recipe.inputs.every((input) => !isMaterial(input.itemId) || discovered.has(input.itemId));
    }
    case 'bestiary': {
      // A component is regional knowledge: catalogue the region and its craft opens.
      const raw = recipe.inputs.map((input) => biomeOf(input.itemId)).find((id): id is BiomeId => !!id);
      return !!raw && cataloguedIn(state, raw) >= REGION_CATALOGUE_TARGET;
    }
    case 'role': {
      const role = CREATURE_ROLES.find((entry) => ROLE_TOOL[entry] === recipeId);
      return !!role && rolesOwned(state).has(role);
    }
    case 'milestone': return topLevel(state) >= milestoneFor(recipeId);
  }
}
/** Recipe ids the player has earned but the save has not recorded yet. */
export function newlyEarned(state: UnlockState): string[] {
  const known = new Set(state.unlockedRecipeIds);
  return recipes.map((recipe) => recipe.id)
    .filter((id) => !known.has(id) && channelOf(id) !== 'shrine' && unlocked(state, id));
}

/** Writes a sighting into the bestiary and pays out anything the region journal just earned. */
export function recordSighting(state: UnlockState & { seenSpeciesIds?: string[]; unlockedRecipeIds: string[] }, speciesId: string): void {
  if (!creatureById(speciesId)) return;
  const seen = new Set(state.seenSpeciesIds ?? []);
  if (!seen.has(speciesId)) state.seenSpeciesIds = [...seen, speciesId].sort();
  const earned = newlyEarned(state);
  if (earned.length) state.unlockedRecipeIds = [...state.unlockedRecipeIds, ...earned];
}
