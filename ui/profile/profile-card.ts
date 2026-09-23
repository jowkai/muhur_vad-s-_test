import { installUiStyles } from '../hud/hud-view';
import { installTheme } from '../theme/theme';
import { normalizeName, profileView, renameRefusal } from './model';
import type { WorldState } from '../../world/persistence/world-save';

export const PROFILE_CSS = `
.mv-profile{position:absolute;top:16px;left:16px;width:236px;max-width:calc(100vw - 32px);padding:12px 14px;pointer-events:auto;
  background:radial-gradient(120% 120% at 0% 0%, #24382f 0%, #101d18f2 70%);
  border:2px solid var(--mv-edge,#d9bd7c);border-radius:16px;box-shadow:0 0 0 1px #0d1714 inset;color:var(--mv-ink,#f6efdd)}
.mv-profile-head{display:flex;align-items:center;gap:10px}
.mv-profile-sigil{flex:0 0 auto;width:38px;height:38px;border-radius:50%;border:1px solid #d9bd7c88;
  background:conic-gradient(from 210deg,#e7c884,#8a7442,#e7c884);display:grid;place-items:center;color:#14231d;font:700 16px/1 Georgia,serif}
.mv-profile-name{all:unset;display:block;font:600 16px/1.2 var(--mv-display,Georgia,serif);color:var(--mv-ink,#f6efdd);cursor:text;
  min-height:24px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mv-profile-name:focus-visible{outline:3px solid var(--mv-focus,#f6d79a);outline-offset:2px}
.mv-profile-title{margin:0;font-size:11px;color:var(--mv-gold,#e7c884);letter-spacing:.04em;text-transform:uppercase}
.mv-profile-input{width:150px;min-height:28px;padding:2px 6px;border-radius:8px;border:1px solid var(--mv-gold,#e7c884);
  background:#0e1a16;color:var(--mv-ink,#f6efdd);font:inherit}
.mv-profile-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 10px;margin:10px 0 0;font-size:11px;color:var(--mv-ink-soft,#cfdcc3)}
.mv-profile-stats b{color:var(--mv-ink,#f6efdd);font-weight:600}
.mv-profile-track{display:block;height:6px;margin-top:8px;border-radius:3px;background:#22322c;overflow:hidden}
.mv-profile-fill{display:block;height:100%;background:linear-gradient(90deg,#8fc07a,#e7c884)}
.mv-profile-note{margin:6px 0 0;min-height:14px;font-size:11px;color:var(--mv-ember,#e58b5a)}
@media (max-width:640px){ .mv-profile{width:auto;left:12px;right:12px;padding:10px 12px} .mv-profile-stats{grid-template-columns:repeat(3,minmax(0,1fr))} }`;
export interface ProfileCardOptions {
  /** The domain writes the name; the card only asks. Returns once the record is saved. */
  readonly onRename: (name: string) => Promise<unknown>;
}
/** The card in the top-left corner: the player's name, their earned title and their tally. */
export class ProfileCard {
  readonly root: HTMLElement;
  private readonly sigil = document.createElement('span');
  private readonly name = document.createElement('button');
  private readonly input = document.createElement('input');
  private readonly title = document.createElement('p');
  private readonly stats = document.createElement('dl');
  private readonly fill = document.createElement('span');
  private readonly note = document.createElement('p');
  private state: WorldState | null = null;
  private editing = false;
  private pending = false;
  private disposed = false;
  constructor(host: HTMLElement, private readonly options: ProfileCardOptions) {
    const doc = host.ownerDocument ?? document;
    installUiStyles(doc);
    installTheme(doc);
    if (!doc.getElementById('muhur-profile-style')) {
      const style = doc.createElement('style');
      style.id = 'muhur-profile-style';
      style.textContent = PROFILE_CSS;
      doc.head.append(style);
    }
    this.root = doc.createElement('section');
    this.root.className = 'mv-profile';
    this.root.setAttribute('aria-label', 'Oyuncu kartı');
    this.sigil.className = 'mv-profile-sigil';
    this.name.type = 'button';
    this.name.className = 'mv-profile-name';
    this.name.addEventListener('click', () => this.beginEdit());
    this.input.className = 'mv-profile-input';
    this.input.type = 'text';
    this.input.maxLength = 24;
    this.input.hidden = true;
    this.input.setAttribute('aria-label', 'Oyuncu adı');
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); void this.commit(); }
      if (event.key === 'Escape') { event.preventDefault(); this.cancel(); }
      event.stopPropagation();
    });
    this.input.addEventListener('blur', () => { if (this.editing) void this.commit(); });
    this.title.className = 'mv-profile-title';
    this.stats.className = 'mv-profile-stats';
    this.note.className = 'mv-profile-note';
    this.note.setAttribute('role', 'status');
    const head = doc.createElement('div');
    head.className = 'mv-profile-head';
    const names = doc.createElement('div');
    names.append(this.name, this.input, this.title);
    head.append(this.sigil, names);
    const track = doc.createElement('span');
    track.className = 'mv-profile-track';
    this.fill.className = 'mv-profile-fill';
    track.append(this.fill);
    this.root.append(head, this.stats, track, this.note);
    host.append(this.root);
  }
  private beginEdit(): void {
    if (this.pending || !this.state) return;
    this.editing = true;
    this.input.value = profileView(this.state).name;
    this.input.hidden = false;
    this.name.hidden = true;
    this.note.textContent = '';
    this.input.focus();
    this.input.select();
  }
  private cancel(): void {
    this.editing = false;
    this.input.hidden = true;
    this.name.hidden = false;
    this.note.textContent = '';
  }
  private async commit(): Promise<void> {
    if (!this.editing || this.pending) return;
    const typed = this.input.value;
    const refusal = renameRefusal(typed);
    if (refusal) { this.note.textContent = refusal; this.input.focus(); return; }
    this.pending = true;
    this.editing = false;
    try { await this.options.onRename(normalizeName(typed)); }
    catch (error) { this.note.textContent = error instanceof Error ? error.message : 'Ad kaydedilemedi'; }
    finally {
      this.pending = false;
      this.input.hidden = true;
      this.name.hidden = false;
      if (this.state) this.update(this.state);
    }
  }
  update(state: WorldState): void {
    if (this.disposed) return;
    this.state = state;
    const view = profileView(state);
    this.sigil.textContent = view.name.slice(0, 1).toLocaleUpperCase('tr');
    this.name.textContent = view.name;
    this.name.title = view.editHint;
    this.name.setAttribute('aria-label', `${view.name} · ${view.editHint}`);
    this.title.textContent = view.title;
    this.stats.replaceChildren(...view.stats.flatMap((stat) => {
      const term = document.createElement('dt');
      term.textContent = stat.label;
      const value = document.createElement('dd');
      value.style.margin = '0';
      const strong = document.createElement('b');
      strong.textContent = stat.value;
      value.append(strong);
      return [term, value];
    }));
    this.fill.style.width = `${Math.round(view.progress * 100)}%`;
    this.root.setAttribute('aria-label', `Oyuncu kartı · ${view.name} · ${view.title} · ${view.progressText}`);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.remove();
  }
}
