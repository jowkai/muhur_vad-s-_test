import { creatureById, itemById, recipeById } from '../../content/catalog';
import { creatureAssets, itemAssets } from '../../content/asset-manifest';
import type { WorldState } from '../../world/persistence/world-save';
import { installUiStyles } from '../hud/hud-view';
import { xpRequired } from '../../game/progression';

export type RewardOutcome = 'won' | 'captured' | 'lost' | 'fled' | 'collected';
export interface RewardLine { readonly label: string; readonly detail: string; readonly iconUrl: string | null }
export interface RewardSummary {
  readonly outcome: RewardOutcome; readonly title: string; readonly subtitle: string;
  readonly lines: readonly RewardLine[]; readonly empty: boolean;
}
export interface RewardSnapshot {
  readonly xp: number; readonly level: number; readonly items: Record<string, number>;
  readonly creatureIds: readonly string[]; readonly deliveryBox: number; readonly secrets: number;
  readonly recipes: readonly string[];
}
/** Compact projection of everything a reward can touch; taken before and after the commit. */
export function rewardSnapshot(state: WorldState): RewardSnapshot {
  const items: Record<string, number> = {};
  for (const stack of state.inventory) if (stack) items[stack.itemId] = (items[stack.itemId] ?? 0) + stack.quantity;
  const active = state.creatures.find((creature) => creature.id === state.activeCreatureId);
  return {
    xp: active?.xp ?? 0, level: active?.level ?? 0, items,
    creatureIds: state.creatures.map((creature) => creature.id),
    deliveryBox: state.deliveryBox.length, secrets: state.secretFlags.length,
    recipes: [...state.unlockedRecipeIds],
  };
}
const TITLES: Record<RewardOutcome, [string, string]> = {
  won: ['Zafer', 'Vahşi yaratık bayıldı.'],
  captured: ['Mühürlendi', 'Yeni bir yoldaş koleksiyona katıldı.'],
  lost: ['Bayıldın', 'Kampa döndün; takımın dinleniyor.'],
  fled: ['Kaçtın', 'Bu karşılaşmadan ödül alınmadı.'],
  collected: ['Toplandı', 'Bulduğun şey çantana girdi.'],
};
/**
 * Shows only what the domain actually committed between the two snapshots. It computes no reward
 * of its own, so closing and reopening the window can never hand out anything twice.
 */
export function rewardView(before: RewardSnapshot, after: RewardSnapshot, outcome: RewardOutcome, state: WorldState): RewardSummary {
  const lines: RewardLine[] = [];
  const levels = after.level - before.level;
  const xpGain = levels > 0
    ? after.xp + Array.from({ length: levels }, (_, index) => xpRequired(before.level + index)).reduce((sum, value) => sum + value, 0) - before.xp
    : after.xp - before.xp;
  if (xpGain > 0) {
    const active = state.creatures.find((creature) => creature.id === state.activeCreatureId);
    const species = active && creatureById(active.speciesId);
    lines.push({
      label: `${xpGain} XP`,
      detail: levels > 0 ? `${species?.name ?? 'Yaratık'} seviye ${after.level}` : `${species?.name ?? 'Yaratık'} · ${after.xp}/${xpRequired(after.level)}`,
      iconUrl: species ? creatureAssets[species.id as keyof typeof creatureAssets]?.front ?? null : null,
    });
  }
  for (const [itemId, quantity] of Object.entries(after.items)) {
    const gained = quantity - (before.items[itemId] ?? 0);
    if (gained <= 0) continue;
    lines.push({
      label: `${itemById(itemId)?.name ?? itemId} ×${gained}`, detail: 'Çantaya eklendi',
      iconUrl: itemAssets[itemId as keyof typeof itemAssets] ?? null,
    });
  }
  for (const creatureId of after.creatureIds) {
    if (before.creatureIds.includes(creatureId)) continue;
    const creature = state.creatures.find((entry) => entry.id === creatureId);
    const species = creature && creatureById(creature.speciesId);
    lines.push({
      label: species?.name ?? 'Yeni yaratık', detail: `Seviye ${creature?.level ?? 1} · koleksiyona katıldı`,
      iconUrl: species ? creatureAssets[species.id as keyof typeof creatureAssets]?.front ?? null : null,
    });
  }
  const delivered = after.deliveryBox - before.deliveryBox;
  if (delivered > 0) lines.push({ label: `${delivered} ödül teslim kutusunda`, detail: 'Çantada yer açınca alınacak', iconUrl: null });
  if (after.secrets > before.secrets) lines.push({ label: 'Bir sır keşfedildi', detail: 'Bölge sırrı kayda geçti', iconUrl: null });
  for (const recipeId of after.recipes) {
    if (before.recipes.includes(recipeId)) continue;
    const recipe = recipeById(recipeId);
    const output = recipe && itemById(recipe.output.itemId);
    lines.push({
      label: `Yeni tarif: ${output?.name ?? recipeId}`,
      detail: 'Simya defterine işlendi',
      iconUrl: output ? itemAssets[output.id as keyof typeof itemAssets] ?? null : null,
    });
  }
  const [title, subtitle] = TITLES[outcome];
  return { outcome, title, subtitle, lines, empty: lines.length === 0 };
}

export const REWARD_CSS = `
.mv-reward{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,calc(100vw - 32px));
 padding:22px;background:#101d1af5;border:1px solid #d9bd7c;border-radius:16px;color:#f1ead6;pointer-events:auto;z-index:7;
 font:14px/1.5 system-ui,sans-serif}
.mv-reward[hidden]{display:none}
.mv-reward h2{margin:0 0 4px;font:600 22px/1.2 Georgia,serif;color:#f6e3b4}
.mv-reward p.mv-reward-sub{margin:0 0 14px;font-size:13px;color:#c7d6bb}
.mv-reward ul{list-style:none;margin:0 0 16px;padding:0;display:flex;flex-direction:column;gap:8px}
.mv-reward li{display:flex;gap:10px;align-items:center;padding:8px 10px;background:#16231f;border-radius:10px}
.mv-reward li img{width:40px;height:40px}
.mv-reward li b{display:block;font-size:14px}
.mv-reward li span{font-size:12px;color:#c7d6bb}
.mv-reward button{min-height:44px;padding:0 18px;border-radius:10px;border:1px solid #d9bd7c;background:#d9bd7c;color:#12201c;font:inherit;font-weight:600;cursor:pointer}
.mv-reward button:focus-visible{outline:3px solid #f0c987;outline-offset:2px}`;
export interface RewardPanelOptions { readonly onDismiss: () => void }
/** Result window over the world; it renders a summary and dismisses, nothing more. */
export class RewardPanel {
  readonly root: HTMLElement;
  private readonly heading = document.createElement('h2');
  private readonly subtitle = document.createElement('p');
  private readonly list = document.createElement('ul');
  private readonly close = document.createElement('button');
  private shown: RewardSummary | null = null;
  private disposed = false;
  private readonly onKey = (event: KeyboardEvent) => {
    if (this.root.hidden || !['Enter', 'Escape', ' '].includes(event.key) || event.repeat) return;
    event.preventDefault();
    this.options.onDismiss();
  };
  constructor(host: HTMLElement, private readonly options: RewardPanelOptions) {
    installUiStyles(host.ownerDocument ?? document);
    if (!document.getElementById('muhur-reward-style')) {
      const style = document.createElement('style');
      style.id = 'muhur-reward-style';
      style.textContent = REWARD_CSS;
      document.head.append(style);
    }
    this.root = document.createElement('section');
    this.root.className = 'mv-reward';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'false');
    this.root.setAttribute('aria-label', 'Karşılaşma sonucu');
    this.root.hidden = true;
    this.subtitle.className = 'mv-reward-sub';
    this.close.type = 'button';
    this.close.textContent = 'Devam et (Enter)';
    this.close.addEventListener('click', () => options.onDismiss());
    this.root.append(this.heading, this.subtitle, this.list, this.close);
    host.append(this.root);
    window.addEventListener('keydown', this.onKey);
  }
  update(summary: RewardSummary | null): void {
    if (this.disposed) return;
    this.root.hidden = !summary;
    if (!summary || summary === this.shown) { if (summary) this.shown = summary; return; }
    this.shown = summary;
    this.heading.textContent = summary.title;
    this.subtitle.textContent = summary.subtitle;
    this.list.replaceChildren(...summary.lines.map((line) => {
      const item = document.createElement('li');
      if (line.iconUrl) {
        const icon = document.createElement('img');
        icon.src = line.iconUrl; icon.alt = ''; icon.width = 40; icon.height = 40;
        item.append(icon);
      }
      const body = document.createElement('div');
      const label = document.createElement('b');
      label.textContent = line.label;
      const detail = document.createElement('span');
      detail.textContent = line.detail;
      body.append(label, detail);
      item.append(body);
      return item;
    }));
    this.close.focus();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }
}
