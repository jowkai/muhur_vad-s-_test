import type { CommandIntent } from '../../contracts';
import { installUiStyles } from '../hud/hud-view';
import { BattleActionGate } from './gate';
import { intentForKey, type BattleView } from './model';

export const BATTLE_CSS = `
.mv-battle{position:absolute;z-index:6;inset:0;display:flex;flex-direction:column;justify-content:space-between;
 padding:20px;background:radial-gradient(120% 90% at 50% 0%,#1b2f2a 0%,#0c1513 100%);pointer-events:auto;
 color:#f1ead6;font:14px/1.45 system-ui,sans-serif}
.mv-battle *{box-sizing:border-box}
.mv-battle[hidden]{display:none}
.mv-battle-field{position:relative;flex:1;min-height:220px}
.mv-fighter{position:absolute;display:flex;gap:12px;align-items:center;padding:12px 14px;background:#0f1b18ee;border:1px solid #d9bd7c55;border-radius:12px;min-width:250px}
.mv-fighter img{width:160px;height:160px}
.mv-fighter.mv-enemy{top:0;right:0;flex-direction:row-reverse}
.mv-fighter.mv-player{bottom:0;left:0}
.mv-fighter h3{margin:0 0 4px;font:600 18px/1.2 Georgia,serif}
.mv-fighter .mv-tags{font-size:12px;color:#c7d6bb}
.mv-hpbar{position:relative;height:10px;margin-top:6px;border-radius:5px;background:#22322c;overflow:hidden}
.mv-hpbar span{display:block;height:100%;background:#8fc07a}
.mv-hpbar.mv-low span{background:#e1734f}
.mv-threshold{position:absolute;top:-3px;bottom:-3px;left:35%;width:2px;background:#f0c987}
.mv-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;max-width:560px}
.mv-actions button{min-height:56px;padding:10px 12px;text-align:left;border-radius:10px;border:1px solid #d9bd7c88;background:#16231fdd;color:#f1ead6;font:inherit;cursor:pointer}
.mv-actions button b{display:block;font-size:14px}
.mv-actions button small{color:#c7d6bb;font-size:11px}
.mv-actions button:disabled{opacity:.55;cursor:not-allowed;border-color:#5d6b60}
.mv-actions button:focus-visible,.mv-side button:focus-visible{outline:3px solid #f0c987;outline-offset:2px}
.mv-tray{display:flex;gap:16px;align-items:flex-end;justify-content:space-between;flex-wrap:wrap}
.mv-side{display:flex;gap:10px}
.mv-side button{min-height:44px;min-width:96px;padding:0 16px;border-radius:10px;border:1px solid #d9bd7c;background:transparent;color:#f1ead6;font:inherit;cursor:pointer}
.mv-side button:disabled{opacity:.55;cursor:not-allowed}
.mv-log{flex:1;min-width:240px;max-height:112px;overflow:auto;margin:0;padding:10px 12px;list-style:none;background:#0f1b18cc;border-radius:10px;font-size:12px;color:#d7e2cd}
.mv-result{margin:0 0 8px;font:600 16px Georgia,serif;color:#f0c987}
@media (max-width:1279px){.mv-fighter img{width:112px;height:112px}.mv-fighter{min-width:0}.mv-actions{max-width:none}}`;
export interface BattleViewOptions {
  readonly send: (intent: CommandIntent) => Promise<unknown>;
  readonly keyTarget?: Window | HTMLElement;
}
/** Battle page over the explore screen. Every control routes through one gate and one bus. */
export class BattlePage {
  readonly root: HTMLElement;
  private readonly gate: BattleActionGate;
  private readonly result = document.createElement('p');
  private readonly field = document.createElement('div');
  private readonly enemy = this.fighter('mv-enemy');
  private readonly player = this.fighter('mv-player');
  private readonly actions = document.createElement('div');
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly capture = document.createElement('button');
  private readonly bag = document.createElement('button');
  private readonly flee = document.createElement('button');
  private readonly log = document.createElement('ul');
  private view: BattleView | null = null;
  private disposed = false;
  private readonly onKey = (event: KeyboardEvent) => {
    if (!this.view || this.root.hidden || event.repeat) return;
    const intent = intentForKey(event.key, this.view);
    if (!intent) return;
    event.preventDefault();
    void this.gate.submit(intent);
  };
  constructor(host: HTMLElement, private readonly options: BattleViewOptions) {
    installUiStyles(host.ownerDocument ?? document);
    if (!document.getElementById('muhur-battle-style')) {
      const style = document.createElement('style');
      style.id = 'muhur-battle-style';
      style.textContent = BATTLE_CSS;
      document.head.append(style);
    }
    this.gate = new BattleActionGate(options.send, () => !!this.view && !this.view.busy);
    this.root = document.createElement('section');
    this.root.className = 'mv-battle';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Savaş');
    this.root.hidden = true;
    this.result.className = 'mv-result';
    this.result.setAttribute('role', 'status');
    this.field.className = 'mv-battle-field';
    this.field.append(this.enemy.root, this.player.root);
    this.actions.className = 'mv-actions';
    for (let slot = 0; slot < 4; slot++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.addEventListener('click', () => { if (this.view) void this.gate.submit(this.view.slots[slot].enabled ? this.view.slots[slot].intent : null); });
      this.buttons.push(button);
      this.actions.append(button);
    }
    const tray = document.createElement('div');
    tray.className = 'mv-tray';
    const side = document.createElement('div');
    side.className = 'mv-side';
    for (const [button, label, action] of [[this.capture, 'Yakala (C)', 'capture'], [this.bag, 'Çanta', 'bag'], [this.flee, 'Kaç (Esc)', 'flee']] as const) {
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => {
        if (!this.view) return;
        // The tray sends the smallest salve that still helps; the full list is a panel's job.
        const target = action === 'capture' ? this.view.capture
          : action === 'flee' ? this.view.flee
          : this.view.bag.items.find((entry) => entry.enabled) ?? null;
        void this.gate.submit(target?.enabled ? target.intent : null);
      });
      side.append(button);
    }
    this.log.className = 'mv-log';
    this.log.setAttribute('aria-label', 'Savaş günlüğü');
    tray.append(this.actions, side);
    this.root.append(this.result, this.field, this.log, tray);
    host.append(this.root);
    (options.keyTarget ?? window).addEventListener('keydown', this.onKey as EventListener);
  }
  private fighter(className: string) {
    const root = document.createElement('div');
    root.className = `mv-fighter ${className}`;
    const image = document.createElement('img');
    image.width = 160; image.height = 160; image.alt = '';
    const body = document.createElement('div');
    const name = document.createElement('h3');
    const tags = document.createElement('p');
    tags.className = 'mv-tags';
    const bar = document.createElement('div');
    bar.className = 'mv-hpbar';
    const fill = document.createElement('span');
    bar.append(fill);
    body.append(name, tags, bar);
    root.append(image, body);
    return { root, image, name, tags, bar, fill };
  }
  update(view: BattleView | null): void {
    if (this.disposed) return;
    this.view = view;
    this.root.hidden = !view;
    if (!view) return;
    for (const [nodes, model, marker] of [[this.player, view.player, false], [this.enemy, view.enemy, true]] as const) {
      nodes.image.src = model.spriteUrl;
      nodes.image.alt = `${model.name} ${model.facing === 'back' ? 'arkadan' : 'önden'}`;
      nodes.name.textContent = `${model.name} · Sv ${model.level}`;
      nodes.tags.textContent = `${model.element} · ${model.hpText} · enerji ${model.stamina}${model.guard ? ' · siper' : ''}`;
      nodes.fill.style.width = `${model.ratio * 100}%`;
      nodes.bar.classList.toggle('mv-low', model.ratio <= view.capture.thresholdRatio);
      if (marker && !nodes.bar.querySelector('.mv-threshold')) {
        const line = document.createElement('i');
        line.className = 'mv-threshold';
        line.title = 'Yakalama eşiği %35';
        nodes.bar.append(line);
      }
    }
    view.slots.forEach((slot, index) => {
      const button = this.buttons[index];
      button.disabled = !slot.enabled;
      button.replaceChildren(Object.assign(document.createElement('b'), { textContent: `${index + 1}. ${slot.name}` }),
        Object.assign(document.createElement('small'), { textContent: `güç ${slot.power} · isabet ${slot.accuracy} · ${slot.note}` }));
      button.setAttribute('aria-label', `${slot.name}, güç ${slot.power}, isabet ${slot.accuracy}, ${slot.note}`);
    });
    this.capture.disabled = !view.capture.enabled;
    this.capture.title = view.capture.note;
    this.capture.setAttribute('aria-label', `Yakala · ${view.capture.note}`);
    const salve = view.bag.items.find((entry) => entry.enabled);
    this.bag.disabled = !view.bag.enabled;
    this.bag.title = salve ? `${salve.name} · ${salve.note}` : view.bag.note;
    this.bag.setAttribute('aria-label', `Çanta · ${salve ? `${salve.name}, ${salve.note}` : view.bag.note}`);
    this.flee.disabled = !view.flee.enabled;
    this.result.textContent = view.resultText ?? '';
    this.log.replaceChildren(...view.log.slice(-8).map((text) => Object.assign(document.createElement('li'), { textContent: text })));
  }
  get busy(): boolean { return this.gate.busy; }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    (this.options.keyTarget ?? window).removeEventListener('keydown', this.onKey as EventListener);
    this.root.remove();
  }
}
