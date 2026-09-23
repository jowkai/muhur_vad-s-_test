import { BufferAttribute, BufferGeometry } from 'three';
import type { BiomeId, VecXZ } from '../../contracts';
import { GAME_CONFIG } from '../../config';
import type { WorldDefinition } from '../../world/generation/world';
import { hash } from '../../world/generation/random';
import { sampleTerrain, type TerrainCell } from '../../world/terrain/terrain';
import { BIOME_STYLE, type BiomeStyle, type DecorKind } from './biome-style';

export interface DecorPlacement {
  readonly kind: DecorKind; readonly biomeId: BiomeId;
  readonly position: VecXZ; readonly height: number;
  readonly scale: number; readonly rotation: number;
}
export interface ChunkTerrainBuild { readonly geometry: BufferGeometry; readonly decor: readonly DecorPlacement[]; readonly triangles: number }
/** Raw buffers for one chunk: what a worker can compute and transfer without touching three.js. */
export interface ChunkTerrainArrays {
  readonly positions: Float32Array; readonly colors: Float32Array; readonly indices: Uint32Array;
  readonly decor: readonly DecorPlacement[]; readonly triangles: number; readonly step: number;
}
/** Ground resolution: the near ring keeps the 2 m cell, the far ring is built on an 8 m grid. */
export const LOD_NEAR_STEP = GAME_CONFIG.cellSize;
export const LOD_FAR_STEP = 8;
const half = GAME_CONFIG.worldSize / 2;
const side = GAME_CONFIG.chunkSize / GAME_CONFIG.cellSize;
/** Visual-only stream: dressing never draws from the gameplay RNG. */
const visual = (world: WorldDefinition, stream: string, x: number, z: number) => hash(world.seed, `visual-${stream}`, x, z) / 4294967296;
const channels = (color: number) => [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255] as const;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** Deterministic ground texture per biome: each pattern has its own shape, not only its own hue. */
function patternMix(style: BiomeStyle, world: WorldDefinition, x: number, z: number): number {
  const noise = visual(world, 'ground', Math.round(x), Math.round(z));
  switch (style.pattern) {
    case 'grass': return noise * 0.5;
    case 'canopy': return 0.25 + 0.55 * Math.abs(Math.sin(x / 9) * Math.cos(z / 11));
    case 'dune': return 0.5 + 0.5 * Math.sin(x / 7 + Math.sin(z / 23));
    case 'wave': return 0.5 + 0.5 * Math.sin(z / 5.5);
    case 'crack': return Math.abs(Math.sin(x / 6) + Math.cos(z / 7)) > 1.35 ? 1 : 0.1 * noise;
    case 'strata': return (Math.floor((z + half) / 6) % 3) / 2.4;
    case 'basalt': return noise > 0.82 ? 0.9 : 0.15;
    case 'ember': return Math.max(0, Math.sin(x / 4.5) * Math.cos(z / 5.5)) ** 3;
  }
}
function colorAt(world: WorldDefinition, cell: TerrainCell): readonly [number, number, number] {
  const style = BIOME_STYLE[cell.biomeId];
  const t = patternMix(style, world, cell.position.x, cell.position.z);
  const [gr, gg, gb] = channels(style.ground);
  const [ar, ag, ab] = channels(style.accent);
  let rgb: [number, number, number] = [mix(gr, ar, t), mix(gg, ag, t), mix(gb, ab, t)];
  if (cell.secondaryBiome && cell.blend > 0) {
    const [sr, sg, sb] = channels(BIOME_STYLE[cell.secondaryBiome].ground);
    rgb = [mix(rgb[0], sr, cell.blend), mix(rgb[1], sg, cell.blend), mix(rgb[2], sb, cell.blend)];
  }
  if (cell.road) rgb = [mix(rgb[0], 0.68, 0.55), mix(rgb[1], 0.6, 0.55), mix(rgb[2], 0.42, 0.55)];
  if (cell.hazard === 'deep-water') rgb = [0.09, 0.26, 0.42];
  if (cell.hazard === 'lava') rgb = [0.85, 0.32, 0.12];
  return rgb;
}
/**
 * One low-poly mesh per chunk with vertex colours: biome blends, roads and hazards share a single
 * material. Corner samples come straight from the world function, so neighbouring chunks meet
 * seamlessly whatever order they load in.
 */
/**
 * Pure buffers for one chunk at the requested ground resolution. Corner samples always land on
 * exact multiples of the step, so a coarse chunk shares every border vertex with its fine
 * neighbour and the seam has no crack.
 */
export function buildChunkArrays(world: WorldDefinition, chunkX: number, chunkZ: number, step: number = LOD_NEAR_STEP): ChunkTerrainArrays {
  const count = GAME_CONFIG.worldSize / GAME_CONFIG.chunkSize;
  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkZ) || chunkX < 0 || chunkZ < 0 || chunkX >= count || chunkZ >= count) throw new RangeError('Chunk dünya sınırları dışında.');
  if (!Number.isFinite(step) || step < GAME_CONFIG.cellSize || GAME_CONFIG.chunkSize % step !== 0) throw new RangeError('Geçersiz LOD adımı.');
  const originX = chunkX * GAME_CONFIG.chunkSize - half, originZ = chunkZ * GAME_CONFIG.chunkSize - half;
  const span = GAME_CONFIG.chunkSize / step;
  const positions = new Float32Array((span + 1) ** 2 * 3);
  const colors = new Float32Array((span + 1) ** 2 * 3);
  for (let z = 0; z <= span; z++) for (let x = 0; x <= span; x++) {
    const point = { x: Math.min(half - 0.001, originX + x * step), z: Math.min(half - 0.001, originZ + z * step) };
    const cell = sampleTerrain(world, point);
    const index = (z * (span + 1) + x) * 3;
    positions[index] = originX + x * step;
    positions[index + 1] = cell.hazard === 'deep-water' ? Math.min(cell.height, -0.6) : cell.height;
    positions[index + 2] = originZ + z * step;
    const [r, g, b] = colorAt(world, cell);
    colors[index] = r; colors[index + 1] = g; colors[index + 2] = b;
  }
  const indices = new Uint32Array(span * span * 6);
  let cursor = 0;
  for (let z = 0; z < span; z++) for (let x = 0; x < span; x++) {
    const a = z * (span + 1) + x, b = a + 1, c = a + span + 1, d = c + 1;
    indices[cursor++] = a; indices[cursor++] = c; indices[cursor++] = b;
    indices[cursor++] = b; indices[cursor++] = c; indices[cursor++] = d;
  }
  // Far chunks keep their trees and rocks; only the ground grid gets coarser.
  return { positions, colors, indices, decor: collectDecor(world, chunkX, chunkZ), triangles: span * span * 2, step };
}
/** Wraps raw buffers into the geometry the renderer mounts. */
export function geometryFromArrays(arrays: ChunkTerrainArrays): ChunkTerrainBuild {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(arrays.positions, 3));
  geometry.setAttribute('color', new BufferAttribute(arrays.colors, 3));
  geometry.setIndex(new BufferAttribute(arrays.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, decor: arrays.decor, triangles: arrays.triangles };
}
export function buildChunkTerrain(world: WorldDefinition, chunkX: number, chunkZ: number, step: number = LOD_NEAR_STEP): ChunkTerrainBuild {
  return geometryFromArrays(buildChunkArrays(world, chunkX, chunkZ, step));
}
/** Trees and rocks mirror the collision obstacles exactly; shrubs are decoration with no collision. */
export function collectDecor(world: WorldDefinition, chunkX: number, chunkZ: number): readonly DecorPlacement[] {
  const originX = chunkX * GAME_CONFIG.chunkSize - half, originZ = chunkZ * GAME_CONFIG.chunkSize - half;
  const placements: DecorPlacement[] = [];
  for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
    const point = { x: originX + x * GAME_CONFIG.cellSize + 1, z: originZ + z * GAME_CONFIG.cellSize + 1 };
    const cell = sampleTerrain(world, point);
    const style = BIOME_STYLE[cell.biomeId];
    const roll = visual(world, 'decor', point.x, point.z);
    const kind: DecorKind | null = cell.obstacle !== 'none' ? cell.obstacle
      : cell.traversable && !cell.road && roll < 0.05 * style.density ? 'shrub' : null;
    if (!kind) continue;
    placements.push(Object.freeze({
      kind, biomeId: cell.biomeId, position: Object.freeze({ ...cell.position }), height: cell.height,
      scale: 0.75 + visual(world, 'scale', point.x, point.z) * 0.6,
      rotation: visual(world, 'spin', point.x, point.z) * Math.PI * 2,
    }));
  }
  return Object.freeze(placements);
}
