import type { CommandIntent } from '../../contracts';
import { installUiStyles } from '../hud/hud-view';
import type { EncounterCard } from './card';

export interface CardViewOptions {
  /** UI only publishes intents; the adapter turns them into commands the domain validates. */
  readonly onIntent: (intent: CommandIntent) => void;
  readonly keyTarget?: Window | HTMLElement;
}
/** Large proximity card: 128 px original SVG, name, level, element and the Enter affordance. */
export class EncounterCardView {
  readonly root: HTMLElement;
  private readonly image = document.createElement('img');
  private readonly name = document.createElement('h3');
  private readonly facts = document.createElement('dl');
  private readonly hint = document.createElement('span');
  private card: EncounterCard | null = null;
  private disposed = false;
  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.repeat || !this.card?.enabled) return;
    event.preventDefault();
    this.options.onIntent(this.card.intent);
  };
  constructor(host: HTMLElement, private readonly options: CardViewOptions) {
    installUiStyles(host.ownerDocument ?? document);
    this.root = document.createElement('aside');
    this.root.className = 'mv-card';
    this.root.setAttribute('aria-live', 'polite');
    this.root.hidden = true;
    this.image.width = 128; this.image.height = 128; this.image.alt = '';
    this.hint.className = 'mv-hint';
    const body = document.createElement('div');
    body.append(this.name, this.facts, this.hint);
    this.root.append(this.image, body);
    host.append(this.root);
    (this.options.keyTarget ?? window).addEventListener('keydown', this.onKey as EventListener);
  }
  update(card: EncounterCard | null): void {
    if (this.disposed) return;
    this.card = card;
    this.root.hidden = !card;
    if (!card) { this.root.removeAttribute('aria-label'); return; }
    this.image.src = card.spriteUrl;
    this.image.alt = `${card.name} görseli`;
    this.name.textContent = card.name;
    const rows: [string, string][] = [];
    if (card.level !== null) rows.push(['Seviye', String(card.level)]);
    if (card.element) rows.push(['Element', card.element]);
    if (card.kind === 'creature') rows.push(['Davranış', card.behaviour]);
    if (card.biomeLabel) rows.push(['Bölge', card.biomeLabel]);
    this.facts.replaceChildren(...rows.flatMap(([term, value]) => {
      const dt = document.createElement('dt'); dt.textContent = term;
      const dd = document.createElement('dd'); dd.textContent = value;
      return [dt, dd];
    }));
    this.hint.textContent = card.hint;
    this.hint.dataset.disabled = String(!card.enabled);
    this.root.setAttribute('aria-label', `${card.name}, ${card.hint}`);
  }
  /** Mirrors a click/tap of the affordance; the same intent the Enter key publishes. */
  trigger(): void { if (this.card?.enabled) this.options.onIntent(this.card.intent); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    (this.options.keyTarget ?? window).removeEventListener('keydown', this.onKey as EventListener);
    this.root.remove();
  }
}
