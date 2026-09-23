import { BIOME_IDS, type BiomeId } from '../contracts';
import { recipeById } from './catalog';

export const SECRET_PREFIX = 'secret:';
/**
 * CONTENT.md: the valley was an alchemy garden and the lost gardeners left recipe fragments in
 * every region. One region keeps one recipe, so exploring a biome is what teaches its craft.
 * The meadow's recipe is the one the player already starts with.
 */
export const BIOME_RECIPE: Readonly<Record<BiomeId, string>> = Object.freeze({
  meadow: 'salve',
  forest: 'forest_balm',
  earth: 'seal',
  desert: 'waking_salt',
  sea: 'tide_balm',
  ice: 'resonant_balm',
  volcanic: 'ember_incense',
  flame: 'egg_feed',
});
/**
 * v2: sixteen recipes, two per shrine. The first is the region's own product, the second is the
 * tool or tonic its gardener worked with, so reading all eight shrines teaches the whole book.
 */
export const BIOME_EXTRA_RECIPE: Readonly<Record<BiomeId, string>> = Object.freeze({
  meadow: 'training_tonic',
  forest: 'trowel',
  earth: 'stone_pick',
  desert: 'lens',
  sea: 'field_tonic',
  ice: 'waking_draught',
  volcanic: 'lantern',
  flame: 'master_tonic',
});
export function recipesForBiome(biomeId: BiomeId): readonly string[] {
  return Object.freeze([BIOME_RECIPE[biomeId], BIOME_EXTRA_RECIPE[biomeId]].filter((id) => recipeById(id)));
}
export const STARTING_RECIPE_ID = BIOME_RECIPE.meadow;
export function secretIdFor(biomeId: BiomeId): string {
  if (!BIOME_IDS.includes(biomeId)) throw new RangeError('Bilinmeyen biyom sırrı.');
  return `${SECRET_PREFIX}${biomeId}`;
}
export function biomeOfSecret(secretId: string): BiomeId | null {
  const biomeId = secretId.startsWith(SECRET_PREFIX) ? secretId.slice(SECRET_PREFIX.length) : '';
  return (BIOME_IDS as readonly string[]).includes(biomeId) ? biomeId as BiomeId : null;
}
/** The recipe a freshly discovered secret teaches, or null when the mark is not a region secret. */
export function recipeForSecret(secretId: string): string | null {
  const biomeId = biomeOfSecret(secretId);
  if (!biomeId) return null;
  const recipeId = BIOME_RECIPE[biomeId];
  return recipeById(recipeId) ? recipeId : null;
}
