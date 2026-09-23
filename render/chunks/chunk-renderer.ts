import {
  ConeGeometry, CylinderGeometry, DodecahedronGeometry, Group, IcosahedronGeometry, InstancedMesh,
  Matrix4, Mesh, MeshStandardMaterial, Object3D, Quaternion, TetrahedronGeometry, Vector3,
  type BufferGeometry,
} from 'three';
import type { BiomeId } from '../../contracts';
import { GAME_CONFIG } from '../../config';
import type { WorldDefinition } from '../../world/generation/world';
import type { ChunkCoord } from '../../world/chunks/chunks';
import { BIOME_STYLE, decorKey, type DecorKind } from '../terrain/biome-style';
import { LOD_FAR_STEP, LOD_NEAR_STEP, buildChunkTerrain, type ChunkTerrainBuild, type DecorPlacement } from '../terrain/chunk-terrain';
import type { ResourceRegistry } from '../resources/registry';

export interface ChunkStats { visible: number; cached: number; resident: number; drawCalls: number; triangles: number; discarded: number; builds: number }
export interface ChunkRendererOptions {
  /** Async build hook; a worker implementation drops in here without changing the token rules. */
  readonly build?: (world: WorldDefinition, chunkX: number, chunkZ: number, step?: number) => Promise<ChunkTerrainBuild>;
  readonly cacheLimit?: number;
  /** Chunks this many rings from the centre keep the fine ground; the rest use the 8 m grid. */
  readonly lodRing?: number;
}
export const DEFAULT_LOD_RING = 1;
/** Ground step for a chunk that many rings away from the player. */
export function lodStepFor(rings: number, ring = DEFAULT_LOD_RING): number {
  return rings <= ring ? LOD_NEAR_STEP : LOD_FAR_STEP;
}
interface ChunkVisual { id: string; group: Group; keys: string[]; triangles: number; drawCalls: number; geometry: BufferGeometry; step: number }
const TERRAIN_MATERIAL = 'terrain:vertex-colors';
function decorGeometry(kind: DecorKind, biomeId: BiomeId): BufferGeometry {
  const style = BIOME_STYLE[biomeId];
  if (kind === 'tree') {
    switch (style.tree.shape) {
      case 'cone': return new ConeGeometry(1.5, 4.4, 6);
      case 'sphere': return new IcosahedronGeometry(1.7, 0);
      case 'column': return new CylinderGeometry(0.9, 1.3, 4.2, 6);
      case 'fan': return new ConeGeometry(1.9, 2.6, 5, 1, true);
    }
  }
  if (kind === 'rock') {
    switch (style.rock.shape) {
      case 'boulder': return new DodecahedronGeometry(0.8, 0);
      case 'shard': return new TetrahedronGeometry(1.1, 0);
      case 'slab': return new CylinderGeometry(1.1, 1.2, 0.7, 6);
    }
  }
  switch (style.shrub.shape) {
    case 'tuft': return new IcosahedronGeometry(0.55, 0);
    case 'coral': return new ConeGeometry(0.5, 1.1, 5, 1, true);
    case 'crystal': return new TetrahedronGeometry(0.6, 0);
    case 'flame': return new ConeGeometry(0.45, 1.3, 4);
  }
}
const triangleCount = (geometry: BufferGeometry) => (geometry.getIndex()?.count ?? geometry.getAttribute('position').count) / 3;
const decorColor = (kind: DecorKind, biomeId: BiomeId) =>
  kind === 'tree' ? BIOME_STYLE[biomeId].tree.crown : kind === 'rock' ? BIOME_STYLE[biomeId].rock.color : BIOME_STYLE[biomeId].shrub.color;
/**
 * Owns what is on screen: one terrain mesh plus instanced decor per chunk, at most 25 visible and
 * {@link ChunkRendererOptions.cacheLimit} cached for hysteresis. Geometry and materials are shared
 * through the registry, and a chunk only frees them when it is evicted, never on `scene.remove`.
 */
export class ChunkRenderer {
  private readonly visible = new Map<string, ChunkVisual>();
  private readonly cache = new Map<string, ChunkVisual>();
  private readonly pending = new Map<string, number>();
  private readonly wanted = new Set<string>();
  private generation = 0;
  private discardedCount = 0;
  private buildCount = 0;
  private disposed = false;
  private readonly cacheLimit: number;
  private readonly build: NonNullable<ChunkRendererOptions['build']>;
  private readonly lodRing: number;
  private readonly steps = new Map<string, number>();
  constructor(private readonly world: WorldDefinition, private readonly scene: Object3D, private readonly registry: ResourceRegistry, options: ChunkRendererOptions = {}) {
    this.cacheLimit = options.cacheLimit ?? GAME_CONFIG.maxResidentChunks - (GAME_CONFIG.visualChunkRadius * 2 + 1) ** 2;
    this.build = options.build ?? ((world, chunkX, chunkZ, step) => Promise.resolve(buildChunkTerrain(world, chunkX, chunkZ, step)));
    this.lodRing = options.lodRing ?? DEFAULT_LOD_RING;
    if (!Number.isInteger(this.cacheLimit) || this.cacheLimit < 0) throw new RangeError('Geçersiz chunk cache sınırı.');
  }
  /** Mounts the given visual window and unmounts the rest; safe to call every frame. */
  async setVisible(chunks: readonly ChunkCoord[], center?: ChunkCoord): Promise<ChunkStats> {
    if (this.disposed) throw new Error('Chunk çizici kapatıldı.');
    const token = ++this.generation;
    this.wanted.clear();
    const middle = center ?? chunks[Math.floor(chunks.length / 2)];
    this.steps.clear();
    for (const chunk of chunks) {
      this.wanted.add(chunk.id);
      const rings = middle ? Math.max(Math.abs(chunk.chunkX - middle.chunkX), Math.abs(chunk.chunkZ - middle.chunkZ)) : 0;
      this.steps.set(chunk.id, lodStepFor(rings, this.lodRing));
    }
    // A chunk that changed resolution is rebuilt instead of being reused at the wrong detail.
    for (const [id, visual] of [...this.visible]) {
      if (!this.wanted.has(id) || visual.step === this.steps.get(id)) continue;
      this.scene.remove(visual.group);
      this.visible.delete(id);
      this.free(visual);
    }
    for (const [id, visual] of [...this.cache]) {
      if (visual.step === this.steps.get(id) || !this.wanted.has(id)) continue;
      this.cache.delete(id);
      this.free(visual);
    }
    for (const [id, visual] of [...this.visible]) {
      if (this.wanted.has(id)) continue;
      this.scene.remove(visual.group);
      this.visible.delete(id);
      this.store(visual);
    }
    const work: Promise<void>[] = [];
    for (const chunk of chunks) {
      if (this.visible.has(chunk.id)) continue;
      const cached = this.cache.get(chunk.id);
      if (cached) { this.cache.delete(chunk.id); this.mount(cached); continue; }
      if (this.pending.has(chunk.id)) continue;
      work.push(this.request(chunk, token));
    }
    await Promise.all(work);
    return this.stats;
  }
  private async request(chunk: ChunkCoord, token: number): Promise<void> {
    this.pending.set(chunk.id, token);
    let built: ChunkTerrainBuild;
    const step = this.steps.get(chunk.id) ?? LOD_NEAR_STEP;
    try { built = await this.build(this.world, chunk.chunkX, chunk.chunkZ, step); }
    finally { this.pending.delete(chunk.id); }
    this.buildCount++;
    // Generation token: a result the player has already walked away from never reaches the scene.
    if (this.disposed || token !== this.generation && !this.wanted.has(chunk.id) || this.visible.has(chunk.id) || this.cache.has(chunk.id)) {
      built.geometry.dispose(); this.discardedCount++; return;
    }
    this.mount(this.assemble(chunk, built, step));
  }
  private assemble(chunk: ChunkCoord, built: ChunkTerrainBuild, step: number): ChunkVisual {
    const group = new Group();
    group.name = `chunk-${chunk.id}`;
    const keys: string[] = [TERRAIN_MATERIAL];
    const material = this.registry.material(TERRAIN_MATERIAL, () => new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
    const ground = new Mesh(built.geometry, material);
    ground.receiveShadow = true;
    group.add(ground);
    let drawCalls = 1;
    let triangles = built.triangles;
    const groups = new Map<string, DecorPlacement[]>();
    for (const placement of built.decor) {
      const key = `${placement.kind}|${placement.biomeId}`;
      const list = groups.get(key) ?? []; list.push(placement); groups.set(key, list);
    }
    for (const [key, placements] of [...groups].sort(([a], [b]) => a < b ? -1 : 1)) {
      const [kind, biomeId] = key.split('|') as [DecorKind, BiomeId];
      const geometryKey = decorKey(kind, biomeId, 'geometry');
      const materialKey = decorKey(kind, biomeId, 'material');
      const geometry = this.registry.geometry(geometryKey, () => decorGeometry(kind, biomeId));
      const surface = this.registry.material(materialKey, () => new MeshStandardMaterial({ color: decorColor(kind, biomeId), roughness: 0.85, flatShading: true }));
      keys.push(geometryKey, materialKey);
      const mesh = new InstancedMesh(geometry, surface, placements.length);
      mesh.name = `${key}-${chunk.id}`;
      mesh.castShadow = kind !== 'shrub';
      const matrix = new Matrix4(), rotation = new Quaternion(), axis = new Vector3(0, 1, 0), scale = new Vector3(), position = new Vector3();
      placements.forEach((placement, index) => {
        rotation.setFromAxisAngle(axis, placement.rotation);
        const lift = kind === 'tree' ? 2.1 * placement.scale : kind === 'rock' ? 0.35 * placement.scale : 0.3 * placement.scale;
        position.set(placement.position.x, placement.height + lift, placement.position.z);
        scale.setScalar(placement.scale);
        mesh.setMatrixAt(index, matrix.compose(position, rotation, scale));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      drawCalls++;
      triangles += triangleCount(geometry) * placements.length;
      if (kind === 'tree') {
        const trunkKey = decorKey(kind, biomeId, 'trunk');
        const trunkGeometry = this.registry.geometry(`${trunkKey}:geometry`, () => new CylinderGeometry(0.16, 0.26, 2.2, 5));
        const trunkMaterial = this.registry.material(trunkKey, () => new MeshStandardMaterial({ color: BIOME_STYLE[biomeId].tree.trunk, roughness: 1, flatShading: true }));
        keys.push(`${trunkKey}:geometry`, trunkKey);
        const trunks = new InstancedMesh(trunkGeometry, trunkMaterial, placements.length);
        trunks.name = `trunk-${biomeId}-${chunk.id}`;
        placements.forEach((placement, index) => {
          rotation.setFromAxisAngle(axis, placement.rotation);
          position.set(placement.position.x, placement.height + 1.1 * placement.scale, placement.position.z);
          scale.setScalar(placement.scale);
          trunks.setMatrixAt(index, matrix.compose(position, rotation, scale));
        });
        trunks.instanceMatrix.needsUpdate = true;
        trunks.computeBoundingSphere();
        group.add(trunks);
        drawCalls++;
        triangles += triangleCount(trunkGeometry) * placements.length;
      }
    }
    return { id: chunk.id, group, keys, triangles, drawCalls, geometry: built.geometry, step };
  }
  private mount(visual: ChunkVisual): void {
    this.visible.set(visual.id, visual);
    this.scene.add(visual.group);
  }
  /** Hysteresis: a chunk just left keeps its resources until the cache evicts it. */
  private store(visual: ChunkVisual): void {
    if (!this.cacheLimit) { this.free(visual); return; }
    this.cache.set(visual.id, visual);
    while (this.cache.size > this.cacheLimit) {
      const oldest = this.cache.keys().next().value!;
      const evicted = this.cache.get(oldest)!;
      this.cache.delete(oldest);
      this.free(evicted);
    }
  }
  private free(visual: ChunkVisual): void {
    visual.group.removeFromParent();
    for (const child of visual.group.children) if (child instanceof InstancedMesh) child.dispose();
    visual.group.clear();
    visual.geometry.dispose();
    for (const key of visual.keys) this.registry.release(key);
  }
  /** Ground step the chunk was built at; the near ring is fine, the rest is coarse. */
  stepOf(chunkId: string): number | null { return this.visible.get(chunkId)?.step ?? this.cache.get(chunkId)?.step ?? null; }
  has(chunkId: string): boolean { return this.visible.has(chunkId); }
  cached(chunkId: string): boolean { return this.cache.has(chunkId); }
  chunkIds(): readonly string[] { return [...this.visible.keys()].sort(); }
  get stats(): ChunkStats {
    let drawCalls = 0, triangles = 0;
    for (const visual of this.visible.values()) { drawCalls += visual.drawCalls; triangles += visual.triangles; }
    return { visible: this.visible.size, cached: this.cache.size, resident: this.visible.size + this.cache.size, drawCalls, triangles, discarded: this.discardedCount, builds: this.buildCount };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const visual of [...this.visible.values(), ...this.cache.values()]) this.free(visual);
    this.visible.clear(); this.cache.clear(); this.wanted.clear();
  }
}