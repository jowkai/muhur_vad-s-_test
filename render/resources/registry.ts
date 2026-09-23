import type { BufferGeometry, Material, Texture } from 'three';

export type Disposable = BufferGeometry | Material | Texture;
export type ResourceKind = 'geometry' | 'material' | 'texture';
interface Entry { kind: ResourceKind; value: Disposable; refs: number }
export interface ResourceCounts { geometry: number; material: number; texture: number; references: number }
/**
 * Single owner of shared GPU resources. Callers acquire by key and release by key; a resource is
 * disposed only when its last reference goes away, so `scene.remove` is never mistaken for a free.
 */
export class ResourceRegistry {
  private readonly entries = new Map<string, Entry>();
  private disposedCount = 0;

  private acquire<T extends Disposable>(kind: ResourceKind, key: string, create: () => T): T {
    if (!key.trim()) throw new RangeError('Kaynak anahtarı boş olamaz.');
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.kind !== kind) throw new RangeError(`Kaynak türü çakışıyor: ${key}`);
      existing.refs++;
      return existing.value as T;
    }
    const value = create();
    this.entries.set(key, { kind, value, refs: 1 });
    return value;
  }
  geometry<T extends BufferGeometry>(key: string, create: () => T): T { return this.acquire('geometry', key, create); }
  material<T extends Material>(key: string, create: () => T): T { return this.acquire('material', key, create); }
  texture<T extends Texture>(key: string, create: () => T): T { return this.acquire('texture', key, create); }

  /** Drops one reference; the final release disposes the resource and forgets the key. */
  release(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (--entry.refs > 0) return false;
    entry.value.dispose();
    this.entries.delete(key);
    this.disposedCount++;
    return true;
  }
  references(key: string): number { return this.entries.get(key)?.refs ?? 0; }
  counts(): ResourceCounts {
    const counts: ResourceCounts = { geometry: 0, material: 0, texture: 0, references: 0 };
    for (const entry of this.entries.values()) { counts[entry.kind]++; counts.references += entry.refs; }
    return counts;
  }
  get disposed(): number { return this.disposedCount; }
  get size(): number { return this.entries.size; }
  /** Final teardown: every tracked resource is disposed regardless of remaining references. */
  disposeAll(): void {
    for (const entry of this.entries.values()) { entry.value.dispose(); this.disposedCount++; }
    this.entries.clear();
  }
}
