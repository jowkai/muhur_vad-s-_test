import { installUiStyles } from '../hud/hud-view';
import { recoveryView, slotViews, type SlotId, type SlotRecord } from './slots';

export interface RecoveryScreenOptions {
  readonly onRetry: () => void;
  readonly onExport: () => void;
  readonly onStart: (slot: SlotId) => void;
  readonly onContinue: (slot: SlotId) => void;
}
export const RECOVERY_CSS = `
.mv-boot-screen{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;
  padding:24px;background:#0b1512f2;color:#f1ead6;pointer-events:auto;text-align:center}
.mv-boot-screen[hidden]{display:none}
.mv-boot-screen h2{margin:0;font:600 22px/1.2 Georgia,serif}
.mv-boot-screen p{margin:0;max-width:52ch;font-size:13px;color:#d8cfb6}
.mv-slot-list{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin:8px 0}
.mv-slot{display:flex;flex-direction:column;gap:6px;min-width:200px;padding:12px;border-radius:12px;
  border:1px solid #d9bd7c55;background:#16241fcc;text-align:left}
.mv-slot b{font:600 14px/1.2 Georgia,serif}
.mv-slot small{color:#b9c9ac}
.mv-slot-actions{display:flex;gap:6px;flex-wrap:wrap}
.mv-boot-screen button{min-height:44px;padding:0 14px;border-radius:9px;border:1px solid #d9bd7c88;background:transparent;
  color:#f1ead6;font:inherit;font-size:13px;cursor:pointer}
.mv-boot-screen button[disabled]{opacity:.45;cursor:not-allowed}
.mv-boot-screen button:focus-visible{outline:3px solid #f0c987;outline-offset:2px}
.mv-slot[data-status="corrupt"]{border-color:#e1734f}`;
/**
 * The screen that comes before the world: three slots, a new game and — when a record cannot be
 * read — the raw export the error message promises. It never deletes anything by itself.
 */
export class RecoveryScreen {
  readonly root: HTMLElement;
  private readonly title = document.createElement('h2');
  private readonly message = document.createElement('p');
  private readonly slots = document.createElement('div');
  private readonly actions = document.createElement('div');
  constructor(host: HTMLElement, private readonly options: RecoveryScreenOptions) {
    const doc = host.ownerDocument ?? document;
    installUiStyles(doc);
    if (!doc.getElementById('muhur-recovery-style')) {
      const style = doc.createElement('style');
      style.id = 'muhur-recovery-style';
      style.textContent = RECOVERY_CSS;
      doc.head.append(style);
    }
    this.root = document.createElement('section');
    this.root.className = 'mv-boot-screen';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Kayıt yuvaları');
    this.root.hidden = true;
    this.slots.className = 'mv-slot-list';
    this.actions.className = 'mv-slot-actions';
    this.root.append(this.title, this.message, this.slots, this.actions);
    host.append(this.root);
  }
  /** `error` is set only when the chosen record failed to load. */
  update(records: readonly SlotRecord[], error: string | null = null): void {
    const recovery = recoveryView(error);
    this.title.textContent = recovery.visible ? recovery.title : 'Kayıt yuvası seç';
    this.message.textContent = recovery.visible ? recovery.message : 'Üç ayrı kayıt tutabilirsin; yuvalar birbirini etkilemez.';
    this.slots.replaceChildren(...slotViews(records).map((slot) => {
      const card = document.createElement('div');
      card.className = 'mv-slot';
      card.dataset.status = slot.status;
      const name = document.createElement('b');
      name.textContent = slot.label;
      const summary = document.createElement('small');
      summary.textContent = slot.summary;
      const row = document.createElement('div');
      row.className = 'mv-slot-actions';
      const cont = document.createElement('button');
      cont.type = 'button';
      cont.textContent = 'Devam et';
      cont.disabled = !slot.canContinue;
      cont.addEventListener('click', () => this.options.onContinue(slot.slot));
      const fresh = document.createElement('button');
      fresh.type = 'button';
      fresh.textContent = 'Yeni oyun';
      fresh.disabled = !slot.canStart;
      fresh.addEventListener('click', () => this.options.onStart(slot.slot));
      row.append(cont, fresh);
      card.append(name, summary, row);
      return card;
    }));
    this.actions.replaceChildren(...recovery.actions.map((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      button.addEventListener('click', () => {
        if (action.id === 'retry') this.options.onRetry();
        else if (action.id === 'export') this.options.onExport();
        else this.options.onStart('a');
      });
      return button;
    }));
    this.root.hidden = false;
  }
  hide(): void { this.root.hidden = true; }
  dispose(): void { this.root.remove(); }
}
