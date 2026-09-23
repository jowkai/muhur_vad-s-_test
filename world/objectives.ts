import { BIOME_IDS, PARTY_LIMIT } from '../contracts';
import { GAME_CONFIG } from '../config';
import { BIOME_RECIPE } from '../content/secrets';
import type { WorldState } from './persistence/world-save';

export type ObjectiveId =
  | 'first-shrine' | 'all-shrines' | 'all-recipes' | 'full-party'
  | 'sealed-species' | 'hatched-egg' | 'veteran-level' | 'mapped-valley';

/**
 * Objectives are rows, not code paths: a title, a hint, a target and a pure selector over the
 * save. Nothing here keeps a quest state of its own, so a reload can never lose progress and a
 * finished objective can never be undone — every field it reads only ever grows.
 */
export interface ObjectiveDefinition {
  readonly id: ObjectiveId; readonly title: string; readonly hint: string;
  readonly target: number; readonly unit: string;
  readonly progress: (state: WorldState) => number;
}
export interface ObjectiveView {
  readonly id: ObjectiveId; readonly title: string; readonly hint: string;
  readonly value: number; readonly target: number; readonly unit: string;
  readonly ratio: number; readonly done: boolean;
}
const CELLS = (GAME_CONFIG.worldSize / GAME_CONFIG.cellSize) ** 2;
export const MAPPED_SHARE = .25;
const capturedIds = (state: WorldState) => state.creatures.filter((creature) => creature.id.startsWith('capture:'));
const distinct = (ids: readonly string[]) => new Set(ids).size;

export const OBJECTIVES: readonly ObjectiveDefinition[] = Object.freeze([
  Object.freeze({
    id: 'first-shrine', title: 'İlk bahçıvan tapınağı', hint: 'Bir bölgenin tapınağını bul ve işaretleri oku.',
    target: 1, unit: 'tapınak', progress: (s: WorldState) => s.shrines.length,
  }),
  Object.freeze({
    id: 'all-shrines', title: 'Sekiz tapınağın hepsi', hint: 'Her bölgenin tapınağını ziyaret et.',
    target: BIOME_IDS.length, unit: 'tapınak', progress: (s: WorldState) => s.shrines.length,
  }),
  Object.freeze({
    id: 'all-recipes', title: 'Bütün tarifler', hint: 'Tapınaklar bölge tariflerini öğretir.',
    target: Object.keys(BIOME_RECIPE).length, unit: 'tarif',
    progress: (s: WorldState) => distinct(s.unlockedRecipeIds),
  }),
  Object.freeze({
    id: 'full-party', title: 'Altı yuva dolu', hint: 'Yanında altı yaratıkla gez.',
    target: PARTY_LIMIT, unit: 'yaratık', progress: (s: WorldState) => Math.min(PARTY_LIMIT, s.party.length),
  }),
  Object.freeze({
    id: 'sealed-species', title: 'Sekiz tür mühürlendi', hint: 'Farklı türleri savaşta yakala.',
    target: 8, unit: 'tür',
    progress: (s: WorldState) => distinct(capturedIds(s).map((creature) => creature.speciesId)),
  }),
  Object.freeze({
    id: 'hatched-egg', title: 'İlk yumurta çatladı', hint: 'Yumurtayı kampta beklet ve aç.',
    target: 1, unit: 'yumurta',
    progress: (s: WorldState) => s.creatures.filter((creature) => creature.id.startsWith('egg:')).length,
  }),
  Object.freeze({
    id: 'veteran-level', title: 'Onuncu seviye', hint: 'Bir yaratığı savaş ve tonikle eğit.',
    target: 10, unit: 'seviye',
    progress: (s: WorldState) => s.creatures.reduce((best, creature) => Math.max(best, creature.level), 0),
  }),
  Object.freeze({
    id: 'mapped-valley', title: 'Vadinin dörtte biri', hint: 'Haritanın dörtte birini keşfet.',
    target: Math.round(CELLS * MAPPED_SHARE), unit: 'hücre', progress: (s: WorldState) => s.discoveredCells.length,
  }),
]);

export function objectiveList(state: WorldState): readonly ObjectiveView[] {
  return Object.freeze(OBJECTIVES.map((objective) => {
    const value = Math.max(0, Math.min(objective.target, Math.floor(objective.progress(state))));
    return Object.freeze({
      id: objective.id, title: objective.title, hint: objective.hint, unit: objective.unit,
      value, target: objective.target, ratio: objective.target > 0 ? value / objective.target : 0,
      done: value >= objective.target,
    });
  }));
}
/** Share of the eight objectives that are finished, 0–1. */
export function objectiveProgress(state: WorldState): number {
  const list = objectiveList(state);
  return list.filter((objective) => objective.done).length / list.length;
}
export function objectiveById(state: WorldState, id: ObjectiveId): ObjectiveView {
  return objectiveList(state).find((objective) => objective.id === id)!;
}
