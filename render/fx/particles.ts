import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Object3D, Points, PointsMaterial, type Vector3Like } from 'three';

export type SparkKind = 'gather' | 'seal' | 'levelup' | 'hit';
export interface SparkStyle { readonly color: number; readonly size: number; readonly life: number; readonly rise: number; readonly spread: number }
/** One table for every burst the game can show; nothing else may invent particle behaviour. */
export const SPARKS: Readonly<Record<SparkKind, SparkStyle>> = Object.freeze({
  gather: { color: 0x9fd98a, size: .18, life: .8, rise: 1.4, spread: .5 },
  seal: { color: 0xf0c987, size: .22, life: 1.1, rise: 1.8, spread: .7 },
  levelup: { color: 0xffe9a8, size: .26, life: 1.4, rise: 2.2, spread: .9 },
  hit: { color: 0xe1734f, size: .2, life: .5, rise: 1, spread: .6 },
});
export const PARTICLE_POOL = 256;
const STRIDE_RANDOM = 9301;
/**
 * A single pooled Points cloud: every burst in the game shares one geometry, one material and
 * therefore one draw call. Dead particles are parked at zero size instead of being allocated
 * away, so a long session never grows the buffer.
 */
export class ParticleField {
  readonly points: Points;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly velocity: Float32Array;
  private readonly life: Float32Array;
  private readonly total: Float32Array;
  private readonly geometry = new BufferGeometry();
  private readonly material: PointsMaterial;
  private cursor = 0;
  private seed = 1;
  private disposed = false;
  constructor(scene: Object3D, private readonly capacity = PARTICLE_POOL) {
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.velocity = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.total = new Float32Array(capacity);
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('size', new BufferAttribute(this.sizes, 1));
    this.material = new PointsMaterial({ size: .22, vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending });
    this.points = new Points(this.geometry, this.material);
    this.points.name = 'fx-sparks';
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  private random(): number {
    this.seed = (this.seed * STRIDE_RANDOM + 49297) % 233280;
    return this.seed / 233280;
  }
  /** Lights a burst. Visual randomness only: it never touches the gameplay RNG. */
  emit(kind: SparkKind, at: Vector3Like, count = 12): number {
    if (this.disposed) return 0;
    const style = SPARKS[kind];
    const wanted = Math.max(0, Math.min(this.capacity, Math.floor(count)));
    const colour = new Color(style.color);
    for (let index = 0; index < wanted; index++) {
      const slot = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const base = slot * 3;
      this.positions[base] = at.x + (this.random() - .5) * style.spread;
      this.positions[base + 1] = at.y + this.random() * .2;
      this.positions[base + 2] = at.z + (this.random() - .5) * style.spread;
      this.velocity[base] = (this.random() - .5) * style.spread;
      this.velocity[base + 1] = style.rise * (.6 + this.random() * .8);
      this.velocity[base + 2] = (this.random() - .5) * style.spread;
      this.colors[base] = colour.r; this.colors[base + 1] = colour.g; this.colors[base + 2] = colour.b;
      this.sizes[slot] = style.size;
      this.life[slot] = style.life;
      this.total[slot] = style.life;
    }
    this.flush();
    return wanted;
  }
  /** Advances every live particle. Reduced motion keeps them still and simply fades them out. */
  update(delta: number, reducedMotion = false): void {
    if (this.disposed || !Number.isFinite(delta) || delta <= 0) return;
    for (let slot = 0; slot < this.capacity; slot++) {
      if (this.life[slot] <= 0) continue;
      this.life[slot] = Math.max(0, this.life[slot] - delta);
      const base = slot * 3;
      if (!reducedMotion) {
        this.positions[base] += this.velocity[base] * delta;
        this.positions[base + 1] += this.velocity[base + 1] * delta;
        this.positions[base + 2] += this.velocity[base + 2] * delta;
        this.velocity[base + 1] -= 1.6 * delta;
      }
      const fade = this.total[slot] > 0 ? this.life[slot] / this.total[slot] : 0;
      this.sizes[slot] = this.life[slot] > 0 ? SPARKS.gather.size * fade * 1.4 : 0;
    }
    this.flush();
  }
  private flush(): void {
    (this.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('size') as BufferAttribute).needsUpdate = true;
  }
  get alive(): number { return this.life.reduce((count, value) => count + (value > 0 ? 1 : 0), 0); }
  get drawCalls(): number { return 1; }
  positionOf(slot: number): { x: number; y: number; z: number } {
    const base = slot * 3;
    return { x: this.positions[base], y: this.positions[base + 1], z: this.positions[base + 2] };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
