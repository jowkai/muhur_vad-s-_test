import { OrthographicCamera, Vector3, type Object3D } from 'three';
import type { VecXZ } from '../../contracts';

export class FollowCamera {
  readonly camera = new OrthographicCamera(-16, 16, 16, -16, 0.1, 300);
  private readonly target = new Vector3();
  private readonly offset = new Vector3(0, Math.sin(Math.PI / 3) * 40, Math.cos(Math.PI / 3) * 40);
  constructor() { this.place(); }
  resize(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height)) throw new RangeError('Geçersiz ekran boyutu.');
    const aspect = Math.max(1, width) / Math.max(1, height);
    this.camera.left = -16 * aspect; this.camera.right = 16 * aspect;
    this.camera.top = 16; this.camera.bottom = -16;
    this.camera.updateProjectionMatrix();
  }
  follow(position: VecXZ, height: number, delta: number, snap = false): void {
    if (![position.x, position.z, height, delta].every(Number.isFinite) || delta < 0) throw new RangeError('Geçersiz kamera hedefi/zamanı.');
    const goal = new Vector3(position.x, height, position.z);
    this.target.lerp(goal, snap ? 1 : 1 - Math.exp(-10 * delta));
    this.place();
  }
  private place(): void {
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
/** Copies a domain snapshot into the visual proxy; never writes back to gameplay. */
export function applyPlayerPose(object: Object3D, position: VecXZ, height: number, yaw: number): void {
  if (![position.x, position.z, height, yaw].every(Number.isFinite)) throw new RangeError('Geçersiz görsel konum.');
  object.position.set(position.x, height, position.z);
  object.rotation.y = yaw;
}
