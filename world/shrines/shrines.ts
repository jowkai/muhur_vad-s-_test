import { BIOME_IDS, type BiomeId, type ShrineRecord, type VecXZ } from '../../contracts';
import { GAME_CONFIG } from '../../config';
import { items } from '../../content/catalog';
import type { Ingredient } from '../../content/schema';
import { canOccupy } from '../collision/collision';
import { randomAt } from '../generation/random';
import type { WorldDefinition } from '../generation/world';
import { sampleTerrain } from '../terrain/terrain';

export const SHRINE_PREFIX = 'shrine:';
/** How far from the region entrance a gardener built: WORLD v2 fixes the 30–60 m band. */
export const SHRINE_MIN_DISTANCE = 30;
export const SHRINE_MAX_DISTANCE = 60;
/** How close the player must stand to read the marks. */
export const SHRINE_VISIT_RADIUS = 8;
const RINGS = 7;
const SPOKES = 24;

export interface Shrine {
  readonly id: string; readonly biomeId: BiomeId; readonly name: string;
  readonly position: VecXZ; readonly story: string;
}
/** Author-written fragments; the world keeps no other quest text. */
const STORY: Readonly<Record<BiomeId, { readonly name: string; readonly story: string }>> = Object.freeze({
  meadow: { name: 'Çayır Tapınağı', story: 'İlk bahçıvan buraya bir avuç çiy bırakmış: "Merhem, sabırla karışır."' },
  forest: { name: 'Koru Tapınağı', story: 'Kabuğa kazınmış not: "Yankıyı dinle, balsamı ağaç söyler."' },
  earth: { name: 'Toprak Tapınağı', story: 'Kil tablet: "Mührü toprak tutar, bağ topraktan doğar."' },
  desert: { name: 'Çöl Tapınağı', story: 'Tuz üstünde iz: "Uyanış, gölge düşmeden karılır."' },
  sea: { name: 'Gelgit Tapınağı', story: 'Sedefe işlenmiş satır: "Gelgit iki kez gelir, balsam bir kez."' },
  ice: { name: 'Buz Tapınağı', story: 'Donmuş cam: "Yankılı balsam, kırılmadan önce söylenir."' },
  volcanic: { name: 'Bazalt Tapınağı', story: 'Isıyla oyulmuş: "Tütsü, közü uyutmak içindir."' },
  flame: { name: 'Alev Tapınağı', story: 'Küle yazılmış son satır: "Yuva özü, en sıcak yerde soğur."' },
});
const half = GAME_CONFIG.worldSize / 2;
const snap = (value: number) => Math.floor((value + half) / GAME_CONFIG.cellSize) * GAME_CONFIG.cellSize - half + GAME_CONFIG.cellSize / 2;
export const shrineIdFor = (biomeId: BiomeId) => `${SHRINE_PREFIX}${biomeId}`;
export function biomeOfShrine(shrineId: string): BiomeId | null {
  const biomeId = shrineId.startsWith(SHRINE_PREFIX) ? shrineId.slice(SHRINE_PREFIX.length) : '';
  return (BIOME_IDS as readonly string[]).includes(biomeId) ? biomeId as BiomeId : null;
}
function usable(world: WorldDefinition, position: VecXZ, biomeId: BiomeId): boolean {
  const terrain = sampleTerrain(world, position);
  if (!terrain.traversable || terrain.hazard !== 'none' || terrain.road || terrain.biomeId !== biomeId) return false;
  if (world.starters.some((starter) => Math.hypot(starter.position.x - position.x, starter.position.z - position.z) < 6)) return false;
  return canOccupy(world, position, GAME_CONFIG.cellSize);
}
/** Placement is pure and costs terrain samples, so each world definition solves it once. */
const CACHE = new WeakMap<WorldDefinition, readonly Shrine[]>();
/**
 * One shrine per region, at a hashed angle 30–60 m from the region entrance. The search walks
 * fixed rings and spokes, so the same world seed always produces the same eight walkable spots.
 */
export function shrinesFor(world: WorldDefinition): readonly Shrine[] {
  const cached = CACHE.get(world);
  if (cached) return cached;
  const placed = Object.freeze(world.regions.map((region) => {
    const base = randomAt(world.seed, `shrine-${region.biomeId}`, 0) * Math.PI * 2;
    const spread = (SHRINE_MAX_DISTANCE - SHRINE_MIN_DISTANCE) / (RINGS - 1);
    let position = region.entrance;
    search: for (let ring = 0; ring < RINGS; ring++) {
      const radius = SHRINE_MIN_DISTANCE + ring * spread;
      for (let spoke = 0; spoke < SPOKES; spoke++) {
        const angle = base + spoke * (2 * Math.PI / SPOKES);
        const candidate = Object.freeze({
          x: snap(region.entrance.x + Math.cos(angle) * radius),
          z: snap(region.entrance.z + Math.sin(angle) * radius),
        });
        if (!usable(world, candidate, region.biomeId)) continue;
        position = candidate;
        break search;
      }
    }
    const { name, story } = STORY[region.biomeId];
    return Object.freeze({ id: shrineIdFor(region.biomeId), biomeId: region.biomeId, name, position, story });
  }));
  CACHE.set(world, placed);
  return placed;
}
export function shrineById(world: WorldDefinition, shrineId: string): Shrine | null {
  return shrinesFor(world).find((shrine) => shrine.id === shrineId) ?? null;
}
/** The shrine the player is standing at, or null: proximity is the only way in. */
export function shrineAt(world: WorldDefinition, position: VecXZ, radius = SHRINE_VISIT_RADIUS): Shrine | null {
  return shrinesFor(world).find((shrine) => Math.hypot(shrine.position.x - position.x, shrine.position.z - position.z) <= radius) ?? null;
}
/** One-off chest: two region materials and a plain seal. Never rolled, never repeated. */
export function shrineChest(biomeId: BiomeId): readonly Ingredient[] {
  const region = items.filter((item) => item.biomeId === biomeId);
  const common = region.find((item) => item.rarity === 'common')!;
  const uncommon = region.find((item) => item.rarity === 'uncommon') ?? common;
  return Object.freeze([
    Object.freeze({ itemId: common.id, quantity: 1 }),
    Object.freeze({ itemId: uncommon.id, quantity: 1 }),
    Object.freeze({ itemId: 'seal', quantity: 1 }),
  ]);
}
export const visitedShrine = (shrines: readonly ShrineRecord[], biomeId: BiomeId): ShrineRecord | undefined =>
  shrines.find((record) => record.biomeId === biomeId);
/** Fast-travel anchors are the visited shrines plus the camp, which is always open. */
export function travelAnchors(world: WorldDefinition, shrines: readonly ShrineRecord[]): readonly { id: string; name: string; position: VecXZ }[] {
  const visited = shrinesFor(world).filter((shrine) => visitedShrine(shrines, shrine.biomeId));
  return Object.freeze([
    Object.freeze({ id: 'camp', name: 'Kamp', position: Object.freeze({ ...world.camp }) }),
    ...visited.map((shrine) => Object.freeze({ id: shrine.id, name: shrine.name, position: shrine.position })),
  ]);
}
