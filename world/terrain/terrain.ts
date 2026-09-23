import type { BiomeId, VecXZ } from '../../contracts';
import { GAME_CONFIG } from '../../config';
import type { WorldDefinition } from '../generation/world';
import { randomAt } from '../generation/random';

export interface TerrainCell {
  readonly position: VecXZ; readonly height: number; readonly biomeId: BiomeId;
  readonly regionId: string; readonly traversable: boolean;
  readonly hazard: 'none' | 'deep-water' | 'lava' | 'boundary';
  readonly obstacle: 'none' | 'tree' | 'rock'; readonly road: boolean;
  readonly secondaryBiome: BiomeId | null; readonly blend: number;
}
export interface TerrainChunk {
  readonly id: string; readonly chunkX: number; readonly chunkZ: number;
  readonly cells: readonly TerrainCell[];
}
const half = GAME_CONFIG.worldSize / 2;
const distanceSquared = (a: VecXZ, b: VecXZ) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
function segmentDistanceSquared(p: VecXZ, a: VecXZ, b: VecXZ) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const denominator = dx * dx + dz * dz;
  const t = denominator ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / denominator)) : 0;
  return (p.x - a.x - t * dx) ** 2 + (p.z - a.z - t * dz) ** 2;
}
export function sampleTerrain(world: WorldDefinition, position: VecXZ): TerrainCell {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.z)) throw new RangeError('Arazi konumu sonlu olmalı.');
  const outside = position.x < -half || position.z < -half || position.x >= half || position.z >= half;
  if (outside) return { position: { ...position }, height: 0, biomeId: 'meadow', regionId: 'boundary', traversable: false, hazard: 'boundary', obstacle: 'none', road: false, secondaryBiome: null, blend: 0 };
  const cellX = Math.floor((position.x + half) / GAME_CONFIG.cellSize);
  const cellZ = Math.floor((position.z + half) / GAME_CONFIG.cellSize);
  const p = { x: cellX * GAME_CONFIG.cellSize - half + 1, z: cellZ * GAME_CONFIG.cellSize - half + 1 };
  const safe = distanceSquared(p, world.camp) <= (GAME_CONFIG.safeCampRadius + 2) ** 2;
  const [a, b, c, d] = world.phases;
  const warped = { x: p.x + 25 * Math.sin(p.z / 170 + a), z: p.z + 25 * Math.sin(p.x / 210 + b) };
  const ranked = world.regions.filter((region) => region.biomeId !== 'flame')
    .map((region) => ({ region, distance: Math.sqrt(distanceSquared(warped, region.center)) }))
    .sort((left, right) => left.distance - right.distance);
  let biomeId = ranked[0].region.biomeId;
  let secondaryBiome: BiomeId | null = ranked[1].region.biomeId;
  let blend = Math.max(0, 0.5 - (ranked[1].distance - ranked[0].distance) / 40);
  const flame = world.regions.find((region) => region.biomeId === 'flame')!;
  const flameDistance = Math.sqrt(distanceSquared(warped, flame.center));
  if (biomeId === 'volcanic' && flameDistance < 130) {
    biomeId = 'flame'; secondaryBiome = 'volcanic'; blend = Math.max(0, 0.5 - (130 - flameDistance) / 40);
  } else if (biomeId === 'volcanic' && flameDistance < 150) {
    secondaryBiome = 'flame'; blend = Math.max(0, 0.5 - (flameDistance - 130) / 40);
  }
  if (!blend) secondaryBiome = null;
  const road = world.roads.some((segment) => segmentDistanceSquared(p, segment.from, segment.to) <= 100);
  const entrance = world.regions.some((region) => distanceSquared(p, region.entrance) <= 24 ** 2);
  let hazard: TerrainCell['hazard'] = 'none';
  let obstacle: TerrainCell['obstacle'] = 'none';
  const sea = world.regions.find((region) => region.biomeId === 'sea')!;
  if (biomeId === 'sea' && p.x > sea.center.x - 24 + 16 * Math.sin(p.z / 100 + c)) hazard = 'deep-water';
  if (biomeId === 'flame' && Math.sin(p.x / 26 + c) + Math.cos(p.z / 30 + d) > 0.35) hazard = 'lava';
  const terrainRoll = randomAt(world.seed, 'obstacle', cellX, cellZ);
  if (terrainRoll < (biomeId === 'forest' ? 0.17 : 0.025)) obstacle = biomeId === 'forest' || biomeId === 'meadow' ? 'tree' : 'rock';
  if (safe || road || entrance) { hazard = 'none'; obstacle = 'none'; }
  if (safe) { biomeId = 'meadow'; secondaryBiome = null; blend = 0; }
  const campBlend = Math.min(1, Math.max(0, (Math.sqrt(distanceSquared(p, world.camp)) - 42) / 30));
  const height = safe ? 0 : campBlend * (2.5 * Math.sin(p.x / 190 + c) + 2 * Math.cos(p.z / 160 + d));
  return { position: p, height, biomeId, regionId: `region-${biomeId}`, traversable: hazard === 'none' && obstacle === 'none', hazard, obstacle, road, secondaryBiome, blend };
}

/** No neighbor or cache lookup: identical cells regardless of load order. */
export function generateChunk(world: WorldDefinition, chunkX: number, chunkZ: number): TerrainChunk {
  const count = GAME_CONFIG.worldSize / GAME_CONFIG.chunkSize;
  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkZ) || chunkX < 0 || chunkZ < 0 || chunkX >= count || chunkZ >= count) throw new RangeError('Chunk dünya sınırları dışında.');
  const cells: TerrainCell[] = [];
  const side = GAME_CONFIG.chunkSize / GAME_CONFIG.cellSize;
  for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
    cells.push(sampleTerrain(world, { x: chunkX * GAME_CONFIG.chunkSize - half + x * GAME_CONFIG.cellSize + 1,
      z: chunkZ * GAME_CONFIG.chunkSize - half + z * GAME_CONFIG.cellSize + 1 }));
  }
  return { id: `${world.seed.length}:${world.seed}:g${world.generatorVersion}:chunk:${chunkX}:${chunkZ}`, chunkX, chunkZ, cells };
}
