import { BufferAttribute, DoubleSide, Group, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, type Texture } from 'three';
import type { ResourceRegistry } from '../resources/registry';
import { ATLAS_FRAMES, frameFor, frameRect, stageScale, type AtlasLayout } from '../atlas/layout';
import { interpolateEntity, type RenderEntity, type WorldFrame } from './frame';

export interface EntityLayerOptions {
  /** Supplied by the integrator in the browser; SVG rasterisation is not a render-layer concern. */
  readonly texture?: (visualId: string) => Texture | null;
  readonly size?: (entity: RenderEntity) => number;
  /** One texture and one layout for every sprite: the whole layer then needs a single material. */
  readonly atlas?: { readonly texture: Texture; readonly layout: AtlasLayout };
  readonly reducedMotion?: () => boolean;
}
export const ATLAS_MATERIAL = 'entity:atlas';
export interface EntitySync { readonly added: readonly string[]; readonly removed: readonly string[] }
const PLANE = 'entity:plane';
const TINT: Record<RenderEntity['kind'], number> = { player: 0xf2e2b8, creature: 0xdff0d0, egg: 0xf6e7c8, resource: 0xcfe0ef };
/**
 * One billboard proxy per entity id, keyed by id rather than index, so removing a creature never
 * reshuffles the others. Materials are shared per visual id through the refcounting registry.
 */
export class EntityLayer {
  readonly group = new Group();
  private readonly proxies = new Map<string, { mesh: Mesh; materialKey: string; visualId: string; geometryKey: string; frame: number }>();
  private previous: WorldFrame | null = null;
  private disposed = false;
  constructor(scene: Object3D, private readonly registry: ResourceRegistry, private readonly options: EntityLayerOptions = {}) {
    this.group.name = 'entities';
    scene.add(this.group);
  }
  /** Adds and removes proxies to match the frame; positions come from {@link draw}. */
  sync(frame: WorldFrame): EntitySync {
    if (this.disposed) throw new Error('Varlık katmanı kapatıldı.');
    const live = new Set(frame.entities.map((entity) => entity.id));
    const added: string[] = [], removed: string[] = [];
    for (const [id, proxy] of [...this.proxies]) {
      if (live.has(id)) continue;
      proxy.mesh.removeFromParent();
      this.registry.release(proxy.materialKey);
      this.registry.release(proxy.geometryKey);
      this.proxies.delete(id);
      removed.push(id);
    }
    for (const entity of frame.entities) {
      if (this.proxies.has(entity.id)) continue;
      const atlas = this.atlasCell(entity.visualId) ? this.options.atlas : undefined;
      const materialKey = atlas ? ATLAS_MATERIAL : `entity:${entity.visualId}`;
      const geometryKey = atlas ? this.geometryKey(entity.visualId, 0) : PLANE;
      const geometry = this.registry.geometry(geometryKey, () => atlas ? this.framedPlane(entity.visualId, 0) : new PlaneGeometry(1, 1));
      const material = this.registry.material(materialKey, () => {
        const map = atlas ? atlas.texture : this.options.texture?.(entity.visualId) ?? null;
        return new MeshBasicMaterial({
          map, color: map && !atlas ? 0xffffff : atlas ? 0xffffff : TINT[entity.kind],
          transparent: true, side: DoubleSide, depthWrite: false,
        });
      });
      const mesh = new Mesh(geometry, material);
      mesh.name = `entity-${entity.id}`;
      const size = this.options.size?.(entity) ?? (entity.kind === 'resource' ? 0.9 : entity.kind === 'egg' ? 1.1 : 1.6);
      // A trained creature is visibly bigger; the plane and the material stay exactly the same.
      mesh.scale.setScalar(size * (entity.kind === 'creature' || entity.kind === 'player' ? stageScale(entity.stage ?? 0) : 1));
      this.group.add(mesh);
      this.proxies.set(entity.id, { mesh, materialKey, visualId: entity.visualId, geometryKey, frame: 0 });
      added.push(entity.id);
    }
    return { added: added.sort(), removed: removed.sort() };
  }
  private atlasCell(visualId: string) { return this.options.atlas?.layout.cells.get(visualId) ?? null; }
  private geometryKey(visualId: string, frame: number) { return `entity:uv:${visualId}:${frame}`; }
  /** A plane whose UVs point at one frame of the atlas; three of them animate one sprite. */
  private framedPlane(visualId: string, frame: number): PlaneGeometry {
    const geometry = new PlaneGeometry(1, 1);
    const rect = frameRect(this.options.atlas!.layout, visualId, frame);
    if (rect) {
      geometry.setAttribute('uv', new BufferAttribute(new Float32Array([
        rect.u0, rect.v1, rect.u1, rect.v1, rect.u0, rect.v0, rect.u1, rect.v0,
      ]), 2));
    }
    return geometry;
  }
  /** Interpolates between the two simulation snapshots; drawing never writes back to the domain. */
  draw(current: WorldFrame, alpha: number, cameraYaw = 0): void {
    const previousById = new Map((this.previous?.entities ?? []).map((entity) => [entity.id, entity]));
    const reducedMotion = this.options.reducedMotion?.() ?? false;
    for (const entity of current.entities) {
      const proxy = this.proxies.get(entity.id);
      if (!proxy) continue;
      const view = interpolateEntity(previousById.get(entity.id), entity, alpha);
      proxy.mesh.position.set(view.position.x, view.height + proxy.mesh.scale.y / 2, view.position.z);
      proxy.mesh.rotation.set(0, cameraYaw, 0);
      if (!this.options.atlas || !this.atlasCell(entity.visualId)) continue;
      // Animation is a geometry swap between three prepared frames: no per-frame buffer writes.
      const wanted = frameFor(current.tick, { reducedMotion, hit: entity.hit });
      if (wanted === proxy.frame) continue;
      const key = this.geometryKey(entity.visualId, wanted);
      const geometry = this.registry.geometry(key, () => this.framedPlane(entity.visualId, wanted));
      this.registry.release(proxy.geometryKey);
      proxy.mesh.geometry = geometry;
      proxy.geometryKey = key;
      proxy.frame = wanted;
    }
    this.previous = current;
  }
  /** How many distinct materials the layer holds: one per atlas, or one per sprite without it. */
  get materialKeys(): readonly string[] { return [...new Set([...this.proxies.values()].map((proxy) => proxy.materialKey))].sort(); }
  get frames(): number { return ATLAS_FRAMES; }
  get size(): number { return this.proxies.size; }
  ids(): readonly string[] { return [...this.proxies.keys()].sort(); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [, proxy] of this.proxies) {
      proxy.mesh.removeFromParent();
      this.registry.release(proxy.materialKey);
      this.registry.release(proxy.geometryKey);
    }
    this.proxies.clear();
    this.group.removeFromParent();
    this.previous = null;
  }
}
