import type { CommandIntent, StatusKind } from '../../contracts';
import { creatureAssets } from '../../content/asset-manifest';
import { itemById } from '../../content/catalog';
import { battleItemHeal, captureChance, movesFor, stats, type BattleEvent, type BattleState, type Receipt } from '../../game/combat/core';
import { TRAIT_LABELS } from '../../game/combat/traits';
import { BIOME_LABEL } from '../hud/labels';

export const CAPTURE_THRESHOLD = 0.35;
export type Slot = 0 | 1 | 2 | 3;
export interface BattleSlotView {
  readonly slot: Slot; readonly name: string; readonly power: number; readonly accuracy: string;
  readonly cost: number; readonly unlockLevel: number; readonly unlocked: boolean;
  readonly affordable: boolean; readonly enabled: boolean; readonly note: string;
  readonly intent: CommandIntent;
}
export interface BattleSideView {
  readonly name: string; readonly level: number; readonly element: string;
  readonly hp: number; readonly maxHp: number; readonly ratio: number; readonly hpText: string;
  readonly spriteUrl: string; readonly facing: 'front' | 'back';
  readonly guard: boolean; readonly stamina: number; readonly fainted: boolean;
}
export interface BattleBagItemView {
  readonly itemId: string; readonly name: string; readonly quantity: number;
  readonly heal: number; readonly enabled: boolean; readonly note: string; readonly intent: CommandIntent;
}
export interface CaptureView {
  readonly enabled: boolean; readonly seals: number; readonly thresholdRatio: number;
  readonly belowThreshold: boolean; readonly odds: 'düşük' | 'orta' | 'yüksek'; readonly note: string;
  readonly intent: CommandIntent;
}
export interface BattleView {
  readonly battleId: string; readonly turn: number; readonly phase: BattleState['phase'];
  readonly busy: boolean; readonly outcome: BattleState['outcome']; readonly resultText: string | null;
  readonly player: BattleSideView; readonly enemy: BattleSideView;
  readonly xp: { readonly value: number; readonly max: number; readonly ratio: number } | null;
  readonly slots: readonly BattleSlotView[]; readonly capture: CaptureView;
  readonly flee: { readonly enabled: boolean; readonly intent: CommandIntent };
  readonly bag: { readonly enabled: boolean; readonly note: string; readonly items: readonly BattleBagItemView[] };
  readonly log: readonly string[]; readonly backdropLabel: string;
}
const percent = (value: number) => `%${Math.round(value * 100)}`;
/** Turkish locative suffix for the unlock levels the move table uses. */
const LOCATIVE: Record<number, string> = { 1: "1'de", 2: "2'de", 3: "3'te", 4: "4'te", 5: "5'te", 6: "6'da", 7: "7'de", 8: "8'de", 9: "9'da", 10: "10'da" };
const atLevel = (level: number) => LOCATIVE[level] ?? `${level}. seviyede`;
function side(state: BattleState, which: 'player' | 'enemy'): BattleSideView {
  const fighter = state[which];
  const hp = which === 'player' ? state.playerHp : state.enemyHp;
  const maxHp = stats(fighter).maxHp;
  const assets = creatureAssets[fighter.species.id as keyof typeof creatureAssets];
  return Object.freeze({
    name: fighter.species.name, level: fighter.level, element: fighter.species.element,
    hp, maxHp, ratio: maxHp > 0 ? Math.min(1, Math.max(0, hp / maxHp)) : 0, hpText: `${hp}/${maxHp}`,
    // The friend is seen from behind and the wild creature from the front: two separate drawings.
    spriteUrl: which === 'player' ? assets?.back ?? '' : assets?.front ?? '',
    facing: which === 'player' ? 'back' : 'front',
    guard: which === 'player' ? state.status.playerGuard : state.status.enemyGuard,
    stamina: which === 'player' ? state.stamina : state.enemyStamina,
    fainted: hp <= 0,
  });
}
const STATUS_LABEL: Readonly<Record<StatusKind, string>> = Object.freeze({
  poison: 'zehirlendi', burn: 'yandı', slow: 'yavaşladı', weaken: 'zayıfladı',
  bulwark: 'siperlendi', charge: 'güç topladı',
});
function line(event: BattleEvent, state: BattleState): string {
  const fighter = event.side === 'enemy' ? state.enemy : state.player;
  const actor = fighter.species.name;
  // Move names come from the acting side's own set; the log never guesses a shared table.
  const moveName = event.slot === undefined ? '' : movesFor(fighter)[event.slot]?.name ?? '';
  switch (event.type) {
    case 'attack': return event.hit
      ? `${actor}, ${moveName} kullandı · ${event.damage} hasar`
      : `${actor}, ${moveName} kullandı · ıskaladı`;
    case 'guard': return `${actor} siper aldı`;
    case 'mend': return `${actor} toparlandı · ${event.heal} can`;
    case 'rest': return `${actor} soluklandı`;
    case 'switch': return `${state.player.species.name} sahaya çıktı`;
    case 'faint': return `${actor} bayıldı`;
    case 'item': return `${itemById(event.itemId ?? '')?.name ?? 'Eşya'} kullanıldı · ${event.heal} can`;
    case 'status': return event.damage !== undefined
      ? `${actor} zehirden ${event.damage} hasar aldı`
      : event.hit ? `${actor} ${STATUS_LABEL[event.status!]}` : `${actor} etkilenmedi`;
    case 'capture': return event.hit ? `Mühür tuttu · ${state.enemy.species.name} bağlandı` : 'Mühür tutmadı';
    case 'flee': return event.hit ? 'Kaçış başarılı' : 'Kaçış tutmadı';
    case 'trait': {
      const label = TRAIT_LABELS[fighter.species.trait]?.name ?? 'Özellik';
      return event.heal !== undefined ? `${actor} · ${label} · ${event.heal} can` : `${actor} · ${label}`;
    }
    case 'turn-end': return '— tur sonu —';
    case 'outcome': return event.outcome === 'WON' ? `${state.enemy.species.name} bayıldı`
      : event.outcome === 'LOST' ? `${state.player.species.name} bayıldı`
      : event.outcome === 'CAPTURED' ? 'Yakalama tamamlandı' : 'Savaştan kaçıldı';
  }
}
/** Ordered battle log built from committed receipts only; animation never invents an event. */
export function battleLog(state: BattleState): readonly string[] {
  const receipts = Object.values(state.committedActions) as Receipt[];
  return Object.freeze(receipts.flatMap((receipt) => receipt.events.map((event) => line(event, state))));
}
/**
 * Read-only projection of the committed battle. The capture odds label comes from the domain's
 * own `captureChance`; the UI keeps no second copy of the formula and promises no success.
 */
export function battleView(state: BattleState, options: { xp?: { value: number; max: number }; biomeId?: keyof typeof BIOME_LABEL } = {}): BattleView {
  const player = side(state, 'player');
  const enemy = side(state, 'enemy');
  const busy = state.phase !== 'PLAYER_INPUT' || !!state.outcome;
  const seals = state.inventorySnapshot.seal ?? 0;
  const belowThreshold = enemy.maxHp > 0 && enemy.hp <= enemy.maxHp * CAPTURE_THRESHOLD;
  const chance = captureChance(state);
  const captureBlocked = !state.capturable ? 'Bu hedef yakalanamaz'
    : enemy.fainted ? 'Bayılmış hedef yakalanamaz'
    : !belowThreshold ? `Canı %35 işaretinin altına indir`
    : seals < 1 ? 'Mühür kalmadı'
    : state.captureCapacity < 1 ? 'Koleksiyon dolu' : '';
  const slots = movesFor(state.player).map((move, index): BattleSlotView => {
    const slot = index as Slot;
    const unlocked = state.player.level >= move.unlockLevel;
    const affordable = state.stamina >= move.cost;
    return Object.freeze({
      slot, name: move.name, power: move.power, accuracy: percent(move.accuracy), cost: move.cost,
      unlockLevel: move.unlockLevel, unlocked, affordable,
      enabled: unlocked && affordable && !busy,
      note: !unlocked ? `Sv ${atLevel(move.unlockLevel)} açılır` : !affordable ? `${move.cost} enerji gerekir` : move.cost ? `${move.cost} enerji` : 'bedelsiz',
      intent: Object.freeze({ type: 'attack', slot }) as CommandIntent,
    });
  });
  // Battle salves come from the catalogue, so the view keeps no second list of usable items.
  const bag = Object.entries(state.inventorySnapshot).flatMap(([itemId, quantity]): BattleBagItemView[] => {
    const heal = battleItemHeal(itemId);
    if (heal === null || quantity < 1) return [];
    const usable = !busy && player.hp < player.maxHp;
    return [Object.freeze({
      itemId, name: itemById(itemId)?.name ?? itemId, quantity, heal, enabled: usable,
      note: player.hp >= player.maxHp ? 'Can zaten dolu' : `${heal} can · bir tur`,
      intent: Object.freeze({ type: 'use-battle-item', itemId }) as CommandIntent,
    })];
  }).sort((a, b) => a.heal - b.heal || a.itemId.localeCompare(b.itemId));
  return Object.freeze({
    battleId: state.battleId, turn: state.turn, phase: state.phase, busy, outcome: state.outcome,
    resultText: state.outcome ? line({ type: 'outcome', outcome: state.outcome }, state) : null,
    player, enemy,
    xp: options.xp ? Object.freeze({ ...options.xp, ratio: options.xp.max > 0 ? Math.min(1, options.xp.value / options.xp.max) : 0 }) : null,
    slots: Object.freeze(slots),
    capture: Object.freeze({
      enabled: !captureBlocked && !busy, seals, thresholdRatio: CAPTURE_THRESHOLD, belowThreshold,
      odds: chance >= 0.6 ? 'yüksek' : chance >= 0.35 ? 'orta' : 'düşük',
      note: captureBlocked || `Mühür ${seals} · şans ${chance >= 0.6 ? 'yüksek' : chance >= 0.35 ? 'orta' : 'düşük'}`,
      intent: Object.freeze({ type: 'capture' }) as CommandIntent,
    }),
    flee: Object.freeze({ enabled: !busy, intent: Object.freeze({ type: 'flee' }) as CommandIntent }),
    bag: Object.freeze({
      enabled: bag.some((entry) => entry.enabled), items: Object.freeze(bag),
      note: !bag.length ? 'Savaşta kullanılacak eşyan yok'
        : player.hp >= player.maxHp ? 'Can zaten dolu'
        : bag.some((entry) => entry.enabled) ? 'Eşya kullanmak bir tur harcar' : 'Savaşta kullanılacak eşyan yok',
    }),
    log: battleLog(state),
    backdropLabel: options.biomeId ? BIOME_LABEL[options.biomeId] : '',
  });
}
/** Keyboard 1–4, C and Escape resolve to exactly the intents the pointer controls publish. */
export function intentForKey(key: string, view: BattleView): CommandIntent | null {
  if (key >= '1' && key <= '4') {
    const slot = view.slots[Number(key) - 1];
    return slot?.enabled ? slot.intent : null;
  }
  if (key.toLowerCase() === 'c') return view.capture.enabled ? view.capture.intent : null;
  if (key === 'Escape') return view.flee.enabled ? view.flee.intent : null;
  return null;
}
