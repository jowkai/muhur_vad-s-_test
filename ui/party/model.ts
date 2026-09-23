import { PARTY_LIMIT, type CommandIntent } from '../../contracts';
import { creatureAssets } from '../../content/asset-manifest';
import { creatureById } from '../../content/catalog';
import { stats, type BattleState } from '../../game/combat/core';
import { roleViews } from '../../game/roles';
import type { CreatureRole } from '../../contracts';
import type { WorldState } from '../../world/persistence/world-save';

export interface PartyRoleBadge { readonly role: CreatureRole; readonly label: string; readonly unlocked: boolean; readonly note: string }
export interface PartySlotView {
  readonly index: number; readonly filled: boolean;
  /** v3: what this creature can do for the player, and whether it is old enough yet. */
  readonly roles: readonly PartyRoleBadge[];
  readonly mounted: boolean;
  readonly creatureId: string | null; readonly name: string; readonly spriteUrl: string;
  readonly level: number; readonly hp: number; readonly maxHp: number; readonly ratio: number;
  readonly hpText: string; readonly active: boolean; readonly fainted: boolean;
  readonly enabled: boolean; readonly note: string; readonly shortcut: string;
  readonly intent: CommandIntent | null;
}
export interface PartyStripView {
  readonly slots: readonly PartySlotView[];
  readonly inBattle: boolean; readonly forced: boolean;
  /** What the strip is for right now, one short line for the screen reader. */
  readonly caption: string;
}
const EMPTY = Object.freeze({
  filled: false as const, creatureId: null, name: 'Boş yuva', spriteUrl: '', level: 0,
  roles: Object.freeze([]) as readonly PartyRoleBadge[], mounted: false,
  hp: 0, maxHp: 0, ratio: 0, hpText: '—', active: false, fainted: false,
  enabled: false, note: 'Boş yuva', intent: null,
});
/**
 * Six slots, in save order. The strip is a projection: it never edits the party, it publishes
 * the intent the session already knows how to run — `switch-party` inside a battle, where the
 * swap costs a turn, and `set-active` outside one, where it is immediate.
 */
export function partyStrip(state: WorldState, options: { readonly battle?: BattleState | null } = {}): PartyStripView {
  const battle = options.battle ?? state.battle ?? null;
  const live = battle && !battle.outcome ? battle : null;
  const forced = live?.phase === 'FORCED_SWITCH';
  const ready = !live || live.phase === 'PLAYER_INPUT' || forced;
  const worldReady = state.mode === 'exploring' || state.mode === 'panel';
  const order = live ? live.party.map((member) => member.id) : state.party;
  const activeId = live ? live.player.id : state.activeCreatureId;
  const slots = Array.from({ length: PARTY_LIMIT }, (_, index): PartySlotView => {
    const creatureId = order[index] ?? null;
    const owned = creatureId ? state.creatures.find((creature) => creature.id === creatureId) : undefined;
    const species = owned && creatureById(owned.speciesId);
    const shortcut = live ? `Shift+${index + 1}` : `${index + 1}`;
    if (!owned || !species) return Object.freeze({ ...EMPTY, index, shortcut });
    const member = live?.party[index];
    const hp = member ? member.hp : owned.hp;
    const maxHp = stats({ id: owned.id, species, level: owned.level }).maxHp;
    const active = creatureId === activeId;
    const fainted = hp <= 0;
    const blocked = !ready ? 'Tur çözülüyor'
      : active ? (forced ? 'Bayıldı' : 'Sahada')
      : fainted ? 'Baygın · kampta iyileştir'
      : !live && !worldReady ? 'Şu anda değiştirilemez' : '';
    const badges = Object.freeze(roleViews(owned).map((view) => Object.freeze({
      role: view.role, label: view.label, unlocked: view.unlocked, note: view.note,
    })));
    return Object.freeze({
      index, filled: true, creatureId, name: species.name,
      roles: badges, mounted: state.mount?.creatureId === creatureId,
      spriteUrl: creatureAssets[species.id as keyof typeof creatureAssets]?.front ?? '',
      level: owned.level, hp, maxHp, ratio: maxHp > 0 ? Math.min(1, Math.max(0, hp / maxHp)) : 0,
      hpText: `${hp}/${maxHp}`, active, fainted, enabled: !blocked,
      note: blocked || (live ? 'Değiştirmek bir tur harcar' : 'Sahaya çıkar'),
      shortcut,
      intent: blocked ? null : live
        ? Object.freeze({ type: 'switch-party', index }) as CommandIntent
        : Object.freeze({ type: 'set-active', creatureId }) as CommandIntent,
    });
  });
  return Object.freeze({
    slots: Object.freeze(slots), inBattle: !!live, forced,
    caption: forced ? 'Ayakta bir yaratık seç' : live ? 'Değiştirmek bir tur harcar' : 'Takımın',
  });
}
/**
 * Keyboard mapping. Outside a battle the digits 1–6 pick a slot; inside one the digits belong to
 * the four attack buttons, so the strip listens on Shift+digit instead.
 */
export function partyIntentForKey(event: { key: string; shiftKey?: boolean }, view: PartyStripView): CommandIntent | null {
  const digit = Number(event.key);
  if (!Number.isInteger(digit) || digit < 1 || digit > PARTY_LIMIT) return null;
  if (view.inBattle !== !!event.shiftKey) return null;
  const slot = view.slots[digit - 1];
  return slot?.enabled ? slot.intent : null;
}
