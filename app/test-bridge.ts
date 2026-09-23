import type { CommandIntent, VecXZ } from '../contracts';
import { GAME_CONFIG } from '../config';
import { distance } from '../world/encounters/targets';
import type { GameSession } from './session';
import type { WorldDefinition } from '../world/generation/world';
import { shrinesFor } from '../world/shrines/shrines';

export const TEST_BRIDGE_KEY = '__muhurTestBridge';
export interface BridgeSnapshot {
  readonly position: VecXZ; readonly yaw: number; readonly mode: string; readonly panel: string | null;
  readonly biome: string; readonly movementAllowed: boolean; readonly hint: string | null;
  readonly nearby: { readonly entityId: string; readonly name: string; readonly kind: string; readonly enabled: boolean } | null;
  readonly team: readonly { readonly id: string; readonly speciesId: string; readonly level: number; readonly xp: number; readonly hp: number }[];
  readonly inventory: readonly (string | null)[]; readonly eggs: number; readonly deliveryBox: number;
  readonly consumed: number; readonly recipes: number; readonly discovered: number;
  readonly battle: {
    readonly turn: number; readonly playerHp: number; readonly enemyHp: number; readonly outcome: string | null;
    readonly ambushed: boolean; readonly phase: string; readonly activeIndex: number;
    readonly party: readonly { readonly id: string; readonly hp: number }[];
    readonly playerEffects: readonly string[]; readonly enemyEffects: readonly string[];
  } | null;
  /** v2 surfaces the gauntlet needs to see: the clock, the team, the anchors and the objectives. */
  readonly day: { readonly phase: string; readonly secondsLeft: number };
  readonly party: readonly string[]; readonly activeCreatureId: string | null;
  readonly shrines: readonly string[]; readonly anchors: readonly string[];
  readonly objectives: { readonly done: number; readonly total: number };
  readonly garden: number; readonly tools: readonly string[];
  /** v3 surfaces: the profile, the mount under the player, the grafts and the tonic in effect. */
  readonly playerName: string; readonly mount: string | null;
  readonly grafts: readonly { readonly creatureId: string; readonly moveId: string }[];
  readonly speedEffects: readonly string[];
}
export interface BridgeNode {
  readonly entityId: string; readonly method: string; readonly itemId: string;
  readonly position: VecXZ; readonly nightOnly: boolean; readonly hidden: boolean;
  readonly treeKind: string | null; readonly autoPick: boolean;
}
export interface BridgeWorld {
  readonly seed: string; readonly camp: VecXZ;
  readonly regions: readonly { readonly biomeId: string; readonly entrance: VecXZ }[];
}
export interface TestBridge {
  snapshot(): BridgeSnapshot;
  /** Designed geography for the QA route; read-only copy of the generated world definition. */
  world(): BridgeWorld;
  /** Drives the real movement domain at full speed; no teleport and no rule is skipped. */
  walkTo(x: number, z: number, maxTicks?: number): boolean;
  /** Gathering plans for the loaded resources, so a test can find a vein without guessing. */
  nodes(): readonly BridgeNode[];
  /** The loaded creatures that come at the player on their own; the danger route walks at one. */
  aggressors(): readonly { readonly entityId: string; readonly level: number; readonly position: VecXZ }[];
  /** Where the gardener shrines stand in this world. */
  shrines(): readonly { readonly id: string; readonly biomeId: string; readonly position: VecXZ }[];
  dispatch(intent: CommandIntent): Promise<void>;
  checkpoint(): Promise<void>;
  /** Tears the whole shell down so a test can prove disposal in a real browser. */
  dispose(): Promise<void>;
}
/**
 * Dev-only inspection and navigation hook for the QA gauntlet. Both signals are replaced at build
 * time, so the bundle drops this body and never defines the global. `MODE` is checked as well as
 * `DEV` because a build inheriting a non-production NODE_ENV (for example from a test runner)
 * would otherwise keep `DEV` true and ship the bridge.
 */
export function installTestBridge(
  session: GameSession,
  world: WorldDefinition,
  teardown: () => Promise<void>,
): () => void {
  const worldDefinition = world;
  if (import.meta.env.MODE === 'production' || !import.meta.env.DEV) return () => undefined;
  const bridge: TestBridge = {
    world: () => ({ seed: world.seed, camp: { ...world.camp }, regions: world.regions.map((region) => ({ biomeId: region.biomeId, entrance: { ...region.entrance } })) }),
    snapshot(): BridgeSnapshot {
      const view = session.view();
      const state = session.state;
      return {
        position: view.position, yaw: view.yaw, mode: state.mode, panel: view.panel,
        biome: view.hud.biome.label, movementAllowed: view.movementAllowed, hint: view.hint,
        nearby: view.card ? { entityId: view.card.entityId, name: view.card.name, kind: view.card.kind, enabled: view.card.enabled } : null,
        team: state.creatures.map((creature) => ({ id: creature.id, speciesId: creature.speciesId, level: creature.level, xp: creature.xp, hp: creature.hp })),
        inventory: state.inventory.map((stack) => stack && `${stack.itemId}:${stack.quantity}`),
        eggs: state.eggs.length, deliveryBox: state.deliveryBox.length, consumed: state.consumedEntityIds.length,
        recipes: state.unlockedRecipeIds.length, discovered: state.discoveredCells.length,
        battle: state.battle ? {
          ambushed: state.battle.ambushed ?? false, turn: state.battle.turn, playerHp: state.battle.playerHp, enemyHp: state.battle.enemyHp,
          outcome: state.battle.outcome, phase: state.battle.phase, activeIndex: state.battle.activeIndex,
          party: state.battle.party.map((member) => ({ id: member.id, hp: member.hp })),
          playerEffects: state.battle.status.playerEffects.map((effect) => effect.kind),
          enemyEffects: state.battle.status.enemyEffects.map((effect) => effect.kind),
        } : null,
        day: { phase: view.day.phase, secondsLeft: view.day.secondsLeft },
        party: [...state.party], activeCreatureId: state.activeCreatureId,
        shrines: state.shrines.map((shrine) => shrine.biomeId),
        anchors: view.travel.map((anchor) => anchor.id),
        objectives: { done: view.objectives.completed, total: view.objectives.total },
        garden: (state.garden ?? []).length, tools: [...state.tools],
        playerName: state.playerName, mount: state.mount?.creatureId ?? null,
        grafts: (state.grafts ?? []).map((graft) => ({ creatureId: graft.creatureId, moveId: graft.moveId })),
        speedEffects: (state.speedEffects ?? []).map((effect) => effect.itemId),
      };
    },
    walkTo(x, z, maxTicks = 20_000): boolean {
      const goal = { x, z };
      for (let tick = 0; tick < maxTicks; tick++) {
        // An encounter that took the world over ends the walk, so the caller can react to it.
        if (session.view().adapter.state.mode !== 'exploring') return false;
        const at = session.view().position;
        if (distance(at, goal) <= 2) return true;
        session.step({
          move: {
            type: 'move', direction: { x: goal.x - at.x, z: goal.z - at.z },
            commandId: `bridge:${tick}`, tick: tick % Number.MAX_SAFE_INTEGER,
          },
        });
      }
      return distance(session.view().position, goal) <= GAME_CONFIG.interactionRadius;
    },
    nodes(): readonly BridgeNode[] {
      return session.visibleEntities()
        .flatMap((entity) => { const node = session.gatherPlan(entity.entityId); return node ? [node] : []; })
        .map((node) => ({
          entityId: node.entityId, method: node.method, itemId: node.itemId,
          position: { ...node.position }, nightOnly: node.nightOnly, hidden: node.hidden,
          treeKind: node.treeKind, autoPick: node.autoPick,
        }));
    },
    aggressors: () => session.visibleEntities()
      .filter((target) => target.aggressive)
      .map((target) => ({ entityId: target.entityId, level: target.level, position: { ...target.position } })),
    shrines: () => shrinesFor(worldDefinition).map((shrine) => ({ id: shrine.id, biomeId: shrine.biomeId, position: { ...shrine.position } })),
    dispatch: (intent) => session.dispatch(intent),
    checkpoint: () => session.checkpoint(),
    dispose: () => teardown(),
  };
  (globalThis as unknown as Record<string, TestBridge>)[TEST_BRIDGE_KEY] = bridge;
  return () => { delete (globalThis as unknown as Record<string, unknown>)[TEST_BRIDGE_KEY]; };
}
