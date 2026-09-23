import type { DecorPlacement } from '../terrain/chunk-terrain';

export interface ChunkRequest {
  readonly id: number; readonly seed: string;
  readonly chunkX: number; readonly chunkZ: number; readonly step: number;
}
export interface ChunkResponse {
  readonly id: number; readonly chunkX: number; readonly chunkZ: number; readonly step: number;
  readonly positions: Float32Array; readonly colors: Float32Array; readonly indices: Uint32Array;
  readonly decor: readonly DecorPlacement[]; readonly triangles: number;
}
export interface ChunkFailure { readonly id: number; readonly error: string }
export type WorkerMessage = ChunkResponse | ChunkFailure;
export const isFailure = (message: WorkerMessage): message is ChunkFailure => 'error' in message;
/** Buffers handed over to the main thread instead of copied. */
export const transferables = (response: ChunkResponse): Transferable[] =>
  [response.positions.buffer, response.colors.buffer, response.indices.buffer];
