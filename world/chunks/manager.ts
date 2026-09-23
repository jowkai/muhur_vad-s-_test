import type { DayPhase, VecXZ } from '../../contracts';
import { GAME_CONFIG } from '../../config';
import type { WorldDefinition } from '../generation/world';
import type { TargetIndex } from '../encounters/targets';
import { chunkAt, residency, shrineInChunk, spawnsForChunk, type ChunkCoord, type ChunkSpawn } from './chunks';
import type { Shrine } from '../shrines/shrines';

export interface ChunkResidency { readonly visual: readonly ChunkCoord[]; readonly simulation: readonly ChunkCoord[] }
export interface ChunkGate {
  /** Durable tombstone: a collected, captured or defeated entity never returns on reload. */
  readonly consumed: (entityId: string) => boolean;
  /** Temporary respawn block (flee/defeat cooldown); the entity returns once it expires. */
  readonly suppressed?: (entityId: string) => boolean;
}
export interface ChunkDelta {
  readonly loaded: readonly string[]; readonly unloaded: readonly string[];
  readonly added: readonly string[]; readonly removed: readonly string[];
}
const EMPTY: ChunkDelta = Object.freeze({ loaded: Object.freeze([]), unloaded: Object.freeze([]), added: Object.freeze([]), removed: Object.freeze([]) });
/**
 * Owns which chunks are resident: {@link GAME_CONFIG.visualChunkRadius} for drawing and the smaller
 * {@link GAME_CONFIG.simulationChunkRadius} for entities. Only simulated chunks put targets in the
 * shared index; the renderer reads `residency.visual` and never decides gameplay presence.
 */
export class ChunkManager {
  private readonly cache = new Map<string, readonly ChunkSpawn[]>();
  private readonly resident = new Map<string, readonly ChunkSpawn[]>();
  private readonly present = new Set<string>();
  private visual: readonly ChunkCoord[] = [];
  private simulation: readonly ChunkCoord[] = [];
  private center: string | null = null;
  private phase: DayPhase = 'day';
  constructor(private readonly world: WorldDefinition, private readonly index: TargetIndex, private readonly gate: ChunkGate) {}

  get residency(): ChunkResidency { return { visual: this.visual, simulation: this.simulation }; }
  get loadedEntityIds(): readonly string[] { return [...this.present].sort(); }
  entities(chunkId: string): readonly ChunkSpawn[] { return this.resident.get(chunkId) ?? []; }
  /** Shrines standing in the drawn chunks; they are landmarks, not consumable entities. */
  get shrines(): readonly Shrine[] {
    return this.visual.flatMap((chunk) => { const shrine = shrineInChunk(this.world, chunk); return shrine ? [shrine] : []; });
  }
  /** Generator record for a resident entity: an egg's species and seed are read here, never rerolled. */
  spawn(entityId: string): ChunkSpawn | null {
    for (const spawns of this.resident.values()) {
      const found = spawns.find((entry) => entry.target.entityId === entityId);
      if (found) return found;
    }
    return null;
  }

  /**
   * Moves the world clock. Day and night answer creature slots differently, so the cache and the
   * resident set are rebuilt once when the phase turns, never every tick.
   */
  setPhase(phase: DayPhase): ChunkDelta {
    if (phase === this.phase) return EMPTY;
    this.phase = phase;
    this.cache.clear();
    for (const chunk of this.simulation) this.resident.set(chunk.id, this.spawns(chunk));
    return this.reconcile([], []);
  }
  get dayPhase(): DayPhase { return this.phase; }

  private spawns(chunk: ChunkCoord): readonly ChunkSpawn[] {
    const cached = this.cache.get(chunk.id);
    if (cached) return cached;
    const generated = spawnsForChunk(this.world, chunk, this.phase);
    // Deterministic generation makes this cache a pure cost saver; eviction cannot change the world.
    if (this.cache.size >= GAME_CONFIG.maxResidentChunks) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(chunk.id, generated);
    return generated;
  }

  /** Call with the committed simulation position. Cheap while the player stays inside one chunk. */
  update(player: VecXZ, force = false): ChunkDelta {
    const middle = chunkAt(player);
    // Gates only change on commit or cooldown expiry, so a same-chunk tick does no entity work.
    if (middle.id === this.center && !force) return EMPTY;
    this.center = middle.id;
    this.visual = residency(player, GAME_CONFIG.visualChunkRadius);
    this.simulation = residency(player, GAME_CONFIG.simulationChunkRadius);
    const wanted = new Set(this.simulation.map((chunk) => chunk.id));
    const unloaded: string[] = [];
    for (const id of [...this.resident.keys()]) {
      if (wanted.has(id)) continue;
      this.resident.delete(id); unloaded.push(id);
    }
    const loaded: string[] = [];
    for (const chunk of this.simulation) {
      if (this.resident.has(chunk.id)) continue;
      this.resident.set(chunk.id, this.spawns(chunk)); loaded.push(chunk.id);
    }
    return this.reconcile(loaded, unloaded);
  }

  /** Re-applies the durable gates; run it after a commit so cooldowns and tombstones take effect. */
  refresh(): ChunkDelta { return this.reconcile([], []); }

  private reconcile(loaded: readonly string[], unloaded: readonly string[]): ChunkDelta {
    const added: string[] = [], removed: string[] = [];
    const live = new Set<string>();
    for (const spawns of this.resident.values()) {
      for (const { target } of spawns) {
        if (this.gate.consumed(target.entityId) || this.gate.suppressed?.(target.entityId)) continue;
        live.add(target.entityId);
        if (this.present.has(target.entityId)) continue;
        this.index.upsert(target); this.present.add(target.entityId); added.push(target.entityId);
      }
    }
    for (const entityId of [...this.present]) {
      if (live.has(entityId)) continue;
      this.index.remove(entityId); this.present.delete(entityId); removed.push(entityId);
    }
    return Object.freeze({ loaded, unloaded, added: added.sort(), removed: removed.sort() });
  }
}
