import { PARTY_LIMIT } from '../contracts';
import type { CreatureDefinition } from '../content/schema';

/** One travelling creature as the battle sees it: identity, species, level and current HP. */
export interface PartyMember {
  id: string; species: CreatureDefinition; level: number; hp: number;
  /** Grafted moves travel with the member so a switch keeps its set. */
  grafts?: string[];
  /** v4: the chosen four travel too, for the same reason. */
  loadout?: string[];
}
/** A standing party member that did not fight still learns from the battle. */
export const PARTY_XP_SHARE = .4;

export function standing(party: readonly PartyMember[]): number[] {
  return party.map((member, index) => (member.hp > 0 ? index : -1)).filter(index => index >= 0);
}
export function hasReserve(party: readonly PartyMember[], activeIndex: number): boolean {
  return standing(party).some(index => index !== activeIndex);
}
/**
 * The single switch rule both the forced and the voluntary path ask. A forced switch happens
 * with the active creature already down, so only there may the caller leave a fainted slot.
 */
export function switchRefusal(party: readonly PartyMember[], activeIndex: number, index: unknown, forced: boolean): string | null {
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= party.length) return 'Takımda böyle bir yuva yok';
  const target = party[index as number];
  if ((index as number) === activeIndex) return forced ? 'Bayılan yaratıkla devam edilemez' : 'Bu yaratık zaten sahada';
  if (target.hp <= 0) return 'Bayılmış yaratığa geçilemez';
  if (!forced && party[activeIndex].hp <= 0) return 'Zorunlu geçiş bekleniyor';
  return null;
}
/**
 * XP the battle pays out: the fighter that was on the field takes all of it, every other
 * standing member takes its share. A fainted member learns nothing.
 */
export function xpShares(party: readonly PartyMember[], activeIndex: number, award: number): { id: string; xp: number }[] {
  if (!Number.isSafeInteger(award) || award <= 0) return [];
  return party.flatMap((member, index) => {
    if (index === activeIndex) return [{ id: member.id, xp: award }];
    if (member.hp <= 0) return [];
    const share = Math.floor(award * PARTY_XP_SHARE);
    return share > 0 ? [{ id: member.id, xp: share }] : [];
  });
}
export function validPartyShape(party: unknown, activeIndex: unknown): party is PartyMember[] {
  if (!Array.isArray(party) || party.length < 1 || party.length > PARTY_LIMIT) return false;
  if (!Number.isInteger(activeIndex) || (activeIndex as number) < 0 || (activeIndex as number) >= party.length) return false;
  const ids = new Set(party.map((member: PartyMember) => member?.id));
  return ids.size === party.length && !ids.has(undefined as unknown as string);
}
