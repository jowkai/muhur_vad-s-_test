import {
  CanvasTexture, ConeGeometry, CylinderGeometry, DirectionalLight, Group, HemisphereLight, Light, Mesh,
  MeshStandardMaterial, SphereGeometry, type Scene, type Texture,
} from 'three';
import type { CommandIntent } from '../contracts';
import { GAME_CONFIG } from '../config';
import { creatureAssets, eggAssets, itemAssets } from '../content/asset-manifest';
import { IndexedDbSave, SaveError } from '../game/save/indexeddb';
import { createWorld } from '../world/generation/world';
import { sampleTerrain } from '../world/terrain/terrain';
import { migrateWorldState, validateWorldState, type WorldState } from '../world/persistence/world-save';
import { createRenderCore } from '../render/core/scene';
import { FixedStepClock } from '../render/core/fixed-step';
import { KeyboardInput } from '../render/input/keyboard';
import { TouchControls } from '../ui/touch/touch-controls';
import { applyPlayerPose } from '../render/camera/follow-camera';
import { ChunkRenderer } from '../render/chunks/chunk-renderer';
import { createTerrainWorker } from '../render/worker/terrain-client';
import { chunkAt } from '../world/chunks/chunks';
import { EntityLayer } from '../render/entities/entity-layer';
import { SpriteAtlas } from '../render/atlas/sprite-atlas';
import { ParticleField } from '../render/fx/particles';
import { DamageNumberLayer, damageNumber } from '../render/fx/damage-numbers';
import { applySky, skySetting } from '../render/fx/sky';
import type { RenderEntity } from '../render/entities/frame';
import { ResourceRegistry } from '../render/resources/registry';
import { HudView } from '../ui/hud/hud-view';
import { TabBarView } from '../ui/shell/tab-bar';
import { ObjectivesPanel } from '../ui/objectives/objectives-panel';
import { SettingsPanel } from '../ui/settings/settings-panel';
import { loadPreferences } from '../ui/settings/preferences';
import { PartyBarView } from '../ui/party/party-view';
import { ProfileCard } from '../ui/profile/profile-card';
import { MinimapDial } from '../ui/minimap/minimap-view';
import { MinimapAtlas } from '../render/minimap/atlas';
import { createCampProps } from '../render/props/camp';
import { EncounterCardView } from '../ui/encounter/card-view';
import { BattlePage } from '../ui/battle/battle-view';
import { RewardPanel } from '../ui/battle/reward';
import { GameAudio } from '../ui/audio';
import { InventoryPanel } from '../ui/inventory/inventory-panel';
import { AlchemyPanel } from '../ui/alchemy/alchemy-panel';
import { CampPanel } from '../ui/camp/camp-panel';
import { BestiaryPanel } from '../ui/bestiary/bestiary-panel';
import { panelIntentForKey } from '../ui/inventory/panel-dialog';
import { GameSession, newGame, type PanelName } from './session';
import type { PanelId } from '../contracts';
import { installTestBridge } from './test-bridge';
import { Telemetry, installTelemetry } from './telemetry';
import { cosmeticStage } from '../game/progression';
import type { BattleEvent } from '../game/combat/core';

const SPRITE_SIZE = 128;
/** Rasterises our own SVG assets into canvas textures; nothing is fetched from a remote host. */
function spriteTextures(): (visualId: string) => Texture | null {
  const cache = new Map<string, Texture>();
  return (visualId) => {
    const cached = cache.get(visualId);
    if (cached) return cached;
    const url = creatureAssets[visualId as keyof typeof creatureAssets]?.front
      ?? eggAssets[visualId.replace('egg_', '') as keyof typeof eggAssets]
      ?? itemAssets[visualId as keyof typeof itemAssets];
    if (!url) return null;
    const canvas = document.createElement('canvas');
    canvas.width = SPRITE_SIZE; canvas.height = SPRITE_SIZE;
    const texture = new CanvasTexture(canvas);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      canvas.getContext('2d')?.drawImage(image, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
      texture.needsUpdate = true;
    };
    image.src = url;
    cache.set(visualId, texture);
    return texture;
  };
}
function playerProxy(registry: ResourceRegistry): Group {
  const group = new Group();
  group.name = 'player';
  const parts: [string, () => Mesh][] = [
    ['player:body', () => new Mesh(registry.geometry('player:body:geometry', () => new CylinderGeometry(0.34, 0.46, 1.1, 8)), registry.material('player:body', () => new MeshStandardMaterial({ color: 0x8f7442, roughness: .8 })))],
    ['player:head', () => new Mesh(registry.geometry('player:head:geometry', () => new SphereGeometry(0.3, 12, 8)), registry.material('player:head', () => new MeshStandardMaterial({ color: 0x9a8058, roughness: .7 })))],
    ['player:hat', () => new Mesh(registry.geometry('player:hat:geometry', () => new ConeGeometry(0.52, 0.42, 8)), registry.material('player:hat', () => new MeshStandardMaterial({ color: 0x2f4c3f, roughness: .9 })))],
  ];
  const heights = [0.75, 1.5, 1.85];
  parts.forEach(([, make], index) => {
    const mesh = make();
    mesh.position.y = heights[index];
    mesh.castShadow = true;
    group.add(mesh);
  });
  return group;
}
/**
 * Exposure grading belongs to the integrator: the render core ships bright studio defaults that
 * blow out the pale biomes (ice and meadow), so the app tones them down for the shipped look.
 */
function gradeLighting(scene: Scene): void {
  for (const child of scene.children) {
    if (!(child instanceof Light)) continue;
    if (child instanceof HemisphereLight) { child.intensity = 0.85; child.color.set('#cfe3d6'); child.groundColor.set('#2f3d38'); }
    else if (child instanceof DirectionalLight) { child.intensity = 1.25; child.castShadow = true; child.shadow.mapSize.set(1024, 1024); child.shadow.normalBias = 0.05; }
    else child.intensity = Math.min(child.intensity, 1);
  }
}
export interface GameShell { dispose(): Promise<void> }
/**
 * Wires the playable session to Three.js and the DOM. All gameplay rules live behind
 * {@link GameSession}; this layer only draws the view it publishes and forwards intents.
 */
export async function startGame(host: HTMLElement, options: { seed?: string; saveName?: string } = {}): Promise<GameShell> {
  const world = createWorld(options.seed);
  const save = await IndexedDbSave.open<WorldState>({
    name: options.saveName ?? 'muhur-vadisi', initial: () => newGame(world),
    // A v1 record is upgraded in place before validation; the original is kept as a backup.
    migrate: migrateWorldState,
    validate: (value) => validateWorldState(world, value),
  });
  const session = await GameSession.open({ world, save, sessionId: crypto.randomUUID(), viewportWidth: () => window.innerWidth });
  const core = createRenderCore(host);
  gradeLighting(core.scene);
  core.renderer.domElement.tabIndex = 0;
  core.renderer.domElement.setAttribute('aria-label', 'Mühür Vadisi dünyası');
  const registry = new ResourceRegistry();
  // Terrain and decor are generated off the main thread when the browser allows it.
  const terrainWorker = createTerrainWorker();
  const chunks = new ChunkRenderer(world, core.scene, registry, { build: terrainWorker.build });
  // One atlas, one material: every creature, egg and resource sprite is drawn from it.
  const spriteAtlas = new SpriteAtlas();
  // One pooled cloud for every burst in the world.
  const sparks = new ParticleField(core.scene);
  const entities = new EntityLayer(core.scene, registry, {
    texture: spriteTextures(), atlas: { texture: spriteAtlas.texture, layout: spriteAtlas.layout },
    reducedMotion: () => motionReduced(),
  });
  const player = playerProxy(registry);
  core.scene.add(player);
  const campProps = createCampProps(registry, world.camp);
  core.scene.add(campProps.group);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  // The saved preference wins over the system setting only when the player turned it on.
  let motionPreference = loadPreferences().reducedMotion;
  const motionReduced = () => motionPreference || reducedMotion.matches;
  const layer = document.createElement('div');
  layer.className = 'mv-layer';
  host.append(layer);
  const send = (intent: CommandIntent) => session.dispatch(intent);
  let holdTarget: string | null = null;
  let holdStart = 0;
  /**
   * One door for every world action. A resource that wants digging or a creature's nose becomes a
   * `gather` intent, and a vein with no pick waits for the Enter key to be held for three seconds.
   */
  const route = async (intent: CommandIntent): Promise<void> => {
    if (intent.type !== 'interact') return send(intent);
    const node = session.gatherPlan(intent.entityId);
    if (!node || node.method === 'pick') return send(intent);
    // A standing tree is felled, not collected, and only a clawed team can do it.
    if (node.method === 'fell') return send({ type: 'fell', entityId: intent.entityId });
    if (node.method === 'dig' && !session.canDigNow()) {
      holdTarget = intent.entityId;
      holdStart = performance.now();
      return;
    }
    return send({ type: 'gather', entityId: intent.entityId, method: node.method });
  };
  const finishHold = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || !holdTarget) return;
    const entityId = holdTarget;
    holdTarget = null;
    session.holdTicks = Math.round((performance.now() - holdStart) / 1000 * 60);
    void send({ type: 'gather', entityId, method: 'dig' });
  };
  window.addEventListener('keyup', finishHold);
  const audio = new GameAudio();
  // One DOM layer for every floating number the battle shows.
  const damage = new DamageNumberLayer(layer);
  const hud = new HudView(layer, {
    onToggleSound: () => audio.toggle(),
    onTogglePause: () => session.togglePause(),
    onExportSave: () => void exportSave(),
    onOpenSettings: () => void send({ type: 'open-panel', panel: 'settings' }),
  });
  // v3: the player's own card sits above the health panel in the corner.
  const profile = new ProfileCard(layer, { onRename: (name) => send({ type: 'rename', name }) });
  // v2: the bag, alchemy, camp, notebook and objectives live in the bottom-centre bar.
  const tabs = new TabBarView(hud.dock, { send: (intent) => void send(intent) });
  /** Every tab now has a panel behind it. */
  const UNBUILT_PANELS: PanelId[] = [];
  // The six travelling creatures sit under the tabs; clicking or 1–6 sends them out.
  const party = new PartyBarView(hud.dock, { send: (intent) => void send(intent) });
  hud.setSound(!audio.muted);
  /** Fulfils the promise in every storage error message: the raw record can always be taken out. */
  async function exportSave(): Promise<void> {
    await session.checkpoint().catch(() => undefined);
    const raw = await save.exportRaw();
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), seed: world.seed, ...raw }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `muhur-vadisi-kayit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  const atlas = new MinimapAtlas(world);
  const dial = new MinimapDial(layer, { atlas: () => atlas.current(session.position, session.discovery) });
  const card = new EncounterCardView(layer, { onIntent: (intent) => void route(intent) });
  const battle = new BattlePage(layer, { send });
  const reward = new RewardPanel(layer, { onDismiss: () => session.dismissReward() });
  const settings = new SettingsPanel(layer, {
    onClose: () => void send({ type: 'close-panel' }),
    onChange: (preferences) => {
      audio.setVolume(preferences.volume);
      hud.setSound(!audio.muted);
      motionPreference = preferences.reducedMotion;
    },
  });
  const panels: Record<PanelName, InventoryPanel | AlchemyPanel | CampPanel | BestiaryPanel | ObjectivesPanel | SettingsPanel> = {
    inventory: new InventoryPanel(layer, { onClose: () => void send({ type: 'close-panel' }) }),
    alchemy: new AlchemyPanel(layer, { onClose: () => void send({ type: 'close-panel' }), send }),
    camp: new CampPanel(layer, {
      onClose: () => void send({ type: 'close-panel' }), send,
      onHatch: (eggId) => session.hatch(eggId), onClaim: () => session.claimDelivery(),
      garden: () => session.gardenView(), onPlant: (itemId) => session.plant(itemId), onHarvest: () => session.harvest(),
      travel: () => session.view().travel, onTravel: (anchorId) => send({ type: 'travel', anchorId }),
    }),
    bestiary: new BestiaryPanel(layer, { onClose: () => void send({ type: 'close-panel' }), send }),
    objectives: new ObjectivesPanel(layer, { onClose: () => void send({ type: 'close-panel' }) }),
    settings,
  };
  const recovery = document.createElement('div');
  recovery.className = 'mv-recovery';
  recovery.hidden = true;
  const recoveryText = document.createElement('p');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Kaydı tekrar dene';
  retry.addEventListener('click', () => void session.retry());
  recovery.append(recoveryText, retry);
  layer.append(recovery);
  // Inert in a production build: both modules compile away with import.meta.env.DEV/MODE.
  const removeBridge = installTestBridge(session, world, () => shell.dispose());
  const telemetry = new Telemetry();
  const removeTelemetry = installTelemetry(telemetry, () => ({
    position: { ...session.view().position }, mode: session.state.mode,
    biome: session.view().hud.biome.label, chunks: chunks.stats,
    resources: registry.counts(), seed: world.seed,
  }));
  // Browsers only allow audio to start from a real gesture, so the first input unlocks it.
  const unlock = () => { audio.unlock(); hud.setSound(!audio.muted); };
  host.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  const sessionInputId = crypto.randomUUID();
  const input = new KeyboardInput(window, document, () => document.hidden, sessionInputId);
  // One pad for touch screens; it shares the keyboard's command shape and owner rule.
  const touch = new TouchControls(layer, { sessionId: sessionInputId, enabled: () => navigator.maxTouchPoints > 0 });
  const clock = new FixedStepClock();
  let disposed = false;
  let lastFrame = 0;
  let mountedChunks = '';
  let loading = false;
  let openPanel: PanelName | null = null;
  let announced: string | null = null;
  let battleTurn = 0;
  let soundedPanel: PanelName | null = null;
  let warned = false;
  // The record only gets a new identity when a transaction commits, so panels and the battle page
  // rebuild their lists then — never every frame, which would detach buttons under the pointer.
  let renderedState: WorldState | null = null;
  const keys = (event: KeyboardEvent) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.isContentEditable) return;
    const owner = battle.root.hidden ? (session.openPanel ? 'panel' : 'world') : 'battle';
    if (event.key.toLowerCase() === 'r' && owner === 'world') {
      event.preventDefault();
      void session.toggleRide();
      return;
    }
    if (event.key.toLowerCase() === 'p' && owner === 'world') {
      event.preventDefault();
      session.togglePause();
      return;
    }
    // Standing at a shrine with nothing else in reach: Enter reads the marks.
    if (event.key === 'Enter' && owner === 'world' && !session.view().card) {
      const shrine = session.nearbyShrine();
      if (shrine) { event.preventDefault(); void send({ type: 'visit-shrine', shrineId: shrine.id }); return; }
    }
    const intent = panelIntentForKey(event.key, owner, session.openPanel);
    if (!intent) return;
    event.preventDefault();
    void send(intent);
  };
  window.addEventListener('keydown', keys);
  const persist = () => void session.checkpoint();
  document.addEventListener('visibilitychange', persist);
  window.addEventListener('pagehide', persist);

  let queryMs = 0;
  function draw(alpha: number, delta: number, snap: boolean): void {
    const queryStart = performance.now();
    const view = session.view();
    queryMs = performance.now() - queryStart;
    const height = sampleTerrain(world, view.position).height;
    applyPlayerPose(player, view.position, height, view.yaw);
    core.followCamera.follow(view.position, height, delta, snap);
    const ids = view.chunks.map((chunk) => chunk.id).join('|');
    if (ids !== mountedChunks && !loading) {
      mountedChunks = ids;
      loading = true;
      void chunks.setVisible(view.chunks, chunkAt(view.position)).finally(() => { loading = false; });
    }
    const frame = {
      tick: 0, playerId: 'player', visibleChunkIds: view.chunks.map((chunk) => chunk.id),
      entities: worldEntities(),
    };
    entities.sync(frame);
    entities.draw(frame, alpha);
    hud.update({ ...view.hud, message: view.hud.message ?? view.hint });
    dial.update(view.minimap);
    card.update(view.card);
    const changed = renderedState !== session.state;
    if (changed || !view.battle !== !battle.root.hidden) battle.update(view.battle);
    reward.update(view.reward);
    const outcome = view.adapter.lastOutcome;
    if (view.reward && outcome !== announced) {
      announced = outcome;
      audio.play(outcome === 'captured' ? 'capture' : outcome === 'lost' || outcome === 'fled' ? 'fail' : 'collect');
      const at = { x: view.position.x, y: sampleTerrain(world, view.position).height + 1.2, z: view.position.z };
      sparks.emit(outcome === 'captured' ? 'seal' : outcome === 'won' ? 'levelup' : 'gather', at, 18);
    }
    if (!view.reward) announced = null;
    if (view.battle && view.battle.turn !== battleTurn) {
      battleTurn = view.battle.turn;
      audio.play('hit');
      // The last committed receipt is the only source for what the number says.
      for (const event of lastEvents()) {
        if (event.type === 'attack' && event.hit && event.damage) {
          damage.show(damageNumber({ amount: event.damage, x: event.side === 'player' ? 66 : 34, y: event.side === 'player' ? 26 : 58, reducedMotion: motionReduced() }));
        } else if (event.type === 'attack' && !event.hit) {
          damage.show(damageNumber({ tone: 'miss', x: event.side === 'player' ? 66 : 34, y: event.side === 'player' ? 26 : 58, reducedMotion: motionReduced() }));
        } else if (event.type === 'mend' || event.type === 'item') {
          damage.show(damageNumber({ amount: event.heal ?? 0, tone: 'heal', x: 34, y: 58, reducedMotion: motionReduced() }));
        } else if (event.type === 'status' && event.hit) {
          damage.show(damageNumber({ tone: 'status', text: event.status ?? '', x: event.side === 'player' ? 34 : 66, y: 44, reducedMotion: motionReduced() }));
        }
      }
    }
    if (!view.battle) battleTurn = 0;
    if (view.panel !== soundedPanel) { soundedPanel = view.panel; if (view.panel) audio.play('panel'); }
    if (view.adapter.pending?.trigger === 'hostile' && !warned) { warned = true; audio.play('encounter'); }
    if (!view.adapter.pending) warned = false;
    party.update(session.state, { battle: session.state.battle });
    if (changed) profile.update(session.state);
    tabs.update(view.panel, !!view.battle || view.adapter.state.mode === 'committing' || view.adapter.state.mode === 'recovery', UNBUILT_PANELS);
    if (openPanel !== view.panel) {
      if (openPanel) panels[openPanel].close();
      openPanel = view.panel;
      if (openPanel) panels[openPanel].open(document.activeElement as HTMLElement | null);
    }
    if (changed) {
      renderedState = session.state;
      panels.inventory.update(session.state);
      panels.alchemy.update(session.state);
      panels.camp.update(session.state);
      panels.bestiary.update(session.state);
      panels.objectives.update(session.state);
    }
    const failure = view.adapter.state.mode === 'recovery' ? view.adapter.error : null;
    recovery.hidden = !failure;
    recoveryText.textContent = failure ?? '';
    const owner = view.battle ? 'battle' : view.panel ? 'panel' : view.movementAllowed ? 'world' : 'none';
    input.setOwner(owner);
    touch.setOwner(owner);
    campProps.update(elapsed, motionReduced());
    // Light, fog and shadows come from the save's own clock, never from wall time.
    applySky({ scene: core.scene, hemisphere: core.hemisphere, sun: core.sun, setShadows: core.setShadows }, skySetting(session.dayTick));
    sparks.update(delta, motionReduced());
    core.render();
  }
  /** Events of the receipt that closed the last turn, in order. */
  function lastEvents(): readonly BattleEvent[] {
    const record = session.state.battle;
    if (!record) return [];
    const receipts = Object.values(record.committedActions);
    return receipts.at(-1)?.events ?? [];
  }
  function worldEntities(): RenderEntity[] {
    const nearby = session.visibleEntities();
    return nearby.map((target) => ({
      id: target.entityId, position: target.position, height: sampleTerrain(world, target.position).height + 0.8,
      yaw: 0, visualId: target.spriteId, kind: target.kind === 'creature' ? 'creature' : target.kind === 'egg' ? 'egg' : 'resource',
      // A wild creature already wears its training: level 5 and 10 grow the silhouette.
      stage: target.kind === 'creature' ? cosmeticStage(target.level) : 0,
    }));
  }
  let tick = 0;
  let elapsed = 0;
  function frame(time: number): void {
    if (disposed) return;
    const delta = lastFrame ? (time - lastFrame) / 1000 : 0;
    lastFrame = time;
    elapsed += Math.min(delta, GAME_CONFIG.maxFrameDelta);
    const paused = document.hidden;
    const simStart = performance.now();
    // The keyboard wins a tie; the pad only speaks when no key is held, so one tick is one move.
    const { alpha, steps } = clock.advance(delta, () => { const step = ++tick; session.step({ move: input.movement(step) ?? touch.stick.movement(step), paused }); }, paused);
    const simMs = performance.now() - simStart;
    const drawStart = performance.now();
    draw(alpha, Math.min(delta, GAME_CONFIG.maxFrameDelta), tick < 3);
    const drawMs = performance.now() - drawStart;
    if (delta > 0) {
      const info = core.renderer.info;
      telemetry.record({
        frameMs: delta * 1000, simMs, queryMs, drawMs, steps,
        counters: { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0 },
      });
    }
    core.renderer.setAnimationLoop(frame);
  }
  core.renderer.setAnimationLoop(frame);
  const shell: GameShell = {
    async dispose() {
      if (disposed) return;
      disposed = true;
      core.renderer.setAnimationLoop(null);
      window.removeEventListener('keydown', keys);
      window.removeEventListener('keyup', finishHold);
      document.removeEventListener('visibilitychange', persist);
      window.removeEventListener('pagehide', persist);
      removeBridge();
      removeTelemetry();
      host.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      audio.dispose();
      input.dispose();
      for (const panel of Object.values(panels)) panel.dispose();
      reward.dispose(); battle.dispose(); card.dispose(); dial.dispose(); party.dispose(); tabs.dispose(); hud.dispose(); atlas.dispose();
      settings.dispose(); spriteAtlas.dispose(); sparks.dispose(); damage.dispose(); terrainWorker.dispose(); touch.dispose(); profile.dispose();
      layer.remove();
      entities.dispose(); chunks.dispose(); campProps.dispose();
      core.scene.remove(player);
      registry.disposeAll();
      core.dispose();
      try { await session.dispose(); } catch (error) { if (!(error instanceof SaveError)) throw error; }
      save.close();
    },
  };
  return shell;
}
