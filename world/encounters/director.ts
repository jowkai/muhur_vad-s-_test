import type { DayPhase, GameCommand, GameMode, NearbyTarget, VecXZ } from '../../contracts';
import { GAME_CONFIG } from '../../config';
import type { WorldDefinition } from '../generation/world';
import { TargetIndex, distance, hasLineOfSight, selectNearby, type WorldTarget } from './targets';
import { AMBUSH_WARNING_TICKS, WARNING_TICKS, ambushes, patrolPosition } from './patrol';

export interface EncounterIntent {
  readonly lockId: string; readonly entityId: string;
  readonly kind: 'battle' | 'collect'; readonly trigger: 'manual' | 'hostile';
}
/**
 * WORLD.md fixes aggro at ten metres, and this is the only place that number lives. It used to
 * be a literal repeated twice in the query below.
 */
export const AGGRO_RADIUS = 10;
export class EncounterDirector {
  private tick = 0;
  private sequence = 0;
  private nearby: NearbyTarget | null = null;
  private lock: EncounterIntent | null = null;
  private warning: { entityId: string; ticks: number } | null = null;
  private immuneUntil = 0;
  private phase: DayPhase = 'day';
  private worldTick = 0;
  private lastAmbush = false;
  private readonly cooldowns = new Map<string, number>();
  /** Where each restless creature started out; its route is drawn around that spot, not its last step. */
  private readonly homes = new Map<string, VecXZ>();
  constructor(private readonly world: WorldDefinition, private readonly index: TargetIndex, private readonly namespace: string) {
    if (!namespace.trim()) throw new RangeError('Karşılaşma oturum kimliği gerekli.');
  }
  private eligible = (id: string) => this.tick >= (this.cooldowns.get(id) ?? 0);
  /** The world clock the patrols and the ambush draw follow; the session passes it every tick. */
  setClock(worldTick: number, phase: DayPhase): void {
    this.worldTick = Number.isSafeInteger(worldTick) && worldTick >= 0 ? worldTick : this.worldTick;
    this.phase = phase;
  }
  /**
   * Where a target actually stands now: a restless creature wanders around its home patch.
   * The world clock drives it so a reload puts every patrol back where it was; a caller that
   * never sets a clock (a unit test driving the adapter directly) falls back to the tick count.
   */
  livePosition(target: WorldTarget): VecXZ {
    const home = this.homes.get(target.entityId) ?? target.position;
    return patrolPosition(this.world, target.entityId, home, this.worldTick || this.tick, target.aggressive);
  }
  /**
   * Walks the restless creatures in the shared index. One source of truth: after this the map,
   * the minimap, the card and the danger rule all read the same spot for a patrol.
   */
  movePatrols(player: VecXZ): void {
    for (const target of this.index.query(player, GAME_CONFIG.proximityRadius)) {
      if (!target.aggressive) continue;
      if (!this.homes.has(target.entityId)) this.homes.set(target.entityId, { ...target.position });
      const live = this.livePosition(target);
      if (live.x !== target.position.x || live.z !== target.position.z) this.index.upsert({ ...target, position: live });
    }
  }
  get ambushed(): boolean { return this.lastAmbush; }
  snapshot() {
    return { nearby: this.nearby ? { ...this.nearby } : null, lock: this.lock ? { ...this.lock } : null,
      warning: this.warning ? {
        entityId: this.warning.entityId, ambush: this.lastAmbush,
        remainingSeconds: Math.max(0, (this.lastAmbush ? AMBUSH_WARNING_TICKS : WARNING_TICKS) * GAME_CONFIG.fixedStep - this.warning.ticks * GAME_CONFIG.fixedStep),
      } : null };
  }
  /** Called once per simulation tick. Paused UI/battle/offline time never advances warnings. */
  update(player: VecXZ, mode: GameMode, paused = false): EncounterIntent | null {
    if (mode !== 'exploring' || paused || this.lock) return null;
    this.tick++;
    for (const [id, until] of this.cooldowns) if (this.tick >= until) this.cooldowns.delete(id);
    this.nearby = selectNearby(this.world, this.index, player, this.nearby, this.eligible);
    if (this.tick < this.immuneUntil || distance(player, this.world.camp) <= GAME_CONFIG.safeCampRadius) { this.warning = null; return null; }
    const hostile = this.index.query(player, AGGRO_RADIUS).filter((target) => target.aggressive && this.eligible(target.entityId) &&
      distance(this.livePosition(target), this.world.camp) > GAME_CONFIG.safeCampRadius &&
      distance(player, this.livePosition(target)) <= AGGRO_RADIUS && hasLineOfSight(this.world, player, this.livePosition(target)))
      .sort((a, b) => distance(player, this.livePosition(a)) - distance(player, this.livePosition(b)) || (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0))[0];
    if (!hostile) { this.warning = null; return null; }
    const first = this.warning?.entityId !== hostile.entityId;
    this.warning = first ? { entityId: hostile.entityId, ticks: 1 } : { entityId: hostile.entityId, ticks: this.warning!.ticks + 1 };
    // An ambush still warns — the product rule is that an aggressor always does — but it leaves
    // the player a third of a second instead of a second and a fifth.
    if (first) this.lastAmbush = ambushes(this.world, hostile.entityId, hostile.level, this.phase, Math.floor(this.tick / 90));
    const needed = this.lastAmbush ? AMBUSH_WARNING_TICKS : WARNING_TICKS;
    return this.warning.ticks >= needed ? this.acquire(hostile, 'hostile') : null;
  }
  interact(player: VecXZ, command: GameCommand, mode: GameMode, paused = false): EncounterIntent | null {
    if (this.lock || paused || mode !== 'exploring' || command.type !== 'interact') return null;
    this.nearby = selectNearby(this.world, this.index, player, this.nearby, this.eligible);
    if (!this.nearby?.interactionAllowed || this.nearby.entityId !== command.entityId) return null;
    const target = this.index.query(player).find((entry) => entry.entityId === command.entityId);
    return target ? this.acquire(target, 'manual') : null;
  }
  private acquire(target: WorldTarget, trigger: EncounterIntent['trigger']): EncounterIntent {
    this.lock = { lockId: `${this.namespace}:${++this.sequence}`, entityId: target.entityId, kind: target.kind === 'creature' ? 'battle' : 'collect', trigger };
    this.warning = null; return { ...this.lock };
  }
  /** Adapter calls this only AFTER durable outcome commit; stale completions cannot unlock another encounter. */
  finishCommitted(lockId: string, outcome: 'won' | 'captured' | 'collected' | 'fled' | 'lost' | 'cancelled'): boolean {
    if (this.lock?.lockId !== lockId) return false;
    const id = this.lock.entityId;
    if (outcome === 'won' || outcome === 'captured' || outcome === 'collected') { this.index.remove(id); this.homes.delete(id); }
    if (outcome === 'fled' || outcome === 'lost') this.cooldowns.set(id, this.tick + Math.round((outcome === 'fled' ? 8 : 30) / GAME_CONFIG.fixedStep));
    this.immuneUntil = this.tick + Math.round(3 / GAME_CONFIG.fixedStep);
    this.lock = null; this.nearby = null; this.warning = null; return true;
  }
}
