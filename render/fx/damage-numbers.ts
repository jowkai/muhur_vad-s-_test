export type DamageTone = 'damage' | 'heal' | 'status' | 'miss';
export interface DamageNumber {
  readonly text: string; readonly tone: DamageTone;
  readonly x: number; readonly y: number;
  readonly durationMs: number; readonly animated: boolean;
}
export const DAMAGE_DURATION_MS = 900;
export const STILL_DURATION_MS = 1400;
/**
 * Pure description of one floating number. Reduced motion keeps it still and shows it longer,
 * so the information is never lost with the animation.
 */
export function damageNumber(options: {
  readonly amount?: number; readonly tone?: DamageTone; readonly text?: string;
  readonly x?: number; readonly y?: number; readonly reducedMotion?: boolean;
}): DamageNumber {
  const tone = options.tone ?? 'damage';
  const amount = Math.max(0, Math.round(options.amount ?? 0));
  const text = options.text ?? (tone === 'heal' ? `+${amount}` : tone === 'miss' ? 'ıska' : `−${amount}`);
  return Object.freeze({
    text, tone,
    x: Number.isFinite(options.x) ? options.x! : 50,
    y: Number.isFinite(options.y) ? options.y! : 40,
    animated: !options.reducedMotion,
    durationMs: options.reducedMotion ? STILL_DURATION_MS : DAMAGE_DURATION_MS,
  });
}
export const DAMAGE_CSS = `
.mv-damage-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.mv-damage{position:absolute;transform:translate(-50%,-50%);font:700 20px/1 Georgia,serif;color:#ffd9a8;
  text-shadow:0 2px 0 #2a1a12,0 0 10px #00000088;opacity:1}
.mv-damage[data-tone="heal"]{color:#a8e5a0}
.mv-damage[data-tone="status"]{color:#c9a8ef;font-size:16px}
.mv-damage[data-tone="miss"]{color:#cfd6c8;font-size:16px}
.mv-damage[data-animated="true"]{animation:mv-float var(--mv-duration,900ms) ease-out forwards}
@keyframes mv-float{0%{opacity:0;transform:translate(-50%,-30%) scale(.8)}20%{opacity:1;transform:translate(-50%,-55%) scale(1.05)}
100%{opacity:0;transform:translate(-50%,-110%) scale(1)}}
@media (prefers-reduced-motion:reduce){.mv-damage[data-animated="true"]{animation:none}}`;
/** Thin DOM layer over the pure model; it owns no game state and reads nothing back. */
export class DamageNumberLayer {
  readonly root: HTMLElement;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;
  constructor(host: HTMLElement) {
    const doc = host.ownerDocument ?? document;
    if (!doc.getElementById('muhur-damage-style')) {
      const style = doc.createElement('style');
      style.id = 'muhur-damage-style';
      style.textContent = DAMAGE_CSS;
      doc.head.append(style);
    }
    this.root = doc.createElement('div');
    this.root.className = 'mv-damage-layer';
    host.append(this.root);
  }
  show(number: DamageNumber): HTMLElement | null {
    if (this.disposed) return null;
    const node = this.root.ownerDocument.createElement('span');
    node.className = 'mv-damage';
    node.dataset.tone = number.tone;
    node.dataset.animated = String(number.animated);
    node.style.left = `${number.x}%`;
    node.style.top = `${number.y}%`;
    node.style.setProperty('--mv-duration', `${number.durationMs}ms`);
    node.textContent = number.text;
    this.root.append(node);
    const timer = setTimeout(() => { node.remove(); this.timers.delete(timer); }, number.durationMs);
    this.timers.add(timer);
    return node;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.root.remove();
  }
}
