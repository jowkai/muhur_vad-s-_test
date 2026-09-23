/// <reference lib="webworker" />
import { createWorld } from '../../world/generation/world';
import { buildChunkArrays } from '../terrain/chunk-terrain';
import { transferables, type ChunkRequest, type ChunkResponse } from './protocol';

/**
 * Terrain and decor for one chunk, off the main thread. The worker holds no state beyond the
 * world definition it rebuilds from the seed, so a message can never be answered with stale data.
 */
const worlds = new Map<string, ReturnType<typeof createWorld>>();
const worldFor = (seed: string) => {
  const cached = worlds.get(seed);
  if (cached) return cached;
  const built = createWorld(seed);
  worlds.set(seed, built);
  return built;
};
self.addEventListener('message', (event: MessageEvent<ChunkRequest>) => {
  const request = event.data;
  try {
    const arrays = buildChunkArrays(worldFor(request.seed), request.chunkX, request.chunkZ, request.step);
    const response: ChunkResponse = {
      id: request.id, chunkX: request.chunkX, chunkZ: request.chunkZ, step: arrays.step,
      positions: arrays.positions, colors: arrays.colors, indices: arrays.indices,
      decor: arrays.decor, triangles: arrays.triangles,
    };
    (self as unknown as Worker).postMessage(response, transferables(response));
  } catch (error) {
    (self as unknown as Worker).postMessage({ id: request.id, error: error instanceof Error ? error.message : 'chunk üretilemedi' });
  }
});
