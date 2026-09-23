import { MAX_LEVEL } from '../../contracts';
import type { BiomeId } from '../../contracts';
import { creatures, creatureById } from '../../content/catalog';
import { creatureAssets } from '../../content/asset-manifest';
import { stats } from '../../game/combat/core';
import { cosmeticStage, xpRequired } from '../../game/progression';
import type { WorldState } from '../../world/persistence/world-save';
import { BIOME_LABEL, BIOME_ORDER } from '../hud/labels';
import { biomeOfSecret } from '../../content/secrets';

export interface OwnedEntry {
  readonly creatureId: string; readonly speciesId: string; readonly name: string;
  readonly level: number; readonly xp: number; readonly xpNeeded: number; readonly hp: number; readonly maxHp: number;
  readonly ratio: number; readonly fainted: boolean; readonly stage: 0 | 1 | 2;
  readonly spriteUrl: string; readonly active: boolean; readonly origin: 'başlangıç' | 'mühürlendi' | 'yumurtadan';
  readonly canActivate: boolean; readonly reason: string | null;
  readonly intent: { readonly type: 'set-active'; readonly creatureId: string };
}
export interface SpeciesEntry {
  readonly speciesId: string; readonly known: boolean; readonly name: string;
  readonly biome: string; readonly biomeId: BiomeId; readonly element: string | null;
  readonly rarity: string | null; readonly owned: number; readonly spriteUrl: string | null; readonly note: string;
}
export interface TrophyEntry { readonly label: string; readonly count: number }
export interface BestiaryView {
  readonly owned: readonly OwnedEntry[]; readonly species: readonly SpeciesEntry[];
  readonly knownCount: number; readonly totalSpecies: number; readonly capacity: string;
  readonly summary: string; readonly locked: string | null;
  readonly secrets: { readonly known: number; readonly total: number; readonly regions: readonly string[] };
  readonly trophies: readonly TrophyEntry[];
}
const RARITY_LABEL: Record<string, string> = { common: 'Sık', uncommon: 'Seyrek', rare: 'Ender' };
const originOf = (creatureId: string): OwnedEntry['origin'] =>
  creatureId.startsWith('capture:') ? 'mühürlendi' : creatureId.startsWith('egg:') ? 'yumurtadan' : 'başlangıç';
/**
 * The collection journal. A species is "known" only when the player actually holds one, so the
 * page can never spoil a creature the save has no record of.
 */
export function bestiaryView(state: WorldState): BestiaryView {
  const locked = state.mode === 'battle' || state.mode === 'committing' || state.mode === 'recovery'
    ? 'Savaş sürerken aktif yaratık değiştirilemez' : null;
  const owned = state.creatures.map((creature): OwnedEntry => {
    const species = creatureById(creature.speciesId)!;
    const maxHp = stats({ id: creature.id, species, level: creature.level }).maxHp;
    const active = creature.id === state.activeCreatureId;
    const reason = active ? 'Zaten aktif' : locked ?? (creature.hp <= 0 ? 'Baygın yaratık aktif yapılabilir ama savaşamaz' : null);
    return {
      creatureId: creature.id, speciesId: species.id, name: species.name,
      level: creature.level, xp: creature.xp, xpNeeded: creature.level >= MAX_LEVEL ? creature.xp : xpRequired(creature.level),
      hp: creature.hp, maxHp, ratio: maxHp > 0 ? Math.min(1, creature.hp / maxHp) : 0,
      fainted: creature.hp <= 0, stage: cosmeticStage(creature.level),
      spriteUrl: creatureAssets[species.id as keyof typeof creatureAssets]?.front ?? '',
      active, origin: originOf(creature.id),
      canActivate: !active && !locked,
      reason: reason === null ? null : reason,
      intent: Object.freeze({ type: 'set-active' as const, creatureId: creature.id }),
    };
  });
  const species = creatures.map((entry): SpeciesEntry => {
    const count = owned.filter((creature) => creature.speciesId === entry.id).length;
    const known = count > 0;
    return {
      speciesId: entry.id, known, name: known ? entry.name : '???',
      biome: BIOME_LABEL[entry.biomeId], biomeId: entry.biomeId,
      element: known ? entry.element : null, rarity: known ? RARITY_LABEL[entry.rarity] : null,
      owned: count, spriteUrl: known ? creatureAssets[entry.id as keyof typeof creatureAssets]?.front ?? null : null,
      note: known ? `${count} kayıt` : 'Henüz mühürlenmedi',
    };
  });
  const known = species.filter((entry) => entry.known).length;
  // Essences have no recipe use by design; the journal is where they read as trophies.
  const essences = new Map<string, number>();
  for (const entry of state.deliveryBox) {
    if (entry.kind !== 'essence') continue;
    essences.set(entry.element, (essences.get(entry.element) ?? 0) + entry.quantity);
  }
  const regions = state.secretFlags.map((flag) => biomeOfSecret(flag)).filter((id): id is BiomeId => !!id);
  return {
    owned, species, knownCount: known, totalSpecies: species.length,
    secrets: Object.freeze({
      known: regions.length, total: BIOME_ORDER.length,
      regions: Object.freeze(regions.map((id) => BIOME_LABEL[id])),
    }),
    trophies: Object.freeze([...essences].sort(([a], [b]) => a < b ? -1 : 1).map(([element, count]) => ({ label: `${element} esansı`, count }))),
    capacity: `${state.creatures.length}/${state.creatureCapacity}`,
    summary: `${known}/${species.length} tür · koleksiyon ${state.creatures.length}/${state.creatureCapacity}` +
      ` · ${regions.length}/${BIOME_ORDER.length} bölge sırrı · ${state.unlockedRecipeIds.length}/8 tarif`,
    locked,
  };
}
