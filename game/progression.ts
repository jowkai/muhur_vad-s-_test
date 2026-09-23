import { MAX_LEVEL } from '../contracts';
import { creatureById } from '../content/catalog';
import { stats } from './combat/core';

export interface OwnedCreature { id: string; speciesId: string; level: number; xp: number; hp: number; maxHp: number }
export function xpRequired(level: number): number { return 20 + 10 * level + 5 * level * level; }
export function validateCreature(c: OwnedCreature): void {
  const species = creatureById(c.speciesId);
  if (!species || !c.id || !Number.isInteger(c.level) || c.level < 1 || c.level > MAX_LEVEL ||
    !Number.isSafeInteger(c.xp) || c.xp < 0 || (c.level < MAX_LEVEL && c.xp >= xpRequired(c.level)) ||
    c.maxHp !== stats({ id: c.id, species, level: c.level }).maxHp || !Number.isInteger(c.hp) || c.hp < 0 || c.hp > c.maxHp) throw new Error('Geçersiz yaratık ilerlemesi');
}
export function grantXp(creature: OwnedCreature, amount: number): OwnedCreature {
  validateCreature(creature);
  if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(amount + creature.xp)) throw new Error('Geçersiz XP');
  const next = { ...creature, xp: creature.xp + amount };
  while (next.level < MAX_LEVEL && next.xp >= xpRequired(next.level)) { next.xp -= xpRequired(next.level); next.level++; }
  const oldMax = next.maxHp;
  next.maxHp = stats({ id: next.id, species: creatureById(next.speciesId)!, level: next.level }).maxHp;
  if (next.hp > 0) next.hp += next.maxHp - oldMax;
  return next;
}
export function cosmeticStage(level: number): 0 | 1 | 2 { return level >= 10 ? 2 : level >= 5 ? 1 : 0; }
