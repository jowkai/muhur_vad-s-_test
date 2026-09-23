import type { BiomeId, VecXZ } from '../../contracts';
import { GAME_CONFIG } from '../../config';
import type { Discovery } from '../../world/discovery/discovery';
import type { TargetIndex } from '../../world/encounters/targets';
import { minimapMarkers, worldToMinimap } from '../../world/minimap-data';
import { biomeLabel } from '../hud/labels';

export const MINIMAP_RADIUS_METRES = 96;
export const MINIMAP_SAFE_MARGIN = 16;
export type MarkerShape = 'triangle' | 'oval' | 'claw' | 'hostile-claw' | 'diamond' | 'star';
export interface MinimapViewport { readonly size: number; readonly center: number; readonly radius: number; readonly scale: number; readonly margin: number }
export interface MinimapMarker {
  readonly entityId: string; readonly shape: MarkerShape; readonly x: number; readonly y: number;
  readonly selected: boolean; readonly label: string; readonly distance: number;
}
export interface MinimapView {
  readonly viewport: MinimapViewport; readonly player: { readonly x: number; readonly y: number; readonly yaw: number };
  readonly northAngle: 0; readonly biome: { readonly id: BiomeId; readonly label: string };
  readonly markers: readonly MinimapMarker[]; readonly selectedLabel: string | null;
}
/** 192 CSS px, or 144 on the narrow layout; both keep a 16 px safe margin from the corner. */
export function minimapViewport(viewportWidth: number): MinimapViewport {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) throw new RangeError('Geçersiz ekran genişliği.');
  const size = viewportWidth < 1280 ? 144 : 192;
  return Object.freeze({ size, center: size / 2, radius: size / 2, scale: size / (2 * MINIMAP_RADIUS_METRES), margin: MINIMAP_SAFE_MARGIN });
}
const SHAPES: Record<string, MarkerShape> = { egg: 'oval', creature: 'claw', resource: 'diamond' };
/** World→map projection; north stays up and the player triangle keeps the facing arrow. */
export function project(position: VecXZ, player: VecXZ, viewport: MinimapViewport): { x: number; y: number; visible: boolean } {
  return worldToMinimap(position, player, viewport.size, MINIMAP_RADIUS_METRES);
}
export function buildMinimap(options: {
  index: TargetIndex; discovery: Discovery; player: VecXZ; yaw: number;
  biomeId: BiomeId; selectedId?: string | null; viewportWidth: number; secrets?: readonly VecXZ[];
}): MinimapView {
  const viewport = minimapViewport(options.viewportWidth);
  const markers: MinimapMarker[] = [];
  for (const marker of minimapMarkers(options.index, options.discovery, options.player, options.selectedId ?? null, viewport.size)) {
    const offset = Math.hypot(marker.x - viewport.center, marker.y - viewport.center);
    // Hard clip: nothing is drawn outside the dial, however far the detection radius reaches.
    if (offset > viewport.radius) continue;
    const entry = options.index.query(options.player, GAME_CONFIG.proximityRadius).find((target) => target.entityId === marker.entityId)!;
    markers.push(Object.freeze({
      entityId: marker.entityId, shape: marker.aggressive ? 'hostile-claw' : SHAPES[marker.kind],
      x: marker.x, y: marker.y, selected: marker.selected, label: entry.name,
      distance: Math.hypot(entry.position.x - options.player.x, entry.position.z - options.player.z),
    }));
  }
  for (const secret of options.secrets ?? []) {
    if (!options.discovery.has(secret)) continue;
    const point = project(secret, options.player, viewport);
    if (!point.visible) continue;
    markers.push(Object.freeze({ entityId: `secret:${secret.x},${secret.z}`, shape: 'star', x: point.x, y: point.y, selected: false, label: 'Keşfedilen sır', distance: Math.hypot(secret.x - options.player.x, secret.z - options.player.z) }));
  }
  markers.sort((a, b) => a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0);
  return Object.freeze({
    viewport, player: Object.freeze({ x: viewport.center, y: viewport.center, yaw: options.yaw }),
    northAngle: 0, biome: Object.freeze({ id: options.biomeId, label: biomeLabel(options.biomeId) }),
    markers: Object.freeze(markers),
    selectedLabel: markers.find((marker) => marker.selected)?.label ?? null,
  });
}
