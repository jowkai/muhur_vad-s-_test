import type { VecXZ } from '../../contracts';

export type EntityVisualKind = 'player' | 'creature' | 'egg' | 'resource';
/**
 * Read-only view of one entity for drawing. Meshes are never the source of gameplay state, and an
 * id survives chunk unload, so the same creature keeps its proxy when it comes back into view.
 *
 * Dependency note: RENDER.md places these two types in src/contracts, but G01 did not define them
 * and contracts is outside this node's scope. They live here until the integrator lifts them.
 */
export interface RenderEntity {
  readonly id: string; readonly position: VecXZ; readonly height: number;
  readonly yaw: number; readonly visualId: string; readonly kind: EntityVisualKind;
  /** Cosmetic growth stage (0–2) from progression; the renderer draws it as a bigger silhouette. */
  readonly stage?: number;
  /** Set on the tick a creature is struck, so the sprite can snap to its strike frame. */
  readonly hit?: boolean;
}
export interface WorldFrame {
  readonly tick: number; readonly playerId: string;
  readonly entities: readonly RenderEntity[]; readonly visibleChunkIds: readonly string[];
}
export const EMPTY_FRAME: WorldFrame = Object.freeze({ tick: 0, playerId: '', entities: Object.freeze([]), visibleChunkIds: Object.freeze([]) });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame interpolation for drawing only; `alpha` outside 0..1 is clamped instead of extrapolated. */
export function interpolateEntity(previous: RenderEntity | undefined, current: RenderEntity, alpha: number): RenderEntity {
  if (!Number.isFinite(alpha)) throw new RangeError('Geçersiz interpolasyon oranı.');
  const t = Math.min(1, Math.max(0, alpha));
  if (!previous || previous.id !== current.id) return current;
  let turn = current.yaw - previous.yaw;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  return {
    ...current,
    position: { x: lerp(previous.position.x, current.position.x, t), z: lerp(previous.position.z, current.position.z, t) },
    height: lerp(previous.height, current.height, t),
    yaw: previous.yaw + turn * t,
  };
}
