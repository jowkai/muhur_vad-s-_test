import type { DayPhase, GatherMethod, SavePort, TreeKind, VecXZ } from '../../contracts';
import { GAME_CONFIG } from '../../config';
import { ContentError, contentTransaction, planInventory } from '../../content/alchemy';
import { creatureById, itemById, items } from '../../content/catalog';
import { newlyEarned } from '../../content/unlocks';
import type { Element, Ingredient } from '../../content/schema';
import { TREE_TABLE, type ChunkSpawn } from '../chunks/chunks';
import { hash, randomAt } from '../generation/random';
import type { WorldDefinition } from '../generation/world';
import { phaseAt } from '../daynight';
import { RESPAWN_TICKS, validateWorldState, type WorldState, MAX_TRACKED_RESPAWNS } from '../persistence/world-save';
import { roleUnlocked, speedEffectFor } from '../../game/roles';

/** Three seconds of held input, or none at all with the right creature at your side. */
export const DIG_HOLD_TICKS = Math.round(3 / GAME_CONFIG.fixedStep);
/** How far a creature's nose reaches for a buried cache. */
export const CACHE_HELP_RADIUS = 24;
/** A planted seed needs three minutes of active world time at the camp. */
export const GARDEN_TICKS = Math.round(180 / GAME_CONFIG.fixedStep);
/** Beds in the camp garden; the trowel adds two more. */
export const GARDEN_PLOTS = 4;
export const GARDEN_YIELD = 3;
export const DIG_ELEMENT: Element = 'taş';

export interface GardenPlot { readonly itemId: string; readonly plantedTick: number }
export interface GatherNode {
  readonly entityId: string; readonly method: GatherMethod; readonly itemId: string;
  readonly position: VecXZ; readonly element: Element | null;
  readonly nightOnly: boolean; readonly hidden: boolean;
  /** Set when the node is a standing tree; felling needs a clawed creature in the team. */
  readonly treeKind: TreeKind | null;
  /** True when the player just takes it as they pass: no card, no key press. */
  readonly autoPick: boolean;
}
/** How close the player must be for a loose material to be picked up in passing. */
export const AUTO_PICK_RADIUS = 2.5;
export const FELL_RESPAWN_TICKS = Math.round(300 / GAME_CONFIG.fixedStep);
const ELEMENTS: readonly Element[] = ['çim', 'su', 'kor', 'buz', 'taş', 'gölge', 'rüzgâr', 'ışık', 'kıvılcım'];
function fail(code: 'context' | 'invalid-target' | 'invalid-state', message: string): never {
  throw new ContentError(code, message);
}
/**
 * Every resource the generator placed answers to exactly one method, decided by a pure hash of
 * its own id: most are picked by hand, some are veins that must be dug, the rest are caches a
 * creature has to sniff out. A slice of each is a night resource that only shows after dark.
 */
export function nodeFor(world: WorldDefinition, spawn: ChunkSpawn, party: readonly string[] = [], phase: DayPhase = 'day', lens = false): GatherNode | null {
  if (spawn.target.kind !== 'resource' || !spawn.itemId) return null;
  if (spawn.treeKind) {
    // A tree is never hidden and never picked up in passing: it has to be felled.
    return Object.freeze({
      entityId: spawn.target.entityId, method: 'fell' as GatherMethod, itemId: spawn.itemId,
      position: spawn.target.position, element: null, nightOnly: TREE_TABLE[spawn.treeKind].nightOnly,
      hidden: false, treeKind: spawn.treeKind, autoPick: false,
    });
  }
  const pick = randomAt(world.seed, 'gather-method', hash(world.seed, 'gather', spawn.seed));
  const item = itemById(spawn.itemId);
  const gem = item && 'itemClass' in item && item.itemClass === 'gem';
  const method: GatherMethod = gem ? 'dig' : pick < .6 ? 'pick' : pick < .85 ? 'dig' : 'cache';
  const nightOnly = randomAt(world.seed, 'gather-night', spawn.seed) < .2;
  const element = method === 'cache' ? ELEMENTS[hash(world.seed, 'gather-element', spawn.seed) % ELEMENTS.length] : null;
  // The gardener's lens reads any mark; without it a creature of the cache's element must be along.
  const sensed = element === null || lens || partyElements(party).has(element);
  const hidden = !sensed || (nightOnly && phase !== 'night');
  return Object.freeze({
    entityId: spawn.target.entityId, method, itemId: spawn.itemId, position: spawn.target.position,
    element, nightOnly,
    // A cache stays invisible until a creature of its element walks with you; a night node sleeps by day.
    hidden, treeKind: null,
    // v3: loose material is taken in passing; veins, caches and trees still ask for a decision.
    autoPick: method === 'pick' && !hidden,
  });
}
export function partyElements(party: readonly string[]): ReadonlySet<Element> {
  return new Set(party.flatMap((speciesId) => { const species = creatureById(speciesId); return species ? [species.element] : []; }));
}
/** Species of the creatures travelling with the player, in party order. */
export function partySpecies(state: WorldState): readonly string[] {
  return state.party.flatMap((id) => { const owned = state.creatures.find((creature) => creature.id === id); return owned ? [owned.speciesId] : []; });
}
/**
 * Loose material the player is standing on. v3 takes these in passing: no card, no key, one
 * transaction per node, and the same rules the deliberate gather uses.
 */
export function autoPickTargets(world: WorldDefinition, spawns: readonly ChunkSpawn[], state: WorldState): readonly GatherNode[] {
  const party = partySpecies(state);
  const phase = phaseAt(state.dayTick);
  const lens = carries(state, TOOL.lens);
  return Object.freeze(spawns.flatMap((spawn) => {
    const node = nodeFor(world, spawn, party, phase, lens);
    if (!node || !node.autoPick || state.consumedEntityIds.includes(node.entityId)) return [];
    const distance = Math.hypot(node.position.x - state.playerPosition.x, node.position.z - state.playerPosition.z);
    return distance <= AUTO_PICK_RADIUS ? [node] : [];
  }));
}
/** Caches the party can sense from where it stands: the minimap's second sight. */
export function sensedCaches(world: WorldDefinition, spawns: readonly ChunkSpawn[], state: WorldState): readonly GatherNode[] {
  const party = partySpecies(state);
  const phase = phaseAt(state.dayTick);
  return Object.freeze(spawns.flatMap((spawn) => {
    const node = nodeFor(world, spawn, party, phase, carries(state, TOOL.lens));
    if (!node || node.method !== 'cache' || node.hidden) return [];
    const distance = Math.hypot(node.position.x - state.playerPosition.x, node.position.z - state.playerPosition.z);
    return distance <= CACHE_HELP_RADIUS ? [node] : [];
  }));
}
/** The four gardener tools, each opening one way of working the valley. */
export const TOOL = Object.freeze({ pick: 'stone_pick', lantern: 'lantern', trowel: 'trowel', lens: 'lens' });
/** A tool counts whether it sits in the bag or on the belt. */
export function carries(state: WorldState, itemId: string): boolean {
  return state.tools.includes(itemId) || state.inventory.some((stack) => stack?.itemId === itemId && stack.quantity > 0);
}
export const hasDigTool = (state: WorldState) => carries(state, TOOL.pick);
export const hasDigger = (state: WorldState) => state.party.some((id) => {
  const creature = state.creatures.find((entry) => entry.id === id);
  return !!creature && creature.hp > 0 && roleUnlocked(creature, 'dig');
});
export const canInstantDig = (state: WorldState) => hasDigger(state) || hasStoneAlly(state) || hasDigTool(state);
/** A tree only falls for a clawed creature that is old enough to use its claws. */
export function clawBearer(state: WorldState): string | null {
  for (const id of state.party) {
    const creature = state.creatures.find((entry) => entry.id === id);
    if (creature && roleUnlocked(creature, 'claw')) return creature.id;
  }
  return null;
}
/** What a felled tree gives: its own wood, the region's essence and, for rare wood, a gem. */
export function fellYield(world: WorldDefinition, node: GatherNode): readonly Ingredient[] {
  const wood = itemById(node.itemId);
  const biomeId = wood?.biomeId;
  const parts: Ingredient[] = [{ itemId: node.itemId, quantity: 1 }];
  const classed = (klass: string) => items.find((item) => 'itemClass' in item && item.biomeId === biomeId && item.itemClass === klass);
  const essence = classed('essence');
  if (essence) parts.push({ itemId: essence.id, quantity: 1 });
  const rare = node.treeKind === 'ghostwood' || node.treeKind === 'amber';
  const gem = classed('gem');
  if (rare && gem && randomAt(world.seed, 'fell-gem', hash(world.seed, 'fell', node.entityId.length)) < .4) {
    parts.push({ itemId: gem.id, quantity: 1 });
  }
  return Object.freeze(parts);
}
/** The trowel turns four beds into six. */
export const gardenPlots = (state: WorldState) => carries(state, TOOL.trowel) ? GARDEN_PLOTS + 2 : GARDEN_PLOTS;
export const hasStoneAlly = (state: WorldState) => partySpecies(state).some((speciesId) => creatureById(speciesId)?.element === DIG_ELEMENT);
/** What a vein gives up: its own material and, deterministically, sometimes the region's rare one. */
export function digYield(world: WorldDefinition, node: GatherNode): readonly Ingredient[] {
  const base: Ingredient[] = [{ itemId: node.itemId, quantity: 1 }];
  const biomeId = itemById(node.itemId)?.biomeId;
  const rare = biomeId ? items.find((item) => item.biomeId === biomeId && item.rarity === 'rare') : undefined;
  if (rare && randomAt(world.seed, 'gather-rare', hash(world.seed, 'vein', node.entityId.length)) < .35) base.push({ itemId: rare.id, quantity: 1 });
  return Object.freeze(base);
}
function deliver(state: WorldState, parts: readonly Ingredient[]): void {
  for (const part of parts) {
    for (let unit = 0; unit < part.quantity; unit++) {
      try { state.inventory = planInventory(state.inventory, [], [{ itemId: part.itemId, quantity: 1 }]); }
      catch (error) {
        if (!(error instanceof ContentError) || error.code !== 'full') throw error;
        state.deliveryBox = [...state.deliveryBox, { kind: 'item', itemId: part.itemId, quantity: part.quantity - unit }];
        break;
      }
    }
  }
}
export interface GatherRequest {
  readonly spawn: ChunkSpawn; readonly method: GatherMethod;
  /** Ticks the dig key was held; a stone ally or a tool makes it unnecessary. */
  readonly holdTicks?: number;
}
/**
 * One transaction per gathered thing: the node is consumed, its respawn is scheduled and the
 * items land in the bag or, when the bag is full, in the delivery box. A refused attempt writes
 * nothing at all, so an empty-handed dig never costs the vein.
 */
export function gather<T extends WorldState>(world: WorldDefinition, save: SavePort<T>, commandId: string, request: GatherRequest): Promise<T> {
  return contentTransaction(save, commandId, (s) => {
    validateWorldState(world, s);
    const node = nodeFor(world, request.spawn, partySpecies(s), phaseAt(s.dayTick), carries(s, TOOL.lens));
    if (!node) fail('invalid-target', 'Burada toplanacak bir kaynak yok.');
    if (s.mode !== 'exploring' || s.battle) fail('context', 'Şu anda kaynak toplanamaz.');
    if (s.consumedEntityIds.includes(node.entityId)) fail('invalid-target', 'Bu kaynak zaten alındı.');
    if (node.method !== request.method) fail('invalid-target', 'Bu kaynak böyle toplanmıyor.');
    if (node.method === 'fell' && !clawBearer(s)) fail('invalid-target', 'Ağacı kesecek pençeli bir yaratığın yok.');
    if (node.nightOnly && phaseAt(s.dayTick) !== 'night') fail('invalid-target', 'Bu kaynak yalnız gece toplanır.');
    if (Math.hypot(node.position.x - s.playerPosition.x, node.position.z - s.playerPosition.z) > GAME_CONFIG.interactionRadius) {
      fail('invalid-target', 'Kaynağa yeterince yakın değilsin.');
    }
    if (node.method === 'cache' && node.hidden) fail('invalid-target', 'Bu zulayı bulacak yaratığın yok.');
    if (node.method === 'dig' && !canInstantDig(s) && (request.holdTicks ?? 0) < DIG_HOLD_TICKS) {
      fail('invalid-target', 'Damarı açmak için kazıcı veya taş elementli yaratık, alet ya da üç saniye gerekir.');
    }
    deliver(s, node.method === 'dig' ? digYield(world, node)
      : node.method === 'fell' ? fellYield(world, node)
      : [{ itemId: node.itemId, quantity: 1 }]);
    s.consumedEntityIds = [...s.consumedEntityIds, node.entityId];
    const back = node.method === 'fell' ? FELL_RESPAWN_TICKS : RESPAWN_TICKS;
    // v4: the respawn list is capped, and a dense sweep can outrun it. Dropping the oldest
    // tombstone simply lets that node come back sooner; keeping it would fail the whole save.
    s.respawns = [...s.respawns.filter((entry) => entry.entityId !== node.entityId), { entityId: node.entityId, tick: s.worldTick + back }]
      .sort((a, b) => a.tick - b.tick || (a.entityId < b.entityId ? -1 : 1))
      .slice(-MAX_TRACKED_RESPAWNS);
    recordDiscoveries(s);
    validateWorldState(world, s);
  });
}
/**
 * Writes the gathering journal and pays out any recipe it just earned. Called inside the same
 * transaction as the pick-up, so a material and the craft it teaches can never disagree.
 */
export function recordDiscoveries(s: WorldState): void {
  const held = new Set(s.discoveredItemIds ?? []);
  for (const stack of s.inventory) {
    if (stack && itemById(stack.itemId)?.biomeId) held.add(stack.itemId);
  }
  s.discoveredItemIds = [...held].sort();
  const earned = newlyEarned(s);
  if (earned.length) s.unlockedRecipeIds = [...s.unlockedRecipeIds, ...earned];
}
/** Seeds are region materials whose id says so; the garden is the only place they grow. */
export const isSeed = (itemId: string) => itemId.endsWith('_seed') && !!itemById(itemId)?.biomeId;
export function gardenYield(itemId: string): Ingredient {
  const biomeId = itemById(itemId)?.biomeId;
  const common = items.find((item) => item.biomeId === biomeId && item.rarity === 'common');
  return { itemId: common?.id ?? itemId, quantity: GARDEN_YIELD };
}
/**
 * Drinks a speed tonic: the bottle leaves the bag and a timed effect joins the record. Tonics
 * do not stack, so a second bottle of the same kind simply refreshes its own clock.
 */
export function drinkTonic<T extends WorldState>(world: WorldDefinition, save: SavePort<T>, commandId: string, itemId: string): Promise<T> {
  return contentTransaction(save, commandId, (s) => {
    validateWorldState(world, s);
    if (s.mode !== 'exploring' && s.mode !== 'panel') fail('context', 'Şu anda tonik içilemez.');
    const effect = speedEffectFor(itemId, s.worldTick);
    if (!effect) fail('invalid-target', 'Bu bir hız toniği değil.');
    if (!s.inventory.some((stack) => stack?.itemId === itemId && stack.quantity > 0)) fail('invalid-target', 'Çantanda bu tonik yok.');
    s.inventory = planInventory(s.inventory, [{ itemId, quantity: 1 }], []);
    s.speedEffects = [...s.speedEffects.filter((entry) => entry.itemId !== itemId && entry.untilTick > s.worldTick), effect];
  });
}
export function plantSeed<T extends WorldState>(world: WorldDefinition, save: SavePort<T>, commandId: string, itemId: string): Promise<T> {
  return contentTransaction(save, commandId, (s) => {
    validateWorldState(world, s);
    if (!s.atCamp || (s.mode !== 'exploring' && s.mode !== 'panel')) fail('context', 'Tohum yalnız kampta ekilir.');
    if (!isSeed(itemId)) fail('invalid-target', 'Bu bir tohum değil.');
    if ((s.garden ?? []).length >= gardenPlots(s)) fail('context', 'Bahçede boş yer yok.');
    s.inventory = planInventory(s.inventory, [{ itemId, quantity: 1 }], []);
    s.garden = [...(s.garden ?? []), { itemId, plantedTick: s.worldTick }];
    validateWorldState(world, s);
  });
}
export const gardenReady = (plot: GardenPlot, worldTick: number) => worldTick - plot.plantedTick >= GARDEN_TICKS;
export function harvestGarden<T extends WorldState>(world: WorldDefinition, save: SavePort<T>, commandId: string): Promise<T> {
  return contentTransaction(save, commandId, (s) => {
    validateWorldState(world, s);
    if (!s.atCamp || (s.mode !== 'exploring' && s.mode !== 'panel')) fail('context', 'Bahçe yalnız kampta toplanır.');
    const plots = s.garden ?? [];
    const ready = plots.filter((plot) => gardenReady(plot, s.worldTick));
    if (!ready.length) fail('invalid-target', 'Hazır ürün yok.');
    for (const plot of ready) deliver(s, [gardenYield(plot.itemId)]);
    s.garden = plots.filter((plot) => !gardenReady(plot, s.worldTick));
    validateWorldState(world, s);
  });
}
