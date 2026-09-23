import { creatureById, itemById } from '../../content/catalog';
import { creatureAssets, itemAssets } from '../../content/asset-manifest';
import { GAME_CONFIG } from '../../config';
import { stats } from '../../game/combat/core';
import type { WorldState } from '../../world/persistence/world-save';
import { effectText } from '../inventory/model';
import { graftRefusal } from '../../content/graft';

export const INCUBATION_TICKS = 7200;
export interface CampCreatureRow {
  readonly creatureId: string; readonly name: string; readonly level: number;
  readonly hp: number; readonly maxHp: number; readonly ratio: number; readonly fainted: boolean;
  readonly spriteUrl: string; readonly preview: string | null; readonly selectable: boolean;
}
export interface CampItemRow {
  readonly itemId: string; readonly name: string; readonly quantity: number; readonly iconUrl: string;
  readonly effect: string; readonly usable: boolean; readonly reason: string | null;
  readonly needsTarget: boolean;
  readonly intent: { readonly type: 'use-item'; readonly itemId: string }
    | { readonly type: 'graft'; readonly creatureId: string; readonly moveId: string };
}
export interface EggRow {
  readonly eggId: string; readonly speciesName: string; readonly activeTicks: number;
  readonly ratio: number; readonly remainingSeconds: number; readonly ready: boolean;
  readonly reason: string | null; readonly text: string;
}
export interface DeliveryRow {
  readonly label: string; readonly detail: string; readonly iconUrl: string | null; readonly claimable: boolean;
}
export interface DeliveryView {
  readonly rows: readonly DeliveryRow[]; readonly items: number; readonly essences: number;
  readonly canClaim: boolean; readonly reason: string | null;
}
export interface CampView {
  readonly atCamp: boolean; readonly locked: string | null;
  readonly creatures: readonly CampCreatureRow[]; readonly items: readonly CampItemRow[];
  readonly eggs: readonly EggRow[]; readonly heatHerbs: number; readonly summary: string;
  readonly delivery: DeliveryView;
}
function healPreview(itemId: string, hp: number, maxHp: number): { value: number; text: string } | null {
  const effect = itemById(itemId)?.effect;
  if (!effect || effect.context !== 'camp') return null;
  // Only the two healing kinds have a preview; grants, grafts and tonics have nothing to show.
  if (effect.kind !== 'heal' && effect.kind !== 'heal_full' && effect.kind !== 'revive_fraction') return null;
  if (effect.kind === 'revive_fraction') {
    if (hp !== 0) return null;
    const value = Math.ceil(maxHp * effect.value);
    return { value, text: `0 → ${value}` };
  }
  // Mirrors the domain guard: a fainted creature needs Uyanış Tuzu and a full one needs nothing.
  if (hp === 0 || hp >= maxHp) return null;
  const value = effect.kind === 'heal_full' ? maxHp : Math.min(maxHp, hp + effect.value);
  return { value, text: `${hp} → ${value}` };
}
/**
 * Camp projection: healing previews come from the same rules the domain enforces, and a preview
 * never changes anything. Rejected use consumes nothing because the command is atomic.
 */
export function campView(state: WorldState, options: { selectedItemId?: string | null; selectedCreatureId?: string | null } = {}): CampView {
  const selectedItem = options.selectedItemId ?? null;
  const creatures = state.creatures.map((creature): CampCreatureRow => {
    const species = creatureById(creature.speciesId)!;
    const maxHp = stats({ id: creature.id, species, level: creature.level }).maxHp;
    const preview = selectedItem ? healPreview(selectedItem, creature.hp, maxHp) : null;
    return Object.freeze({
      creatureId: creature.id, name: species.name, level: creature.level, hp: creature.hp, maxHp,
      ratio: maxHp > 0 ? Math.min(1, creature.hp / maxHp) : 0, fainted: creature.hp === 0,
      spriteUrl: creatureAssets[species.id as keyof typeof creatureAssets]?.front ?? '',
      preview: preview?.text ?? null, selectable: !!preview,
    });
  });
  const stock = new Map<string, number>();
  for (const stack of state.inventory) if (stack) stock.set(stack.itemId, (stock.get(stack.itemId) ?? 0) + stack.quantity);
  const locked = !state.atCamp ? 'Eşyalar yalnız güvenli kampta kullanılabilir'
    : state.mode !== 'exploring' && state.mode !== 'panel' ? 'Şu anda kamp işlemleri kapalı' : null;
  const items = [...stock].filter(([itemId]) => itemById(itemId)?.effect?.context === 'camp')
    .sort(([a], [b]) => a < b ? -1 : 1)
    .map(([itemId, quantity]): CampItemRow => {
      const effect = itemById(itemId)!.effect!;
      const needsTarget = effect.kind !== 'grant_heat_herb';
      const target = creatures.find((creature) => creature.creatureId === options.selectedCreatureId);
      // v3: a graft is used on a creature too, but it teaches a move instead of healing one.
      const graft = effect.kind === 'graft' ? effect.moveId : null;
      const reason = locked ? locked
        : !needsTarget ? null
        : !target ? 'Bir yaratık seç'
        : graft ? graftRefusal({ ...state, grafts: state.grafts } as Parameters<typeof graftRefusal>[0], target.creatureId, itemId)
        : !healPreview(itemId, target.hp, target.maxHp) ? (effect.kind === 'revive_fraction' ? 'Uyanış Tuzu yalnız baygın yaratıkta' : target.fainted ? 'Baygın yaratık için Uyanış Tuzu gerekir' : 'Canı zaten tam') : null;
      return Object.freeze({
        itemId, name: itemById(itemId)!.name, quantity, iconUrl: itemAssets[itemId as keyof typeof itemAssets] ?? '',
        effect: effectText(itemId) ?? '', usable: !reason, reason, needsTarget,
        intent: graft && target
          ? Object.freeze({ type: 'graft' as const, creatureId: target.creatureId, moveId: itemId })
          : Object.freeze({ type: 'use-item' as const, itemId }),
      });
    });
  const heatHerbs = stock.get('heat_herb') ?? 0;
  const eggs = state.eggs.map((egg): EggRow => {
    const ready = egg.activeTicks >= INCUBATION_TICKS;
    const reason = !state.atCamp ? 'Kuluçka yalnız güvenli kampta ilerler'
      : !ready ? 'Kuluçka sürüyor'
      : heatHerbs < 1 ? 'Isı Otu gerekir'
      : state.creatures.length >= state.creatureCapacity ? 'Koleksiyon dolu' : null;
    const remaining = Math.max(0, INCUBATION_TICKS - egg.activeTicks) * GAME_CONFIG.fixedStep;
    return Object.freeze({
      eggId: egg.id, speciesName: creatureById(egg.speciesId)?.name ?? 'Bilinmeyen',
      activeTicks: egg.activeTicks, ratio: Math.min(1, egg.activeTicks / INCUBATION_TICKS),
      remainingSeconds: Math.round(remaining), ready: ready && !reason, reason,
      text: ready ? (reason ?? 'Çatlamaya hazır') : `${Math.round(remaining)} sn aktif kamp oyunu kaldı`,
    });
  });
  const freeSlots = state.inventory.filter((stack) => stack === null).length;
  const deliveryRows = state.deliveryBox.map((entry): DeliveryRow => entry.kind === 'item'
    ? {
      label: `${itemById(entry.itemId)?.name ?? entry.itemId} ×${entry.quantity}`,
      detail: freeSlots > 0 ? 'Alınabilir' : 'Çantada yer açınca alınabilir',
      iconUrl: itemAssets[entry.itemId as keyof typeof itemAssets] ?? null, claimable: freeSlots > 0,
    }
    : { label: `${entry.element} esansı ×${entry.quantity}`, detail: 'Kupa olarak saklanır', iconUrl: null, claimable: false });
  const claimableItems = state.deliveryBox.filter((entry) => entry.kind === 'item').length;
  const delivery: DeliveryView = Object.freeze({
    rows: Object.freeze(deliveryRows), items: claimableItems,
    essences: state.deliveryBox.length - claimableItems,
    canClaim: !!claimableItems && freeSlots > 0 && !locked,
    reason: !claimableItems ? (state.deliveryBox.length ? 'Kutuda yalnız esans var' : 'Teslim kutusu boş')
      : locked ?? (freeSlots > 0 ? null : 'Çantada boş yuva yok'),
  });
  return Object.freeze({
    atCamp: state.atCamp, locked, creatures: Object.freeze(creatures), items: Object.freeze(items),
    eggs: Object.freeze(eggs), heatHerbs, delivery,
    summary: `Takım ${state.creatures.length}/${state.creatureCapacity} · Yumurta ${state.eggs.length}/${state.eggCapacity} · Isı Otu ${heatHerbs}`,
  });
}
