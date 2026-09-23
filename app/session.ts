import { withRoleCapacity } from './role-capacity';
import type { PanelId } from '../contracts';
import { PARTY_LIMIT, type CommandIntent, type GameCommand, type NearbyTarget, type SavePort, type VecXZ } from '../contracts';
import { GAME_CONFIG } from '../config';
import { ContentError, craft } from '../content/alchemy';
import { useCampItem } from '../content/camp-use';
import { creatureById, creatures, itemById, tutorialEgg } from '../content/catalog';
import { secretIdFor, STARTING_RECIPE_ID } from '../content/secrets';
import { stats } from '../game/combat/core';
import { claimDelivery, hatchEgg, incubateTick } from '../game/combat/rewards';
import { EncounterAdapter, type AdapterView } from '../game/encounter-adapter';
import type { Discovery } from '../world/discovery/discovery';
import { xpRequired } from '../game/progression';
import { canOccupy } from '../world/collision/collision';
import { residency, type ChunkCoord } from '../world/chunks/chunks';
import { distance, selectNearby, type WorldTarget } from '../world/encounters/targets';
import type { WorldDefinition } from '../world/generation/world';
import { sampleTerrain } from '../world/terrain/terrain';
import { spawnPlayer, stepMovement, type MovementState } from '../world/movement/movement';
import {
  checkpointExploration, createWorldState, explorationAllowed, tickWorld, validateWorldState, type WorldState,
} from '../world/persistence/world-save';
import { dayView, detectionRadiusWith, phaseAt, type DayView } from '../world/daynight';
import { objectivesPanelView, type ObjectivesPanelView } from '../ui/objectives/model';
import { normalizeName, renameRefusal } from '../ui/profile/model';
import { dismount, mountCreature } from '../world/riding';
import { permissions, travelSpeed } from '../game/roles';
import { graftMove } from '../content/graft';
import { setLoadout } from '../content/loadout';
import { travelOptions, travelTo, type TravelAnchorView } from '../world/travel';
import { visitShrine } from '../world/shrines/visit';
import { shrineAt } from '../world/shrines/shrines';
import {
  GARDEN_TICKS, TOOL, autoPickTargets, carries, gardenPlots, gardenReady, gather, harvestGarden,
  canInstantDig, isSeed, nodeFor, partySpecies, plantSeed, sensedCaches, type GatherNode,
} from '../world/gathering/gathering';
import type { GardenView } from '../ui/camp/camp-panel';
import { battleView, type BattleView } from '../ui/battle/model';
import { rewardSnapshot, rewardView, type RewardSnapshot, type RewardSummary } from '../ui/battle/reward';
import { campView, type CampView } from '../ui/camp/model';
import { encounterCard, type EncounterCard } from '../ui/encounter/card';
import { hudModel, type HudModel } from '../ui/hud/model';
import { alchemyView, type AlchemyView } from '../ui/alchemy/model';
import { inventoryView, type InventoryView } from '../ui/inventory/model';
import { bestiaryView, type BestiaryView } from '../ui/bestiary/model';
import { buildMinimap, type MinimapView } from '../ui/minimap/model';

const fail = (message: string): never => { throw new ContentError('invalid-state', message); };
export const CHECKPOINT_TICKS = 120;
export const TUTORIAL_RANGE = 50;
/** v2: the bottom bar opens five panels and the settings dialog. */
export type PanelName = PanelId;
export interface SessionInput { readonly move: GameCommand | null; readonly paused?: boolean }
export interface SessionView {
  readonly hud: HudModel; readonly minimap: MinimapView; readonly card: EncounterCard | null;
  readonly battle: BattleView | null; readonly inventory: InventoryView; readonly alchemy: AlchemyView;
  readonly camp: CampView; readonly bestiary: BestiaryView;
  readonly panel: PanelName | null; readonly hint: string | null;
  readonly reward: RewardSummary | null;
  readonly adapter: AdapterView; readonly position: VecXZ; readonly yaw: number;
  readonly chunks: readonly ChunkCoord[]; readonly movementAllowed: boolean;
  /** v2: the world clock, the eight objectives, the open anchors and the caches the team senses. */
  readonly day: DayView; readonly objectives: ObjectivesPanelView;
  readonly travel: readonly TravelAnchorView[]; readonly caches: readonly GatherNode[];
}
/** A fresh single-player record: one level 2 friend, two seals, one heat herb, one known recipe. */
export function newGame(world: WorldDefinition): WorldState {
  // The starter is the tutorial species by name, not whatever happens to sort first:
  // a growing roster must not quietly hand new players a different creature.
  const species = creatureById(tutorialEgg.speciesId) ?? creatures[0];
  const maxHp = stats({ id: 'friend', species, level: 2 }).maxHp;
  const state = createWorldState(world, {
    mode: 'exploring', atCamp: true,
    inventory: [{ itemId: 'seal', quantity: 2 }, { itemId: 'heat_herb', quantity: 1 },
      ...Array.from({ length: 22 }, () => null)],
    unlockedRecipeIds: [STARTING_RECIPE_ID],
    creatures: [{ id: 'friend', speciesId: species.id, level: 2, xp: 0, hp: maxHp, maxHp }],
    creatureCapacity: 60, eggCapacity: 2, eggs: [], battle: null, loot: null,
    rewardLedger: [], consumedEntityIds: [], secretFlags: [], deliveryBox: [],
  });
  // The meadow's mark is already known, so its secret pays out as an essence like any repeat.
  return { ...state, activeCreatureId: 'friend', secretFlags: [secretIdFor('meadow')] };
}
/** Straight-line walkability probe for the opening hint; it never moves the player. */
function reachable(world: WorldDefinition, from: VecXZ, to: VecXZ): boolean {
  const span = distance(from, to);
  if (span > TUTORIAL_RANGE) return false;
  for (let step = 1; step <= Math.ceil(span); step++) {
    const t = Math.min(1, step / span);
    if (!canOccupy(world, { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t })) return false;
  }
  return true;
}
const COMPASS = ['kuzeye', 'kuzeydoğuya', 'doğuya', 'güneydoğuya', 'güneye', 'güneybatıya', 'batıya', 'kuzeybatıya'];
/**
 * Owns the playable loop without touching the DOM or Three.js: fixed-step world simulation,
 * one command path into the domain and a read-only view the shell renders. Every rule it shows
 * comes from the module that owns it; the session only sequences them.
 */
export class GameSession {
  private movement: MovementState;
  private tick = 0;
  private sinceCheckpoint = 0;
  private dirty = false;
  private carrier: WorldState;
  private pendingIncubation = 0;
  private panel: PanelName | null = null;
  private counter = 0;
  private message: string | null = null;
  private selectedItemId: string | null = null;
  private beforeReward: RewardSnapshot | null = null;
  private reward: RewardSummary | null = null;
  private tutorialDone = false;
  private pausedByPlayer = false;
  private previousMode: string;
  private saving: Promise<unknown> = Promise.resolve();
  private constructor(private readonly world: WorldDefinition, private readonly save: SavePort<WorldState>,
    private readonly adapter: EncounterAdapter, private readonly sessionId: string,
    private readonly viewportWidth: () => number) {
    const state = adapter.state;
    this.movement = state.worldTick > 0 || state.playerPosition.x !== world.camp.x || state.playerPosition.z !== world.camp.z
      ? { position: { ...state.playerPosition }, yaw: state.playerYaw, lastSafePosition: { ...state.lastSafePosition } }
      : spawnPlayer(world);
    this.carrier = state;
    this.previousMode = state.mode;
    this.tutorialDone = state.consumedEntityIds.length > 0;
    this.adapter.chunks.update(this.movement.position, true);
  }
  static async open(options: { world: WorldDefinition; save: SavePort<WorldState>; sessionId: string; viewportWidth?: () => number }): Promise<GameSession> {
    const save = withRoleCapacity(options.save);
    if (!await save.load()) await save.transact(`${options.sessionId}:boot`, () => {});
    // A tab closed with a panel open, or in the middle of walking up to a target, leaves a record
    // in a mode that only the screen can be in. Nothing is open at boot, so those two modes are
    // released here; battle, committing and recovery carry real state and are left alone.
    await save.transact(`${options.sessionId}:release-ui-mode`, (draft) => {
      if (draft.mode === 'panel' || draft.mode === 'encounter') draft.mode = 'exploring';
    });
    const adapter = await EncounterAdapter.open(options.world, save, options.sessionId);
    return new GameSession(options.world, save, adapter, options.sessionId, options.viewportWidth ?? (() => 1280));
  }
  get state(): WorldState { return this.adapter.state; }
  /** Live world clock: the record catches up at the next checkpoint, the view never lags. */
  get dayTick(): number { return this.carrier.dayTick ?? this.adapter.state.dayTick; }
  get openPanel(): PanelName | null { return this.panel; }
  get paused(): boolean { return this.pausedByPlayer; }
  /** Player pause: world movement, aggro, world time and incubation all stop with it. */
  togglePause(): boolean {
    this.pausedByPlayer = !this.pausedByPlayer;
    if (this.pausedByPlayer) void this.checkpoint();
    return this.pausedByPlayer;
  }
  get position(): VecXZ { return { ...this.movement.position }; }
  /** Read-only discovery set for the minimap atlas; the renderer never writes to it. */
  get discovery(): Discovery { return this.adapter.discovery; }
  /** Entities the renderer may draw: exactly what the simulated chunks currently hold. */
  visibleEntities(): readonly WorldTarget[] {
    return this.adapter.chunks.loadedEntityIds
      // The index carries a patrol's current spot; the spawn only knows where it started.
      .map((entityId) => this.adapter.index.get(entityId) ?? this.adapter.chunks.spawn(entityId)?.target)
      .filter((target): target is WorldTarget => !!target);
  }
  private id(kind: string): string { return `${this.sessionId}:${kind}:${++this.counter}`; }
  private atCamp(): boolean { return distance(this.movement.position, this.world.camp) <= GAME_CONFIG.safeCampRadius; }
  /** Adapter for every write: the camp flag and pending incubation ride along atomically. */
  private writer(incubation = 0): SavePort<WorldState> {
    return {
      load: () => this.save.load(),
      transact: async (commandId, mutate) => {
        const next = await this.save.transact(commandId, (draft) => {
        draft.atCamp = this.atCamp();
        if (incubation > 0) {
          // incubateTick owns the rule; a stripped carrier keeps the per-tick clone cheap.
          let carrier = { mode: draft.mode, atCamp: draft.atCamp, eggs: draft.eggs } as WorldState;
          for (let step = 0; step < incubation; step++) carrier = incubateTick(carrier, false);
          draft.eggs = carrier.eggs;
        }
          mutate(draft);
        });
        // One source of truth: the adapter publishes the record every reader sees.
        this.adapter.resync(next);
        return next;
      },
    };
  }
  /** Exactly one 1/60 s simulation step. */
  step(input: SessionInput): void {
    const paused = !!input.paused || this.pausedByPlayer;
    const state = this.state;
    const running = explorationAllowed(state, paused) && !this.panel;
    if (running) {
      this.tick++;
      const moved = stepMovement(this.world, this.movement, input.move, { mode: 'exploring' }, paused, {
        speed: travelSpeed({ mount: state.mount, creatures: state.creatures, effects: state.speedEffects, worldTick: this.dayTick, activeCreatureId: state.activeCreatureId }),
        passes: permissions(state.mount),
      });
      if (moved !== this.movement) { this.movement = moved; this.dirty = true; }
      this.adapter.discovery.reveal(this.movement.position, 'exploring', paused);
      this.adapter.chunks.update(this.movement.position);
      this.adapter.tick(this.movement.position, paused, { worldTick: this.carrier.worldTick, dayTick: this.carrier.dayTick });
      this.openHostileBattle();
      const before = this.carrier.worldTick;
      this.carrier = tickWorld({ mode: 'exploring', battle: null, worldTick: this.carrier.worldTick, dayTick: this.carrier.dayTick, entityCooldowns: this.carrier.entityCooldowns } as WorldState, paused);
      if (this.carrier.worldTick !== before) this.dirty = true;
      if (this.atCamp() && state.eggs.length) this.pendingIncubation++;
      this.sinceCheckpoint++;
      this.collectUnderfoot();
    }
    if (state.mode !== this.previousMode) {
      // Only a settled battle moves the player; leaving a panel must not rewind the walk.
      if (['battle', 'committing', 'recovery'].includes(this.previousMode) && state.mode === 'exploring') {
        this.movement = { position: { ...state.playerPosition }, yaw: this.movement.yaw, lastSafePosition: { ...state.lastSafePosition } };
        this.carrier = { ...this.carrier, entityCooldowns: state.entityCooldowns };
        this.adapter.chunks.update(this.movement.position, true);
        this.message = this.outcomeMessage();
      }
      this.previousMode = state.mode;
    }
    if (this.sinceCheckpoint >= CHECKPOINT_TICKS && this.dirty) void this.checkpoint();
  }
  private outcomeMessage(): string | null {
    const outcome = this.adapter.snapshot().lastOutcome;
    if (!outcome) return null;
    this.tutorialDone = true;
    // The window reports only the difference the domain committed; it never grants anything.
    if (this.beforeReward) {
      this.reward = rewardView(this.beforeReward, rewardSnapshot(this.state), outcome, this.state);
      this.beforeReward = null;
    }
    return { collected: 'Toplandı.', won: 'Savaşı kazandın.', captured: 'Yaratık mühürlendi.', lost: 'Bayıldın; kampa döndün.', fled: 'Kaçtın.' }[outcome];
  }
  /** Closes the result window; the record is already committed, so this only clears the view. */
  dismissReward(): void { this.reward = null; }
  /** Writes movement, discovery, world time, cooldowns and incubation in one transaction. */
  async checkpoint(): Promise<void> {
    // A checkpoint started by the tick loop may still be on its way. A command that asks for a
    // checkpoint needs the record to be current, so it waits for that one instead of racing it.
    if (!this.dirty && !this.pendingIncubation) { await this.saving; return; }
    const incubated = this.pendingIncubation;
    this.sinceCheckpoint = 0;
    this.dirty = false;
    this.pendingIncubation = 0;
    const work = this.saving.then(async () => {
      try {
        await checkpointExploration(this.world, this.writer(incubated), this.id('checkpoint'), {
          position: this.movement.position, yaw: this.movement.yaw, lastSafePosition: this.movement.lastSafePosition,
          worldTick: this.carrier.worldTick, dayTick: this.carrier.dayTick,
          discoveredCells: this.adapter.discovery.serialize(),
          entityCooldowns: this.carrier.entityCooldowns,
        });
      } catch { this.dirty = true; this.pendingIncubation += incubated; }
    });
    this.saving = work;
    await work;
  }
  async dispatch(intent: CommandIntent): Promise<void> {
    switch (intent.type) {
      case 'open-panel': case 'close-panel': return this.togglePanel(intent);
      case 'craft': {
        await craft(this.writer(), this.id('craft'), intent.recipeId);
        this.message = 'Üretim tamamlandı.';
        return;
      }
      case 'set-active': {
        await this.writer().transact(this.id('active'), (draft) => {
          validateWorldState(this.world, draft);
          if (draft.battle || !['exploring', 'panel'].includes(draft.mode)) fail('Savaş sürerken aktif yaratık değiştirilemez');
          if (!draft.creatures.some((creature) => creature.id === intent.creatureId)) fail('Bu yaratık koleksiyonda yok');
          // The active creature must travel in a party slot: take a free one, else the active slot.
          if (!draft.party.includes(intent.creatureId)) {
            if (draft.party.length < PARTY_LIMIT) draft.party.push(intent.creatureId);
            else {
              const slot = Math.max(0, draft.party.indexOf(draft.activeCreatureId ?? ''));
              draft.party[slot] = intent.creatureId;
            }
          }
          draft.activeCreatureId = intent.creatureId;
          validateWorldState(this.world, draft);
        });
        this.message = 'Aktif yaratık değişti.';
        return;
      }
      case 'use-item': {
        this.selectedItemId = intent.itemId;
        await useCampItem(this.writer(), this.id('use'), intent.itemId, this.state.activeCreatureId ?? undefined);
        this.message = 'Eşya kullanıldı.';
        return;
      }
      case 'interact': case 'attack': case 'capture': case 'flee': case 'switch-party': case 'use-battle-item': {
        if (this.panel) return;
        await this.checkpoint();
        const command = { ...intent, commandId: this.id(intent.type), tick: this.tick } as GameCommand;
        if (!this.beforeReward) this.beforeReward = rewardSnapshot(this.state);
        try {
          const result = await this.adapter.dispatch(this.movement.position, command);
          if (!result.accepted) this.message = result.reason === 'owner' ? 'Bu eylem şu anda kabul edilmiyor.' : null;
          else this.message = this.outcomeMessage() ?? this.message;
        } catch (error) {
          // A target that vanished or a bag that filled up is normal play, not a crashed loop.
          if (intent.type !== 'interact') throw error;
          this.message = error instanceof Error ? error.message : 'Etkileşim kabul edilmedi.';
        }
        return;
      }
      case 'visit-shrine': {
        if (this.panel) return;
        await this.checkpoint();
        try {
          await visitShrine(this.world, this.writer(), this.id('shrine'), intent.shrineId);
          this.message = 'Tapınak okundu: bölgenin tarifleri açıldı.';
        } catch (error) { this.message = error instanceof Error ? error.message : 'Tapınak okunamadı.'; }
        return;
      }
      case 'travel': {
        // Travel is a world action: the panel that offered it closes first, by the same rule.
        if (this.panel) await this.togglePanel({ type: 'close-panel' });
        await this.checkpoint();
        try {
          const next = await travelTo(this.world, this.writer(), this.id('travel'), intent.anchorId);
          // The runtime follows the record: one transaction moved the player, the chunks catch up.
          this.movement = { position: { ...next.playerPosition }, yaw: this.movement.yaw, lastSafePosition: { ...next.lastSafePosition } };
          // The journey costs a minute of world time. The session's own clock has to follow the
          // record, or every checkpoint after it is refused for winding time back.
          this.carrier = { ...this.carrier, worldTick: next.worldTick, dayTick: next.dayTick, entityCooldowns: next.entityCooldowns };
          this.adapter.chunks.update(this.movement.position, true);
          this.adapter.discovery.reveal(this.movement.position, 'exploring', false);
          this.message = 'Yolculuk tamamlandı · 60 saniye geçti.';
        } catch (error) { this.message = error instanceof Error ? error.message : 'Seyahat edilemedi.'; }
        return;
      }
      case 'gather': {
        if (this.panel) return;
        await this.checkpoint();
        const spawn = this.adapter.chunks.spawn(intent.entityId);
        if (!spawn) { this.message = 'Bu kaynak artık yüklü değil.'; return; }
        try {
          await gather(this.world, this.writer(), this.id('gather'), { spawn, method: intent.method, holdTicks: this.holdTicks });
          this.adapter.chunks.refresh();
          this.message = 'Kaynak alındı.';
        } catch (error) { this.message = error instanceof Error ? error.message : 'Kaynak alınamadı.'; }
        return;
      }
      case 'rename': {
        await this.writer().transact(this.id('rename'), (draft) => {
          validateWorldState(this.world, draft);
          const name = normalizeName(intent.name);
          if (renameRefusal(name)) fail('Oyuncu adı geçersiz');
          draft.playerName = name;
          validateWorldState(this.world, draft);
        });
        this.message = 'Ad kaydedildi.';
        return;
      }
      case 'ride': {
        if (this.panel) return;
        await this.checkpoint();
        try {
          await mountCreature(this.world, this.writer(), this.id('ride'), intent.creatureId);
          this.message = 'Sırtına bindin.';
        } catch (error) { this.message = error instanceof Error ? error.message : 'Binilemedi.'; }
        return;
      }
      case 'dismount': {
        await this.checkpoint();
        await dismount(this.world, this.writer(), this.id('dismount'));
        this.message = 'İndin.';
        return;
      }
      case 'fell': {
        if (this.panel) return;
        await this.checkpoint();
        const spawn = this.adapter.chunks.spawn(intent.entityId);
        if (!spawn) { this.message = 'Bu ağaç artık yüklü değil.'; return; }
        try {
          await gather(this.world, this.writer(), this.id('fell'), { spawn, method: 'fell' });
          this.adapter.chunks.refresh();
          this.message = 'Ağaç kesildi.';
        } catch (error) { this.message = error instanceof Error ? error.message : 'Ağaç kesilemedi.'; }
        return;
      }
      case 'graft': {
        await this.checkpoint();
        try {
          await graftMove(this.writer(), this.id('graft'), intent.creatureId, intent.moveId);
          this.message = 'Hareket aşılandı.';
        } catch (error) { this.message = error instanceof Error ? error.message : 'Aşı yapılamadı.'; }
        return;
      }
      case 'set-loadout': {
        await this.checkpoint();
        try {
          await setLoadout(this.writer(), this.id('loadout'), intent.creatureId, intent.moveIds);
          this.message = 'Hareketler seçildi.';
        } catch (error) { this.message = error instanceof Error ? error.message : 'Hareketler seçilemedi.'; }
        return;
      }
      case 'move': return;
    }
  }
  private opening = false;
  /**
   * An aggressor that finished its warning holds a hostile lock. Nothing else opens that fight,
   * so the session starts it here — once per lock, and never while a panel or a battle owns input.
   */
  private openHostileBattle(): void {
    if (this.opening || this.panel) return;
    const view = this.adapter.snapshot();
    if (view.state.mode !== 'encounter' || view.pending?.trigger !== 'hostile' || view.pending.kind !== 'battle') return;
    this.opening = true;
    void this.adapter.begin(this.id('ambush'))
      .then((next) => { this.message = next.battle ? 'Saldırıya uğradın!' : this.message; this.dirty = true; })
      // A fight that cannot be opened must not leave the player frozen in an encounter.
      .catch(() => { this.adapter.cancel(); })
      .finally(() => { this.opening = false; });
  }
  /** How long the dig key has been held; the gathering rule turns it into an opened vein. */
  holdTicks = 0;
  private picking = false;
  /**
   * v3: loose material is taken in passing. One transaction per node, deduplicated by the
   * node's own id, and never while a panel, a battle or a commit owns the world.
   */
  private collectUnderfoot(): void {
    if (this.picking || this.panel || this.state.mode !== 'exploring') return;
    const spawns = this.adapter.chunks.residency.simulation.flatMap((chunk) => this.adapter.chunks.entities(chunk.id));
    const target = autoPickTargets(this.world, spawns, { ...this.state, playerPosition: this.movement.position })[0];
    if (!target) return;
    this.picking = true;
    const spawn = this.adapter.chunks.spawn(target.entityId);
    if (!spawn) { this.picking = false; return; }
    void gather(this.world, this.writer(), `pick:${target.entityId}`, { spawn, method: 'pick' })
      .then(() => { this.adapter.chunks.refresh(); this.message = `${itemById(target.itemId)?.name ?? 'Malzeme'} alındı.`; })
      .catch(() => undefined)
      .finally(() => { this.picking = false; });
  }
  /** Climbs on or gets off in one call; the bar and the R key both use it. */
  async toggleRide(creatureId?: string): Promise<void> {
    const id = creatureId ?? this.state.activeCreatureId;
    if (this.state.mount) { await this.dispatch({ type: 'dismount' }); return; }
    if (id) await this.dispatch({ type: 'ride', creatureId: id });
  }
  /** Drops the card for anything the player simply walks over. */
  private cardTarget(nearby: NearbyTarget | null): NearbyTarget | null {
    if (!nearby || nearby.kind !== 'resource') return nearby;
    return this.gatherPlan(nearby.entityId)?.autoPick ? null : nearby;
  }
  /** How this resource wants to be taken, or null when it is not a resource at all. */
  gatherPlan(entityId: string): GatherNode | null {
    const spawn = this.adapter.chunks.spawn(entityId);
    if (!spawn) return null;
    return nodeFor(this.world, spawn, partySpecies(this.state), phaseAt(this.state.dayTick), carries(this.state, TOOL.lens));
  }
  /** True when a vein opens at once: a stone ally in the team or a pick in the bag. */
  canDigNow(): boolean { return canInstantDig(this.state); }
  /** The gardener shrine the player is standing at, if any. */
  nearbyShrine() { return this.panel ? null : shrineAt(this.world, this.movement.position); }
  /** What the camp garden looks like right now: beds, ready crops and the seeds in the bag. */
  gardenView(): GardenView {
    const state = this.state;
    const plots = (state.garden ?? []).map((plot) => {
      const ready = gardenReady(plot, state.worldTick);
      const left = Math.max(0, GARDEN_TICKS - (state.worldTick - plot.plantedTick));
      return {
        itemId: plot.itemId, name: itemById(plot.itemId)?.name ?? plot.itemId, ready,
        text: ready ? 'hazır' : `${Math.ceil(left / 60)} sn`,
      };
    });
    const seeds = state.inventory.flatMap((stack) => stack && isSeed(stack.itemId)
      ? [{ itemId: stack.itemId, name: itemById(stack.itemId)?.name ?? stack.itemId, quantity: stack.quantity }] : []);
    return {
      plots, capacity: gardenPlots(state), seeds,
      canHarvest: plots.some((plot) => plot.ready) && state.atCamp,
      note: state.atCamp ? 'Çantanda tohum yok.' : 'Bahçe yalnız kampta işlenir.',
    };
  }
  async plant(itemId: string): Promise<void> {
    await this.checkpoint();
    await plantSeed(this.world, this.writer(), this.id('plant'), itemId);
    this.message = 'Tohum ekildi.';
  }
  async harvest(): Promise<void> {
    await this.checkpoint();
    await harvestGarden(this.world, this.writer(), this.id('harvest'));
    this.message = 'Bahçe toplandı.';
  }
  /** Retrieves the rewards a full bag pushed into the delivery box. */
  async claimDelivery(): Promise<void> {
    await this.checkpoint();
    await claimDelivery(this.writer(), this.id('claim'));
    this.message = 'Teslim kutusu alındı.';
  }
  /** Hatching has no command intent in the shared contract yet; the session exposes it directly. */
  async hatch(eggId: string): Promise<void> {
    await this.checkpoint();
    await hatchEgg(this.writer(), this.id('hatch'), eggId);
    this.message = 'Yumurta çatladı.';
  }
  async retry(): Promise<void> { await this.adapter.retry(); }
  private async togglePanel(intent: CommandIntent & { type: 'open-panel' | 'close-panel' }): Promise<void> {
    if (intent.type === 'open-panel') {
      if (this.panel || this.state.mode !== 'exploring') return;
      await this.checkpoint();
      this.panel = intent.panel as PanelName;
      await this.writer().transact(this.id('panel-open'), (draft) => { draft.mode = 'panel'; });
      return;
    }
    if (!this.panel) return;
    this.panel = null;
    if (this.state.mode === 'panel') await this.writer().transact(this.id('panel-close'), (draft) => { draft.mode = 'exploring'; });
  }
  private hint(): string | null {
    if (this.tutorialDone || this.state.mode !== 'exploring') return null;
    const player = this.movement.position;
    const candidates = this.adapter.index.query(player, GAME_CONFIG.proximityRadius)
      .filter((target) => reachable(this.world, player, target.position))
      .sort((a, b) => distance(player, a.position) - distance(player, b.position));
    const target = candidates[0];
    if (!target) return 'Kampın çevresini keşfet: yakınlarda yumurta ve sakin yaratıklar var.';
    const angle = Math.atan2(target.position.x - player.x, -(target.position.z - player.z));
    const way = COMPASS[(Math.round(angle / (Math.PI / 4)) + 8) % 8];
    const range = Math.round(distance(player, target.position));
    return `${target.name} ${way} ${range} m uzakta · WASD ile yaklaş, Enter ile etkileşim kur.`;
  }
  view(): SessionView {
    const state = this.state;
    const adapter = this.adapter.snapshot();
    const biomeId = sampleTerrain(this.world, this.movement.position).biomeId;
    const phase = phaseAt(this.dayTick);
    const lantern = carries(state, TOOL.lantern);
    // Night narrows what the world notices, unless a lantern is lit.
    const reach = detectionRadiusWith(phase, lantern);
    const nearby = this.panel ? null : adapter.nearby ?? selectNearby(this.world, this.adapter.index, this.movement.position, null, () => true, reach);
    const owned = state.creatures.find((creature) => creature.id === state.activeCreatureId);
    return {
      hud: hudModel(state, {
        biomeId, paused: this.pausedByPlayer,
        movementAllowed: adapter.movementAllowed && !this.panel && !this.pausedByPlayer,
        warningName: adapter.warning ? this.adapter.index.query(this.movement.position, GAME_CONFIG.proximityRadius)
          .find((target) => target.entityId === adapter.warning!.entityId)?.name ?? 'Vahşi yaratık' : null,
        warningSeconds: adapter.warning?.remainingSeconds ?? null,
        message: adapter.error ?? this.message,
        dayLabel: `${dayView(this.dayTick).label} · ${dayView(this.dayTick).secondsLeft} sn`,
      }),
      minimap: buildMinimap({
        index: this.adapter.index, discovery: this.adapter.discovery, player: this.movement.position,
        yaw: this.movement.yaw, biomeId, selectedId: nearby?.entityId ?? null, viewportWidth: this.viewportWidth(),
      }),
      // v3: loose material is taken in passing, so it never asks for a key. Only creatures, eggs
      // and the resources that still need an action (veins, caches, standing trees) get a card.
      card: this.panel || adapter.state.mode !== 'exploring' ? null : encounterCard(this.cardTarget(nearby), {
        eggSlotsLeft: state.eggCapacity - state.eggs.length,
        creatureSlotsLeft: state.creatureCapacity - state.creatures.length,
        hasHealthyCreature: state.creatures.some((creature) => creature.hp > 0),
        inventoryFull: state.inventory.every((stack) => stack !== null),
        aggressive: adapter.warning?.entityId === nearby?.entityId,
      }),
      battle: state.battle ? battleView(state.battle, {
        biomeId, xp: owned ? { value: owned.xp, max: xpRequired(owned.level) } : undefined,
      }) : null,
      inventory: inventoryView(state), alchemy: alchemyView(state),
      camp: campView(state, { selectedCreatureId: state.activeCreatureId, selectedItemId: this.selectedItemId }),
      bestiary: bestiaryView(state),
      panel: this.panel, hint: this.hint(), adapter, reward: this.reward,
      position: { ...this.movement.position }, yaw: this.movement.yaw,
      chunks: residency(this.movement.position, GAME_CONFIG.visualChunkRadius),
      movementAllowed: adapter.movementAllowed && !this.panel && !this.pausedByPlayer,
      day: dayView(this.dayTick), objectives: objectivesPanelView(state),
      travel: travelOptions(this.world, state),
      caches: sensedCaches(this.world, this.adapter.chunks.residency.simulation.flatMap((chunk) => this.adapter.chunks.entities(chunk.id)), state),
    };
  }
  async dispose(): Promise<void> {
    await this.checkpoint();
    await this.saving;
  }
}
