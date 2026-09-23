import type { GameCommand, InputOwner } from '../../contracts';

const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
/** Physical-key adapter only; the movement domain normalizes direction and resolves collision. */
export class KeyboardInput {
  private readonly held = new Set<string>();
  private owner: InputOwner = 'none';
  private focused = true;
  private sequence = 0;
  constructor(private readonly win: EventTarget, private readonly doc: EventTarget, private readonly hidden: () => boolean, private readonly sessionId: string) {
    if (!sessionId.trim()) throw new RangeError('Girdi oturum kimliği gerekli.');
    win.addEventListener('keydown', this.down);
    win.addEventListener('keyup', this.up);
    win.addEventListener('blur', this.blur);
    win.addEventListener('focus', this.focus);
    doc.addEventListener('visibilitychange', this.clear);
    doc.addEventListener('focusin', this.clear);
  }
  setOwner(owner: InputOwner): void {
    if (this.owner !== owner) this.clear();
    this.owner = owner;
  }
  private clear = (): void => { this.held.clear(); };
  private blur = (): void => { this.focused = false; this.clear(); };
  private focus = (): void => { this.focused = true; this.clear(); };
  private down = (event: Event): void => {
    const key = event as KeyboardEvent;
    const target = key.target as HTMLElement | null;
    const editable = target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target?.tagName ?? '');
    if (!movementKeys.has(key.code) || key.ctrlKey || key.altKey || key.metaKey || editable || this.owner !== 'world' || !this.focused || this.hidden()) return;
    key.preventDefault(); this.held.add(key.code);
  };
  private up = (event: Event): void => { this.held.delete((event as KeyboardEvent).code); };
  movement(tick: number): GameCommand | null {
    if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError('Geçersiz simülasyon tick değeri.');
    if (this.owner !== 'world' || !this.focused || this.hidden()) { this.clear(); return null; }
    const x = Number(this.held.has('KeyD') || this.held.has('ArrowRight')) - Number(this.held.has('KeyA') || this.held.has('ArrowLeft'));
    const z = Number(this.held.has('KeyS') || this.held.has('ArrowDown')) - Number(this.held.has('KeyW') || this.held.has('ArrowUp'));
    return x || z ? { type: 'move', commandId: `${this.sessionId}:move:${++this.sequence}`, tick, direction: { x, z } } : null;
  }
  dispose(): void {
    this.owner = 'none'; this.clear();
    this.win.removeEventListener('keydown', this.down); this.win.removeEventListener('keyup', this.up);
    this.win.removeEventListener('blur', this.blur); this.win.removeEventListener('focus', this.focus);
    this.doc.removeEventListener('visibilitychange', this.clear); this.doc.removeEventListener('focusin', this.clear);
  }
}
