import type { CommandIntent } from '../../contracts';
import type { ContentState } from '../../content/alchemy';
import { PanelDialog } from '../inventory/panel-dialog';
import { alchemyView, type AlchemyView } from './model';

export interface AlchemyPanelOptions {
  readonly onClose: () => void;
  readonly send: (intent: CommandIntent) => Promise<unknown>;
}
/** Recipe list, ingredient slots and craft preview. Crafting itself is one atomic domain command. */
export class AlchemyPanel {
  readonly dialog: PanelDialog;
  private readonly list = document.createElement('ul');
  private readonly detail = document.createElement('div');
  private readonly craftButton = document.createElement('button');
  private selected: string | null = null;
  private state: Pick<ContentState, 'inventory' | 'unlockedRecipeIds'> = { inventory: [], unlockedRecipeIds: [] };
  private pending = false;
  constructor(host: HTMLElement, private readonly options: AlchemyPanelOptions) {
    this.dialog = new PanelDialog(host, { title: 'Simya', panelId: 'alchemy', onClose: options.onClose });
    this.list.className = 'mv-list';
    this.list.setAttribute('aria-label', 'Tarifler');
    this.detail.className = 'mv-detail';
    this.craftButton.type = 'button';
    this.craftButton.textContent = 'Üret';
    this.craftButton.addEventListener('click', () => void this.craft());
    const columns = document.createElement('div');
    columns.className = 'mv-columns';
    columns.append(this.list, this.detail);
    this.dialog.body.append(columns);
  }
  private async craft(): Promise<void> {
    const view = alchemyView(this.state, this.selected);
    if (this.pending || !view.preview?.craftable) return;
    this.pending = true;
    this.render();
    try { await this.options.send(view.preview.intent); }
    finally { this.pending = false; this.render(); }
  }
  update(state: Pick<ContentState, 'inventory' | 'unlockedRecipeIds'>): void {
    this.state = state;
    this.render();
  }
  private render(): void {
    const view: AlchemyView = alchemyView(this.state, this.selected);
    this.dialog.setSubtitle(view.note);
    this.list.replaceChildren(...view.rows.map((row) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = !row.unlocked;
      button.textContent = row.unlocked ? `${row.name} ×${row.outputQuantity}` : row.name;
      button.setAttribute('aria-pressed', String(row.recipeId === this.selected));
      button.setAttribute('aria-label', row.unlocked ? `${row.name}, ${row.craftable ? 'üretilebilir' : row.reason ?? 'eksik malzeme'}` : 'Keşfedilmemiş tarif');
      button.addEventListener('click', () => { this.selected = row.recipeId; this.render(); });
      item.append(button);
      return item;
    }));
    this.detail.replaceChildren();
    const preview = view.preview;
    const title = document.createElement('h3');
    title.textContent = preview ? `${preview.outputName} ×${preview.outputQuantity}` : 'Tarif seçin';
    this.detail.append(title);
    if (!preview) { this.craftButton.disabled = true; this.detail.append(this.craftButton); return; }
    for (const slot of preview.slots) {
      const line = document.createElement('p');
      line.textContent = slot.text;
      if (!slot.enough) line.className = 'mv-warn';
      this.detail.append(line);
    }
    const effect = document.createElement('p');
    effect.textContent = preview.effect ?? 'Simya ürünü';
    const status = document.createElement('p');
    status.className = preview.craftable ? '' : 'mv-warn';
    status.textContent = preview.craftable ? `Üretim sonrası boş yuva: ${preview.resultingFreeSlots}` : preview.reason ?? '';
    this.craftButton.disabled = !preview.craftable || this.pending;
    this.craftButton.setAttribute('aria-label', preview.craftable ? `${preview.outputName} üret` : `Üretilemiyor: ${preview.reason}`);
    this.detail.append(effect, status, this.craftButton);
  }
  select(recipeId: string | null): void { this.selected = recipeId; this.render(); }
  open(opener: HTMLElement | null = null): void { this.dialog.open(opener); }
  close(): void { this.dialog.close(); }
  get isOpen(): boolean { return this.dialog.isOpen; }
  dispose(): void { this.dialog.dispose(); }
}
