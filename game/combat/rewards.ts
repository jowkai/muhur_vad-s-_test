import type { GameCommand, SavePort } from '../../contracts';
import { ContentError, contentTransaction, planInventory, validateContentState, type ContentState } from '../../content/alchemy';
import { creatureById, items, itemById, moveById } from '../../content/catalog';
import { recipeForSecret } from '../../content/secrets';
import { newlyEarned } from '../../content/unlocks';
import type { Element, Ingredient } from '../../content/schema';
import { grantXp, validateCreature, type OwnedCreature } from '../progression';
import { STATUS_KINDS, STATUS_RULES, battleItemHeal, movesFor, randomStep, resolveBattle, sealChoice, stats, type BattleState, type Fighter } from './core';
import { standing, xpShares, type PartyMember } from '../party';
import { EMPTY_TRAIT_STATE } from './traits';
import { graftCapacity, MAX_LEVEL, PARTY_LIMIT, STATUS_KIND_IDS } from '../../contracts';
import type { StatusEffect, StatusKind } from '../../contracts';

/** Active camp ticks an egg needs: two minutes of world time at the fire. */
export const MAX_INCUBATION_TICKS = 7200;
/** A defeated creature leaves a second, rare material this often. */
export const LOOT_BONUS_CHANCE = .15;
export interface Egg { id: string; encounterId: string; speciesId: string; seed: number; activeTicks: number }
export type Delivery = { kind: 'item'; itemId: string; quantity: number } | { kind: 'essence'; element: Element; quantity: number };
export interface LootPlan { battleId: string; habitat: Ingredient; essence: Element | null; secretId: string | null; bonus: Ingredient | null }
/** Combat-owned extension of the existing content projection; world integration remains separate. */
export interface ProgressState extends ContentState {
  creatures: OwnedCreature[];
  creatureCapacity: number; eggCapacity: number; eggs: Egg[];
  battle: BattleState | null; loot: LootPlan | null;
  rewardLedger: string[]; consumedEntityIds: string[]; secretFlags: string[];
  deliveryBox: Delivery[];
  /** Owned by the world save; combat only keeps these pointed at the creatures in play. */
  activeCreatureId?: string | null;
  party?: string[];
}
function fail(message: string): never { throw new ContentError('invalid-state', message); }
const integer = (n: number, min = 0) => Number.isSafeInteger(n) && n >= min;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const identifier = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string' && s.length > 0) && new Set(v).size === v.length;
const elements: Element[] = ['çim', 'su', 'kor', 'buz', 'taş', 'gölge', 'rüzgâr', 'ışık', 'kıvılcım'];
function validFighter(f: Fighter): boolean {
  const species = f && creatureById(f.species?.id);
  // Grafts travel with the fighter so a saved battle replays exactly, including its move set.
  if (f?.grafts !== undefined && (!Array.isArray(f.grafts) || f.grafts.length > graftCapacity(f.level) ||
    new Set(f.grafts).size !== f.grafts.length || f.grafts.some((moveId) => !moveById(moveId)))) return false;
  // A saved fighter carries a cloned species, so list fields are compared by value not identity.
  const same = (a: unknown, b: unknown) => Array.isArray(a) || Array.isArray(b)
    ? Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index])
    : a === b;
  return !!species && identifier(f.id) && integer(f.level, 1) && f.level <= MAX_LEVEL &&
    Object.entries(species).every(([key, val]) => same(f.species[key as keyof typeof species], val));
}
/** Passive counters are plain bounded bookkeeping; a forged one is refused like any other field. */
function traitState(value: unknown): boolean {
  if (!record(value)) return false;
  const { hitsTaken, streak, rescued, guardedLast } = value as Record<string, unknown>;
  return integer(hitsTaken as number) && integer(streak as number) && (streak as number) <= 8 &&
    typeof rescued === 'boolean' && typeof guardedLast === 'boolean';
}
/** Status lists carry at most one running clock per kind, never longer than its own rule. */
function effectList(value: unknown): value is StatusEffect[] {
  return Array.isArray(value) && value.length <= STATUS_KINDS.length &&
    new Set(value.map((effect) => effect?.kind)).size === value.length &&
    value.every((effect) => !!effect && STATUS_KINDS.includes(effect.kind as StatusKind) &&
      integer(effect.turns, 1) && effect.turns <= STATUS_RULES[effect.kind as StatusKind].turns);
}
/**
 * Battle records written before status effects existed gain empty clocks; every other field,
 * including each committed receipt, is carried over untouched.
 */
export function migrateBattleRecord(raw: unknown): unknown {
  if (!record(raw) || (raw.version !== 1 && raw.version !== 2)) return raw;
  const status = record(raw.status) ? raw.status : {};
  // v1 had no status clocks; v2 had no passives. Both land on the v3 shape in one pass.
  const upgraded: Record<string, unknown> = {
    ...raw, version: 3,
    status: raw.version === 1 ? { ...status, playerEffects: [], enemyEffects: [] } : status,
    traits: { player: EMPTY_TRAIT_STATE, enemy: EMPTY_TRAIT_STATE },
    dayPhase: 'day', pendingGuard: false,
  };
  // Receipts hold snapshots of the same shape; a snapshot itself carries no receipt map.
  if (record(raw.committedActions)) {
    upgraded.committedActions = Object.fromEntries(Object.entries(raw.committedActions).map(([id, receipt]) => [id,
      record(receipt) ? { ...receipt, snapshot: migrateBattleRecord(receipt.snapshot) } : receipt]));
  }
  return upgraded;
}
/** The travelling team: one to six known creatures, unique, alive-or-fainted within their stats. */
function partyList(party: unknown, activeIndex: unknown, player: Fighter, playerHp: number): party is PartyMember[] {
  if (!Array.isArray(party) || party.length < 1 || party.length > PARTY_LIMIT) return false;
  if (!Number.isInteger(activeIndex) || (activeIndex as number) < 0 || (activeIndex as number) >= party.length) return false;
  if (new Set(party.map((member: PartyMember) => member?.id)).size !== party.length) return false;
  for (const member of party as PartyMember[]) {
    const fighter: Fighter = { id: member?.id, species: member?.species, level: member?.level, ...(member?.grafts ? { grafts: member.grafts } : {}) };
    if (!member || !validFighter(fighter) || movesFor(fighter).length !== 4 ||
      !integer(member.hp) || member.hp > stats(fighter).maxHp) return false;
  }
  const active = (party as PartyMember[])[activeIndex as number];
  return active.id === player.id && active.species.id === player.species.id &&
    active.level === player.level && active.hp === playerHp;
}
export function validateBattle(value: unknown): asserts value is BattleState {
  if (!value || typeof value !== 'object') fail('Savaş kaydı geçersiz');
  const b = value as BattleState;
  if (b.version !== 3 || !identifier(b.battleId) || !identifier(b.encounterId) || !validFighter(b.player) || !validFighter(b.enemy) ||
    b.playerCreatureId !== b.player.id || !integer(b.turn, 1) || !integer(b.rngState, 1) || b.rngState > 0xffffffff ||
    !integer(b.playerHp) || b.playerHp > stats(b.player).maxHp || !integer(b.enemyHp) || b.enemyHp > stats(b.enemy).maxHp ||
    !integer(b.stamina) || b.stamina > 5 || !integer(b.enemyStamina) || b.enemyStamina > 5 ||
    (b.ambushed !== undefined && typeof b.ambushed !== 'boolean') || typeof b.capturable !== 'boolean' || typeof b.aggressive !== 'boolean' || !integer(b.captureCapacity) ||
    !b.status || typeof b.status.playerGuard !== 'boolean' || typeof b.status.enemyGuard !== 'boolean' ||
    !effectList(b.status.playerEffects) || !effectList(b.status.enemyEffects) ||
    !partyList(b.party, b.activeIndex, b.player, b.playerHp) ||
    ![null, 0, 1, 2, 3].includes(b.status.enemyLastSlot) || !record(b.inventorySnapshot) || !record(b.committedActions) ||
    !traitState(b.traits?.player) || !traitState(b.traits?.enemy) ||
    !['day', 'night'].includes(b.dayPhase) || typeof b.pendingGuard !== 'boolean') fail('Savaş verisi geçersiz');
  if (!['INTRO', 'PLAYER_INPUT', 'FORCED_SWITCH', 'WON', 'CAPTURED', 'LOST', 'FLED'].includes(b.phase)) fail('Çözümlenmemiş savaş kaydı');
  // A battle may pause on a fallen fighter only while a standing team mate can take the field.
  if (b.phase === 'FORCED_SWITCH' && (b.playerHp !== 0 || b.outcome !== null || !standing(b.party).length)) fail('Zorunlu geçiş kaydı tutarsız');
  const terminal = ['WON', 'CAPTURED', 'LOST', 'FLED'].includes(b.phase);
  if (terminal && (b.status.playerEffects.length || b.status.enemyEffects.length)) fail('Biten savaşta durum etkisi kaldı');
  if ((terminal ? b.outcome !== b.phase : b.outcome !== null) ||
    (b.phase === 'WON' ? b.enemyHp !== 0 || b.playerHp === 0 : b.phase === 'LOST' ? b.playerHp !== 0 || b.enemyHp === 0
      : b.phase === 'FORCED_SWITCH' ? b.enemyHp === 0 : b.playerHp === 0 || b.enemyHp === 0)) fail('Savaş can/faz uyumsuzluğu');
  // Losing means the whole team is down, not just the creature that was on the field.
  if (b.phase === 'LOST' && standing(b.party).length) fail('Ayakta takım üyesi varken kayıp');
  for (const [id, n] of Object.entries(b.inventorySnapshot)) if (!itemById(id) || !integer(n)) fail('Savaş envanteri geçersiz');
  // Receipts are data, never trusted as a second source of mutable battle state.
  for (const [id, receipt] of Object.entries(b.committedActions)) {
    if (!identifier(id) || !receipt || receipt.command?.commandId !== id || !integer(receipt.command.tick) ||
      !['attack', 'capture', 'flee', 'switch-party', 'use-battle-item'].includes(receipt.command.type) || !Array.isArray(receipt.events) ||
      receipt.snapshot?.battleId !== b.battleId || receipt.snapshot.encounterId !== b.encounterId) fail('Savaş komut kaydı geçersiz');
    if (receipt.command.type === 'attack' && ![0, 1, 2, 3].includes(receipt.command.slot)) fail('Savaş slotu geçersiz');
    if (receipt.command.type === 'switch-party' && !integer(receipt.command.index)) fail('Takım yuvası geçersiz');
    if (receipt.command.type === 'use-battle-item' && battleItemHeal(receipt.command.itemId) === null) fail('Savaş eşyası geçersiz');
    validateBattle({ ...receipt.snapshot, committedActions: {} });
    for (const e of receipt.events) {
      if (!e || !['attack', 'guard', 'mend', 'rest', 'status', 'switch', 'faint', 'item', 'capture', 'flee', 'turn-end', 'outcome', 'trait'].includes(e.type) ||
        (e.damage !== undefined && !integer(e.damage)) || (e.hit !== undefined && typeof e.hit !== 'boolean') ||
        (e.heal !== undefined && !integer(e.heal)) || (e.side !== undefined && !['player', 'enemy'].includes(e.side))) fail('Savaş olay kaydı geçersiz');
      if (e.type === 'attack' && (!e.side || ![0, 1, 2, 3].includes(e.slot!) || typeof e.hit !== 'boolean' || !integer(e.damage!) || (!e.hit && e.damage !== 0))) fail('Saldırı olayı geçersiz');
      if (e.type === 'guard' && (!e.side || ![0, 1, 2, 3].includes(e.slot!))) fail('Siper olayı geçersiz');
      if (e.type === 'mend' && (!e.side || ![0, 1, 2, 3].includes(e.slot!) || !integer(e.heal!) || e.damage !== undefined)) fail('Toparlanma olayı geçersiz');
      if (e.type === 'rest' && (!e.side || e.slot !== undefined || e.damage !== undefined)) fail('Dinlenme olayı geçersiz');
      if (['switch', 'faint'].includes(e.type) && (e.side !== 'player' || !integer(e.index!) || e.index! >= PARTY_LIMIT)) fail('Takım olayı geçersiz');
      if (e.type === 'item' && (e.side !== 'player' || battleItemHeal(e.itemId ?? '') === null || !integer(e.heal!))) fail('Eşya olayı geçersiz');
      if (e.type === 'status' && (!e.side || !STATUS_KIND_IDS.includes(e.status as StatusKind) ||
        (typeof e.hit === 'boolean') === (e.damage !== undefined))) fail('Durum olayı geçersiz');
      if (e.type === 'trait' && (!e.side || !identifier(e.trait) || (e.heal !== undefined && !integer(e.heal)))) fail('Özellik olayı geçersiz');
      if (['capture', 'flee'].includes(e.type) && (e.side !== 'player' || typeof e.hit !== 'boolean')) fail('Deneme olayı geçersiz');
      if (e.type === 'outcome' && !['WON', 'CAPTURED', 'LOST', 'FLED'].includes(e.outcome!)) fail('Sonuç olayı geçersiz');
      if (e.type === 'outcome' && e.outcome !== receipt.snapshot.outcome) fail('Sonuç olayı savaşla uyuşmuyor');
    }
  }
}
export function validateProgressState(value: unknown): asserts value is ProgressState {
  validateContentState(value);
  const s = value as ProgressState;
  if (!integer(s.creatureCapacity, 1) || s.creatures.length > s.creatureCapacity || !integer(s.eggCapacity) ||
    !Array.isArray(s.eggs) || s.eggs.length > s.eggCapacity || !strings(s.rewardLedger) || !strings(s.consumedEntityIds) ||
    !strings(s.secretFlags) || !Array.isArray(s.deliveryBox)) fail('İlerleme kaydı geçersiz');
  for (const c of s.creatures) validateCreature(c);
  const ids = new Set<string>();
  const encounters = new Set<string>();
  for (const egg of s.eggs) {
    if (!egg || !identifier(egg.id) || ids.has(egg.id) || !identifier(egg.encounterId) || !s.consumedEntityIds.includes(egg.encounterId) ||
      encounters.has(egg.encounterId) || s.creatures.some(c => c.id === `egg:${egg.encounterId}`) ||
      !creatureById(egg.speciesId) || !integer(egg.seed) || egg.seed > 0xffffffff || !integer(egg.activeTicks) || egg.activeTicks > MAX_INCUBATION_TICKS) fail('Yumurta kaydı geçersiz');
    ids.add(egg.id); encounters.add(egg.encounterId);
  }
  for (const d of s.deliveryBox) {
    if (!d || !integer(d.quantity, 1) || (d.kind === 'item' ? !itemById(d.itemId) : d.kind !== 'essence' || !elements.includes(d.element))) fail('Teslim kutusu geçersiz');
  }
  if (s.battle !== null) {
    validateBattle(s.battle);
    const owner = s.creatures.find(c => c.id === s.battle!.playerCreatureId);
    if (!owner || owner.speciesId !== s.battle.player.species.id || (!s.battle.outcome && owner.level !== s.battle.player.level)) fail('Aktif savaşçı bulunamadı');
    for (const member of s.battle.party) {
      const owned = s.creatures.find(c => c.id === member.id);
      if (!owned || owned.speciesId !== member.species.id) fail('Takım üyesi koleksiyonda yok');
      if (!s.battle.outcome && (owned.level !== member.level || owned.hp !== member.hp)) fail('Takım canı kayıtla uyuşmuyor');
    }
    if (s.battle.outcome) {
      if (!s.rewardLedger.includes(s.battle.battleId) || !['committing', 'recovery'].includes(s.mode)) fail('Savaş sonucu işlenmemiş');
      if (['WON', 'CAPTURED'].includes(s.battle.outcome) && !s.consumedEntityIds.includes(s.battle.encounterId)) fail('Sonuç karşılaşmayı tüketmemiş');
    } else if (s.rewardLedger.includes(s.battle.battleId) || owner.hp !== s.battle.playerHp || !['battle', 'encounter'].includes(s.mode)) fail('Etkin savaş kaydı tutarsız');
    if (!s.loot || s.loot.battleId !== s.battle.battleId || !itemById(s.loot.habitat.itemId) || !integer(s.loot.habitat.quantity, 1) ||
      (s.loot.essence !== null && !elements.includes(s.loot.essence)) || (s.loot.secretId !== null && !identifier(s.loot.secretId)) ||
      (s.loot.bonus !== null && s.loot.bonus !== undefined && (!itemById(s.loot.bonus.itemId) || !integer(s.loot.bonus.quantity, 1)))) fail('Ganimet planı geçersiz');
  } else if (s.loot !== null) fail('Savaşsız ganimet planı');
}
/**
 * Call once at encounter creation and persist; rewards never reroll this plan. v2 removed the
 * random gardener's mark from battle loot: a region recipe is now taught by its shrine alone.
 * `secretId` stays in the record so battles saved before the change still pay out once.
 */
export function createLootPlan(battleId: string, enemy: Fighter, aggressive: boolean, seed = 0): LootPlan {
  if (!battleId || !validFighter(enemy) || !integer(seed) || seed > 0xffffffff) fail('Ganimet başlangıcı geçersiz');
  const habitat = items.find(i => i.biomeId === enemy.species.biomeId && i.rarity === 'common')!;
  const rare = items.find(i => i.biomeId === enemy.species.biomeId && i.rarity === 'rare');
  // One roll at encounter time decides the second, rare drop; the reward never rerolls it.
  // Two xorshift steps, because a small encounter seed has a small first output.
  const bonus = rare && randomStep(randomStep(seed).state).value < LOOT_BONUS_CHANCE ? { itemId: rare.id, quantity: 1 } : null;
  return { battleId, habitat: { itemId: habitat.id, quantity: 1 }, essence: aggressive ? enemy.species.element : null, secretId: null, bonus };
}
function deliver(s: ProgressState, item: Ingredient): void {
  for (let n = 0; n < item.quantity; n++) {
    try { s.inventory = planInventory(s.inventory, [], [{ itemId: item.itemId, quantity: 1 }]); }
    catch (error) {
      if (!(error instanceof ContentError) || error.code !== 'full') throw error;
      s.deliveryBox.push({ kind: 'item', itemId: item.itemId, quantity: item.quantity - n }); return;
    }
  }
}
function award(s: ProgressState): void {
  const b = s.battle!;
  if (!b.outcome || s.rewardLedger.includes(b.battleId)) return;
  const player = s.creatures.find(c => c.id === b.playerCreatureId)!;
  for (const member of b.party) {
    const owned = s.creatures.find(c => c.id === member.id);
    if (owned) owned.hp = Math.min(member.hp, owned.maxHp);
  }
  if (b.outcome === 'WON' || b.outcome === 'CAPTURED') {
    if (s.consumedEntityIds.includes(b.encounterId)) fail('Karşılaşma zaten tüketildi');
    if (b.outcome === 'CAPTURED') {
      if (s.creatures.length >= s.creatureCapacity) fail('Yaratık deposu dolu');
      const id = `capture:${b.encounterId}`;
      if (s.creatures.some(c => c.id === id)) fail('Yaratık kimliği zaten var');
      s.creatures.push({ id, speciesId: b.enemy.species.id, level: b.enemy.level, xp: 0, hp: b.enemyHp, maxHp: stats(b.enemy).maxHp });
      // A sealed creature joins the team when a slot is free; otherwise it waits in the collection.
      if (Array.isArray(s.party) && s.party.length < PARTY_LIMIT) s.party.push(id);
    } else {
      deliver(s, s.loot!.habitat);
      if (s.loot!.bonus) deliver(s, s.loot!.bonus);
      if (s.loot!.essence) s.deliveryBox.push({ kind: 'essence', element: s.loot!.essence, quantity: 1 });
      if (s.loot!.secretId) {
        if (s.secretFlags.includes(s.loot!.secretId!)) s.deliveryBox.push({ kind: 'essence', element: b.enemy.species.element, quantity: 1 });
        else {
          // A gardener's mark teaches the region's recipe once; a known mark yields an essence.
          s.secretFlags.push(s.loot!.secretId!);
          const recipeId = recipeForSecret(s.loot!.secretId!);
          if (recipeId && !s.unlockedRecipeIds.includes(recipeId)) s.unlockedRecipeIds.push(recipeId);
        }
      }
    }
    // The fighter on the field learns in full; every standing team mate learns its share.
    const award = b.outcome === 'WON' ? 10 + 6 * b.enemy.level : Math.floor(.6 * (10 + 6 * b.enemy.level));
    for (const share of xpShares(b.party, b.activeIndex, award)) {
      const learner = s.creatures.find(c => c.id === share.id);
      if (learner) Object.assign(learner, grantXp(learner, share.xp));
    }
    // Raising a creature is its own unlock channel: levels and roles open the advanced book.
    const earned = newlyEarned(s);
    if (earned.length) s.unlockedRecipeIds = [...s.unlockedRecipeIds, ...earned];
    s.consumedEntityIds.push(b.encounterId);
  } else if (b.outcome === 'LOST') {
    // A lost team wakes up at camp; the whole party is back on its feet.
    for (const member of b.party) {
      const owned = s.creatures.find(c => c.id === member.id);
      if (owned) owned.hp = owned.maxHp;
    }
    player.hp = player.maxHp;
  }
  s.rewardLedger.push(b.battleId);
}
export function applyBattleCommand<T extends ProgressState>(save: SavePort<T>, battleId: string, command: GameCommand): Promise<T> {
  return contentTransaction(save, `battle:${JSON.stringify([battleId, command.commandId])}`, s => {
    validateProgressState(s);
    if (!s.battle || s.battle.battleId !== battleId || s.mode !== 'battle') fail('Savaş etkin değil');
    if (s.rewardLedger.includes(battleId)) return;
    const before = s.battle;
    const input = structuredClone(before);
    input.captureCapacity = s.creatureCapacity - s.creatures.length;
    input.inventorySnapshot = {};
    for (const stack of s.inventory) if (stack) input.inventorySnapshot[stack.itemId] = (input.inventorySnapshot[stack.itemId] ?? 0) + stack.quantity;
    const result = resolveBattle(input, command);
    if (!result.accepted) fail(result.reason ?? 'Savaş eylemi reddedildi');
    if (result.duplicate) return;
    // The bag pays for exactly what the resolver spent: the chosen seal or the used salve.
    if (command.type === 'capture') s.inventory = planInventory(s.inventory, [{ itemId: sealChoice(input.inventorySnapshot)!.id, quantity: 1 }], []);
    if (command.type === 'use-battle-item') s.inventory = planInventory(s.inventory, [{ itemId: command.itemId, quantity: 1 }], []);
    s.battle = result.state;
    for (const member of result.state.party) {
      const owned = s.creatures.find(c => c.id === member.id);
      if (owned) owned.hp = Math.min(member.hp, owned.maxHp);
    }
    // Switching moves the world's active creature too, so the save keeps one truth.
    if ('activeCreatureId' in s) s.activeCreatureId = result.state.playerCreatureId;
    award(s);
    // World remains locked until its integration consumes the committed outcome.
    if (s.battle.outcome) s.mode = 'committing';
    validateProgressState(s);
  });
}
export function collectEgg<T extends ProgressState>(save: SavePort<T>, commandId: string, egg: Omit<Egg, 'activeTicks'>): Promise<T> {
  return contentTransaction(save, commandId, s => {
    validateProgressState(s);
    if (s.mode !== 'exploring' || s.eggs.length >= s.eggCapacity || s.consumedEntityIds.includes(egg.encounterId) || s.eggs.some(e => e.id === egg.id)) fail('Yumurta alınamıyor');
    s.eggs.push({ ...egg, activeTicks: 0 }); s.consumedEntityIds.push(egg.encounterId);
    validateProgressState(s);
  });
}
/** One fixed 1/60s simulation tick; caller never forwards wall-clock/offline time. */
export function incubateTick<T extends ProgressState>(state: T, paused: boolean): T {
  if (paused || state.mode !== 'exploring' || !state.atCamp) return state;
  const next = structuredClone(state);
  for (const egg of next.eggs) egg.activeTicks = Math.min(MAX_INCUBATION_TICKS, egg.activeTicks + 1);
  return next;
}
export function hatchEgg<T extends ProgressState>(save: SavePort<T>, commandId: string, eggId: string): Promise<T> {
  return contentTransaction(save, commandId, s => {
    validateProgressState(s);
    const egg = s.eggs.find(e => e.id === eggId);
    if (!egg || egg.activeTicks < MAX_INCUBATION_TICKS || !s.atCamp || !['exploring', 'panel'].includes(s.mode) || s.creatures.length >= s.creatureCapacity) fail('Yumurta henüz açılamıyor');
    const id = `egg:${egg.encounterId}`;
    if (s.creatures.some(c => c.id === id)) fail('Yumurta yaratığı zaten var');
    const maxHp = stats({ id, species: creatureById(egg.speciesId)!, level: 1 }).maxHp;
    s.inventory = planInventory(s.inventory, [{ itemId: 'heat_herb', quantity: 1 }], []);
    s.eggs = s.eggs.filter(e => e.id !== eggId);
    s.creatures.push({ id, speciesId: egg.speciesId, level: 1, xp: 0, hp: maxHp, maxHp });
    validateProgressState(s);
  });
}
/**
 * Moves what fits from the delivery box into the bag, one stack at a time, and leaves the rest
 * in place. Rewards that overflowed a full bag are therefore reachable without ever duplicating:
 * an entry is only removed once its items are in the inventory.
 */
export function claimDelivery<T extends ProgressState>(save: SavePort<T>, commandId: string): Promise<T> {
  return contentTransaction(save, commandId, s => {
    validateProgressState(s);
    if (!['exploring', 'panel'].includes(s.mode)) fail('Teslim kutusu şu anda açılamıyor');
    if (!s.deliveryBox.length) fail('Teslim kutusu boş');
    const remaining: Delivery[] = [];
    let claimed = 0;
    for (const entry of s.deliveryBox) {
      if (entry.kind !== 'item') { remaining.push(entry); continue; }
      let left = entry.quantity;
      while (left > 0) {
        try { s.inventory = planInventory(s.inventory, [], [{ itemId: entry.itemId, quantity: 1 }]); }
        catch (error) {
          if (!(error instanceof ContentError) || error.code !== 'full') throw error;
          break;
        }
        left--; claimed++;
      }
      if (left > 0) remaining.push({ ...entry, quantity: left });
    }
    if (!claimed) fail('Çantada yer yok');
    s.deliveryBox = remaining;
    validateProgressState(s);
  });
}
