import {
  BIOME_IDS, CREATURE_ROLES, DEFAULT_PLAYER_NAME, graftCapacity, MAX_GRAFTS_PER_CREATURE, PARTY_LIMIT, PLAYER_NAME_LIMIT,
  type BiomeId, type CreatureRole, type GraftRecord, type MountRecord, type MoveLoadout, type SavePort, type ShrineRecord,
  type SpeedEffect, type VecXZ, type RoleCapacityState,
} from '../../contracts';
import { itemById, moveById } from '../../content/catalog';
import { biomeOfSecret } from '../../content/secrets';
import { GAME_CONFIG } from '../../config';
import { ContentError, contentTransaction } from '../../content/alchemy';
import { migrateBattleRecord, validateProgressState, type ProgressState } from '../../game/combat/rewards';
import { GENERATOR_VERSION, type WorldDefinition } from '../generation/world';
import { canOccupy } from '../collision/collision';
import { DAY_CYCLE_TICKS, advanceDayTick } from '../daynight';
import { GARDEN_PLOTS, isSeed, type GardenPlot } from '../gathering/gathering';
import { Discovery } from '../discovery/discovery';
import { TargetIndex } from '../encounters/targets';
import type { MovementState } from '../movement/movement';
import { ChunkManager } from '../chunks/manager';
import { loadoutRefusal } from '../../content/loadout';
import { creatureById } from '../../content/catalog';

export const WORLD_SAVE_VERSION = 4;
/** Ten minutes of world time per day cycle; six of them are daylight. */
export { DAY_CYCLE_TICKS, DAY_TICKS } from '../daynight';
export const FLEE_COOLDOWN_TICKS = Math.round(8 / GAME_CONFIG.fixedStep);
export const DEFEAT_COOLDOWN_TICKS = Math.round(30 / GAME_CONFIG.fixedStep);
// v4 puts more creatures on the ground, so more of them can be on cooldown at once.
export const MAX_TRACKED_COOLDOWNS = 96;
/** WORLD.md: collected items and captured creatures stay gone; a defeated one returns in time. */
export const RESPAWN_TICKS = Math.round(300 / GAME_CONFIG.fixedStep);
// v4 raises spawn density and adds auto-pick, which can leave far more than 128 tombstones
// outstanding inside one 300-second window.
export const MAX_TRACKED_RESPAWNS = 256;
export interface EntityCooldown { entityId: string; ticks: number }
export interface RespawnEntry { entityId: string; tick: number }
/** World-owned extension of the combat projection; one record versions the whole game. */
export interface WorldState extends ProgressState, RoleCapacityState {
  saveVersion: 4; seed: string; generatorVersion: 1;
  playerPosition: VecXZ; playerYaw: number; lastSafePosition: VecXZ;
  worldTick: number; discoveredCells: number[];
  entityCooldowns: EntityCooldown[]; activeCreatureId: string | null;
  respawns: RespawnEntry[];
  /** v2: ordered active slots. The active creature is always one of them. */
  party: string[];
  shrines: ShrineRecord[];
  dayTick: number;
  tools: string[];
  /** v2 camp garden; absent in records written before it existed, which read as empty. */
  garden?: GardenPlot[];
  /** v3: who the player is, what alchemy grafted, what carries them and what speeds them up. */
  playerName: string;
  grafts: GraftRecord[];
  /** v4: the four moves the player chose for each creature, from the eight its species knows. */
  loadouts: MoveLoadout[];
  /**
   * v4: species the player has laid eyes on. The bestiary used to record ownership only, so a
   * creature you fought and fled from left no trace and could teach you nothing.
   */
  seenSpeciesIds: string[];
  /** v4: materials gathered at least once; the first of each teaches how to refine it. */
  discoveredItemIds: string[];
  mount: MountRecord | null;
  speedEffects: SpeedEffect[];
}
export interface ExplorationCheckpoint {
  position: VecXZ; yaw: number; lastSafePosition: VecXZ;
  worldTick: number; discoveredCells: readonly number[]; entityCooldowns: readonly EntityCooldown[];
  /** The ten minute clock advances with the world tick and is persisted with it. */
  dayTick?: number;
}
function fail(message: string): never { throw new ContentError('invalid-state', message); }
const finite = (p: unknown): p is VecXZ => !!p && typeof p === 'object' && Number.isFinite((p as VecXZ).x) && Number.isFinite((p as VecXZ).z);
const cells = GAME_CONFIG.worldSize / GAME_CONFIG.cellSize;

export function validateWorldState(world: WorldDefinition, value: unknown): asserts value is WorldState {
  validateProgressState(value);
  const s = value as WorldState;
  if (s.saveVersion !== WORLD_SAVE_VERSION || s.seed !== world.seed || s.generatorVersion !== GENERATOR_VERSION) fail('Kayıt sürümü veya tohumu uyuşmuyor');
  if (!finite(s.playerPosition) || !finite(s.lastSafePosition) || !Number.isFinite(s.playerYaw) ||
    !canOccupy(world, s.playerPosition) || !canOccupy(world, s.lastSafePosition)) fail('Kayıtlı oyuncu konumu geçersiz');
  if (!Number.isSafeInteger(s.worldTick) || s.worldTick < 0 || !Array.isArray(s.discoveredCells) || !Array.isArray(s.entityCooldowns)) fail('Dünya zamanı veya keşif verisi geçersiz');
  let previous = -1;
  for (const id of s.discoveredCells) {
    if (!Number.isSafeInteger(id) || id <= previous || id >= cells * cells) fail('Keşif hücresi geçersiz');
    previous = id;
  }
  const seen = new Set<string>();
  if (s.entityCooldowns.length > MAX_TRACKED_COOLDOWNS) fail('Bekleme listesi sınırı aşıldı');
  for (const entry of s.entityCooldowns) {
    if (!entry || typeof entry.entityId !== 'string' || !entry.entityId.trim() || seen.has(entry.entityId) ||
      !Number.isSafeInteger(entry.ticks) || entry.ticks <= 0 || entry.ticks > DEFEAT_COOLDOWN_TICKS) fail('Bekleme kaydı geçersiz');
    seen.add(entry.entityId);
  }
  if (!Array.isArray(s.respawns) || s.respawns.length > MAX_TRACKED_RESPAWNS) fail('Yeniden doğuş listesi geçersiz');
  const scheduled = new Set<string>();
  for (const entry of s.respawns) {
    if (!entry || typeof entry.entityId !== 'string' || !entry.entityId.trim() || scheduled.has(entry.entityId) ||
      !Number.isSafeInteger(entry.tick) || entry.tick <= 0 || !s.consumedEntityIds.includes(entry.entityId)) fail('Yeniden doğuş kaydı geçersiz');
    if (s.eggs.some((egg) => egg.encounterId === entry.entityId) || s.creatures.some((creature) => creature.id === `capture:${entry.entityId}`)) fail('Kalıcı tüketim yeniden doğamaz');
    scheduled.add(entry.entityId);
  }
  if (!Array.isArray(s.party) || s.party.length > PARTY_LIMIT || new Set(s.party).size !== s.party.length ||
    s.party.some((id) => !s.creatures.some((creature) => creature.id === id))) fail('Takım kaydı geçersiz');
  if (s.activeCreatureId !== null && !s.creatures.some((creature) => creature.id === s.activeCreatureId)) fail('Etkin yaratık bulunamadı');
  // The active creature always travels in the party; slots are the only place a fighter comes from.
  if (s.activeCreatureId !== null && !s.party.includes(s.activeCreatureId)) fail('Etkin yaratık takımda değil');
  if (!Array.isArray(s.shrines) || s.shrines.length > BIOME_IDS.length) fail('Tapınak kaydı geçersiz');
  const visited = new Set<string>();
  for (const shrine of s.shrines) {
    if (!shrine || !(BIOME_IDS as readonly string[]).includes(shrine.biomeId) || visited.has(shrine.biomeId) ||
      !Number.isSafeInteger(shrine.visitedTick) || shrine.visitedTick < 0 || typeof shrine.chestTaken !== 'boolean') fail('Tapınak kaydı geçersiz');
    visited.add(shrine.biomeId);
  }
  if (!Number.isSafeInteger(s.dayTick) || s.dayTick < 0 || s.dayTick >= DAY_CYCLE_TICKS) fail('Gün döngüsü kaydı geçersiz');
  if (!validPlayerName(s.playerName)) fail('Oyuncu adı geçersiz');
  if (s.tankBonusSlots !== undefined && (s.tankBonusSlots !== 0 && s.tankBonusSlots !== 6)) fail('Tank çanta bonusu geçersiz');
  if ((s.tankBonusSlots ?? 0) >= s.inventory.length) fail('Tank çanta kapasitesi geçersiz');
  if (!Array.isArray(s.grafts) || s.grafts.length > PARTY_LIMIT * MAX_GRAFTS_PER_CREATURE * 10) fail('Aşı listesi geçersiz');
  const graftCounts = new Map<string, number>();
  const graftKeys = new Set<string>();
  for (const graft of s.grafts) {
    if (!graft || !moveById(graft.moveId) || !s.creatures.some((creature) => creature.id === graft.creatureId) ||
      !Number.isSafeInteger(graft.tick) || graft.tick < 0) fail('Aşı kaydı geçersiz');
    const key = `${graft.creatureId}|${graft.moveId}`;
    if (graftKeys.has(key)) fail('Aynı hareket iki kez aşılanamaz');
    graftKeys.add(key);
    const count = (graftCounts.get(graft.creatureId) ?? 0) + 1;
    // v4: the ceiling travels with the creature — two slots, a third at twenty-five, a fourth at forty.
    const owner = s.creatures.find((creature) => creature.id === graft.creatureId)!;
    if (count > graftCapacity(owner.level)) fail(`Bu seviyede en çok ${graftCapacity(owner.level)} hareket aşılanır`);
    graftCounts.set(graft.creatureId, count);
  }
  // A loadout names four moves the creature's species actually knows and has grown into.
  if (!Array.isArray(s.loadouts) || s.loadouts.length > s.creatures.length) fail('Hareket seçimi listesi geçersiz');
  const loadoutOwners = new Set<string>();
  for (const entry of s.loadouts) {
    if (!entry || typeof entry.creatureId !== 'string' || loadoutOwners.has(entry.creatureId)) fail('Hareket seçimi kaydı geçersiz');
    const owner = s.creatures.find((creature) => creature.id === entry.creatureId);
    if (!owner || !Array.isArray(entry.moveIds)) fail('Hareket seçimi kaydı geçersiz');
    if (loadoutRefusal(owner.speciesId, owner.level, entry.moveIds)) fail('Hareket seçimi kaydı geçersiz');
    loadoutOwners.add(entry.creatureId);
  }
  if (!Array.isArray(s.seenSpeciesIds) || new Set(s.seenSpeciesIds).size !== s.seenSpeciesIds.length ||
    s.seenSpeciesIds.some((id) => !creatureById(id))) fail('Görülen tür listesi geçersiz');
  if (!Array.isArray(s.discoveredItemIds) || new Set(s.discoveredItemIds).size !== s.discoveredItemIds.length ||
    s.discoveredItemIds.some((id) => !itemById(id))) fail('Keşfedilen eşya listesi geçersiz');
  if (s.mount !== null) {
    if (!s.mount || !s.party.includes(s.mount.creatureId) ||
      !(['ride', 'fly', 'swim', 'dig'] as const).some((role) => role === s.mount!.role)) fail('Binek kaydı geçersiz');
  }
  if (!Array.isArray(s.speedEffects) || s.speedEffects.length > 4) fail('Hız etkisi listesi geçersiz');
  for (const effect of s.speedEffects) {
    if (!effect || !itemById(effect.itemId) || !Number.isFinite(effect.multiplier) ||
      effect.multiplier <= 1 || effect.multiplier > 3 ||
      !Number.isSafeInteger(effect.untilTick) || effect.untilTick < 0) fail('Hız etkisi geçersiz');
  }
  if (s.garden !== undefined) {
    // Two extra beds are only ever opened by the trowel, so the record allows them.
    if (!Array.isArray(s.garden) || s.garden.length > GARDEN_PLOTS + 2) fail('Bahçe kaydı geçersiz');
    for (const plot of s.garden) {
      if (!plot || !isSeed(plot.itemId) || !Number.isSafeInteger(plot.plantedTick) || plot.plantedTick < 0 || plot.plantedTick > s.worldTick) fail('Bahçe fidesi geçersiz');
    }
  }
  if (!Array.isArray(s.tools) || new Set(s.tools).size !== s.tools.length || s.tools.some((id) => !itemById(id))) fail('Alet kaydı geçersiz');
  if (s.battle && s.activeCreatureId !== s.battle.playerCreatureId) fail('Savaşçı etkin yaratık değil');
}
/** A known region mark means that shrine was already visited; its chest cannot pay out twice. */
/** A name the player typed: printable, trimmed and short enough to fit the card. */
export function validPlayerName(value: unknown): value is string {
  if (typeof value !== 'string' || value !== value.trim() || !value.length || value.length > PLAYER_NAME_LIMIT) return false;
  // Control characters would break the card and the export; only printable text is a name.
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}
export const roleOf = (roles: readonly string[] | undefined): readonly CreatureRole[] =>
  (roles ?? []).filter((role): role is CreatureRole => CREATURE_ROLES.includes(role as CreatureRole));
function shrinesFromSecrets(secretFlags: readonly string[]): ShrineRecord[] {
  const seen = new Set<BiomeId>();
  const shrines: ShrineRecord[] = [];
  for (const flag of secretFlags) {
    const biomeId = biomeOfSecret(flag);
    if (!biomeId || seen.has(biomeId)) continue;
    seen.add(biomeId);
    shrines.push({ biomeId, visitedTick: 0, chestTaken: true });
  }
  return shrines;
}
/**
 * Upgrades a v1 record in place: the single active creature becomes the first party slot and
 * known region marks become visited shrines. Nothing is dropped and no reward is replayed.
 */
export function migrateWorldState(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const stored = raw as Omit<Partial<WorldState>, 'saveVersion'> & { saveVersion?: number };
  // A stored battle predates status effects independently of the world save version, and an
  // untouched record is returned by identity so a healthy load never rewrites itself.
  const battle = migrateBattleRecord(stored.battle) as WorldState['battle'];
  const record = battle === stored.battle ? stored : { ...stored, battle };
  // v4 fields every older branch must also produce, since each returns the current version.
  const v4 = { loadouts: [], seenSpeciesIds: [], discoveredItemIds: [] };
  if (record.saveVersion === 3) {
    // Everything a v3 record holds is still true; it simply never recorded these three.
    return { ...record, saveVersion: WORLD_SAVE_VERSION, ...v4 };
  }
  if (record.saveVersion === 2) {
    return {
      ...record, saveVersion: WORLD_SAVE_VERSION,
      playerName: validPlayerName(record.playerName) ? record.playerName : DEFAULT_PLAYER_NAME,
      grafts: [], mount: null, speedEffects: [], ...v4,
    };
  }
  if (record.saveVersion !== 1) return record === stored ? raw : record;
  const creatureIds = new Set((record.creatures ?? []).map((creature) => creature.id));
  const active = record.activeCreatureId && creatureIds.has(record.activeCreatureId) ? record.activeCreatureId : null;
  return {
    ...record,
    saveVersion: WORLD_SAVE_VERSION,
    activeCreatureId: active,
    party: active ? [active] : [],
    shrines: shrinesFromSecrets(record.secretFlags ?? []),
    dayTick: 0,
    tools: [],
    playerName: DEFAULT_PLAYER_NAME,
    grafts: [],
    mount: null,
    speedEffects: [],
    ...v4,
  };
}
export function createWorldState(world: WorldDefinition, base: ProgressState): WorldState {
  const position = { ...world.camp };
  const state: WorldState = {
    ...structuredClone(base), saveVersion: WORLD_SAVE_VERSION, seed: world.seed, generatorVersion: GENERATOR_VERSION,
    playerPosition: position, playerYaw: 0, lastSafePosition: { ...position }, worldTick: 0,
    discoveredCells: [], entityCooldowns: [], respawns: [], activeCreatureId: base.creatures[0]?.id ?? null,
    party: base.creatures.slice(0, PARTY_LIMIT).map((creature) => creature.id),
    shrines: shrinesFromSecrets(base.secretFlags), dayTick: 0, tools: [], garden: [],
    playerName: DEFAULT_PLAYER_NAME, grafts: [], mount: null, speedEffects: [],
    loadouts: [], seenSpeciesIds: [], discoveredItemIds: [],
  };
  validateWorldState(world, state);
  return state;
}
/** Movement, aggro and world simulation belong to `exploring` alone: a failed commit keeps them off. */
export function explorationAllowed(state: WorldState, paused = false): boolean {
  return !paused && state.mode === 'exploring' && state.battle === null;
}
/** Share of each material stack a defeat scatters on the way back to camp. */
export const DEFEAT_MATERIAL_LOSS = .1;
/**
 * What the player still carries after losing a fight: every stack of raw material is a tenth
 * lighter (at least one unit, never the whole stack), and nothing crafted is ever taken.
 */
export function dropOnDefeat(inventory: WorldState['inventory']): WorldState['inventory'] {
  return inventory.map((stack) => {
    if (!stack) return stack;
    const item = itemById(stack.itemId);
    if (!item || !('itemClass' in item)) return stack;
    const lost = Math.min(stack.quantity - 1, Math.max(1, Math.floor(stack.quantity * DEFEAT_MATERIAL_LOSS)));
    if (lost <= 0) return stack;
    return { ...stack, quantity: stack.quantity - lost };
  });
}
export function cooldownRemaining(state: WorldState, entityId: string): number {
  return state.entityCooldowns.find((entry) => entry.entityId === entityId)?.ticks ?? 0;
}
/** Durable respawn gates for {@link ChunkManager}: tombstones are permanent, cooldowns expire. */
export function chunkGate(read: () => WorldState) {
  return {
    consumed: (entityId: string) => read().consumedEntityIds.includes(entityId),
    suppressed: (entityId: string) => cooldownRemaining(read(), entityId) > 0,
  };
}
/** One fixed simulation tick of world time; pause, panels and battles never advance it. */
export function tickWorld(state: WorldState, paused = false): WorldState {
  if (!explorationAllowed(state, paused)) return state;
  const next = structuredClone(state);
  next.worldTick++;
  // The ten minute day runs on the same fixed step and is kept as one wrapped integer.
  next.dayTick = advanceDayTick(next.dayTick, 1);
  next.entityCooldowns = next.entityCooldowns.map((entry) => ({ ...entry, ticks: entry.ticks - 1 })).filter((entry) => entry.ticks > 0);
  return next;
}
function applyCooldown(state: WorldState, entityId: string, ticks: number): void {
  const rest = state.entityCooldowns.filter((entry) => entry.entityId !== entityId && entry.ticks > 0);
  rest.sort((a, b) => b.ticks - a.ticks || (a.entityId < b.entityId ? -1 : 1));
  state.entityCooldowns = [{ entityId, ticks }, ...rest].slice(0, MAX_TRACKED_COOLDOWNS);
}
/** Persists movement, discovery and cooldown progress without touching combat or inventory. */
export function checkpointExploration<T extends WorldState>(world: WorldDefinition, save: SavePort<T>, commandId: string, checkpoint: ExplorationCheckpoint): Promise<T> {
  return contentTransaction(save, commandId, (s) => {
    validateWorldState(world, s);
    if (s.mode !== 'exploring' && s.mode !== 'panel') fail('Keşif kaydı yalnız dünya modunda yazılır');
    if (checkpoint.worldTick < s.worldTick) fail('Dünya zamanı geriye alınamaz');
    if (checkpoint.discoveredCells.some((cell) => !Number.isSafeInteger(cell) || cell < 0 || cell >= cells * cells)) fail('Keşif hücresi geçersiz');
    // Discovery only ever grows: a stale checkpoint can never erase explored ground.
    const merged = [...new Set([...s.discoveredCells, ...checkpoint.discoveredCells])].sort((a, b) => a - b);
    // Respawn sweep: due entries drop their tombstone so the chunk gates can reload the entity.
    const due = s.respawns.filter((entry) => entry.tick <= checkpoint.worldTick).map((entry) => entry.entityId);
    if (due.length) {
      s.respawns = s.respawns.filter((entry) => entry.tick > checkpoint.worldTick);
      s.consumedEntityIds = s.consumedEntityIds.filter((entityId) => !due.includes(entityId));
    }
    s.playerPosition = { ...checkpoint.position }; s.playerYaw = checkpoint.yaw;
    s.lastSafePosition = { ...checkpoint.lastSafePosition };
    s.worldTick = checkpoint.worldTick; s.discoveredCells = merged;
    if (checkpoint.dayTick !== undefined) {
      if (!Number.isSafeInteger(checkpoint.dayTick) || checkpoint.dayTick < 0 || checkpoint.dayTick >= DAY_CYCLE_TICKS) fail('Gün saati geçersiz');
      s.dayTick = checkpoint.dayTick;
    }
    s.entityCooldowns = checkpoint.entityCooldowns.filter((entry) => entry.ticks > 0).map((entry) => ({ ...entry })).slice(0, MAX_TRACKED_COOLDOWNS);
    validateWorldState(world, s);
  });
}
export type EncounterSettlement = { entityId: string; outcome: 'won' | 'captured' | 'lost' | 'fled' };
/**
 * Closes a resolved battle in one transaction: rewards are already in the ledger, so this only
 * settles world consequences. The encounter lock may be released after it resolves, never before.
 */
export function commitEncounterOutcome<T extends WorldState>(world: WorldDefinition, save: SavePort<T>, commandId: string, battleId: string): Promise<T> {
  return contentTransaction(save, commandId, (s) => {
    validateWorldState(world, s);
    if (!s.battle && s.mode === 'exploring') return;
    if (!s.battle || s.battle.battleId !== battleId) fail('Kapatılacak savaş bulunamadı');
    if (s.mode !== 'committing' && s.mode !== 'recovery') fail('Savaş henüz commit aşamasında değil');
    const { outcome, encounterId } = s.battle;
    if (!outcome || !s.rewardLedger.includes(battleId)) fail('Ödül işlenmeden dünya açılamaz');
    if ((outcome === 'WON' || outcome === 'CAPTURED') && !s.consumedEntityIds.includes(encounterId)) fail('Tüketilmemiş hedef kapatılamaz');
    // A defeated wild creature is scheduled back into the world; collecting and sealing are final.
    if (outcome === 'WON') {
      const due = { entityId: encounterId, tick: s.worldTick + RESPAWN_TICKS };
      s.respawns = [...s.respawns.filter((entry) => entry.entityId !== encounterId), due]
        .sort((a, b) => a.tick - b.tick).slice(0, MAX_TRACKED_RESPAWNS);
    }
    if (outcome === 'LOST') {
      s.playerPosition = { ...world.camp }; s.lastSafePosition = { ...world.camp };
      // v3: the walk home costs materials. Seals, tools and every alchemy product survive it.
      s.inventory = dropOnDefeat(s.inventory);
      s.mount = null;
      applyCooldown(s, encounterId, DEFEAT_COOLDOWN_TICKS);
    } else if (outcome === 'FLED') {
      s.playerPosition = { ...s.lastSafePosition };
      applyCooldown(s, encounterId, FLEE_COOLDOWN_TICKS);
    }
    s.battle = null; s.loot = null; s.mode = 'exploring';
    validateWorldState(world, s);
  });
}
/** Reads the resolved battle for the caller that releases the encounter lock after the commit. */
export function settlementOf(state: WorldState): EncounterSettlement | null {
  const battle = state.battle;
  if (!battle?.outcome) return null;
  return { entityId: battle.encounterId, outcome: ({ WON: 'won', CAPTURED: 'captured', LOST: 'lost', FLED: 'fled' } as const)[battle.outcome] };
}
export interface RestoredWorld { index: TargetIndex; chunks: ChunkManager; discovery: Discovery; movement: MovementState }
/** Rebuilds session runtime from the record: tombstoned and cooling entities never come back. */
export function restoreWorld(world: WorldDefinition, read: () => WorldState): RestoredWorld {
  const state = read();
  validateWorldState(world, state);
  const index = new TargetIndex();
  const chunks = new ChunkManager(world, index, chunkGate(read));
  chunks.update(state.playerPosition, true);
  return { index, chunks, discovery: new Discovery(state.discoveredCells),
    movement: { position: { ...state.playerPosition }, yaw: state.playerYaw, lastSafePosition: { ...state.lastSafePosition } } };
}
