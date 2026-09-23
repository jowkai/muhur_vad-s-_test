import type { VecXZ } from '../contracts';
import { GAME_CONFIG } from '../config';
import { Discovery } from './discovery/discovery';
import { TargetIndex } from './encounters/targets';

export function worldToMinimap(position: VecXZ, player: VecXZ, size = 192, radius = 96) {
  if (![position.x, position.z, player.x, player.z, size, radius].every(Number.isFinite) || size <= 0 || radius <= 0) throw new RangeError('Geçersiz minimap parametresi.');
  const dx = position.x - player.x, dz = position.z - player.z;
  return { x: size / 2 + dx * size / (2 * radius), y: size / 2 + dz * size / (2 * radius), visible: Math.hypot(dx, dz) <= radius };
}
export function minimapToWorld(point: { x: number; y: number }, player: VecXZ, size = 192, radius = 96): VecXZ {
  worldToMinimap({ x: point.x, z: point.y }, player, size, radius);
  return { x: player.x + (point.x - size / 2) * (2 * radius) / size, z: player.z + (point.y - size / 2) * (2 * radius) / size };
}
export function minimapMarkers(index: TargetIndex, discovery: Discovery, player: VecXZ, selectedId: string | null = null, size = 192) {
  // Perception and discovery are both required; a previously explored distant target stays hidden.
  return index.query(player, GAME_CONFIG.proximityRadius).filter((target) => discovery.has(target.position)).map((target) => ({
    entityId: target.entityId, kind: target.kind, aggressive: target.aggressive,
    selected: target.entityId === selectedId, ...worldToMinimap(target.position, player, size),
  })).filter((marker) => marker.visible).sort((a, b) => a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0);
}
