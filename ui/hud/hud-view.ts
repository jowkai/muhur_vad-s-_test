import type { PanelId } from '../../contracts';
import { hudSections, type HudModel } from './model';

export const UI_STYLE_ID = 'muhur-ui-style';
/** Scoped UI styling shipped with the layer; G00's global stylesheet stays untouched. */
export const UI_CSS = `
.mv-layer{position:absolute;inset:0;pointer-events:none;font:14px/1.45 system-ui,sans-serif;color:#f1ead6}
.mv-layer *{box-sizing:border-box}
.mv-hud{position:absolute;top:172px;left:16px;width:236px;max-width:calc(100vw - 32px);padding:14px 16px;background:#0f1b18f2;border:1px solid #d9bd7c55;border-radius:12px}
.mv-hud h2{margin:0 0 2px;font:600 16px/1.2 Georgia,serif;color:#f6f1e0}
.mv-hud .mv-sub{margin:0 0 10px;font-size:12px;color:#b9c9ac}
.mv-bar{margin:6px 0}
.mv-bar-head{display:flex;justify-content:space-between;font-size:12px;color:#e6dcc0}
.mv-bar-track{height:8px;margin-top:3px;border-radius:4px;background:#22322c;overflow:hidden}
.mv-bar-fill{height:100%;background:#8fc07a;transition:width .16s linear}
.mv-bar.mv-xp .mv-bar-fill{background:#d9bd7c}
.mv-bar.mv-low .mv-bar-fill{background:#e1734f}
.mv-dock{position:absolute;z-index:2;left:50%;bottom:16px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;
  max-width:calc(100vw - 32px);pointer-events:none}
.mv-tabbar{display:flex;gap:6px;padding:6px;background:#0f1b18f2;border:1px solid #d9bd7c55;border-radius:14px;pointer-events:auto;
  overflow-x:auto;scrollbar-width:none;max-width:100%}
.mv-tabbar::-webkit-scrollbar{display:none}
.mv-tabbar button{min-height:44px;min-width:44px;padding:0 14px;border-radius:10px;border:1px solid transparent;background:transparent;
  color:#f1ead6;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.mv-tabbar button[aria-pressed="true"]{background:#d9bd7c;color:#12201c;font-weight:600}
.mv-tabbar button[disabled]{opacity:.45;cursor:not-allowed}
.mv-tabbar button:focus-visible{outline:3px solid #f0c987;outline-offset:2px}
.mv-tabbar .mv-tab-key{margin-left:6px;font-size:11px;opacity:.7}
.mv-dock-status{margin:0;min-height:18px;font-size:12px;color:#ffdca8;text-align:center}
.mv-utility{padding:4px}
.mv-utility button{font-size:12px;padding:0 10px;min-height:36px}
.mv-warning{margin-top:10px;padding:8px 10px;border-radius:8px;background:#3a1f18;color:#ffc9ac;font-size:12px}
.mv-message{font-size:12px;color:#ffdca8}
.mv-minimap{position:absolute;left:16px;bottom:16px;width:var(--mv-size,192px);text-align:center}
.mv-minimap canvas{display:block;border-radius:50%}
.mv-minimap-caption{margin:6px 0 0;font-size:12px;color:#e6dcc0}
.mv-minimap-readout{margin:2px 0 0;font-size:11px;color:#b9c9ac}
.mv-card{position:absolute;left:50%;bottom:calc(var(--mv-dock-height,330px) + 16px);transform:translateX(-50%);width:340px;min-height:172px;display:flex;gap:14px;align-items:center;
  padding:16px;background:#0f1b18f7;border:1px solid #d9bd7c88;border-radius:14px;pointer-events:auto}
.mv-card{z-index:1}
.mv-card[hidden]{display:none}
.mv-card img{width:128px;height:128px;flex:0 0 128px;image-rendering:auto}
.mv-card h3{margin:0 0 6px;font:600 20px/1.2 Georgia,serif}
.mv-card dl{display:grid;grid-template-columns:auto auto;gap:2px 10px;margin:0 0 10px;font-size:12px;color:#c7d6bb}
.mv-card dd{margin:0;color:#f1ead6}
.mv-hint{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:8px;border:1px solid #d9bd7c;background:#d9bd7c;color:#12201c;font-size:13px;font-weight:600}
.mv-hint[data-disabled="true"]{background:transparent;color:#e9c39f;border-color:#e1734f}
@media (max-width:1279px){
 .mv-card{width:260px;left:auto;right:16px;transform:none;min-height:140px}
 .mv-card img{width:112px;height:112px;flex-basis:112px}
}
@media (max-width:640px){
 .mv-hud{width:auto;left:12px;right:12px;top:186px;padding:10px 12px}
 .mv-minimap{--mv-size:120px;left:12px;bottom:236px}
 .mv-dock{left:0;right:0;bottom:10px;transform:none;width:100%;max-width:100%;padding:0 8px}
 .mv-tabbar{width:100%;justify-content:space-between;gap:4px;padding:4px}
 .mv-tabbar button{padding:0 8px;font-size:12px}
 .mv-tabbar .mv-tab-key{display:none}
 .mv-card{right:12px;left:12px;width:auto}
}`;
export function installUiStyles(root: Document = document): void {
  if (root.getElementById(UI_STYLE_ID)) return;
  const style = root.createElement('style');
  style.id = UI_STYLE_ID;
  style.textContent = UI_CSS;
  root.head.append(style);
}
interface BarNodes { root: HTMLElement; label: HTMLElement; value: HTMLElement; fill: HTMLElement }
function makeBar(className: string, label: string): BarNodes {
  const root = document.createElement('div');
  root.className = `mv-bar ${className}`;
  const head = document.createElement('div');
  head.className = 'mv-bar-head';
  const name = document.createElement('span');
  name.textContent = label;
  const value = document.createElement('span');
  head.append(name, value);
  const track = document.createElement('div');
  track.className = 'mv-bar-track';
  const fill = document.createElement('div');
  fill.className = 'mv-bar-fill';
  track.append(fill);
  root.append(head, track);
  return { root, label: name, value, fill };
}
/** Renders the HUD model. It holds no game state and sends no commands. */
export interface HudViewOptions {
  readonly onToggleSound?: () => boolean;
  readonly onTogglePause?: () => boolean;
  readonly onExportSave?: () => void;
  readonly onOpenSettings?: () => void;
  /** Kept for callers that had their own panel buttons; v2 opens panels from the tab bar. */
  readonly onOpenPanel?: (panel: PanelId) => void;
}
export class HudView {
  readonly root: HTMLElement;
  /** Bottom-centre dock: the status line, the tab bar and the party strip share it. */
  readonly dock = document.createElement('div');
  private readonly controls = document.createElement('div');
  private readonly soundButton = document.createElement('button');
  private readonly pauseButton = document.createElement('button');
  private readonly exportButton = document.createElement('button');
  private readonly title = document.createElement('h2');
  private readonly subtitle = document.createElement('p');
  private readonly hp = makeBar('mv-hp', 'Can');
  private readonly xp = makeBar('mv-xp', 'Deneyim');
  private readonly warning = document.createElement('p');
  private readonly message = document.createElement('p');
  private disposed = false;
  /** Publishes the dock's height, so the encounter card always sits clear of the tab bar. */
  private readonly dockSize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
    const height = entries[0]?.target.getBoundingClientRect().height ?? 0;
    if (height > 0) this.dock.parentElement?.style.setProperty('--mv-dock-height', `${Math.round(height + 16)}px`);
  });
  constructor(host: HTMLElement, options: HudViewOptions = {}) {
    installUiStyles(host.ownerDocument ?? document);
    this.root = document.createElement('section');
    this.root.className = 'mv-hud';
    this.root.setAttribute('aria-label', 'Oyuncu durumu');
    this.subtitle.className = 'mv-sub';
    this.warning.className = 'mv-warning';
    this.warning.setAttribute('role', 'alert');
    this.warning.hidden = true;
    this.message.className = 'mv-message';
    this.message.setAttribute('role', 'status');
    this.controls.className = 'mv-tabbar mv-utility';
    this.soundButton.type = 'button';
    this.soundButton.textContent = 'Ses';
    this.soundButton.setAttribute('aria-pressed', 'false');
    if (options.onToggleSound) {
      this.soundButton.addEventListener('click', () => this.setSound(!options.onToggleSound!()));
      this.controls.append(this.soundButton);
    }
    if (options.onTogglePause) {
      this.pauseButton.type = 'button';
      this.pauseButton.textContent = 'Duraklat (P)';
      this.pauseButton.addEventListener('click', () => options.onTogglePause!());
      this.controls.append(this.pauseButton);
    }
    if (options.onOpenSettings) {
      const settings = document.createElement('button');
      settings.type = 'button';
      settings.textContent = 'Ayarlar';
      settings.addEventListener('click', () => options.onOpenSettings!());
      this.controls.append(settings);
    }
    if (options.onExportSave) {
      this.exportButton.type = 'button';
      this.exportButton.textContent = 'Kaydı dışa aktar';
      this.exportButton.addEventListener('click', () => options.onExportSave!());
      this.controls.append(this.exportButton);
    }
    // The left panel keeps health and experience only; everything else lives in the bottom dock.
    this.root.append(this.title, this.subtitle, this.hp.root, this.xp.root, this.warning);
    host.append(this.root);
    this.dock.className = 'mv-dock';
    // Keeps the old hook for tests and adds the dock's own layout class.
    this.message.className = 'mv-message mv-dock-status';
    this.dock.append(this.message, this.controls);
    host.append(this.dock);
    this.dockSize?.observe(this.dock);
  }
  update(model: HudModel): void {
    if (this.disposed) return;
    const sections = new Map(hudSections(model).map((section) => [section.id, section]));
    this.title.textContent = sections.get('identity')!.text;
    this.subtitle.textContent = sections.get('biome')!.text;
    const hp = sections.get('hp')!, xp = sections.get('xp')!;
    this.hp.value.textContent = hp.text;
    this.hp.fill.style.width = `${(hp.ratio ?? 0) * 100}%`;
    this.hp.root.classList.toggle('mv-low', hp.tone === 'low');
    this.xp.value.textContent = xp.text;
    this.xp.fill.style.width = `${(xp.ratio ?? 0) * 100}%`;
    this.pauseButton.setAttribute('aria-pressed', String(model.paused));
    this.pauseButton.textContent = model.paused ? 'Devam et (P)' : 'Duraklat (P)';
    const warning = sections.get('warning');
    this.warning.hidden = !warning;
    this.warning.textContent = warning?.text ?? '';
    this.message.textContent = model.message ?? '';
  }
  /** `on` mirrors the audio layer's state; the HUD never decides whether sound is allowed. */
  setSound(on: boolean): void {
    this.soundButton.setAttribute('aria-pressed', String(on));
    this.soundButton.textContent = on ? 'Ses açık' : 'Ses kapalı';
    this.soundButton.setAttribute('aria-label', on ? 'Sesi kapat' : 'Sesi aç');
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dockSize?.disconnect();
    this.root.remove();
    this.dock.remove();
  }
}
