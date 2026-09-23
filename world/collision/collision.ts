import type { VecXZ } from '../../contracts';
import { GAME_CONFIG } from '../../config';
import type { WorldDefinition } from '../generation/world';
import { sampleTerrain } from '../terrain/terrain';

export const PLAYER_RADIUS = 0.4;
/** What a mount lets the player ignore. Walking on foot passes none of these. */
export interface TravelPasses { readonly fly?: boolean; readonly swim?: boolean }
/** Circle versus solid terrain-cell AABBs; samples the whole body, not just its center. */
export function canOccupy(world: WorldDefinition, position: VecXZ, radius = PLAYER_RADIUS, passes: TravelPasses = {}): boolean {
  if (![position.x, position.z, radius].every(Number.isFinite) || radius <= 0) return false;
  const half = GAME_CONFIG.worldSize / 2, size = GAME_CONFIG.cellSize;
  if (position.x - radius < -half || position.z - radius < -half || position.x + radius > half || position.z + radius > half) return false;
  const minX = Math.floor((position.x - radius + half) / size), maxX = Math.floor((position.x + radius + half) / size);
  const minZ = Math.floor((position.z - radius + half) / size), maxZ = Math.floor((position.z + radius + half) / size);
  for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
    const left = x * size - half, top = z * size - half;
    const nearestX = Math.max(left, Math.min(left + size, position.x));
    const nearestZ = Math.max(top, Math.min(top + size, position.z));
    if ((nearestX - position.x) ** 2 + (nearestZ - position.z) ** 2 >= radius ** 2 - 1e-12) continue;
    const cell = sampleTerrain(world, { x: left + size / 2, z: top + size / 2 });
    if (cell.traversable) continue;
    // Flight clears trees, rocks and water; swimming clears deep water only; nothing clears the edge.
    if (cell.hazard === 'boundary') return false;
    if (passes.fly && cell.hazard !== 'lava') continue;
    if (passes.swim && cell.hazard === 'deep-water') continue;
    return false;
  }
  return true;
}
