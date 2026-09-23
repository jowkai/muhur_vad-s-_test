import type { GameCommand, InputOwner, VecXZ } from '../../contracts';

export const STICK_RADIUS = 56;
export const STICK_DEAD_ZONE = 0.18;
export interface StickReading { readonly active: boolean; readonly direction: VecXZ; readonly knob: VecXZ }
export const STICK_REST: StickReading = Object.freeze({
  active: false, direction: Object.freeze({ x: 0, z: 0 }), knob: Object.freeze({ x: 0, z: 0 }),
});
/**
 * Where the thumb is, as a direction the movement domain understands. The vector is clamped to
 * the pad, a small dead zone keeps a resting thumb still, and the length never exceeds one, so
 * touch can never outrun the keyboard.
 */
export function readStick(origin: VecXZ, point: VecXZ, radius = STICK_RADIUS): StickReading {
  const dx = point.x - origin.x, dz = point.z - origin.z;
  const distance = Math.hypot(dx, dz);
  if (!Number.isFinite(distance) || distance <= radius * STICK_DEAD_ZONE) return STICK_REST;
  const clamped = Math.min(1, distance / radius);
  const nx = dx / distance, nz = dz / distance;
  return Object.freeze({
    active: true,
    direction: Object.freeze({ x: nx * clamped, z: nz * clamped }),
    knob: Object.freeze({ x: nx * clamped * radius, z: nz * clamped * radius }),
  });
}
/**
 * One pointer at a time. Whichever pointer grabs the pad owns it until it lifts, so a mouse and
 * a finger on the same screen can never drive the player twice in one frame.
 */
export class VirtualStick {
  private pointerId: number | null = null;
  private origin: VecXZ = { x: 0, z: 0 };
  private reading: StickReading = STICK_REST;
  private sequence = 0;
  private owner: InputOwner = 'none';
  constructor(private readonly sessionId: string, private readonly radius = STICK_RADIUS) {
    if (!sessionId.trim()) throw new RangeError('Girdi oturum kimliği gerekli.');
  }
  setOwner(owner: InputOwner): void {
    if (owner !== this.owner) this.release(this.pointerId ?? 0);
    this.owner = owner;
  }
  get held(): number | null { return this.pointerId; }
  get current(): StickReading { return this.reading; }
  press(pointerId: number, origin: VecXZ, point: VecXZ = origin): boolean {
    if (this.pointerId !== null || this.owner !== 'world') return false;
    this.pointerId = pointerId;
    this.origin = { ...origin };
    this.reading = readStick(this.origin, point, this.radius);
    return true;
  }
  move(pointerId: number, point: VecXZ): boolean {
    if (this.pointerId !== pointerId) return false;
    this.reading = readStick(this.origin, point, this.radius);
    return true;
  }
  release(pointerId: number): boolean {
    if (this.pointerId !== pointerId) return false;
    this.pointerId = null;
    this.reading = STICK_REST;
    return true;
  }
  /** Same command shape, same owner rule and same tick as the keyboard produces. */
  movement(tick: number): GameCommand | null {
    if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError('Geçersiz simülasyon tick değeri.');
    if (this.owner !== 'world' || !this.reading.active) return null;
    const { x, z } = this.reading.direction;
    return x || z ? { type: 'move', commandId: `${this.sessionId}:touch:${++this.sequence}`, tick, direction: { x, z } } : null;
  }
}
