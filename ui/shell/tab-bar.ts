import type { CommandIntent, PanelId } from '../../contracts';
import { installUiStyles } from '../hud/hud-view';
import { TABS, tabItems, type TabItem } from './tabs';

export interface TabBarOptions {
  /** One way out: the bar publishes an intent, the session decides what happens. */
  readonly send: (intent: CommandIntent) => void;
}
/**
 * The bottom-centre tab bar. It owns no game state: it renders `tabItems` and publishes the
 * intent of whichever tab was pressed, exactly like the keyboard shortcut would.
 */
export class TabBarView {
  readonly root: HTMLElement;
  private readonly buttons = new Map<PanelId, HTMLButtonElement>();
  private items: readonly TabItem[] = tabItems({ open: null });
  private disposed = false;
  constructor(dock: HTMLElement, private readonly options: TabBarOptions) {
    installUiStyles(dock.ownerDocument ?? document);
    this.root = document.createElement('nav');
    this.root.className = 'mv-tabbar';
    this.root.setAttribute('aria-label', 'Paneller');
    for (const tab of TABS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.panel = tab.id;
      button.setAttribute('aria-pressed', 'false');
      button.title = tab.hint;
      const label = document.createElement('span');
      label.textContent = tab.label;
      const key = document.createElement('span');
      key.className = 'mv-tab-key';
      key.textContent = tab.key.toUpperCase();
      button.append(label, key);
      button.addEventListener('click', () => {
        const item = this.items.find((entry) => entry.id === tab.id);
        if (item?.enabled) this.options.send(item.intent);
      });
      this.buttons.set(tab.id, button);
      this.root.append(button);
    }
    // The status line stays above the bar, so the bar is the second row of the dock.
    const status = dock.firstElementChild;
    if (status) status.after(this.root); else dock.append(this.root);
  }
  update(open: PanelId | null, locked = false, unavailable: readonly PanelId[] = []): void {
    if (this.disposed) return;
    this.items = tabItems({ open, locked, unavailable });
    for (const item of this.items) {
      const button = this.buttons.get(item.id)!;
      button.setAttribute('aria-pressed', String(item.active));
      button.disabled = !item.enabled;
      button.setAttribute('aria-label', `${item.label} · ${item.shortcut}`);
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.remove();
    this.buttons.clear();
  }
}
