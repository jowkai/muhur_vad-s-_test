import type { CommandIntent } from '../../contracts';
import { installUiStyles } from '../hud/hud-view';
import { PARTY_CSS } from './style';
import { partyIntentForKey, partyStrip, type PartyStripView } from './model';

export interface PartyBarOptions {
  readonly send: (intent: CommandIntent) => void;
  readonly keyTarget?: EventTarget;
}
/** Six horizontal slots under the tab bar. It draws `partyStrip` and publishes its intents. */
export class PartyBarView {
  readonly root: HTMLElement;
  private readonly cells: {
    button: HTMLButtonElement; sprite: HTMLElement; name: HTMLElement;
    level: HTMLElement; fill: HTMLElement; hp: HTMLElement; roles: HTMLElement;
  }[] = [];
  private view: PartyStripView | null = null;
  private disposed = false;
  private readonly onKey = (event: KeyboardEvent) => {
    if (!this.view || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const intent = partyIntentForKey(event, this.view);
    if (!intent) return;
    event.preventDefault();
    this.options.send(intent);
  };
  constructor(dock: HTMLElement, private readonly options: PartyBarOptions) {
    const doc = dock.ownerDocument ?? document;
    installUiStyles(doc);
    if (!doc.getElementById('muhur-party-style')) {
      const style = doc.createElement('style');
      style.id = 'muhur-party-style';
      style.textContent = PARTY_CSS;
      doc.head.append(style);
    }
    this.root = document.createElement('div');
    this.root.className = 'mv-party';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Takım');
    for (let index = 0; index < 6; index++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mv-party-slot';
      button.dataset.slot = String(index);
      const sprite = document.createElement('span');
      sprite.className = 'mv-party-sprite';
      const name = document.createElement('span');
      name.className = 'mv-party-name';
      const level = document.createElement('span');
      level.className = 'mv-party-level';
      const track = document.createElement('span');
      track.className = 'mv-party-track';
      const fill = document.createElement('span');
      fill.className = 'mv-party-fill';
      track.append(fill);
      const hp = document.createElement('span');
      hp.className = 'mv-party-hp';
      const roles = document.createElement('span');
      roles.className = 'mv-party-roles';
      button.append(sprite, name, level, roles, track, hp);
      button.addEventListener('click', () => {
        const slot = this.view?.slots[index];
        if (slot?.enabled && slot.intent) this.options.send(slot.intent);
      });
      this.cells.push({ button, sprite, name, level, fill, hp, roles });
      this.root.append(button);
    }
    dock.append(this.root);
    (options.keyTarget ?? window).addEventListener('keydown', this.onKey as EventListener);
  }
  update(state: Parameters<typeof partyStrip>[0], options: Parameters<typeof partyStrip>[1] = {}): void {
    if (this.disposed) return;
    const view = partyStrip(state, options);
    this.view = view;
    this.root.setAttribute('aria-label', `Takım · ${view.caption}`);
    view.slots.forEach((slot, index) => {
      const cell = this.cells[index];
      cell.button.disabled = !slot.enabled;
      cell.button.classList.toggle('mv-empty', !slot.filled);
      cell.button.classList.toggle('mv-active', slot.active);
      cell.button.classList.toggle('mv-fainted', slot.fainted);
      cell.button.title = slot.note;
      cell.button.setAttribute('aria-pressed', String(slot.active));
      cell.button.setAttribute('aria-label', slot.filled
        ? `${slot.shortcut}: ${slot.name}, seviye ${slot.level}, can ${slot.hpText} · ${slot.note}`
        : `${slot.shortcut}: boş yuva`);
      cell.sprite.style.backgroundImage = slot.spriteUrl ? `url("${slot.spriteUrl}")` : '';
      cell.name.textContent = slot.filled ? slot.name : '—';
      cell.level.textContent = slot.filled ? `Sv ${slot.level}` : slot.shortcut;
      cell.fill.style.width = `${slot.ratio * 100}%`;
      cell.fill.classList.toggle('mv-low', slot.filled && slot.ratio <= .35);
      cell.hp.textContent = slot.filled ? slot.hpText : '';
      cell.button.classList.toggle('mv-mounted', slot.mounted);
      cell.roles.replaceChildren(...slot.roles.map((badge) => {
        const tag = document.createElement('span');
        tag.className = 'mv-party-role';
        tag.dataset.locked = String(!badge.unlocked);
        tag.textContent = badge.label.slice(0, 5);
        tag.title = badge.note;
        return tag;
      }));
    });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    (this.options.keyTarget ?? window).removeEventListener('keydown', this.onKey as EventListener);
    this.root.remove();
    this.cells.length = 0;
  }
}
