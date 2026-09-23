import type { CommandIntent } from '../../contracts';
import type { WorldState } from '../../world/persistence/world-save';
import { PanelDialog } from '../inventory/panel-dialog';
import { campView, type CampView } from './model';
import type { TravelAnchorView } from '../../world/travel';

export interface CampPanelOptions {
  readonly onClose: () => void;
  readonly send: (intent: CommandIntent) => Promise<unknown>;
  /** Hatching is a domain command of its own; the panel only asks for it. */
  readonly onHatch: (eggId: string) => Promise<unknown>;
  /** Claiming the delivery box is its own atomic command, like hatching. */
  readonly onClaim: () => Promise<unknown>;
  /** v2 camp work: the garden beds and the anchors fast travel can reach. */
  readonly garden?: () => GardenView;
  readonly onPlant?: (itemId: string) => Promise<unknown>;
  readonly onHarvest?: () => Promise<unknown>;
  readonly travel?: () => readonly TravelAnchorView[];
  readonly onTravel?: (anchorId: string) => Promise<unknown>;
}
export interface GardenPlotView { readonly itemId: string; readonly name: string; readonly ready: boolean; readonly text: string }
export interface GardenView {
  readonly plots: readonly GardenPlotView[]; readonly capacity: number;
  readonly seeds: readonly { readonly itemId: string; readonly name: string; readonly quantity: number }[];
  readonly canHarvest: boolean; readonly note: string;
}
/** Camp panel: team healing with a live preview, camp items and the incubation tab. */
export class CampPanel {
  readonly dialog: PanelDialog;
  private readonly team = document.createElement('ul');
  private readonly items = document.createElement('ul');
  private readonly eggs = document.createElement('ul');
  private readonly delivery = document.createElement('ul');
  private readonly claimButton = document.createElement('button');
  private readonly garden = document.createElement('ul');
  private readonly harvestButton = document.createElement('button');
  private readonly travel = document.createElement('ul');
  private selectedItem: string | null = null;
  private selectedCreature: string | null = null;
  private pending = false;
  private state: WorldState | null = null;
  constructor(host: HTMLElement, private readonly options: CampPanelOptions) {
    this.dialog = new PanelDialog(host, { title: 'Kamp', panelId: 'camp', onClose: options.onClose });
    const columns = document.createElement('div');
    columns.className = 'mv-columns';
    for (const [list, label] of [[this.team, 'Takım'], [this.items, 'Kamp eşyaları'], [this.eggs, 'Kuluçka'], [this.delivery, 'Teslim kutusu']] as const) {
      list.className = 'mv-list';
      list.setAttribute('aria-label', label);
    }
    this.claimButton.type = 'button';
    this.claimButton.textContent = 'Teslim kutusunu al';
    this.claimButton.addEventListener('click', () => void this.run(() => this.options.onClaim()));
    const left = document.createElement('div');
    left.append(this.team, this.items);
    for (const [list, label] of [[this.garden, 'Bahçe'], [this.travel, 'Hızlı seyahat']] as const) {
      list.className = 'mv-list';
      list.setAttribute('aria-label', label);
    }
    this.harvestButton.type = 'button';
    this.harvestButton.textContent = 'Bahçeyi topla';
    this.harvestButton.addEventListener('click', () => { if (this.options.onHarvest) void this.run(() => this.options.onHarvest!()); });
    const right = document.createElement('div');
    right.append(this.eggs, this.delivery, this.claimButton);
    if (this.options.garden) right.append(this.garden, this.harvestButton);
    if (this.options.travel) right.append(this.travel);
    columns.append(left, right);
    this.dialog.body.append(columns);
  }
  update(state: WorldState): void {
    this.state = state;
    this.render();
  }
  private async run(action: () => Promise<unknown>): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    this.render();
    try { await action(); }
    finally { this.pending = false; this.render(); }
  }
  private renderGarden(): void {
    const garden = this.options.garden?.();
    if (!garden) return;
    const rows: HTMLElement[] = garden.plots.map((plot) => {
      const item = document.createElement('li');
      item.textContent = `${plot.name} · ${plot.text}`;
      return item;
    });
    for (const seed of garden.seeds) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = this.pending || garden.plots.length >= garden.capacity || !this.options.onPlant;
      button.textContent = `${seed.name} ek (×${seed.quantity})`;
      button.addEventListener('click', () => { if (this.options.onPlant) void this.run(() => this.options.onPlant!(seed.itemId)); });
      item.append(button);
      rows.push(item);
    }
    if (!rows.length) {
      const empty = document.createElement('li');
      empty.textContent = garden.note;
      rows.push(empty);
    }
    this.garden.replaceChildren(...rows);
    this.harvestButton.disabled = !garden.canHarvest || this.pending;
  }
  private renderTravel(): void {
    const anchors = this.options.travel?.();
    if (!anchors) return;
    this.travel.replaceChildren(...anchors.map((anchor) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = this.pending || !this.options.onTravel || anchor.here;
      button.textContent = `${anchor.name} · ${anchor.note}`;
      button.addEventListener('click', () => { if (this.options.onTravel) void this.run(() => this.options.onTravel!(anchor.id)); });
      item.append(button);
      return item;
    }));
  }
  private render(): void {
    if (!this.state) return;
    this.renderGarden();
    this.renderTravel();
    const view: CampView = campView(this.state, { selectedItemId: this.selectedItem, selectedCreatureId: this.selectedCreature });
    this.dialog.setSubtitle(view.locked ? `${view.summary} · ${view.locked}` : view.summary);
    this.team.replaceChildren(...view.creatures.map((creature) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(creature.creatureId === this.selectedCreature));
      button.textContent = `${creature.name} Sv ${creature.level} · ${creature.hp}/${creature.maxHp}${creature.preview ? ` → ${creature.preview.split(' → ')[1]}` : ''}${creature.fainted ? ' · baygın' : ''}`;
      button.addEventListener('click', () => { this.selectedCreature = creature.creatureId; this.render(); });
      item.append(button);
      return item;
    }));
    this.items.replaceChildren(...view.items.map((row) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = !row.usable || this.pending;
      button.setAttribute('aria-pressed', String(row.itemId === this.selectedItem));
      button.textContent = `${row.name} ×${row.quantity} · ${row.usable ? row.effect : row.reason}`;
      button.addEventListener('click', () => {
        if (this.selectedItem !== row.itemId) { this.selectedItem = row.itemId; this.render(); return; }
        void this.run(() => this.options.send(row.intent as CommandIntent));
      });
      button.addEventListener('focus', () => { if (this.selectedItem !== row.itemId) { this.selectedItem = row.itemId; this.render(); } });
      item.append(button);
      return item;
    }));
    this.eggs.replaceChildren(...(view.eggs.length ? view.eggs : []).map((egg) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = !egg.ready || this.pending;
      button.textContent = `${egg.speciesName} yumurtası · ${egg.text}`;
      button.setAttribute('aria-label', `${egg.speciesName} yumurtası, ${egg.text}`);
      button.addEventListener('click', () => void this.run(() => this.options.onHatch(egg.eggId)));
      item.append(button);
      return item;
    }));
    if (!view.eggs.length) {
      const empty = document.createElement('li');
      empty.textContent = 'Kuluçkada yumurta yok.';
      this.eggs.append(empty);
    }
    this.delivery.replaceChildren(...view.delivery.rows.map((row) => {
      const item = document.createElement('li');
      const line = document.createElement('div');
      line.className = 'mv-detail';
      const title = document.createElement('h3');
      title.textContent = row.label;
      const detail = document.createElement('p');
      detail.textContent = row.detail;
      if (!row.claimable) detail.className = 'mv-warn';
      line.append(title, detail);
      if (row.iconUrl) {
        const icon = document.createElement('img');
        icon.src = row.iconUrl; icon.alt = ''; icon.width = 32; icon.height = 32;
        line.prepend(icon);
      }
      item.append(line);
      return item;
    }));
    if (!view.delivery.rows.length) {
      const empty = document.createElement('li');
      empty.textContent = 'Teslim kutusu boş.';
      this.delivery.append(empty);
    }
    this.claimButton.disabled = !view.delivery.canClaim || this.pending;
    this.claimButton.setAttribute('aria-label', view.delivery.canClaim ? 'Teslim kutusundaki ödülleri al' : `Alınamıyor: ${view.delivery.reason}`);
  }
  selectItem(itemId: string | null): void { this.selectedItem = itemId; this.render(); }
  selectCreature(creatureId: string | null): void { this.selectedCreature = creatureId; this.render(); }
  open(opener: HTMLElement | null = null): void { this.dialog.open(opener); }
  close(): void { this.dialog.close(); }
  get isOpen(): boolean { return this.dialog.isOpen; }
  dispose(): void { this.dialog.dispose(); }
}
