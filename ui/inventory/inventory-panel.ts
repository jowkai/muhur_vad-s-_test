import type { ContentState } from '../../content/alchemy';
import { PanelDialog } from './panel-dialog';
import { INVENTORY_COLUMNS, inventoryView, moveSelection, type InventoryFilter, type InventoryView } from './model';

export interface InventoryPanelOptions { readonly onClose: () => void }
/** 6-column grid with roving focus; sorting and filtering never touch the saved inventory. */
export class InventoryPanel {
  readonly dialog: PanelDialog;
  private readonly toolbar = document.createElement('div');
  private readonly grid = document.createElement('div');
  private readonly detail = document.createElement('div');
  private readonly cells: HTMLButtonElement[] = [];
  private filter: InventoryFilter = 'all';
  private selected = 0;
  private state: Pick<ContentState, 'inventory'> = { inventory: [] };
  constructor(host: HTMLElement, options: InventoryPanelOptions) {
    this.dialog = new PanelDialog(host, { title: 'Çanta', panelId: 'inventory', onClose: options.onClose });
    this.toolbar.className = 'mv-toolbar';
    for (const [value, label] of [['all', 'Tümü'], ['material', 'Malzeme'], ['effect', 'Ürün']] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.filter = value;
      button.addEventListener('click', () => { this.filter = value; this.render(); });
      this.toolbar.append(button);
    }
    this.grid.className = 'mv-grid';
    this.grid.setAttribute('role', 'grid');
    this.grid.setAttribute('aria-label', `Çanta, ${INVENTORY_COLUMNS} sütun`);
    this.grid.addEventListener('keydown', (event) => {
      const next = moveSelection(this.selected, event.key, this.cells.length);
      if (next === this.selected && !['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      this.selected = next;
      this.render();
      this.cells[this.selected]?.focus();
    });
    this.detail.className = 'mv-detail';
    const columns = document.createElement('div');
    columns.className = 'mv-columns';
    columns.append(this.grid, this.detail);
    this.dialog.body.append(this.toolbar, columns);
  }
  update(state: Pick<ContentState, 'inventory'>): void {
    this.state = state;
    this.render();
  }
  private render(): void {
    const view: InventoryView = inventoryView(this.state, { filter: this.filter, selectedIndex: this.selected });
    this.dialog.setSubtitle(view.summary);
    for (const button of this.toolbar.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.filter === view.filter));
    }
    if (this.cells.length !== view.cells.length) {
      this.cells.length = 0;
      this.grid.replaceChildren(...view.cells.map(() => {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'mv-grid-cell';
        this.cells.push(cell);
        return cell;
      }));
      this.cells.forEach((cell, index) => cell.addEventListener('click', () => { this.selected = index; this.render(); }));
    }
    view.cells.forEach((model, index) => {
      const cell = this.cells[index];
      cell.classList.toggle('mv-dim', !model.matches);
      cell.setAttribute('aria-selected', String(index === this.selected));
      cell.tabIndex = index === this.selected ? 0 : -1;
      cell.setAttribute('aria-label', model.itemId ? `${model.name}, ${model.quantity} adet` : 'Boş yuva');
      cell.replaceChildren();
      if (!model.itemId) return;
      const icon = document.createElement('img');
      icon.src = model.iconUrl; icon.alt = ''; icon.width = 36; icon.height = 36;
      const count = document.createElement('b');
      count.textContent = String(model.quantity);
      cell.append(icon, count);
    });
    const selected = view.selected;
    this.detail.replaceChildren();
    const title = document.createElement('h3');
    title.textContent = selected?.name ?? 'Yuva boş';
    this.detail.append(title);
    for (const text of selected ? [`${selected.rarity} · ${selected.origin}`, `Adet ${selected.quantity}`, selected.effect ?? 'Simya malzemesi'] : ['Bir yuva seçin.']) {
      const line = document.createElement('p');
      line.textContent = text;
      this.detail.append(line);
    }
  }
  open(opener: HTMLElement | null = null): void { this.dialog.open(opener); this.cells[this.selected]?.focus(); }
  close(): void { this.dialog.close(); }
  get isOpen(): boolean { return this.dialog.isOpen; }
  dispose(): void { this.dialog.dispose(); }
}
