import type { BattleEntryContext } from '../../contracts';
import { roleUnlocked, TANK_AMBUSH_SHIELD } from '../roles';
import { LOADOUT_SIZE, MAX_LEVEL, type DayPhase, type GameCommand, type StatusEffect, type StatusKind } from '../../contracts';
import { advanceTraitState, EMPTY_TRAIT_STATE, traitMaxHpBonus, traitModifiers, type TraitState } from './traits';
import type { CreatureDefinition, Element, MoveDefinition } from '../../content/schema';
import { itemById, items, moveById } from '../../content/catalog';
import { defaultLoadout, equippedMoveIds } from '../../content/loadout';
import { elementEffectiveness } from '../../content/elements';
import { hasReserve, switchRefusal, validPartyShape, type PartyMember } from '../party';

type Slot = 0 | 1 | 2 | 3;
type Side = 'player' | 'enemy';
type Outcome = 'WON' | 'CAPTURED' | 'LOST' | 'FLED';
/** One die, one chance, one duration: the whole status contract lives here. */
export const STATUS_RULES: Readonly<Record<StatusKind, { readonly chance: number; readonly turns: number }>> = Object.freeze({
  poison: { chance: .35, turns: 3 },
  burn: { chance: .30, turns: 3 },
  slow: { chance: .40, turns: 2 },
  weaken: { chance: .45, turns: 3 },
  // Self-applied by a support move, so their chance never comes up; the clock is what matters.
  bulwark: { chance: 1, turns: 3 },
  charge: { chance: 1, turns: 2 },
});
/** The statuses an attack can write onto its target; the rest are self-applied buffs. */
export const STATUS_KINDS: readonly StatusKind[] = Object.freeze(['poison', 'burn', 'slow', 'weaken'] as const);
/** While weakened a fighter hits softer; behind a bulwark it takes less. */
export const WEAKEN_FACTOR = .8;
export const BULWARK_FACTOR = .8;
/** A stored charge adds this much power to the next attack, then discharges. */
export const CHARGE_POWER = 8;
/** A draining move returns this share of what it dealt. */
export const DRAIN_SHARE = .5;
/** Same-element moves hit harder: the reason a species' own element still matters. */
export const STAB = 1.15;
export interface Fighter {
  id: string; species: CreatureDefinition; level: number;
  /** v3: moves alchemy grafted onto this creature; each takes one slot of its loadout. */
  grafts?: string[];
  /** v4: the four the player chose from the eight this species knows. */
  loadout?: string[];
}
export interface BattleEvent {
  type: 'attack' | 'guard' | 'mend' | 'rest' | 'status' | 'switch' | 'faint' | 'item' | 'capture' | 'flee' | 'turn-end' | 'outcome' | 'trait';
  side?: Side; slot?: Slot; hit?: boolean; damage?: number; heal?: number; status?: StatusKind; outcome?: Outcome; index?: number; itemId?: string;
  /** Which passive fired, for the log and the battle card. */
  trait?: string;
}
export interface BattleSnapshot extends BattleEntryContext {
  version: 3; battleId: string; encounterId: string;
  phase: 'INTRO' | 'PLAYER_INPUT' | 'FORCED_SWITCH' | 'RESOLVE_PLAYER' | 'RESOLVE_ENEMY' | 'TURN_END' | Outcome;
  turn: number; rngState: number; playerCreatureId: string;
  /** Ordered travelling team; `player` is always the mirror of `party[activeIndex]`. */
  party: PartyMember[]; activeIndex: number;
  player: Fighter; enemy: Fighter; playerHp: number; enemyHp: number;
  stamina: number; enemyStamina: number; aggressive: boolean;
  capturable: boolean; captureCapacity: number;
  status: { playerGuard: boolean; enemyGuard: boolean; enemyLastSlot: Slot | null; playerEffects: StatusEffect[]; enemyEffects: StatusEffect[] };
  /** v4: the counters species passives read. Saved, so a reload replays a fight identically. */
  traits: { player: TraitState; enemy: TraitState };
  /** v4: which half of the day the fight opened under; two passives read it. */
  dayPhase: DayPhase;
  /** Set when a fallen `tohumcu` owes its replacement a guard. */
  pendingGuard: boolean;
  inventorySnapshot: Record<string, number>; outcome: Outcome | null;
}
export interface Receipt { command: GameCommand; snapshot: BattleSnapshot; events: BattleEvent[] }
export interface BattleState extends BattleSnapshot { committedActions: Record<string, Receipt> }
export interface BattleResult { state: BattleState; accepted: boolean; duplicate: boolean; reason?: string; receipt?: Receipt }

export interface SealTier { readonly id: string; readonly bonus: number }
/** Every capture consumable the catalogue knows, plainest first. */
export function sealTiers(): SealTier[] {
  return items.flatMap(item => item.effect?.kind === 'capture_consumable' ? [{ id: item.id, bonus: item.effect.value ?? 0 }] : [])
    .sort((a, b) => a.bonus - b.bonus || a.id.localeCompare(b.id));
}
/** The bag spends its plainest seal first, so a rare one stays for a rare creature. */
export function sealChoice(inventory: Record<string, number>): SealTier | null {
  return sealTiers().find(tier => (inventory[tier.id] ?? 0) >= 1) ?? null;
}
/** A salve the catalogue marks as usable in battle; anything else is not a battle item. */
export function battleItemHeal(itemId: string): number | null {
  const effect = itemById(itemId)?.effect;
  return effect?.kind === 'heal' && effect.context === 'battle' ? effect.value : null;
}
/** The four slots on the battle card: the chosen loadout, with any graft standing in for one. */
export function movesFor(fighter: Fighter): readonly MoveDefinition[] {
  const base = fighter.loadout?.length === LOADOUT_SIZE ? fighter.loadout : defaultLoadout(fighter.species.id);
  if (!base.length) return [];
  const ids = fighter.grafts?.length ? equippedMoveIds(base, fighter.grafts, fighter.level) : base;
  return ids.flatMap((id) => { const move = moveById(id); return move ? [move] : []; });
}
/**
 * v4 stat curve. Two things changed and COMBAT.md records why.
 *
 * Base stats carry three times the weight they used to, so a species still reads as itself at
 * the ceiling: the gap between the frailest and the sturdiest is ~13 % of a level-50 bar rather
 * than the 4 % v3 had, where every creature converged on the same sponge.
 */
export function stats(fighter: Fighter) {
  const { species: s, level } = fighter;
  const maxHp = Math.floor((12 + 3 * s.baseHp + 4 * level) * (1 + traitMaxHpBonus(s.trait, level)));
  return { maxHp, atk: 2 * s.baseAtk + level, def: s.baseDef + level };
}
/**
 * The defence softening constant, which v3 pinned at a flat 10. That was the whole reason
 * fights stretched from four turns at level two to sixteen at fifty: damage converged on a
 * ceiling while health kept climbing. Scaling it with the attacker holds time-to-kill in a
 * three-to-five turn band the entire way up.
 */
export function softening(level: number): number { return Math.floor(12 + 1.5 * level); }
export function randomStep(seed: number): { state: number; value: number } {
  let x = seed >>> 0 || 0x6d2b79f5;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  return { state: x >>> 0, value: (x >>> 0) / 4294967296 };
}
/** Delegates to the catalogue table; combat keeps no second copy of elemental advantage. */
export function elementMultiplier(attack: Element | null, defense: Element): number {
  return elementEffectiveness(attack, defense);
}
export function hasStatus(effects: readonly StatusEffect[], kind: StatusKind): boolean {
  return effects.some(effect => effect.kind === kind);
}
/** Refresh, never stack: a second hit resets the clock and adds no second copy. */
function applyStatus(effects: StatusEffect[], kind: StatusKind): void {
  const index = effects.findIndex(effect => effect.kind === kind);
  const fresh: StatusEffect = { kind, turns: STATUS_RULES[kind].turns };
  if (index >= 0) effects[index] = fresh; else effects.push(fresh);
}
/** Drops a single status; used when a stored charge discharges. */
function removeStatus(effects: StatusEffect[], kind: StatusKind): void {
  const index = effects.findIndex(effect => effect.kind === kind);
  if (index >= 0) effects.splice(index, 1);
}
export function poisonDamage(fighter: Fighter): number {
  return Math.ceil(stats(fighter).maxHp / 16);
}
/** What a passive may bend on the way to a damage number. Every field is neutral by default. */
export interface DamageMods {
  readonly outgoing?: number; readonly incoming?: number;
  readonly powerBonus?: number; readonly ignoreGuard?: boolean;
}
/**
 * `moveElement` is the element of the move being used. v3 read the attacker's species element
 * here, which quietly made every move's own element cosmetic — a graft that taught an
 * off-element move changed nothing about effectiveness, and the typeless path the catalogue
 * documents was unreachable. Passing `undefined` keeps the old species-element behaviour for
 * callers that have no move in hand.
 */
export function damage(
  power: number, attacker: Fighter, defender: Fighter, roll: number, guarded: boolean,
  burned = false, moveElement: Element | null | undefined = undefined, mods: DamageMods = {},
): number {
  const element = moveElement === undefined ? attacker.species.element : moveElement;
  const K = softening(attacker.level);
  // The same-element bonus is a property of the *move*, so a caller with no move in hand
  // (the legacy shape) gets the plain multiplier rather than a silent bonus.
  const stab = moveElement !== undefined && element !== null && element === attacker.species.element ? STAB : 1;
  const guardFactor = guarded && !mods.ignoreGuard ? .5 : 1;
  return Math.max(1, Math.floor((power + (mods.powerBonus ?? 0) + stats(attacker).atk) * K / (K + stats(defender).def)
    * elementMultiplier(element, defender.species.element) * stab * (.90 + .20 * roll)
    * guardFactor * (burned ? .75 : 1) * (mods.outgoing ?? 1) * (mods.incoming ?? 1)));
}
export function createBattle(options: { battleId: string; encounterId: string; seed: number; player: Fighter; enemy: Fighter; playerHp?: number; party?: PartyMember[]; activeIndex?: number; ambushed?: boolean; aggressive?: boolean; capturable?: boolean; captureCapacity?: number; inventorySnapshot?: Record<string, number>; dayPhase?: DayPhase }): BattleState {
  for (const f of [options.player, options.enemy]) {
    if (!f.id || !Number.isInteger(f.level) || f.level < 1 || f.level > MAX_LEVEL ||
      ![f.species.baseHp, f.species.baseAtk, f.species.baseDef].every(n => Number.isFinite(n) && n >= 0)) throw new Error('Geçersiz savaşçı');
    if (movesFor(f).length !== 4) throw new Error('Türün hareket seti eksik');
  }
  const hp = options.playerHp ?? stats(options.player).maxHp;
  if (!options.battleId || !options.encounterId || !Number.isInteger(options.seed) || !Number.isInteger(hp) || hp <= 0 || hp > stats(options.player).maxHp) throw new Error('Geçersiz savaş başlangıcı');
  if (!Number.isSafeInteger(options.captureCapacity ?? 0) || (options.captureCapacity ?? 0) < 0 ||
    (options.capturable !== undefined && typeof options.capturable !== 'boolean') ||
    Object.values(options.inventorySnapshot ?? {}).some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('Geçersiz yakalama kaynakları');
  // A battle without an explicit team is a one-creature team: the fighter that walked in.
  const activeIndex = options.activeIndex ?? 0;
  const party: PartyMember[] = options.party ?? [{ id: options.player.id, species: options.player.species, level: options.player.level, hp }];
  if (!validPartyShape(party, activeIndex)) throw new Error('Geçersiz takım');
  for (const member of party) {
    if (!member.id || !Number.isInteger(member.level) || member.level < 1 || member.level > MAX_LEVEL ||
      movesFor(member).length !== 4 || !Number.isInteger(member.hp) || member.hp < 0 ||
      member.hp > stats(member).maxHp) throw new Error('Geçersiz takım üyesi');
  }
  const active = party[activeIndex];
  if (active.id !== options.player.id || active.species.id !== options.player.species.id ||
    active.level !== options.player.level || active.hp !== hp) throw new Error('Sahadaki yaratık takımla uyuşmuyor');
  return structuredClone({ version: 3, battleId: options.battleId, encounterId: options.encounterId,
    phase: 'INTRO', turn: 1, rngState: options.seed >>> 0 || 0x6d2b79f5,
    playerCreatureId: options.player.id, party, activeIndex, player: options.player, enemy: options.enemy,
    playerHp: hp, enemyHp: stats(options.enemy).maxHp, stamina: 5, enemyStamina: 5,
    ambushed: options.ambushed ?? false, aggressive: options.aggressive ?? false, capturable: options.capturable ?? true, captureCapacity: options.captureCapacity ?? 0,
    status: { playerGuard: false, enemyGuard: false, enemyLastSlot: null, playerEffects: [], enemyEffects: [] },
    traits: { player: EMPTY_TRAIT_STATE, enemy: EMPTY_TRAIT_STATE }, dayPhase: options.dayPhase ?? 'day', pendingGuard: false,
    inventorySnapshot: options.inventorySnapshot ?? {}, outcome: null, committedActions: {} });
}
export function beginBattle(state: BattleState): BattleState {
  return state.phase === 'INTRO' ? { ...structuredClone(state), phase: 'PLAYER_INPUT' } : state;
}
/**
 * Picks the enemy's slot, or null when slow has drained it below every price: an exhausted
 * fighter rests instead of paying energy it does not have.
 */
export function enemyMove(state: BattleSnapshot): Slot | null {
  const moves = movesFor(state.enemy);
  const usable = (slot: Slot) => moves[slot].unlockLevel <= state.enemy.level && moves[slot].cost <= state.enemyStamina;
  if (state.enemyHp / stats(state.enemy).maxHp < .3 && state.status.enemyLastSlot !== 2 && usable(2)) return 2;
  return ([3, 1, 0] as const).find(usable) ?? null;
}
/** Pure resolver. Persist state + receipt atomically before presenting its events. */
export function resolveBattle(state: BattleState, command: GameCommand): BattleResult {
  const reject = (reason: string): BattleResult => ({ state, accepted: false, duplicate: false, reason });
  if (!command.commandId || !Number.isSafeInteger(command.tick) || command.tick < 0) return reject('Geçersiz komut');
  const previous = Object.hasOwn(state.committedActions, command.commandId) ? state.committedActions[command.commandId] : undefined;
  if (previous) {
    const same = previous.command.type === command.type && previous.command.tick === command.tick &&
      (command.type !== 'attack' || (previous.command.type === 'attack' && previous.command.slot === command.slot)) &&
      (command.type !== 'switch-party' || (previous.command.type === 'switch-party' && previous.command.index === command.index)) &&
      (command.type !== 'use-battle-item' || (previous.command.type === 'use-battle-item' && previous.command.itemId === command.itemId));
    return same ? { state, accepted: true, duplicate: true, receipt: structuredClone(previous) } : reject('Komut kimliği çakışıyor');
  }
  const forced = state.phase === 'FORCED_SWITCH';
  // A downed fighter owes the field a replacement: nothing else is accepted until it arrives.
  if (forced ? command.type !== 'switch-party' : state.phase !== 'PLAYER_INPUT' || state.playerHp <= 0) return reject('Eylem sırası değil');
  if (state.outcome || state.enemyHp <= 0) return reject('Eylem sırası değil');
  if (command.type !== 'attack' && command.type !== 'flee' && command.type !== 'capture' &&
    command.type !== 'switch-party' && command.type !== 'use-battle-item') return reject('Desteklenmeyen savaş eylemi');
  if (command.type === 'switch-party') {
    const refusal = switchRefusal(state.party, state.activeIndex, command.index, forced);
    if (refusal) return reject(refusal);
  }
  if (command.type === 'capture') {
    if (!state.capturable || state.enemyHp / stats(state.enemy).maxHp > .35) return reject('Hedef yakalanamaz; canı %35 veya altında olmalı');
    if (!sealChoice(state.inventorySnapshot) || !(state.captureCapacity >= 1)) return reject('Mühür veya boş yaratık yeri yok');
  }
  if (command.type === 'use-battle-item') {
    const heal = battleItemHeal(command.itemId);
    if (heal === null) return reject('Bu eşya savaşta kullanılamaz');
    if (!((state.inventorySnapshot[command.itemId] ?? 0) >= 1)) return reject('Eşya kalmadı');
    if (state.playerHp >= stats(state.player).maxHp) return reject('Can zaten dolu');
  }
  if (command.type === 'attack') {
    const move = movesFor(state.player)[command.slot];
    if (!move || state.player.level < move.unlockLevel) return reject('Seviye yetersiz');
    if (state.stamina < move.cost) return reject('Enerji yetersiz');
  }
  const next = structuredClone(state);
  const events: BattleEvent[] = [];
  const roll = () => { const r = randomStep(next.rngState); next.rngState = r.state; return r.value; };
  const finish = (outcome: Outcome) => {
    next.phase = outcome; next.outcome = outcome;
    // Statuses belong to the battle, never to the creature that walks out of it.
    next.status.playerEffects = []; next.status.enemyEffects = [];
    events.push({ type: 'outcome', outcome });
  };
  /** Builds the pure context a passive reads. No dice, no clock, no hidden state. */
  const contextFor = (side: Side, effectiveness: number, guarded: boolean) => {
    const player = side === 'player';
    const self = player ? next.player : next.enemy;
    const foe = player ? next.enemy : next.player;
    return {
      trait: self.species.trait, level: self.level,
      hp: player ? next.playerHp : next.enemyHp, maxHp: stats(self).maxHp,
      element: self.species.element, state: player ? next.traits.player : next.traits.enemy,
      dayPhase: next.dayPhase,
      allies: player ? next.party.filter((m, i) => i !== next.activeIndex && m.hp > 0).length : 0,
      enemyLevel: foe.level, enemyElement: foe.species.element, effectiveness, guarded,
    };
  };
  const modsFor = (side: Side, effectiveness = 1, guarded = false) => traitModifiers(contextFor(side, effectiveness, guarded));
  const bump = (side: Side, event: Parameters<typeof advanceTraitState>[1]) => {
    if (side === 'player') next.traits.player = advanceTraitState(next.traits.player, event);
    else next.traits.enemy = advanceTraitState(next.traits.enemy, event);
  };
  const act = (side: Side, slot: Slot | null) => {
    const player = side === 'player';
    const other: Side = player ? 'enemy' : 'player';
    const guardKey = player ? 'playerGuard' : 'enemyGuard';
    const targetGuard = player ? 'enemyGuard' : 'playerGuard';
    const ownEffects = player ? next.status.playerEffects : next.status.enemyEffects;
    const targetEffects = player ? next.status.enemyEffects : next.status.playerEffects;
    next.status[guardKey] = false;
    if (slot === null) { bump(side, 'other'); events.push({ type: 'rest', side }); return; }
    const attacker = player ? next.player : next.enemy;
    const defender = player ? next.enemy : next.player;
    const move = movesFor(attacker)[slot];
    const own = modsFor(side);
    const spend = Math.max(0, move.cost - own.staminaDiscount);
    if (player) next.stamina -= spend;
    else { next.enemyStamina -= spend; next.status.enemyLastSlot = slot; }
    const hpKey = player ? 'playerHp' : 'enemyHp';
    const maxHp = stats(attacker).maxHp;
    // D09: support moves are defensive, so they never draw attack dice.
    if (move.effect === 'guard' || move.effect === 'shield') {
      next.status[guardKey] = true;
      // A shield wall also steadies the fighter, which is what separates it from a plain guard.
      if (move.effect === 'shield') applyStatus(ownEffects, 'bulwark');
      bump(side, 'guarded');
      events.push({ type: 'guard', side, slot });
      return;
    }
    if (move.effect === 'mend') {
      const healed = Math.min(maxHp - next[hpKey], Math.ceil(maxHp / 5));
      next[hpKey] += healed; bump(side, 'other');
      events.push({ type: 'mend', side, slot, heal: healed });
      return;
    }
    if (move.effect === 'cleanse') {
      const cleared = ownEffects.filter((effect) => effect.kind === 'poison' || effect.kind === 'burn' ||
        effect.kind === 'slow' || effect.kind === 'weaken');
      if (player) next.status.playerEffects = ownEffects.filter((effect) => !cleared.includes(effect));
      else next.status.enemyEffects = ownEffects.filter((effect) => !cleared.includes(effect));
      bump(side, 'other');
      events.push({ type: 'mend', side, slot, heal: 0 });
      return;
    }
    if (move.effect === 'haste') {
      if (player) next.stamina = Math.min(5, next.stamina + 2); else next.enemyStamina = Math.min(5, next.enemyStamina + 2);
      bump(side, 'other'); events.push({ type: 'guard', side, slot });
      return;
    }
    if (move.effect === 'bulwark' || move.effect === 'charge') {
      applyStatus(ownEffects, move.effect);
      bump(side, 'other');
      events.push({ type: 'status', side, status: move.effect, hit: true });
      return;
    }
    const effectiveness = elementMultiplier(move.element, defender.species.element);
    const foeMods = modsFor(other, effectiveness, next.status[targetGuard]);
    const selfMods = modsFor(side, effectiveness, next.status[targetGuard]);
    const hit = roll() < Math.min(1, move.accuracy + selfMods.accuracy);
    const variation = roll(); // Misses consume the damage die too.
    const targetKey = player ? 'enemyHp' : 'playerHp';
    // A stored charge discharges into this swing; weaken and bulwark are the status-borne halves.
    const charged = hasStatus(ownEffects, 'charge') ? CHARGE_POWER : 0;
    const outgoing = selfMods.outgoing * (hasStatus(ownEffects, 'weaken') ? WEAKEN_FACTOR : 1);
    const incoming = foeMods.incoming * (hasStatus(targetEffects, 'bulwark') ? BULWARK_FACTOR : 1);
    const rawAmount = damage(move.power, attacker, defender, variation, next.status[targetGuard],
      hasStatus(ownEffects, 'burn'), move.element,
      { outgoing, incoming, powerBonus: selfMods.powerBonus + charged, ignoreGuard: selfMods.ignoreGuard });
    const shield = !player && next.ambushed && next.turn === 1 && roleUnlocked({ speciesId: next.player.species.id, level: next.player.level }, 'tank') ? TANK_AMBUSH_SHIELD : 1;
    let amount = hit ? Math.min(next[targetKey], Math.max(1, Math.floor(rawAmount * shield))) : 0;
    if (charged) removeStatus(ownEffects, 'charge');
    // `element_emici` turns a poorly matched hit into a drink rather than a wound.
    if (hit && foeMods.absorbWeak && effectiveness < 1) {
      const drank = Math.min(stats(defender).maxHp - next[targetKey], Math.max(1, Math.floor(amount / 2)));
      next[targetKey] += drank; amount = 0;
      events.push({ type: 'trait', side: other, trait: defender.species.trait, heal: drank });
    } else if (hit && amount >= next[targetKey] && foeMods.rescues) {
      // `inatci` holds on at a single point of health, once per battle.
      amount = Math.max(0, next[targetKey] - 1);
      next[targetKey] -= amount;
      bump(other, 'rescued');
      events.push({ type: 'trait', side: other, trait: defender.species.trait });
    } else {
      next[targetKey] -= amount;
    }
    if (hit) {
      next.status[targetGuard] = false;
      bump(other, 'took-hit');
      if (move.effect === 'drain') {
        const drawn = Math.min(maxHp - next[hpKey], Math.max(1, Math.floor(amount * DRAIN_SHARE)));
        next[hpKey] += drawn;
        events.push({ type: 'mend', side, slot, heal: drawn });
      }
    }
    bump(side, 'attacked');
    events.push({ type: 'attack', side, slot, hit, damage: amount });
    // `zehirli_deri` answers a landed blow on a fixed count, so it costs no die.
    const skin = modsFor(other).contactPoison;
    const taken = other === 'player' ? next.traits.player.hitsTaken : next.traits.enemy.hitsTaken;
    if (hit && skin > 0 && taken % skin === 0 && next[hpKey] > 0 && !modsFor(side).immune.includes('poison')) {
      applyStatus(ownEffects, 'poison');
      events.push({ type: 'trait', side: other, trait: defender.species.trait, status: 'poison' });
    }
    if (!hit || !move.effect || !STATUS_KINDS.includes(move.effect as StatusKind)) return;
    // One die per landed status move; a fainted target is never afflicted.
    const kind = move.effect as StatusKind;
    const applied = roll() < STATUS_RULES[kind].chance + selfMods.statusBonus && next[targetKey] > 0
      && !foeMods.immune.includes(kind);
    if (applied) applyStatus(targetEffects, kind);
    events.push({ type: 'status', side: player ? 'enemy' : 'player', status: kind, hit: applied });
  };
  /** Brings a bench member out: the leaving creature keeps its HP, its statuses stay behind. */
  const swap = (index: number) => {
    const leaving = next.player;
    const parting = modsFor('player');
    next.party[next.activeIndex] = { ...next.party[next.activeIndex], hp: next.playerHp };
    if (parting.switchHeal > 0) {
      // `simbiyoz`: stepping back is itself the support move.
      next.party = next.party.map((member, i) => {
        if (i === next.activeIndex || member.hp <= 0) return member;
        const top = stats(member).maxHp;
        return { ...member, hp: Math.min(top, member.hp + Math.max(1, Math.floor(top * parting.switchHeal))) };
      });
      events.push({ type: 'trait', side: 'player', trait: leaving.species.trait });
    }
    next.activeIndex = index;
    const member = next.party[index];
    next.player = { id: member.id, species: member.species, level: member.level,
      ...(member.grafts?.length ? { grafts: [...member.grafts] } : {}),
      ...(member.loadout?.length ? { loadout: [...member.loadout] } : {}) };
    next.playerCreatureId = member.id;
    next.playerHp = member.hp;
    next.status.playerGuard = false;
    next.status.playerEffects = [];
    next.traits.player = EMPTY_TRAIT_STATE;
    // `tohumcu` on the creature that just fell sends its replacement out already covered.
    if (next.pendingGuard) { next.status.playerGuard = true; next.pendingGuard = false; }
    events.push({ type: 'switch', side: 'player', index });
  };
  /** One turn's bookkeeping: poison, energy, clocks. Returns false when it ended the battle. */
  const endTurn = (): boolean => {
    next.phase = 'TURN_END';
    for (const side of ['player', 'enemy'] as const) {
      const effects = side === 'player' ? next.status.playerEffects : next.status.enemyEffects;
      if (!hasStatus(effects, 'poison')) continue;
      const hpKey = side === 'player' ? 'playerHp' : 'enemyHp';
      const bite = Math.min(next[hpKey], poisonDamage(side === 'player' ? next.player : next.enemy));
      next[hpKey] -= bite;
      events.push({ type: 'status', side, status: 'poison', damage: bite });
    }
    for (const side of ['player', 'enemy'] as const) {
      const regen = modsFor(side).regenDivisor;
      const hpKey = side === 'player' ? 'playerHp' : 'enemyHp';
      const fighter = side === 'player' ? next.player : next.enemy;
      if (!regen || next[hpKey] <= 0) continue;
      const top = stats(fighter).maxHp;
      const gained = Math.min(top - next[hpKey], Math.max(1, Math.floor(top / regen)));
      if (gained <= 0) continue;
      next[hpKey] += gained;
      events.push({ type: 'trait', side, trait: fighter.species.trait, heal: gained });
    }
    if (next.playerHp === 0 && !downPlayer()) return false;
    if (next.enemyHp === 0) { finish('WON'); return false; }
    if (!hasStatus(next.status.playerEffects, 'slow')) next.stamina = Math.min(5, next.stamina + 1);
    if (!hasStatus(next.status.enemyEffects, 'slow')) next.enemyStamina = Math.min(5, next.enemyStamina + 1);
    next.status.playerEffects = tick(next.status.playerEffects, 1 + modsFor('player').statusTick);
    next.status.enemyEffects = tick(next.status.enemyEffects, 1 + modsFor('enemy').statusTick);
    next.turn++; events.push({ type: 'turn-end' });
    next.phase = next.phase === 'TURN_END' ? 'PLAYER_INPUT' : next.phase;
    return true;
  };
  /**
   * Handles the active creature going down. With a standing team mate the battle waits for a
   * forced switch instead of ending, which is the v2 change to v1's single-creature loss.
   */
  const downPlayer = (): boolean => {
    next.party[next.activeIndex] = { ...next.party[next.activeIndex], hp: 0 };
    if (modsFor('player').guardsSuccessor) next.pendingGuard = true;
    events.push({ type: 'faint', side: 'player', index: next.activeIndex });
    if (!hasReserve(next.party, next.activeIndex)) { finish('LOST'); return false; }
    next.status.playerEffects = [];
    next.status.playerGuard = false;
    next.phase = 'FORCED_SWITCH';
    return true;
  };
  if (forced && command.type === 'switch-party') {
    // The turn the fighter fell in is closed by its replacement stepping out.
    swap(command.index);
    if (endTurn()) next.phase = 'PLAYER_INPUT';
    return commit(next, command, events);
  }
  next.phase = 'RESOLVE_PLAYER';
  next.status.playerGuard = false;
  if (command.type === 'switch-party') {
    swap(command.index);
  } else if (command.type === 'use-battle-item') {
    // A salve costs the whole turn: the enemy answers before the next command is taken.
    next.inventorySnapshot[command.itemId] = (next.inventorySnapshot[command.itemId] ?? 0) - 1;
    const healed = Math.min(stats(next.player).maxHp - next.playerHp, battleItemHeal(command.itemId)!);
    next.playerHp += healed;
    events.push({ type: 'item', side: 'player', itemId: command.itemId, heal: healed });
  } else if (command.type === 'flee') {
    const hit = roll() < (next.aggressive ? .45 : .75);
    events.push({ type: 'flee', side: 'player', hit });
    if (hit) finish('FLED');
  } else if (command.type === 'capture') {
    const seal = sealChoice(next.inventorySnapshot)!;
    next.inventorySnapshot[seal.id]--;
    const hit = captureSucceeds(next, roll());
    events.push({ type: 'capture', side: 'player', hit });
    if (hit) { next.captureCapacity--; finish('CAPTURED'); }
  } else act('player', command.slot);
  if (!next.outcome && next.enemyHp === 0) finish('WON');
  if (!next.outcome) {
    next.phase = 'RESOLVE_ENEMY'; act('enemy', enemyMove(next));
    // Poison bites first, then energy returns to whoever is not slowed, then the clocks run down.
    if (next.playerHp === 0 ? downPlayer() : next.enemyHp !== 0) endTurn();
    else if (next.enemyHp === 0 && !next.outcome) finish('WON');
  }
  return commit(next, command, events);
}
function commit(next: BattleState, command: GameCommand, events: BattleEvent[]): BattleResult {
  // The team record is the single truth about who has how much HP left.
  next.party[next.activeIndex] = { ...next.party[next.activeIndex], hp: next.playerHp };
  const snapshot: BattleSnapshot = { ...next };
  delete (snapshot as Partial<BattleState>).committedActions;
  const receipt: Receipt = { command: structuredClone(command), snapshot, events };
  Object.defineProperty(next.committedActions, command.commandId, { value: structuredClone(receipt), enumerable: true, configurable: true, writable: true });
  return { state: next, accepted: true, duplicate: false, receipt: structuredClone(receipt) };
}
/** `steps` is normally one; `isik_halesi` burns clocks down faster. */
function tick(effects: readonly StatusEffect[], steps = 1): StatusEffect[] {
  return effects.map(effect => ({ kind: effect.kind, turns: effect.turns - steps })).filter(effect => effect.turns > 0);
}

export function captureChance(state: BattleSnapshot): number {
  const penalty = { common: 0, uncommon: .1, rare: .2, legendary: .3 }[state.enemy.species.rarity];
  // The seal about to be spent decides the bonus: plain +0, fine +.05, ancient +.10.
  const bonus = sealChoice(state.inventorySnapshot)?.bonus ?? 0;
  return Math.max(.1, Math.min(.85, .20 + .60 * (1 - state.enemyHp / stats(state.enemy).maxHp) + .015 * (state.player.level - state.enemy.level) - penalty + bonus));
}
export function captureSucceeds(state: BattleSnapshot, roll: number): boolean {
  return roll < captureChance(state);
}
