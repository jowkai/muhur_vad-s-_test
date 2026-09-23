import { MAX_LEVEL, type BiomeId, type CreatureRole, type DayPhase, type TreeKind, type VecXZ } from '../../contracts';
import { GAME_CONFIG } from '../../config';
import { creaturesInBiome, items } from '../../content/catalog';
import { GENERATOR_VERSION, type WorldDefinition } from '../generation/world';
import { hash, randomAt } from '../generation/random';
import { sampleTerrain } from '../terrain/terrain';
import type { WorldTarget } from '../encounters/targets';
import { shrinesFor, type Shrine } from '../shrines/shrines';
import { activityOf, aggressiveBonus } from '../daynight';

export const CHUNK_GRID = GAME_CONFIG.worldSize / GAME_CONFIG.chunkSize;
export interface ChunkCoord { readonly id: string; readonly chunkX: number; readonly chunkZ: number }
/**
 * What the generator recorded for one entity. `target` is the public proximity contract; the
 * species an egg will hatch and its RNG seed are fixed here at generation and never rerolled.
 */
export interface ChunkSpawn {
  readonly target: WorldTarget; readonly speciesId: string | null;
  readonly itemId: string | null; readonly seed: number;
  /** v3: a standing tree is a resource with a kind; everything else leaves this null. */
  readonly treeKind?: TreeKind | null;
}
/** Which tree grows where, how often, and what it needs before it shows at all. */
export const TREE_TABLE: Readonly<Record<TreeKind, {
  readonly itemId: string; readonly name: string; readonly biomes: readonly BiomeId[];
  readonly share: number; readonly nightOnly: boolean;
}>> = Object.freeze({
  oak: { itemId: 'oak_log', name: 'Meşe', biomes: ['meadow', 'forest', 'earth'], share: .55, nightOnly: false },
  amber: { itemId: 'amber_log', name: 'Kehribar Ağacı', biomes: ['meadow', 'forest', 'desert'], share: .22, nightOnly: false },
  ghostwood: { itemId: 'ghost_log', name: 'Hayalet Ağaç', biomes: ['forest', 'ice'], share: .08, nightOnly: true },
  emberbark: { itemId: 'ember_log', name: 'Köz Kabuk', biomes: ['volcanic', 'flame'], share: .5, nightOnly: false },
  frostpine: { itemId: 'frost_log', name: 'Kırağı Çamı', biomes: ['ice', 'sea'], share: .45, nightOnly: false },
  // v4: earth, desert, sea and flame each stood on a single wood, so their groves all looked
  // alike and their lumber fed one recipe. A second kind apiece fixes both.
  ironroot: { itemId: 'ironroot_log', name: 'Demirkök', biomes: ['earth'], share: .5, nightOnly: false },
  dunepalm: { itemId: 'dunepalm_log', name: 'Çöl Hurması', biomes: ['desert'], share: .5, nightOnly: false },
  coralwood: { itemId: 'coral_log', name: 'Mercan Odunu', biomes: ['sea'], share: .5, nightOnly: false },
  ashwillow: { itemId: 'ash_log', name: 'Kül Söğüdü', biomes: ['flame'], share: .45, nightOnly: true },
});
/** The tree a resource slot grows into, or null when the region has none for this roll. */
export function treeFor(biomeId: BiomeId, roll: number, phase: DayPhase): { kind: TreeKind; itemId: string; name: string } | null {
  const options = (Object.entries(TREE_TABLE) as [TreeKind, typeof TREE_TABLE[TreeKind]][])
    .filter(([, entry]) => entry.biomes.includes(biomeId) && (!entry.nightOnly || phase === 'night'))
    .sort(([a], [b]) => a < b ? -1 : 1);
  if (!options.length) return null;
  const total = options.reduce((sum, [, entry]) => sum + entry.share, 0);
  let ticket = roll * total;
  for (const [kind, entry] of options) {
    ticket -= entry.share;
    if (ticket < 0) return { kind, itemId: entry.itemId, name: entry.name };
  }
  const [kind, entry] = options[options.length - 1];
  return { kind, itemId: entry.itemId, name: entry.name };
}
const half = GAME_CONFIG.worldSize / 2;
const size = GAME_CONFIG.chunkSize;
const cell = GAME_CONFIG.cellSize;
/** Level bands follow the WORLD.md region table; species come from the biome the cell resolves to. */
/** v3 raises every band and lifts the ceiling to fifty; the deep regions are a real wall now. */
export const BANDS: Readonly<Record<BiomeId, readonly [number, number]>> = Object.freeze({
  meadow: [1, 5], forest: [5, 12], sea: [8, 16], desert: [12, 22],
  earth: [18, 28], ice: [24, 34], volcanic: [30, 40], flame: [36, 50],
});
/** The role a region effectively asks for; the HUD warns, the terrain enforces what it can. */
export const REGION_GATE: Readonly<Record<BiomeId, CreatureRole | null>> = Object.freeze({
  meadow: null, forest: 'claw', sea: 'swim', desert: 'ride',
  earth: 'dig', ice: 'tank', volcanic: 'tank', flame: 'fly',
});
/** A legendary is genuinely rare: roughly one in sixty of a region's rolls. */
const RARITY_WEIGHT = Object.freeze({ common: 6, uncommon: 3, rare: 1, legendary: .2 });
const inWorld = (p: VecXZ) => Number.isFinite(p.x) && Number.isFinite(p.z) && p.x >= -half && p.z >= -half && p.x < half && p.z < half;
export const chunkKey = (chunkX: number, chunkZ: number) => `${chunkX},${chunkZ}`;
export function chunkAt(position: VecXZ): ChunkCoord {
  if (!inWorld(position)) throw new RangeError('Chunk konumu dünya dışında.');
  const chunkX = Math.floor((position.x + half) / size), chunkZ = Math.floor((position.z + half) / size);
  return Object.freeze({ id: chunkKey(chunkX, chunkZ), chunkX, chunkZ });
}
/** Square ring around the player, clipped at the world edge; order never depends on arrival path. */
export function residency(center: VecXZ, radius: number): readonly ChunkCoord[] {
  if (!Number.isInteger(radius) || radius < 0 || radius > 8) throw new RangeError('Geçersiz chunk yarıçapı.');
  const middle = chunkAt(center);
  const result: ChunkCoord[] = [];
  for (let z = middle.chunkZ - radius; z <= middle.chunkZ + radius; z++) {
    for (let x = middle.chunkX - radius; x <= middle.chunkX + radius; x++) {
      if (x < 0 || z < 0 || x >= CHUNK_GRID || z >= CHUNK_GRID) continue;
      result.push(Object.freeze({ id: chunkKey(x, z), chunkX: x, chunkZ: z }));
    }
  }
  return Object.freeze(result);
}
function weighted<T extends { rarity: keyof typeof RARITY_WEIGHT }>(entries: readonly T[], roll: number): T {
  const total = entries.reduce((sum, entry) => sum + RARITY_WEIGHT[entry.rarity], 0);
  let ticket = roll * total;
  for (const entry of entries) { ticket -= RARITY_WEIGHT[entry.rarity]; if (ticket < 0) return entry; }
  return entries[entries.length - 1];
}
/** The gardener shrine that stands in this chunk, if any: one per region, never respawned. */
export function shrineInChunk(world: WorldDefinition, chunk: ChunkCoord): Shrine | null {
  return shrinesFor(world).find((shrine) => chunkAt(shrine.position).id === chunk.id) ?? null;
}
export function entityIdFor(world: WorldDefinition, chunk: ChunkCoord, index: number, nocturnal = false): string {
  // A slot that turns nocturnal is its own entity: day and night creatures never share a grave.
  return `${world.seed.length}:${world.seed}:g${GENERATOR_VERSION}:chunk:${chunk.chunkX}:${chunk.chunkZ}:${index}${nocturnal ? ':n' : ''}`;
}
/**
 * Pure `hash(seed, subsystem, chunkX, chunkZ, entityIndex)` placement: a chunk produces the same
 * entities in the same order however the player reached it, and never mutates world state.
 */
export function spawnsForChunk(world: WorldDefinition, chunk: ChunkCoord, phase: DayPhase = 'day'): readonly ChunkSpawn[] {
  if (!Number.isInteger(chunk.chunkX) || !Number.isInteger(chunk.chunkZ) ||
    chunk.chunkX < 0 || chunk.chunkZ < 0 || chunk.chunkX >= CHUNK_GRID || chunk.chunkZ >= CHUNK_GRID) throw new RangeError('Geçersiz chunk.');
  const originX = chunk.chunkX * size - half, originZ = chunk.chunkZ * size - half;
  const count = 4 + (hash(world.seed, 'chunk-count', chunk.chunkX, chunk.chunkZ) % 6);
  const spawns: ChunkSpawn[] = [];
  for (let index = 0; index < count; index++) {
    const roll = (stream: string) => randomAt(world.seed, `chunk-${stream}`, chunk.chunkX, chunk.chunkZ, index);
    const position = Object.freeze({
      x: originX + Math.floor(roll('x') * (size / cell)) * cell + cell / 2,
      z: originZ + Math.floor(roll('z') * (size / cell)) * cell + cell / 2,
    });
    const terrain = sampleTerrain(world, position);
    if (!terrain.traversable || terrain.hazard !== 'none' || terrain.road) continue;
    if (world.starters.some((starter) => Math.hypot(starter.position.x - position.x, starter.position.z - position.z) < 4)) continue;
    // The ground a shrine stands on stays clear, so the marks are always reachable on foot.
    if (shrinesFor(world).some((shrine) => Math.hypot(shrine.position.x - position.x, shrine.position.z - position.z) < 6)) continue;
    const biomeId = terrain.biomeId;
    const species = creaturesInBiome(biomeId);
    const resources = items.filter((item) => item.biomeId === biomeId);
    if (!species.length || !resources.length) continue;
    const kindRoll = roll('kind');
    const eggShare = biomeId === 'meadow' ? 0.3 : 0.12;
    const kind: WorldTarget['kind'] = kindRoll < eggShare ? 'egg' : kindRoll < eggShare + 0.4 ? 'resource' : 'creature';
    const seed = hash(world.seed, 'chunk-seed', chunk.chunkX, chunk.chunkZ, index);
    const entityId = entityIdFor(world, chunk, index);
    if (kind === 'resource') {
      // A quarter of the region's resource slots are standing trees rather than loose material.
      const standing = roll('tree') < .25;
      const dayTree = standing ? treeFor(biomeId, roll('tree-kind'), 'day') : null;
      const tree = standing ? treeFor(biomeId, roll('tree-kind'), phase) : null;
      // A slot the night turns into another tree is its own entity, like a nocturnal creature.
      const nightGrown = tree?.kind !== dayTree?.kind;
      const resourceId = entityIdFor(world, chunk, index, nightGrown);
      if (tree) {
        const target = Object.freeze({ entityId: resourceId, kind, name: tree.name, spriteId: tree.itemId, level: 0, aggressive: false, position });
        spawns.push(Object.freeze({ target, speciesId: null, itemId: tree.itemId, seed, treeKind: tree.kind }));
        continue;
      }
      const item = weighted(resources, roll('item'));
      const target = Object.freeze({ entityId: resourceId, kind, name: item.name, spriteId: item.id, level: 0, aggressive: false, position });
      spawns.push(Object.freeze({ target, speciesId: null, itemId: item.id, seed, treeKind: null }));
      continue;
    }
    // The clock only changes who answers a creature slot, never how many slots a chunk has.
    const pool = (want: DayPhase) => {
      const awake = species.filter((entry) => { const activity = activityOf(entry); return activity === 'any' || activity === want; });
      return kind === 'creature' && awake.length ? awake : species;
    };
    const daytime = weighted(pool('day'), roll('species'));
    const picked = phase === 'day' ? daytime : weighted(pool('night'), roll('species'));
    if (kind === 'egg') {
      const target = Object.freeze({ entityId, kind, name: `${picked.name} Yumurtası`, spriteId: `egg_${biomeId}`, level: 1, aggressive: false, position });
      spawns.push(Object.freeze({ target, speciesId: picked.id, itemId: null, seed }));
      continue;
    }
    const [low, high] = BANDS[biomeId];
    const level = Math.min(MAX_LEVEL, Math.max(1, low + Math.floor(roll('level') * (high - low + 1))));
    const distanceToCamp = Math.hypot(position.x - world.camp.x, position.z - world.camp.z);
    const aggressive = biomeId !== 'meadow' && distanceToCamp > GAME_CONFIG.safeCampRadius && roll('aggro') < 0.45 + aggressiveBonus(phase);
    // A slot only becomes a second entity when the night actually puts someone else on it.
    const nocturnal = picked.id !== daytime.id;
    const target = Object.freeze({
      entityId: entityIdFor(world, chunk, index, nocturnal), kind,
      name: picked.name, spriteId: picked.id, level, aggressive, position,
    });
    spawns.push(Object.freeze({ target, speciesId: picked.id, itemId: null, seed }));
  }
  // Designed starter spawns belong to the chunk that contains them, so they consume and persist alike.
  for (const starter of world.starters) {
    if (chunkAt(starter.position).id !== chunk.id) continue;
    const species = creaturesInBiome('meadow').find((entry) => entry.id === starter.speciesId) ?? creaturesInBiome('meadow')[0];
    const target = Object.freeze({
      entityId: starter.entityId, kind: starter.kind, level: starter.level, aggressive: false,
      name: starter.kind === 'egg' ? `${species.name} Yumurtası` : species.name,
      spriteId: starter.kind === 'egg' ? 'egg_meadow' : species.id, position: Object.freeze({ ...starter.position }),
    });
    spawns.push(Object.freeze({ target, speciesId: species.id, itemId: null, seed: hash(world.seed, 'starter-seed', chunkAt(starter.position).chunkX, chunkAt(starter.position).chunkZ, world.starters.indexOf(starter)) }));
  }
  return Object.freeze(spawns);
}
