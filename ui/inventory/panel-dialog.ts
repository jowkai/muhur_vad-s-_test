import type { CommandIntent, InputOwner, PanelId } from '../../contracts';
import { tabForKey } from '../shell/tabs';
import { installUiStyles } from '../hud/hud-view';
import { installTheme } from '../theme/theme';

export const PANEL_CSS = `
.mv-panel{position:absolute;z-index:5;inset:0;display:flex;align-items:center;justify-content:center;background:#060d0cbb;pointer-events:auto}
.mv-panel[hidden]{display:none}
.mv-panel-frame{position:relative;width:min(920px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:22px;
 background:#101d1a;border:1px solid #d9bd7c88;border-radius:16px;color:#f1ead6;font:14px/1.45 system-ui,sans-serif}
.mv-panel-frame *{box-sizing:border-box}
.mv-panel-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px}
.mv-panel-head h2{margin:0;font:600 20px/1.2 Georgia,serif}
.mv-panel-head p{margin:0;font-size:12px;color:#c7d6bb}
.mv-panel button{min-height:44px;padding:0 14px;border-radius:9px;border:1px solid #d9bd7c;background:transparent;color:#f1ead6;font:inherit;cursor:pointer}
.mv-panel button[aria-pressed="true"]{background:#d9bd7c;color:#12201c}
.mv-panel button:disabled{opacity:.55;cursor:not-allowed}
.mv-panel button:focus-visible,.mv-grid-cell:focus-visible{outline:3px solid #f0c987;outline-offset:2px}
.mv-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}
.mv-grid-cell{position:relative;aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
 min-height:64px;padding:6px;border-radius:10px;border:1px solid #3c4d44;background:#16231f;color:#f1ead6;font:inherit;cursor:pointer}
.mv-grid-cell[aria-selected="true"]{border-color:#f0c987;background:#1d2f28}
.mv-grid-cell img{width:36px;height:36px}
.mv-grid-cell b{position:absolute;right:6px;bottom:4px;font-size:11px}
.mv-grid-cell.mv-dim{opacity:.35}
.mv-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:16px}
.mv-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.mv-list button{width:100%;text-align:left}
.mv-detail{padding:12px;border-radius:12px;background:#16231f;border:1px solid #3c4d44}
.mv-detail h3{margin:0 0 6px;font:600 16px Georgia,serif}
.mv-detail p{margin:4px 0;font-size:12px;color:#c7d6bb}
.mv-detail .mv-warn{color:#f0b48f}
.mv-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
@media (max-width:900px){.mv-columns{grid-template-columns:minmax(0,1fr)}.mv-grid{grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}}`;
// A roving-tabindex cell keeps `tabindex="-1"`, so it must stay out of the tab cycle we trap.
const FOCUSABLE = 'button:not(:disabled):not([tabindex="-1"]), [href]:not([tabindex="-1"]), input:not(:disabled):not([tabindex="-1"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
const stack: PanelDialog[] = [];
/** Keyboard ownership of the panels; battle keys are routed elsewhere by the command bus owner. */
export function panelIntentForKey(key: string, owner: InputOwner, openPanel: PanelId | null): CommandIntent | null {
  if (owner === 'battle' || owner === 'none') return null;
  if (key === 'Escape') return openPanel ? { type: 'close-panel' } : null;
  if (openPanel) return null;
  // One shortcut table for the bar and the keyboard: the bottom tabs define it.
  const tab = tabForKey(key);
  return tab ? { type: 'open-panel', panel: tab.id } : null;
}
export interface PanelDialogOptions { readonly title: string; readonly panelId: PanelId; readonly onClose: () => void }
/**
 * Shared modal shell for the three strategy panels: real dialog semantics, a focus trap, Escape on
 * the topmost panel only, and focus returned to whatever opened it.
 */
export class PanelDialog {
  readonly root: HTMLElement;
  readonly frame: HTMLElement;
  readonly body = document.createElement('div');
  private readonly heading = document.createElement('h2');
  private readonly subtitle = document.createElement('p');
  private readonly closeButton = document.createElement('button');
  private opener: HTMLElement | null = null;
  private disposed = false;
  private readonly onKey = (event: KeyboardEvent) => {
    if (this.root.hidden || stack.at(-1) !== this) return;
    if (event.key === 'Escape') { event.preventDefault(); this.options.onClose(); return; }
    if (event.key !== 'Tab') return;
    const nodes = [...this.frame.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.offsetParent !== null || node === document.activeElement);
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    const active = this.frame.ownerDocument.activeElement;
    if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
    else if (!this.frame.contains(active)) { event.preventDefault(); first.focus(); }
  };
  /** A re-render can remove the focused control; focus must not fall out of an open dialog. */
  private readonly onFocusOut = (event: FocusEvent) => {
    if (!this.isOpen || this.frame.contains(event.relatedTarget as Node | null)) return;
    queueMicrotask(() => {
      if (!this.isOpen || this.frame.contains(this.frame.ownerDocument.activeElement)) return;
      (this.frame.querySelector<HTMLElement>(FOCUSABLE) ?? this.frame).focus();
    });
  };
  constructor(host: HTMLElement, private readonly options: PanelDialogOptions) {
    installUiStyles(host.ownerDocument ?? document);
    installTheme(host.ownerDocument ?? document);
    if (!document.getElementById('muhur-panel-style')) {
      const style = document.createElement('style');
      style.id = 'muhur-panel-style';
      style.textContent = PANEL_CSS;
      document.head.append(style);
    }
    this.root = document.createElement('div');
    this.root.className = 'mv-panel';
    this.root.hidden = true;
    this.frame = document.createElement('section');
    this.frame.className = 'mv-panel-frame';
    this.frame.setAttribute('role', 'dialog');
    this.frame.setAttribute('aria-modal', 'true');
    this.frame.setAttribute('aria-label', options.title);
    this.frame.tabIndex = -1;
    this.heading.textContent = options.title;
    this.subtitle.className = 'mv-panel-subtitle';
    this.closeButton.type = 'button';
    this.closeButton.textContent = 'Kapat (Esc)';
    this.closeButton.addEventListener('click', () => options.onClose());
    const head = document.createElement('header');
    head.className = 'mv-panel-head';
    const titles = document.createElement('div');
    titles.append(this.heading, this.subtitle);
    head.append(titles, this.closeButton);
    this.frame.append(head, this.body);
    this.root.append(this.frame);
    host.append(this.root);
    this.frame.addEventListener('focusout', this.onFocusOut as EventListener);
    (host.ownerDocument ?? document).addEventListener('keydown', this.onKey as EventListener, true);
  }
  get isOpen(): boolean { return !this.root.hidden; }
  setSubtitle(text: string): void { this.subtitle.textContent = text; }
  open(opener: HTMLElement | null = null): void {
    if (this.disposed || this.isOpen) return;
    this.opener = opener ?? (document.activeElement as HTMLElement | null);
    this.root.hidden = false;
    stack.push(this);
    const first = this.frame.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? this.frame).focus();
  }
  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    const index = stack.indexOf(this);
    if (index >= 0) stack.splice(index, 1);
    this.opener?.focus();
    this.opener = null;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.close();
    this.frame.removeEventListener('focusout', this.onFocusOut as EventListener);
    (this.root.ownerDocument ?? document).removeEventListener('keydown', this.onKey as EventListener, true);
    this.root.remove();
  }
}
