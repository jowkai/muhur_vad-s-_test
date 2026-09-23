import type { GameMode, VecXZ } from '../../contracts';
import { GAME_CONFIG } from '../../config';
const side = GAME_CONFIG.worldSize / GAME_CONFIG.cellSize;
const half = GAME_CONFIG.worldSize / 2;
function cellId(position: VecXZ): number | null {
  if (![position.x, position.z].every(Number.isFinite) || position.x < -half || position.z < -half || position.x >= half || position.z >= half) return null;
  return Math.floor((position.z + half) / GAME_CONFIG.cellSize) * side + Math.floor((position.x + half) / GAME_CONFIG.cellSize);
}
/** Compact simulation-owned discovery; serialization is handed to the W04 save adapter. */
export class Discovery {
  private readonly cells = new Set<number>();
  constructor(savedCells: readonly number[] = []) {
    for (const cell of savedCells) {
      if (!Number.isSafeInteger(cell) || cell < 0 || cell >= side * side) throw new RangeError('Geçersiz keşif hücresi.');
      this.cells.add(cell);
    }
  }
  has(position: VecXZ): boolean { const id = cellId(position); return id !== null && this.cells.has(id); }
  reveal(position: VecXZ, mode: GameMode, paused = false): void {
    if (mode !== 'exploring' || paused) return;
    if (cellId(position) === null) throw new RangeError('Geçersiz keşif konumu.');
    const radius = GAME_CONFIG.proximityRadius, size = GAME_CONFIG.cellSize;
    const minX = Math.max(0, Math.floor((position.x - radius + half) / size));
    const maxX = Math.min(side - 1, Math.floor((position.x + radius + half) / size));
    const minZ = Math.max(0, Math.floor((position.z - radius + half) / size));
    const maxZ = Math.min(side - 1, Math.floor((position.z + radius + half) / size));
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      if (Math.hypot(x * size - half + size / 2 - position.x, z * size - half + size / 2 - position.z) <= radius) this.cells.add(z * side + x);
    }
  }
  /** O(1) change signal for readers that must not sort the whole set every frame. */
  get size(): number { return this.cells.size; }
  serialize(): number[] { return [...this.cells].sort((a, b) => a - b); }
}
