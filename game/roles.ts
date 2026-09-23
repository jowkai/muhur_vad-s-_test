import { CREATURE_ROLES, MAX_LEVEL, type CreatureRole, type MountRecord, type SpeedEffect } from '../contracts';
import { creatureById, itemById } from '../content/catalog';
import type { CreatureDefinition, Rarity } from '../content/schema';
import { cosmeticStage, type OwnedCreature } from './progression';

export interface RoleRule {
  readonly role: CreatureRole; readonly unlockLevel: number;
  readonly label: string; readonly hint: string;
  /** What the role does to walking speed while it carries the player. */
  readonly speed: number;
  /** A carrier takes the player somewhere; tank and claw work from the ground. */
  readonly carries: boolean;
}
/** One table for the six roles: when they open, what they do and what they are called. */
export const ROLE_RULES: Readonly<Record<CreatureRole, RoleRule>> = Object.freeze({
  claw: { role: 'claw', unlockLevel: 10, label: 'Pençeli', hint: 'Ağaç kesebilir', speed: 1, carries: false },
  swim: { role: 'swim', unlockLevel: 12, label: 'Yüzücü', hint: 'Derin suyu geçirir', speed: 1.1, carries: true },
  tank: { role: 'tank', unlockLevel: 14, label: 'Tank', hint: 'Yavaş ama pusuyu yarı hasara indirir', speed: .7, carries: false },
  dig: { role: 'dig', unlockLevel: 16, label: 'Kazıcı', hint: 'Damarı anında açar ve tünelden geçirir', speed: 1, carries: true },
  ride: { role: 'ride', unlockLevel: 20, label: 'Binek', hint: 'Sırtında taşır', speed: 1, carries: true },
  fly: { role: 'fly', unlockLevel: 28, label: 'Uçucu', hint: 'Engelleri ve suyu aşar', speed: 1.15, carries: true },
});
/** Flying needs a grown body: the second cosmetic stage, which arrives at level ten. */
export const FLY_STAGE = 2;
export const TANK_AMBUSH_SHIELD = .5;
export const TANK_BONUS_SLOTS = 6;
export function activeTank(creatures: readonly OwnedCreature[], activeCreatureId?: string | null): boolean {
  const active = creatures.find((creature) => creature.id === activeCreatureId);
  return !!active && active.hp > 0 && roleUnlocked(active, 'tank');
}
const RARITY_BONUS: Readonly<Record<Rarity, number>> = Object.freeze({ common: 1, uncommon: 1.05, rare: 1.12, legendary: 1.18 });

export const rolesOf = (speciesId: string): readonly CreatureRole[] => creatureById(speciesId)?.roles ?? [];
export const speciesRoles = (species: Pick<CreatureDefinition, 'roles'>) => species.roles;
/** A role is only usable once the creature is old enough — and flight also needs the size. */
export function roleUnlocked(creature: Pick<OwnedCreature, 'speciesId' | 'level'>, role: CreatureRole): boolean {
  if (!rolesOf(creature.speciesId).includes(role)) return false;
  if (creature.level < ROLE_RULES[role].unlockLevel) return false;
  return role !== 'fly' || cosmeticStage(creature.level) >= FLY_STAGE;
}
export const unlockedRoles = (creature: Pick<OwnedCreature, 'speciesId' | 'level'>): readonly CreatureRole[] =>
  CREATURE_ROLES.filter((role) => roleUnlocked(creature, role));
/** The ways this creature could carry the player right now, strongest first. */
export function mountRoles(creature: Pick<OwnedCreature, 'speciesId' | 'level'>): readonly MountRecord['role'][] {
  return (['fly', 'ride', 'swim', 'dig'] as const).filter((role) => roleUnlocked(creature, role));
}
export interface RoleView {
  readonly role: CreatureRole; readonly label: string; readonly hint: string;
  readonly unlocked: boolean; readonly unlockLevel: number; readonly note: string;
}
/** What the creature panel shows: every role the species has and whether it is open yet. */
export function roleViews(creature: Pick<OwnedCreature, 'speciesId' | 'level'>): readonly RoleView[] {
  return Object.freeze(rolesOf(creature.speciesId).map((role) => {
    const rule = ROLE_RULES[role];
    const unlocked = roleUnlocked(creature, role);
    const needsSize = role === 'fly' && cosmeticStage(creature.level) < FLY_STAGE;
    return Object.freeze({
      role, label: rule.label, hint: rule.hint, unlocked, unlockLevel: rule.unlockLevel,
      note: unlocked ? rule.hint
        : needsSize && creature.level >= rule.unlockLevel ? 'Gövdesi henüz yeterince büyük değil'
        : `Sv ${rule.unlockLevel} gerekir`,
    });
  }));
}
/** Speed effects that have not run out yet; the list is filtered, never mutated in place. */
export const activeSpeedEffects = (effects: readonly SpeedEffect[], worldTick: number): readonly SpeedEffect[] =>
  effects.filter((effect) => effect.untilTick > worldTick);
export function tonicMultiplier(effects: readonly SpeedEffect[], worldTick: number): number {
  // Tonics do not stack: the strongest one that is still running wins.
  return activeSpeedEffects(effects, worldTick).reduce((best, effect) => Math.max(best, effect.multiplier), 1);
}
/** How fast the player moves: the mount's own speed, its rarity, its role and any tonic. */
export function travelSpeed(options: {
  readonly mount?: MountRecord | null;
  readonly creatures: readonly OwnedCreature[];
  readonly effects?: readonly SpeedEffect[];
  readonly worldTick?: number;
  readonly activeCreatureId?: string | null;
}): number {
  const tonic = tonicMultiplier(options.effects ?? [], options.worldTick ?? 0);
  const mounted = options.mount && options.creatures.find((creature) => creature.id === options.mount!.creatureId);
  if (!mounted) return tonic * (activeTank(options.creatures, options.activeCreatureId) ? ROLE_RULES.tank.speed : 1);
  const species = creatureById(mounted.speciesId);
  if (!species || !roleUnlocked(mounted, options.mount!.role)) return tonic;
  return species.baseSpeed * RARITY_BONUS[species.rarity] * ROLE_RULES[options.mount!.role].speed * tonic;
}
/** Where a mount may take the player: flight ignores the ground, swimming crosses deep water. */
export interface TravelPermissions { readonly fly: boolean; readonly swim: boolean; readonly dig: boolean }
export function permissions(mount: MountRecord | null | undefined): TravelPermissions {
  return Object.freeze({
    fly: mount?.role === 'fly',
    swim: mount?.role === 'fly' || mount?.role === 'swim',
    dig: mount?.role === 'dig',
  });
}
/** Roles the travelling team can offer at all, whether or not one is being ridden. */
export function partyRoles(party: readonly string[], creatures: readonly OwnedCreature[]): ReadonlySet<CreatureRole> {
  const open = new Set<CreatureRole>();
  for (const id of party) {
    const creature = creatures.find((entry) => entry.id === id);
    if (!creature) continue;
    for (const role of unlockedRoles(creature)) open.add(role);
  }
  return open;
}
/** Why a mount request is refused, or null when it is allowed. */
export function mountRefusal(options: {
  readonly creature?: OwnedCreature; readonly party: readonly string[]; readonly role?: MountRecord['role'];
}): string | null {
  const { creature, party, role } = options;
  if (!creature) return 'Bu yaratık koleksiyonda yok';
  if (!party.includes(creature.id)) return 'Yalnız takımdaki bir yaratığa binilir';
  if (creature.hp <= 0) return 'Baygın yaratığa binilemez';
  const open = mountRoles(creature);
  if (!open.length) return rolesOf(creature.speciesId).some((entry) => ROLE_RULES[entry].carries)
    ? `Bu yaratık Sv ${Math.min(...rolesOf(creature.speciesId).filter((entry) => ROLE_RULES[entry].carries).map((entry) => ROLE_RULES[entry].unlockLevel))} olunca taşıyabilir`
    : 'Bu yaratık taşıyamaz';
  if (role && !open.includes(role)) return 'Bu yaratık böyle taşıyamaz';
  return null;
}
export const bestMountRole = (creature: Pick<OwnedCreature, 'speciesId' | 'level'>): MountRecord['role'] | null =>
  mountRoles(creature)[0] ?? null;
/** A tonic item turns into the timed effect the save keeps. */
export function speedEffectFor(itemId: string, worldTick: number, seconds = 180): SpeedEffect | null {
  const effect = itemById(itemId)?.effect;
  if (effect?.kind !== 'speed') return null;
  return { itemId, multiplier: effect.value, untilTick: worldTick + Math.round(seconds * 60) };
}
export const MAX_ROLE_LEVEL = MAX_LEVEL;
