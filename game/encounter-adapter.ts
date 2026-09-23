import type { GameCommand, GameState, InputOwner, NearbyTarget, SavePort, VecXZ } from '../contracts';
import { CommandBus, type DispatchResult } from '../contracts/command-bus';
import { inputOwner, transition } from '../app/state';
import { ContentError, contentTransaction, planInventory } from '../content/alchemy';
import { creatureById } from '../content/catalog';
import { hash } from '../world/generation/random';
import type { WorldDefinition } from '../world/generation/world';
import { EncounterDirector, type EncounterIntent } from '../world/encounters/director';
import type { ChunkSpawn } from '../world/chunks/chunks';
import type { ChunkManager } from '../world/chunks/manager';
import type { Discovery } from '../world/discovery/discovery';
import type { TargetIndex } from '../world/encounters/targets';
import {
  commitEncounterOutcome, explorationAllowed, restoreWorld, settlementOf, validateWorldState, type WorldState,
} from '../world/persistence/world-save';
import { beginBattle, createBattle, stats, type BattleState, type Fighter } from './combat/core';
import type { PartyMember } from './party';
import { loadoutFor } from '../content/loadout';
import { recordSighting } from '../content/unlocks';
import { graftsOf } from '../content/graft';
import { phaseAt } from '../world/daynight';
import { applyBattleCommand, collectEgg, createLootPlan } from './combat/rewards';

export type EncounterOutcome = 'collected' | 'won' | 'captured' | 'lost' | 'fled';
export interface PendingEncounter { readonly entityId: string; readonly kind: 'battle' | 'collect'; readonly trigger: 'manual' | 'hostile' }
export interface AdapterView {
  readonly state: GameState; readonly owner: InputOwner;
  readonly nearby: NearbyTarget | null; readonly warning: { entityId: string; remainingSeconds: number } | null;
  readonly pending: PendingEncounter | null; readonly battle: BattleState | null;
  readonly lastOutcome: EncounterOutcome | null; readonly movementAllowed: boolean; readonly error: string | null;
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Bilinmeyen kayıt hatası';
/**
 * The single command path from exploring to a committed encounter and back. It owns no rendering
 * and no DOM: UI sends intents, this adapter runs the domain transaction and publishes a view.
 * The world stays locked until the outcome is durable, so a failed save ends in `recovery`.
 */
/** How often the patrols are stepped forward in the shared index. */
export const PATROL_SYNC_TICKS = 6;
export class EncounterAdapter {
  readonly index: TargetIndex;
  readonly chunks: ChunkManager;
  readonly discovery: Discovery;
  readonly director: EncounterDirector;
  private current: WorldState;
  private view: GameState;
  private lock: EncounterIntent | null = null;
  private outcome: EncounterOutcome | null = null;
  private error: string | null = null;
  private position: VecXZ;
  private readonly positions = new Map<string, VecXZ>();
  private readonly bus: CommandBus<AdapterView>;

  private constructor(private readonly world: WorldDefinition, private readonly save: SavePort<WorldState>, loaded: WorldState, sessionId: string) {
    validateWorldState(world, loaded);
    this.current = loaded;
    this.position = { ...loaded.playerPosition };
    const restored = restoreWorld(world, () => this.current);
    this.index = restored.index; this.chunks = restored.chunks; this.discovery = restored.discovery;
    this.director = new EncounterDirector(world, this.index, sessionId);
    // A record left mid-commit reopens in `committing`, never in a world the player can walk around in.
    this.view = loaded.battle
      ? loaded.battle.outcome
        ? { mode: 'committing', transactionId: settleId(loaded.battle.battleId), battleId: loaded.battle.battleId, encounterId: loaded.battle.encounterId }
        : { mode: 'battle', battleId: loaded.battle.battleId, encounterId: loaded.battle.encounterId }
      : { mode: 'exploring' };
    this.bus = new CommandBus<AdapterView>(() => this.owner(), (command) => this.handle(command));
  }
  static async open(world: WorldDefinition, save: SavePort<WorldState>, sessionId: string): Promise<EncounterAdapter> {
    const loaded = await save.load();
    if (!loaded) throw new ContentError('invalid-state', 'Kayıt bulunamadı; önce dünya kaydı oluşturulmalı.');
    return new EncounterAdapter(world, save, loaded, sessionId);
  }
  get state(): WorldState { return this.current; }
  /**
   * Publishes a record committed outside this adapter (panel mode, crafting, an exploration
   * checkpoint) so the session keeps one source of truth and the chunk gates stay current.
   */
  resync(state: WorldState): void {
    validateWorldState(this.world, state);
    if (state.seed !== this.current.seed) throw new ContentError('invalid-state', 'Farklı dünyaya ait kayıt.');
    this.current = state;
    this.chunks.refresh();
  }
  private owner(): InputOwner { return inputOwner(this.view); }
  snapshot(): AdapterView {
    const { nearby, warning } = this.director.snapshot();
    return Object.freeze({
      state: this.view, owner: this.owner(), nearby, warning,
      pending: this.lock ? Object.freeze({ entityId: this.lock.entityId, kind: this.lock.kind, trigger: this.lock.trigger }) : null,
      battle: this.current.battle ? structuredClone(this.current.battle) : null,
      lastOutcome: this.outcome, movementAllowed: this.view.mode === 'exploring' && explorationAllowed(this.current), error: this.error,
    });
  }
  /**
   * One simulation tick of encounter logic; warnings and aggro only advance while exploring.
   * `clock` is the session's live world clock: the committed record only catches up at a
   * checkpoint, and patrols must not stand still between two of them.
   */
  tick(player: VecXZ, paused = false, clock?: { readonly worldTick: number; readonly dayTick: number }): AdapterView {
    this.position = { ...player };
    // Patrol routes and the ambush draw both read the world clock, so it is handed over first.
    const worldTick = clock && Number.isSafeInteger(clock.worldTick) && clock.worldTick >= 0 ? clock.worldTick : this.current.worldTick;
    const dayTick = clock && Number.isFinite(clock.dayTick) ? clock.dayTick : this.current.dayTick;
    this.director.setClock(worldTick, phaseAt(dayTick));
    if (this.view.mode === 'exploring' && !this.lock && explorationAllowed(this.current, paused)) {
      // Ten steps a second is enough for a smooth walk and keeps the index churn small.
      if (worldTick % PATROL_SYNC_TICKS === 0) this.director.movePatrols(player);
      const intent = this.director.update(player, 'exploring', paused);
      // An ambush the player cannot answer is dropped here, not left as an unreachable lock.
      if (intent && !this.ready(intent)) this.director.finishCommitted(intent.lockId, 'cancelled');
      else if (intent) { this.lock = intent; this.view = transition(this.view, { type: 'encounter', encounterId: intent.entityId }); }
    }
    return this.snapshot();
  }
  dispatch(player: VecXZ, command: GameCommand): Promise<DispatchResult<AdapterView>> {
    this.position = { ...player };
    this.positions.set(command.commandId, { ...player });
    return this.bus.dispatch(command);
  }
  /** Starts the battle for a hostile lock the director raised during {@link tick}. */
  async begin(commandId: string): Promise<AdapterView> {
    if (!this.lock || this.lock.kind !== 'battle' || this.view.mode !== 'encounter') return this.snapshot();
    return this.startBattle(commandId, this.lock.entityId);
  }
  /** Releases a lock the player walked away from; only legal before a battle opened. */
  cancel(): AdapterView {
    if (this.lock && this.view.mode === 'exploring') { this.director.finishCommitted(this.lock.lockId, 'cancelled'); this.lock = null; }
    return this.snapshot();
  }
  private async handle(command: GameCommand): Promise<AdapterView> {
    const player = this.positions.get(command.commandId) ?? this.position;
    this.positions.delete(command.commandId);
    switch (command.type) {
      case 'interact': return this.beginEncounter(command, player);
      case 'attack': case 'capture': case 'flee': case 'switch-party': case 'use-battle-item': return this.act(command);
      default: throw new ContentError('context', 'Bu komut karşılaşma adapterine ait değil.');
    }
  }
  private spawnOf(entityId: string): ChunkSpawn {
    const spawn = this.chunks.spawn(entityId);
    if (!spawn) throw new ContentError('invalid-target', 'Hedef artık yüklü değil.');
    if (this.current.consumedEntityIds.includes(entityId)) throw new ContentError('invalid-target', 'Bu hedef zaten tüketildi.');
    return spawn;
  }
  private activeFighter(): Fighter | null {
    const owned = this.current.creatures.find((creature) => creature.id === this.current.activeCreatureId);
    const species = owned && creatureById(owned.speciesId);
    return owned && species && owned.hp > 0 ? { id: owned.id, species, level: owned.level } : null;
  }
  /** Preconditions are checked before a lock is taken, so no unwinnable encounter state is entered. */
  private ready(intent: EncounterIntent): boolean {
    const spawn = this.chunks.spawn(intent.entityId);
    if (!spawn || this.current.consumedEntityIds.includes(intent.entityId)) return false;
    return intent.kind === 'collect' ? true : !!this.activeFighter() && !!creatureById(spawn.speciesId ?? '');
  }
  private async beginEncounter(command: GameCommand, player: VecXZ): Promise<AdapterView> {
    if (command.type !== 'interact') throw new ContentError('context', 'Geçersiz etkileşim.');
    this.error = null;
    if (this.lock && this.lock.entityId !== command.entityId) throw new ContentError('invalid-target', 'Başka bir karşılaşma sürüyor.');
    if (!this.lock) {
      this.spawnOf(command.entityId);
      const preview = this.director.snapshot().nearby;
      if (preview?.entityId === command.entityId && preview.kind === 'creature' && !this.activeFighter()) {
        throw new ContentError('invalid-target', 'Savaşacak ayakta yaratığınız yok.');
      }
      const intent = this.director.interact(player, command, this.view.mode, !explorationAllowed(this.current));
      if (!intent) return this.snapshot();
      if (!this.ready(intent)) { this.director.finishCommitted(intent.lockId, 'cancelled'); throw new ContentError('invalid-target', 'Bu karşılaşma şu anda başlatılamaz.'); }
      this.lock = intent;
      if (intent.kind === 'battle') this.view = transition(this.view, { type: 'encounter', encounterId: intent.entityId });
    }
    return this.lock.kind === 'collect' ? this.collect(command) : this.startBattle(command.commandId, this.lock.entityId);
  }
  /** Collection never opens a battle: one transaction consumes the entity and stores its reward. */
  private async collect(command: GameCommand): Promise<AdapterView> {
    const spawn = this.spawnOf(this.lock!.entityId);
    const entityId = spawn.target.entityId;
    if (spawn.target.kind === 'egg') {
      this.current = await collectEgg(this.save, command.commandId, {
        id: `egg:${entityId}`, encounterId: entityId, speciesId: spawn.speciesId ?? '', seed: spawn.seed,
      });
    } else {
      this.current = await contentTransaction(this.save, command.commandId, (draft) => {
        validateWorldState(this.world, draft);
        if (draft.mode !== 'exploring' || draft.consumedEntityIds.includes(entityId)) throw new ContentError('context', 'Bu kaynak toplanamıyor.');
        draft.inventory = planInventory(draft.inventory, [], [{ itemId: spawn.itemId ?? '', quantity: 1 }]);
        draft.consumedEntityIds.push(entityId);
        validateWorldState(this.world, draft);
      });
    }
    this.release('collected');
    return this.snapshot();
  }
  private async startBattle(commandId: string, entityId: string): Promise<AdapterView> {
    const spawn = this.spawnOf(entityId);
    // The world tick makes each encounter instance unique, so a respawned creature earns its own
    // reward-ledger entry instead of colliding with the fight that defeated it.
    const battleId = `battle:${entityId}:${this.current.worldTick}`;
    this.current = await contentTransaction(this.save, commandId, (draft) => {
      validateWorldState(this.world, draft);
      if (draft.battle || (draft.mode !== 'exploring' && draft.mode !== 'encounter')) throw new ContentError('context', 'Savaş başlatılamaz.');
      if (draft.consumedEntityIds.includes(entityId)) throw new ContentError('invalid-target', 'Bu hedef zaten tüketildi.');
      const owned = draft.creatures.find((creature) => creature.id === draft.activeCreatureId);
      const mine = owned && creatureById(owned.speciesId);
      const species = creatureById(spawn.speciesId ?? '');
      if (!owned || !mine || owned.hp <= 0) throw new ContentError('invalid-target', 'Savaşacak ayakta yaratığınız yok.');
      if (!species) throw new ContentError('invalid-target', 'Vahşi yaratık tanımı bulunamadı.');
      const grafts = graftsOf(draft.grafts, owned.id);
      const player: Fighter = { id: owned.id, species: mine, level: owned.level,
        ...(grafts.length ? { grafts: [...grafts] } : {}),
        loadout: [...loadoutFor(draft.loadouts, owned.id, owned.speciesId)] };
      // The whole travelling team enters the battle record, so switching has somewhere to go.
      const roster = draft.party.includes(owned.id) ? draft.party : [owned.id];
      const party: PartyMember[] = roster.flatMap((id) => {
        const member = draft.creatures.find((creature) => creature.id === id);
        const definition = member && creatureById(member.speciesId);
        if (!member || !definition) return [];
        const memberGrafts = graftsOf(draft.grafts, member.id);
        return [{
          id: member.id, species: definition, level: member.level,
          hp: Math.min(member.hp, stats({ id, species: definition, level: member.level }).maxHp),
          ...(memberGrafts.length ? { grafts: [...memberGrafts] } : {}),
          loadout: [...loadoutFor(draft.loadouts, member.id, member.speciesId)],
        }];
      });
      const snapshot: Record<string, number> = {};
      for (const stack of draft.inventory) if (stack) snapshot[stack.itemId] = (snapshot[stack.itemId] ?? 0) + stack.quantity;
      const battle = beginBattle(createBattle({
        battleId, encounterId: entityId, seed: hash(this.world.seed, `battle:${entityId}`, draft.worldTick),
        player, enemy: { id: entityId, species, level: spawn.target.level },
        party, activeIndex: party.findIndex((member) => member.id === owned.id),
        ambushed: this.lock?.trigger === 'hostile' && this.director.ambushed,
        playerHp: Math.min(owned.hp, stats(player).maxHp), aggressive: spawn.target.aggressive, capturable: true,
        captureCapacity: draft.creatureCapacity - draft.creatures.length, inventorySnapshot: snapshot,
      }));
      draft.battle = battle;
      draft.loot = createLootPlan(battleId, battle.enemy, battle.aggressive, spawn.seed);
      draft.mode = 'battle';
      // Meeting a creature is what catalogues it — v3 recorded only the ones you kept, so a
      // species you fought and fled from taught you nothing at all.
      recordSighting(draft, species.id);
      validateWorldState(this.world, draft);
    });
    this.view = transition(this.view, { type: 'start-battle', battleId, encounterId: entityId });
    return this.snapshot();
  }
  private async act(command: GameCommand): Promise<AdapterView> {
    if (this.view.mode !== 'battle') throw new ContentError('context', 'Savaş etkin değil.');
    const battleId = this.view.battleId;
    this.error = null;
    this.current = await applyBattleCommand(this.save, battleId, command);
    if (!this.current.battle?.outcome) return this.snapshot();
    const transactionId = settleId(battleId);
    this.view = transition(this.view, { type: 'commit', transactionId, battleId });
    await this.settle(transactionId);
    return this.snapshot();
  }
  /** Retries the identical commit transaction; the save ledger makes a second attempt a no-op. */
  async retry(): Promise<AdapterView> {
    if (this.view.mode !== 'recovery') return this.snapshot();
    const { transactionId } = this.view;
    this.view = transition(this.view, { type: 'retry' });
    await this.settle(transactionId);
    return this.snapshot();
  }
  private async settle(transactionId: string): Promise<void> {
    if (this.view.mode !== 'committing') throw new ContentError('context', 'Commit aşaması değil.');
    const settlement = settlementOf(this.current);
    if (!settlement) throw new ContentError('context', 'Çözümlenmemiş savaş kapatılamaz.');
    try {
      this.current = await commitEncounterOutcome(this.world, this.save, transactionId, this.view.battleId);
    } catch (error) {
      // The record stays in `committing`, so movement, aggro and world time remain closed.
      this.error = message(error);
      this.view = transition(this.view, { type: 'commit-failed', transactionId, error: this.error });
      return;
    }
    this.error = null;
    this.release(settlement.outcome);
    this.view = transition(this.view, { type: 'committed', transactionId });
  }
  private release(outcome: EncounterOutcome): void {
    if (this.lock) this.director.finishCommitted(this.lock.lockId, outcome);
    this.chunks.refresh();
    this.lock = null;
    this.outcome = outcome;
  }
}
function settleId(battleId: string): string { return `settle:${battleId}`; }
