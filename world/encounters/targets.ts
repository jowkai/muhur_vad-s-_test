import { MAX_LEVEL, type NearbyTarget, type VecXZ } from '../../contracts';
import { GAME_CONFIG } from '../../config';
import type { WorldDefinition } from '../generation/world';
import { sampleTerrain } from '../terrain/terrain';

export type WorldTarget = Omit<NearbyTarget, 'distance' | 'interactionAllowed'> & {
  readonly position: VecXZ; readonly aggressive: boolean;
};
const bucketSize = GAME_CONFIG.proximityRadius;
const inBounds = (p: VecXZ) => Number.isFinite(p.x) && Number.isFinite(p.z) && p.x >= -GAME_CONFIG.worldSize / 2 && p.z >= -GAME_CONFIG.worldSize / 2 && p.x < GAME_CONFIG.worldSize / 2 && p.z < GAME_CONFIG.worldSize / 2;
const key = (x: number, z: number) => `${x},${z}`;
const bucket = (p: VecXZ) => key(Math.floor(p.x / bucketSize), Math.floor(p.z / bucketSize));
export const distance = (a: VecXZ, b: VecXZ) => Math.hypot(a.x - b.x, a.z - b.z);
/** Local spatial hash. Query visits only neighboring buckets, never the entire entity map. */
export class TargetIndex {
  private readonly entries = new Map<string, WorldTarget>();
  private readonly buckets = new Map<string, Set<string>>();
  upsert(target: WorldTarget): void {
    if (!target.entityId.trim() || !inBounds(target.position) ||
      !Number.isInteger(target.level) || target.level < 0 || target.level > MAX_LEVEL ||
      !['egg', 'creature', 'resource'].includes(target.kind) || (target.aggressive && target.kind !== 'creature')) throw new RangeError('Geçersiz dünya hedefi.');
    this.remove(target.entityId);
    const copy = Object.freeze({ ...target, position: Object.freeze({ ...target.position }) });
    this.entries.set(target.entityId, copy);
    const cell = bucket(copy.position), ids = this.buckets.get(cell) ?? new Set<string>();
    ids.add(copy.entityId); this.buckets.set(cell, ids);
  }
  /** The entry as it stands now, including a patrol that has walked away from its home. */
  get(id: string): WorldTarget | undefined { return this.entries.get(id); }
  remove(id: string): void {
    const old = this.entries.get(id); if (!old) return;
    const cell = bucket(old.position), ids = this.buckets.get(cell)!;
    ids.delete(id); if (!ids.size) this.buckets.delete(cell);
    this.entries.delete(id);
  }
  query(position: VecXZ, radius: number = GAME_CONFIG.proximityRadius): readonly WorldTarget[] {
    if (!inBounds(position) || !Number.isFinite(radius) || radius < 0 || radius > bucketSize) throw new RangeError('Geçersiz yakınlık sorgusu.');
    const result: WorldTarget[] = [];
    for (let z = Math.floor((position.z - radius) / bucketSize); z <= Math.floor((position.z + radius) / bucketSize); z++) {
      for (let x = Math.floor((position.x - radius) / bucketSize); x <= Math.floor((position.x + radius) / bucketSize); x++) {
        for (const id of this.buckets.get(key(x, z)) ?? []) {
          const target = this.entries.get(id)!; if (distance(position, target.position) <= radius) result.push(target);
        }
      }
    }
    return result;
  }
}
/** Conservative segment/AABB test: solid corners and cell edges also occlude. */
export function hasLineOfSight(world: WorldDefinition, from: VecXZ, to: VecXZ): boolean {
  if (!inBounds(from) || !inBounds(to) || distance(from, to) > GAME_CONFIG.proximityRadius) return false;
  const size = GAME_CONFIG.cellSize, half = GAME_CONFIG.worldSize / 2;
  const minX = Math.floor((Math.min(from.x, to.x) + half) / size) - 1;
  const maxX = Math.floor((Math.max(from.x, to.x) + half) / size);
  const minZ = Math.floor((Math.min(from.z, to.z) + half) / size) - 1;
  const maxZ = Math.floor((Math.max(from.z, to.z) + half) / size);
  for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
    const left = x * size - half, top = z * size - half;
    let lo = 0, hi = 1;
    for (const [origin, delta, min, max] of [[from.x, to.x - from.x, left, left + size], [from.z, to.z - from.z, top, top + size]]) {
      if (delta === 0) { if (origin < min || origin > max) { hi = -1; break; } }
      else { const a = (min - origin) / delta, b = (max - origin) / delta; lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b)); }
    }
    if (lo <= hi && !sampleTerrain(world, { x: left + size / 2, z: top + size / 2 }).traversable) return false;
  }
  return true;
}
export function selectNearby(world: WorldDefinition, index: TargetIndex, player: VecXZ, previous: NearbyTarget | null, eligible: (id: string) => boolean = () => true, reach: number = GAME_CONFIG.proximityRadius): NearbyTarget | null {
  // `reach` is how far the world notices the player; the night halves it.
  const candidates = index.query(player, Math.min(GAME_CONFIG.proximityRadius, reach)).map((target) => {
    const range = distance(player, target.position);
    const held = previous?.entityId === target.entityId && previous.interactionAllowed;
    const { position: _position, aggressive: _aggressive, ...data } = target;
    // Keep the geometric data out of the shared UI contract.
    void _position; void _aggressive;
    return { ...data, distance: range, interactionAllowed: eligible(target.entityId) && range <= (held ? 8 : GAME_CONFIG.interactionRadius) && hasLineOfSight(world, player, target.position) };
  });
  const retained = candidates.find((candidate) => candidate.entityId === previous?.entityId && candidate.interactionAllowed && previous.interactionAllowed);
  if (retained) return retained;
  candidates.sort((a, b) => Number(b.interactionAllowed) - Number(a.interactionAllowed) || a.distance - b.distance || (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));
  return candidates[0] ?? null;
}
