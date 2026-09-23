import { PanelDialog } from '../inventory/panel-dialog';
import {
  ACTIONS, DEFAULT_PREFERENCES, loadPreferences, rebind, savePreferences, type ActionId, type Preferences,
} from './preferences';

export interface SettingsPanelOptions {
  readonly onClose: () => void;
  /** The shell applies what changed: volume to the audio layer, motion to the renderer. */
  readonly onChange: (preferences: Preferences) => void;
}
/**
 * Sound, motion and key bindings. Preferences live on the device, never in the save, and a
 * browser that refuses storage only costs persistence — the panel keeps working.
 */
export class SettingsPanel {
  readonly dialog: PanelDialog;
  private readonly volume = document.createElement('input');
  private readonly motion = document.createElement('input');
  private readonly bindings = new Map<ActionId, HTMLButtonElement>();
  private readonly notice = document.createElement('p');
  private preferences: Preferences = loadPreferences();
  private listening: ActionId | null = null;
  private readonly onKey = (event: KeyboardEvent) => {
    if (!this.listening) return;
    event.preventDefault();
    const result = rebind(this.preferences, this.listening, event.code || event.key);
    this.listening = null;
    if (result.error) { this.notice.textContent = result.error; this.render(); return; }
    this.apply(result.preferences);
  };
  constructor(host: HTMLElement, private readonly options: SettingsPanelOptions) {
    this.dialog = new PanelDialog(host, { title: 'Ayarlar', panelId: 'settings', onClose: options.onClose });
    const list = document.createElement('div');
    list.className = 'mv-settings';
    this.volume.type = 'range';
    this.volume.min = '0'; this.volume.max = '100'; this.volume.step = '5';
    this.volume.setAttribute('aria-label', 'Ses seviyesi');
    this.volume.addEventListener('input', () => this.apply({ ...this.preferences, volume: Number(this.volume.value) / 100 }));
    this.motion.type = 'checkbox';
    this.motion.id = 'mv-reduced-motion';
    this.motion.addEventListener('change', () => this.apply({ ...this.preferences, reducedMotion: this.motion.checked }));
    const motionLabel = document.createElement('label');
    motionLabel.htmlFor = this.motion.id;
    motionLabel.textContent = 'Hareketi azalt';
    const volumeRow = document.createElement('div');
    volumeRow.className = 'mv-settings-row';
    const volumeLabel = document.createElement('span');
    volumeLabel.textContent = 'Ses';
    volumeRow.append(volumeLabel, this.volume);
    const motionRow = document.createElement('div');
    motionRow.className = 'mv-settings-row';
    motionRow.append(this.motion, motionLabel);
    list.append(volumeRow, motionRow);
    for (const action of ACTIONS) {
      const row = document.createElement('div');
      row.className = 'mv-settings-row';
      const label = document.createElement('span');
      label.textContent = action.label;
      const button = document.createElement('button');
      button.type = 'button';
      button.addEventListener('click', () => {
        this.listening = action.id;
        this.notice.textContent = `${action.label} için bir tuşa bas`;
        this.render();
      });
      this.bindings.set(action.id, button);
      row.append(label, button);
      list.append(row);
    }
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Varsayılana dön';
    reset.addEventListener('click', () => this.apply(DEFAULT_PREFERENCES));
    this.notice.className = 'mv-settings-note';
    this.notice.setAttribute('role', 'status');
    this.dialog.body.append(list, reset, this.notice);
    this.dialog.frame.addEventListener('keydown', this.onKey as EventListener);
    this.render();
  }
  private apply(next: Preferences): void {
    this.preferences = next;
    const stored = savePreferences(next);
    if (!stored) this.notice.textContent = 'Tercihler bu tarayıcıda saklanamıyor; bu oturumda geçerli.';
    this.options.onChange(next);
    this.render();
  }
  get current(): Preferences { return this.preferences; }
  private render(): void {
    this.volume.value = String(Math.round(this.preferences.volume * 100));
    this.motion.checked = this.preferences.reducedMotion;
    for (const action of ACTIONS) {
      const button = this.bindings.get(action.id)!;
      const listening = this.listening === action.id;
      button.textContent = listening ? 'Tuşa bas…' : this.preferences.keys[action.id];
      button.setAttribute('aria-label', `${action.label}: ${this.preferences.keys[action.id]}`);
      button.setAttribute('aria-pressed', String(listening));
    }
    this.dialog.setSubtitle(`Ses %${Math.round(this.preferences.volume * 100)} · ${this.preferences.reducedMotion ? 'hareket azaltıldı' : 'tam hareket'}`);
  }
  update(): void { this.render(); }
  open(opener: HTMLElement | null = null): void { this.dialog.open(opener); }
  close(): void { this.dialog.close(); }
  dispose(): void {
    this.dialog.frame.removeEventListener('keydown', this.onKey as EventListener);
    this.dialog.dispose();
  }
}
