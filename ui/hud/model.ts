import { MAX_LEVEL } from '../../contracts';
import type { BiomeId } from '../../contracts';
import { creatureById } from '../../content/catalog';
import { stats } from '../../game/combat/core';
import { xpRequired } from '../../game/progression';
import type { WorldState } from '../../world/persistence/world-save';
import { REGION_GATE } from '../../world/chunks/chunks';
import { ROLE_RULES, roleUnlocked } from '../../game/roles';
import { BIOME_LABEL, MODE_LABEL } from './labels';

export interface HudBar { readonly value: number; readonly max: number; readonly ratio: number; readonly text: string }
export interface HudModel {
  readonly mode: string; readonly modeLabel: string; readonly paused: boolean;
  readonly biome: { readonly id: BiomeId; readonly label: string };
  readonly active: { readonly name: string; readonly level: number; readonly hp: HudBar; readonly xp: HudBar } | null;
  readonly team: HudBar; readonly eggs: HudBar; readonly warning: string | null;
  readonly message: string | null; readonly movementAllowed: boolean;
  /** v2: the ten minute clock, shown on the region line. */
  readonly day: string | null;
  /**
   * v4: what this region asks the team to be able to do, when the team cannot do it yet.
   * `REGION_GATE` has existed since v3 with a comment claiming the HUD warns about it; it never
   * did, because wiring it up belonged to a different node. This is that wiring.
   */
  readonly gate: string | null;
}
/** Exactly what the left panel is allowed to show, in order. */
export type HudSectionId = 'identity' | 'biome' | 'hp' | 'xp' | 'gate' | 'warning';
export interface HudSection {
  readonly id: HudSectionId; readonly label: string; readonly text: string;
  readonly ratio: number | null; readonly tone: 'normal' | 'low' | 'alert';
}
/**
 * v2 keeps the left panel to health and experience: bag, alchemy, camp, notebook and objectives
 * moved to the bottom bar, and the team moved to the party strip. This list is the contract the
 * view renders one to one, so nothing can creep back in unnoticed.
 */
export function hudSections(model: HudModel): readonly HudSection[] {
  const sections: HudSection[] = [
    { id: 'identity', label: 'Yaratık', text: model.active ? `${model.active.name} · Sv ${model.active.level}` : 'Takım boş', ratio: null, tone: 'normal' },
    { id: 'biome', label: 'Bölge', text: `${model.biome.label} · ${model.paused ? 'Duraklatıldı' : model.modeLabel}${model.day ? ` · ${model.day}` : ''}`, ratio: null, tone: 'normal' },
    { id: 'hp', label: 'Can', text: model.active?.hp.text ?? '—', ratio: model.active?.hp.ratio ?? 0, tone: (model.active?.hp.ratio ?? 1) <= .35 ? 'low' : 'normal' },
    { id: 'xp', label: 'Deneyim', text: model.active?.xp.text ?? '—', ratio: model.active?.xp.ratio ?? 0, tone: 'normal' },
  ];
  if (model.gate) sections.push({ id: 'gate', label: 'Bölge', text: model.gate, ratio: null, tone: 'low' });
  if (model.warning) sections.push({ id: 'warning', label: 'Uyarı', text: model.warning, ratio: null, tone: 'alert' });
  return Object.freeze(sections.map((section) => Object.freeze(section)));
}
/**
 * The role a region effectively asks for, phrased as a hint, or null when the team already
 * carries it. Terrain enforces what it can; this is what tells the player why.
 */
export function regionGateHint(biomeId: BiomeId, state: Pick<WorldState, 'creatures'>): string | null {
  const role = REGION_GATE[biomeId];
  if (!role) return null;
  const ready = state.creatures.some((creature) => creature.hp > 0 &&
    roleUnlocked({ speciesId: creature.speciesId, level: creature.level }, role));
  if (ready) return null;
  const rule = ROLE_RULES[role];
  return `${rule.label} gerek · ${rule.hint} (Sv ${rule.unlockLevel})`;
}
const ratio = (value: number, max: number) => max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
const bar = (value: number, max: number, suffix = ''): HudBar => Object.freeze({ value, max, ratio: ratio(value, max), text: `${value}/${max}${suffix}` });
/**
 * Read-only projection of the saved game for the HUD. The HUD never edits HP, XP or items; it
 * shows what the domain already committed.
 */
export function hudModel(state: WorldState, options: {
  biomeId: BiomeId; paused?: boolean; movementAllowed: boolean;
  warningSeconds?: number | null; warningName?: string | null; message?: string | null;
  dayLabel?: string | null;
}): HudModel {
  const owned = state.creatures.find((creature) => creature.id === state.activeCreatureId) ?? null;
  const species = owned && creatureById(owned.speciesId);
  const maxHp = owned && species ? stats({ id: owned.id, species, level: owned.level }).maxHp : 0;
  return Object.freeze({
    mode: state.mode, modeLabel: MODE_LABEL[state.mode], paused: !!options.paused,
    biome: Object.freeze({ id: options.biomeId, label: BIOME_LABEL[options.biomeId] }),
    active: owned && species ? Object.freeze({
      name: species.name, level: owned.level,
      hp: bar(owned.hp, maxHp), xp: bar(owned.xp, owned.level >= MAX_LEVEL ? owned.xp || 1 : xpRequired(owned.level), ' XP'),
    }) : null,
    team: bar(state.creatures.length, state.creatureCapacity),
    eggs: bar(state.eggs.length, state.eggCapacity),
    warning: options.warningName && (options.warningSeconds ?? 0) > 0
      ? `${options.warningName} yaklaşıyor · ${(options.warningSeconds ?? 0).toFixed(1)} sn` : null,
    message: options.message ?? null,
    movementAllowed: options.movementAllowed,
    day: options.dayLabel ?? null,
    gate: regionGateHint(options.biomeId, state),
  });
}
