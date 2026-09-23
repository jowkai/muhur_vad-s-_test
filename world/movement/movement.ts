import type { GameCommand, GameState, VecXZ } from '../../contracts';
import { GAME_CONFIG } from '../../config';
import type { WorldDefinition } from '../generation/world';
import { canOccupy, type TravelPasses } from '../collision/collision';

export const PLAYER_SPEED = 6;
export interface MovementState { readonly position: VecXZ; readonly yaw: number; readonly lastSafePosition: VecXZ }
export function spawnPlayer(world: WorldDefinition): MovementState {
  if (!canOccupy(world, world.camp)) throw new Error('Başlangıç konumu yürünebilir değil.');
  return { position: { ...world.camp }, yaw: 0, lastSafePosition: { ...world.camp } };
}
/** Exactly one 1/60s domain step. Never reads keyboard state, renderer meshes or wall time. */
export interface MovementOptions {
  /** Walking speed multiplier from a mount and any tonic; one is plain walking. */
  readonly speed?: number;
  /** What the current mount lets the player cross. */
  readonly passes?: TravelPasses;
}
export function stepMovement(world: WorldDefinition, state: MovementState, command: GameCommand | null, gameState: GameState, paused = false, options: MovementOptions = {}): MovementState {
  if (![state.position.x, state.position.z, state.yaw, state.lastSafePosition.x, state.lastSafePosition.z].every(Number.isFinite)) throw new RangeError('Geçersiz oyuncu durumu.');
  if (paused || gameState.mode !== 'exploring' || command?.type !== 'move') return state;
  const { x, z } = command.direction;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return state;
  const length = Math.hypot(x, z);
  if (!length || !Number.isFinite(length)) return state;
  const passes = options.passes ?? {};
  const speed = Number.isFinite(options.speed) && (options.speed ?? 1) > 0 ? Math.min(3, options.speed!) : 1;
  if (!canOccupy(world, state.position, undefined, passes)) throw new RangeError('Oyuncu katı arazi içinde.');
  const scale = PLAYER_SPEED * speed * GAME_CONFIG.fixedStep / Math.max(1, length);
  const dx = x * scale, dz = z * scale;
  let position = { x: state.position.x + dx, z: state.position.z + dz };
  if (!canOccupy(world, position, undefined, passes)) {
    // Resolve each axis against the full circle so sliding cannot cut solid corners.
    position = { ...state.position };
    const alongX = { x: position.x + dx, z: position.z };
    if (canOccupy(world, alongX, undefined, passes)) position = alongX;
    const alongZ = { x: position.x, z: position.z + dz };
    if (canOccupy(world, alongZ, undefined, passes)) position = alongZ;
  }
  // The last safe spot is somewhere the player could stand without the mount.
  const grounded = canOccupy(world, position) ? { ...position } : { ...state.lastSafePosition };
  return { position, yaw: Math.atan2(x === 0 ? 0 : -x, z === 0 ? 0 : -z), lastSafePosition: grounded };
}
