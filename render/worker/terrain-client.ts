import type { WorldDefinition } from '../../world/generation/world';
import { LOD_NEAR_STEP, buildChunkTerrain, geometryFromArrays, type ChunkTerrainBuild } from '../terrain/chunk-terrain';
import { isFailure, type ChunkRequest, type WorkerMessage } from './protocol';

export type ChunkBuild = (world: WorldDefinition, chunkX: number, chunkZ: number, step?: number) => Promise<ChunkTerrainBuild>;
export interface TerrainWorkerOptions {
  /** Injected in tests; the browser build creates the module worker from this file's sibling. */
  readonly factory?: () => Worker;
  readonly timeoutMs?: number;
}
/** Builds on the main thread; the fallback whenever a worker is unavailable or fails. */
export const synchronousBuild: ChunkBuild = (world, chunkX, chunkZ, step) =>
  Promise.resolve(buildChunkTerrain(world, chunkX, chunkZ, step));

export interface TerrainWorkerClient { readonly build: ChunkBuild; readonly usingWorker: boolean; dispose(): void }
/**
 * Wraps the worker in the same `build` shape the chunk renderer already expects, so the
 * generation-token rule is untouched: a late answer is still discarded by the renderer. If the
 * worker cannot start, or answers with an error, the client falls back to synchronous building
 * for good and the game keeps running.
 */
function startWorker(options: TerrainWorkerOptions): Worker | null {
  try {
    if (options.factory) return options.factory();
    if (typeof Worker === 'undefined') return null;
    return new Worker(new URL('./terrain-worker.ts', import.meta.url), { type: 'module' });
  } catch { return null; }
}
export function createTerrainWorker(options: TerrainWorkerOptions = {}): TerrainWorkerClient {
  const worker = startWorker(options);
  if (!worker) return { build: synchronousBuild, usingWorker: false, dispose() { /* nothing to close */ } };
  const live = worker;
  const pending = new Map<number, { resolve: (build: ChunkTerrainBuild) => void; reject: (error: Error) => void }>();
  let nextId = 1;
  let broken = false;
  const fail = (error: Error) => {
    broken = true;
    for (const [, entry] of pending) entry.reject(error);
    pending.clear();
  };
  live.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (isFailure(message)) { entry.reject(new Error(message.error)); return; }
    entry.resolve(geometryFromArrays({
      positions: message.positions, colors: message.colors, indices: message.indices,
      decor: message.decor, triangles: message.triangles, step: message.step,
    }));
  });
  live.addEventListener('error', () => fail(new Error('Chunk worker durdu')));
  const build: ChunkBuild = (world, chunkX, chunkZ, step) => {
    if (broken) return synchronousBuild(world, chunkX, chunkZ, step);
    const id = nextId++;
    const request: ChunkRequest = { id, seed: world.seed, chunkX, chunkZ, step: step ?? LOD_NEAR_STEP };
    return new Promise<ChunkTerrainBuild>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try { live.postMessage(request); } catch (error) { pending.delete(id); reject(error instanceof Error ? error : new Error('worker mesajı gönderilemedi')); }
    }).catch(() => synchronousBuild(world, chunkX, chunkZ, step));
  };
  return {
    build, usingWorker: true,
    dispose() { fail(new Error('kapandı')); live.terminate(); },
  };
}
