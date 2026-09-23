import type { InputOwner } from '../../contracts';
import { STICK_RADIUS, VirtualStick } from './stick';

export const TOUCH_CSS = `
.mv-stick{position:absolute;left:18px;bottom:190px;width:132px;height:132px;border-radius:50%;
  border:1px solid #d9bd7c55;background:#0f1b1899;touch-action:none;pointer-events:auto;display:none}
.mv-stick[data-enabled="true"]{display:block}
.mv-stick-knob{position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;
  background:#d9bd7ccc;border:1px solid #12201c66;transform:translate(0,0)}
.mv-stick:focus-visible{outline:3px solid #f0c987;outline-offset:2px}
@media (max-width:640px){ .mv-stick{left:12px;bottom:210px;width:118px;height:118px} }
@media (pointer:fine){ .mv-stick[data-enabled="auto"]{display:none} }`;
export interface TouchControlsOptions {
  readonly sessionId: string;
  /** Forced on in tests and on demand; by default the pad only shows on a touch screen. */
  readonly enabled?: () => boolean;
}
/**
 * The on-screen stick. It listens to pointer events only — one stream for mouse, pen and touch —
 * so a device with both never sends two move commands for one gesture.
 */
export class TouchControls {
  readonly root: HTMLElement;
  readonly stick: VirtualStick;
  private readonly knob = document.createElement('div');
  private disposed = false;
  private readonly onDown = (event: PointerEvent) => {
    if (!this.visible()) return;
    const box = this.root.getBoundingClientRect();
    const origin = { x: box.left + box.width / 2, z: box.top + box.height / 2 };
    if (!this.stick.press(event.pointerId, origin, { x: event.clientX, z: event.clientY })) return;
    event.preventDefault();
    this.root.setPointerCapture?.(event.pointerId);
    this.paint();
  };
  private readonly onMove = (event: PointerEvent) => {
    if (!this.stick.move(event.pointerId, { x: event.clientX, z: event.clientY })) return;
    event.preventDefault();
    this.paint();
  };
  private readonly onUp = (event: PointerEvent) => {
    if (!this.stick.release(event.pointerId)) return;
    this.root.releasePointerCapture?.(event.pointerId);
    this.paint();
  };
  constructor(host: HTMLElement, private readonly options: TouchControlsOptions) {
    const doc = host.ownerDocument ?? document;
    if (!doc.getElementById('muhur-touch-style')) {
      const style = doc.createElement('style');
      style.id = 'muhur-touch-style';
      style.textContent = TOUCH_CSS;
      doc.head.append(style);
    }
    this.stick = new VirtualStick(options.sessionId);
    this.root = doc.createElement('div');
    this.root.className = 'mv-stick';
    this.root.setAttribute('role', 'application');
    this.root.setAttribute('aria-label', 'Yön çubuğu');
    this.root.dataset.enabled = 'auto';
    this.knob.className = 'mv-stick-knob';
    this.root.append(this.knob);
    this.root.addEventListener('pointerdown', this.onDown);
    this.root.addEventListener('pointermove', this.onMove);
    this.root.addEventListener('pointerup', this.onUp);
    this.root.addEventListener('pointercancel', this.onUp);
    host.append(this.root);
  }
  private visible(): boolean { return this.options.enabled?.() ?? true; }
  setOwner(owner: InputOwner): void {
    this.stick.setOwner(owner);
    this.root.dataset.enabled = owner === 'world' ? (this.options.enabled?.() ? 'true' : 'auto') : 'false';
    this.paint();
  }
  private paint(): void {
    const { knob } = this.stick.current;
    this.knob.style.transform = `translate(${knob.x}px, ${knob.z}px)`;
  }
  get radius(): number { return STICK_RADIUS; }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeEventListener('pointerdown', this.onDown);
    this.root.removeEventListener('pointermove', this.onMove);
    this.root.removeEventListener('pointerup', this.onUp);
    this.root.removeEventListener('pointercancel', this.onUp);
    this.root.remove();
  }
}
