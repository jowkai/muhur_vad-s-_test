export const BIOME_IDS = ['meadow', 'forest', 'earth', 'desert', 'sea', 'ice', 'volcanic', 'flame'] as const;
export type BiomeId = typeof BIOME_IDS[number];
export interface VecXZ { readonly x: number; readonly z: number }
export type InputOwner = 'world' | 'panel' | 'battle' | 'none';
export type PanelId = 'inventory' | 'alchemy' | 'camp' | 'bestiary' | 'objectives' | 'settings';
/** v2: six active creatures travel with the player; the rest stay in the collection. */
export const PARTY_LIMIT = 6;
/** v4 adds three lasting statuses the wider move pool writes: a stat debuff, a stat buff and a stored charge. */
export type StatusKind = 'poison' | 'burn' | 'slow' | 'weaken' | 'bulwark' | 'charge';
export const STATUS_KIND_IDS: readonly StatusKind[] =
  Object.freeze(['poison', 'burn', 'slow', 'weaken', 'bulwark', 'charge']);
/** A status lives inside a battle; `turns` is what remains after the current turn resolves. */
export interface StatusEffect { readonly kind: StatusKind; readonly turns: number }
export interface ShrineRecord {
  readonly biomeId: BiomeId; readonly visitedTick: number; readonly chestTaken: boolean;
}
export type DayPhase = 'day' | 'night';
/** v3: what a creature can do for the player outside a fight. A species carries at most two. */
export type CreatureRole = 'ride' | 'fly' | 'swim' | 'dig' | 'tank' | 'claw';
export const CREATURE_ROLES: readonly CreatureRole[] = Object.freeze(['ride', 'fly', 'swim', 'dig', 'tank', 'claw']);
/** Trees are resources, not decoration; each kind has its own wood and its own rules. */
export type TreeKind = 'oak' | 'amber' | 'ghostwood' | 'emberbark' | 'frostpine'
  | 'ironroot' | 'dunepalm' | 'coralwood' | 'ashwillow';
export const TREE_KINDS: readonly TreeKind[] = Object.freeze(
  ['oak', 'amber', 'ghostwood', 'emberbark', 'frostpine', 'ironroot', 'dunepalm', 'coralwood', 'ashwillow']);
/** A move alchemy grafted onto one creature; it is permanent and lives in the save. */
export interface GraftRecord { readonly creatureId: string; readonly moveId: string; readonly tick: number }
/** A timed speed tonic. `untilTick` is world time, so pausing the game does not burn it. */
export interface SpeedEffect { readonly itemId: string; readonly multiplier: number; readonly untilTick: number }
/** The creature currently carrying the player, and how it carries them. */
export interface MountRecord { readonly creatureId: string; readonly role: Extract<CreatureRole, 'ride' | 'fly' | 'swim' | 'dig'> }
/** Optional for older saves; absence means the original bag has no role-granted slots. */
export interface RoleCapacityState { tankBonusSlots?: 0 | 6 }
/** Persisted entry context; a normal encounter or an older record has no ambush flag. */
export interface BattleEntryContext { ambushed?: boolean }
export const PLAYER_NAME_LIMIT = 24;
export const DEFAULT_PLAYER_NAME = 'Gezgin';
/** v3 raises the ceiling: deep regions need room above thirty. */
export const MAX_LEVEL = 50;
/**
 * The ceiling a level-50 creature reaches. Validation and save shapes size against this;
 * what a given creature may hold right now is `graftCapacity(level)`.
 */
export const MAX_GRAFTS_PER_CREATURE = 4;
/** v4: a third graft slot opens at twenty-five and a fourth at forty. */
export function graftCapacity(level: number): number {
  if (!Number.isFinite(level) || level < 1) return 0;
  return level >= 40 ? 4 : level >= 25 ? 3 : 2;
}
/** v4: the four moves a creature actually fights with, chosen at camp from its learn set. */
export interface MoveLoadout { readonly creatureId: string; readonly moveIds: readonly string[] }
/** How many moves a species knows in total, and how many it carries into a fight. */
export const LEARNSET_SIZE = 8;
export const LOADOUT_SIZE = 4;
/** How a material left the world; every method commits through one transaction. */
export type GatherMethod = 'pick' | 'dig' | 'cache' | 'garden' | 'chest' | 'fell';
/** Tool and item identifiers are catalogue-owned strings; contracts only fixes the shape. */
export type ItemRef = string;
export interface NearbyTarget {
  readonly entityId: string;
  readonly kind: 'egg' | 'creature' | 'resource';
  readonly name: string;
  readonly spriteId: string;
  readonly distance: number;
  readonly level: number;
  readonly interactionAllowed: boolean;
}
export type GameState =
  | { readonly mode: 'boot' }
  | { readonly mode: 'exploring' }
  | { readonly mode: 'panel'; readonly panel: PanelId }
  | { readonly mode: 'encounter'; readonly encounterId: string }
  | { readonly mode: 'battle'; readonly battleId: string; readonly encounterId: string }
  | { readonly mode: 'committing'; readonly transactionId: string; readonly battleId: string; readonly encounterId: string }
  | { readonly mode: 'recovery'; readonly transactionId: string; readonly battleId: string; readonly encounterId: string; readonly error: string };
export type GameMode = GameState['mode'];
export type GameEvent =
  | { type: 'loaded' }
  | { type: 'open-panel'; panel: PanelId }
  | { type: 'close-panel' }
  | { type: 'encounter'; encounterId: string }
  | { type: 'start-battle'; battleId: string; encounterId: string }
  | { type: 'commit'; transactionId: string; battleId: string }
  | { type: 'committed'; transactionId: string }
  | { type: 'commit-failed'; transactionId: string; error: string }
  | { type: 'retry' };
export type CommandIntent =
  | { type: 'move'; direction: VecXZ }
  | { type: 'interact'; entityId: string }
  | { type: 'open-panel'; panel: PanelId }
  | { type: 'close-panel' }
  | { type: 'craft'; recipeId: string }
  | { type: 'use-item'; itemId: string }
  | { type: 'set-active'; creatureId: string }
  | { type: 'switch-party'; index: number }
  | { type: 'use-battle-item'; itemId: ItemRef }
  | { type: 'travel'; anchorId: string }
  | { type: 'gather'; entityId: string; method: GatherMethod }
  | { type: 'visit-shrine'; shrineId: string }
  | { type: 'ride'; creatureId: string }
  | { type: 'dismount' }
  | { type: 'fell'; entityId: string }
  | { type: 'graft'; creatureId: string; moveId: string }
  | { type: 'rename'; name: string }
  | { type: 'set-loadout'; creatureId: string; moveIds: readonly string[] }
  | { type: 'attack'; slot: 0 | 1 | 2 | 3 }
  | { type: 'capture' }
  | { type: 'flee' };
export type GameCommand = CommandIntent & { readonly commandId: string; readonly tick: number };
/** Implementations must persist the ledger and mutation in one transaction. */
export interface SavePort<T> {
  load(): Promise<T | null>;
  transact(commandId: string, mutate: (draft: T) => void): Promise<T>;
}
