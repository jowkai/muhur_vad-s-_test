import seed from '../../design/catalog.seed.json';
import { BIOME_IDS, type BiomeId } from '../contracts';
import { parseCatalog } from './schema';

export const catalog = parseCatalog(seed);
export const creatures = catalog.creatures;
export const items = catalog.items;
export const recipes = catalog.recipes;
export const moves = catalog.moves;

export function creatureById(id: string) { return creatures.find((entry) => entry.id === id); }
export function itemById(id: string) { return items.find((entry) => entry.id === id); }
export function recipeById(id: string) { return recipes.find((entry) => entry.id === id); }
export function moveById(id: string) { return moves.find((entry) => entry.id === id); }
/** The four moves a species fights with, in slot order. */
export function movesOf(speciesId: string) {
  const species = creatureById(speciesId);
  return species ? species.moveIds.map((id) => moveById(id)!) : [];
}
export function creaturesInBiome(id: BiomeId) { return creatures.filter((entry) => entry.biomeId === id); }

/** Species is selected once by the world generator; this is eligibility, not a reroll. */
export const eggVariants = Object.freeze(BIOME_IDS.map((biomeId) => Object.freeze({
  id: `egg_${biomeId}`,
  biomeId,
  eligibleSpeciesIds: Object.freeze(creaturesInBiome(biomeId).map((species) => species.id)),
})));
export const tutorialEgg = Object.freeze({ speciesId: 'dewbud', level: 1, biomeId: 'meadow' as const });
