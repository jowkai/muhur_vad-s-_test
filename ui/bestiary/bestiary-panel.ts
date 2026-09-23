import type { CommandIntent } from '../../contracts';
import type { WorldState } from '../../world/persistence/world-save';
import { PanelDialog } from '../inventory/panel-dialog';
import { bestiaryView, type BestiaryView } from './model';

export interface BestiaryPanelOptions {
  readonly onClose: () => void;
  readonly send: (intent: CommandIntent) => Promise<unknown>;
}
/** Collection journal: owned creatures on the left, the species list on the right. */
export class BestiaryPanel {
  readonly dialog: PanelDialog;
  private readonly team = document.createElement('ul');
  private readonly species = document.createElement('ul');
  private state: WorldState | null = null;
  private pending = false;
  constructor(host: HTMLElement, private readonly options: BestiaryPanelOptions) {
    this.dialog = new PanelDialog(host, { title: 'Yaratık defteri', panelId: 'bestiary', onClose: options.onClose });
    for (const [list, label] of [[this.team, 'Koleksiyon'], [this.species, 'Türler']] as const) {
      list.className = 'mv-list';
      list.setAttribute('aria-label', label);
    }
    const columns = document.createElement('div');
    columns.className = 'mv-columns';
    columns.append(this.team, this.species);
    this.dialog.body.append(columns);
  }
  update(state: WorldState): void {
    this.state = state;
    this.render();
  }
  private async activate(intent: CommandIntent): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    this.render();
    try { await this.options.send(intent); }
    finally { this.pending = false; this.render(); }
  }
  private render(): void {
    if (!this.state) return;
    const view: BestiaryView = bestiaryView(this.state);
    this.dialog.setSubtitle(view.locked ? `${view.summary} · ${view.locked}` : view.summary);
    this.team.replaceChildren(...view.owned.map((entry) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = !entry.canActivate || this.pending;
      button.setAttribute('aria-pressed', String(entry.active));
      button.textContent = `${entry.name} Sv ${entry.level} · ${entry.hp}/${entry.maxHp} · ${entry.origin}` +
        (entry.active ? ' · aktif' : entry.reason ? ` · ${entry.reason}` : '');
      button.setAttribute('aria-label', entry.active ? `${entry.name}, aktif yaratık` : `${entry.name} seviye ${entry.level}, aktif yap`);
      button.addEventListener('click', () => void this.activate(entry.intent));
      item.append(button);
      return item;
    }));
    if (!view.owned.length) {
      const empty = document.createElement('li');
      empty.textContent = 'Koleksiyon boş.';
      this.team.append(empty);
    }
    const header = document.createElement('li');
    const summary = document.createElement('div');
    summary.className = 'mv-detail';
    const heading = document.createElement('h3');
    heading.textContent = `Bölge sırları ${view.secrets.known}/${view.secrets.total}`;
    const detail = document.createElement('p');
    detail.textContent = view.secrets.regions.length ? view.secrets.regions.join(' · ') : 'Henüz bir bahçıvan işareti bulunmadı';
    summary.append(heading, detail);
    if (view.trophies.length) {
      const trophies = document.createElement('p');
      trophies.textContent = `Kupalar: ${view.trophies.map((trophy) => `${trophy.label} ×${trophy.count}`).join(' · ')}`;
      summary.append(trophies);
    }
    header.append(summary);
    this.species.replaceChildren(header, ...view.species.map((entry) => {
      const item = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'mv-detail';
      const title = document.createElement('h3');
      title.textContent = entry.known ? `${entry.name} ×${entry.owned}` : '???';
      const detail = document.createElement('p');
      detail.textContent = entry.known ? `${entry.biome} · ${entry.element} · ${entry.rarity}` : `${entry.biome} · ${entry.note}`;
      row.append(title, detail);
      if (entry.spriteUrl) {
        const icon = document.createElement('img');
        icon.src = entry.spriteUrl; icon.alt = ''; icon.width = 48; icon.height = 48;
        row.prepend(icon);
      }
      item.append(row);
      return item;
    }));
  }
  open(opener: HTMLElement | null = null): void { this.dialog.open(opener); }
  close(): void { this.dialog.close(); }
  get isOpen(): boolean { return this.dialog.isOpen; }
  dispose(): void { this.dialog.dispose(); }
}
