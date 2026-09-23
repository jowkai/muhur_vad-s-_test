import { PanelDialog } from '../inventory/panel-dialog';
import type { WorldState } from '../../world/persistence/world-save';
import { objectivesPanelView, type ObjectiveRow } from './model';

export interface ObjectivesPanelOptions { readonly onClose: () => void }
/** Read-only panel: the eight objectives, the open ones first, then the finished ones. */
export class ObjectivesPanel {
  readonly dialog: PanelDialog;
  private readonly openList = document.createElement('ul');
  private readonly done = document.createElement('ul');
  constructor(host: HTMLElement, options: ObjectivesPanelOptions) {
    this.dialog = new PanelDialog(host, { title: 'Hedefler', panelId: 'objectives', onClose: options.onClose });
    for (const [list, label] of [[this.openList, 'Süren hedefler'], [this.done, 'Tamamlananlar']] as const) {
      list.className = 'mv-list';
      list.setAttribute('aria-label', label);
    }
    const columns = document.createElement('div');
    columns.className = 'mv-columns';
    columns.append(this.openList, this.done);
    this.dialog.body.append(columns);
  }
  update(state: WorldState): void {
    const view = objectivesPanelView(state);
    this.dialog.setSubtitle(`${view.summary} · %${Math.round(view.ratio * 100)}`);
    this.openList.replaceChildren(...view.open.map((row) => this.row(row)));
    this.done.replaceChildren(...view.done.map((row) => this.row(row)));
  }
  private row(row: ObjectiveRow): HTMLElement {
    const item = document.createElement('li');
    item.className = `mv-objective${row.status === 'done' ? ' mv-objective-done' : ''}`;
    const title = document.createElement('b');
    title.textContent = row.title;
    const progress = document.createElement('span');
    progress.textContent = `${row.progressText} · %${row.percent}`;
    const hint = document.createElement('small');
    hint.textContent = row.status === 'done' ? 'Tamamlandı' : row.hint;
    const track = document.createElement('span');
    track.className = 'mv-bar-track';
    const fill = document.createElement('span');
    fill.className = 'mv-bar-fill';
    fill.style.width = `${row.percent}%`;
    track.append(fill);
    item.append(title, progress, track, hint);
    item.setAttribute('aria-label', `${row.title}: ${row.progressText}${row.status === 'done' ? ', tamamlandı' : ''}`);
    return item;
  }
  open(opener: HTMLElement | null = null): void { this.dialog.open(opener); }
  close(): void { this.dialog.close(); }
  dispose(): void { this.dialog.dispose(); }
}
