import { DEFAULT_PLAYER_NAME, PLAYER_NAME_LIMIT } from '../../contracts';
import { GAME_CONFIG } from '../../config';
import { creatures as allSpecies } from '../../content/catalog';
import { objectiveProgress } from '../../world/objectives';
import { validPlayerName, type WorldState } from '../../world/persistence/world-save';

export interface ProfileStat { readonly id: string; readonly label: string; readonly value: string }
export interface ProfileView {
  readonly name: string; readonly title: string; readonly rank: number;
  readonly stats: readonly ProfileStat[];
  readonly progress: number; readonly progressText: string;
  readonly editHint: string; readonly nameLimit: number;
}
/** Titles are earned, never chosen: each one needs one more thing done in the valley. */
export const TITLES: readonly { readonly title: string; readonly needs: (state: WorldState) => boolean }[] = Object.freeze([
  Object.freeze({ title: 'Vadi Çırağı', needs: () => true }),
  Object.freeze({ title: 'İz Sürücü', needs: (state: WorldState) => state.creatures.length >= 3 }),
  Object.freeze({ title: 'Bahçıvan Öğrencisi', needs: (state: WorldState) => state.shrines.length >= 1 }),
  Object.freeze({ title: 'Mühürdar', needs: (state: WorldState) => state.creatures.filter((creature) => creature.id.startsWith('capture:')).length >= 5 }),
  Object.freeze({ title: 'Simya Kâtibi', needs: (state: WorldState) => state.unlockedRecipeIds.length >= 8 }),
  Object.freeze({ title: 'Tapınak Gezgini', needs: (state: WorldState) => state.shrines.length >= 4 }),
  Object.freeze({ title: 'Vadi Ustası', needs: (state: WorldState) => state.shrines.length >= 8 && state.creatures.some((creature) => creature.level >= 30) }),
]);
export function titleFor(state: WorldState): { title: string; rank: number } {
  let rank = 0;
  TITLES.forEach((entry, index) => { if (entry.needs(state)) rank = index; });
  return { title: TITLES[rank].title, rank };
}
const minutes = (ticks: number) => Math.floor(ticks * GAME_CONFIG.fixedStep / 60);
export function playtimeText(ticks: number): string {
  const total = minutes(ticks);
  return total >= 60 ? `${Math.floor(total / 60)} sa ${total % 60} dk` : `${total} dk`;
}
/**
 * The card in the corner: who the player is, what they have earned and how far the valley has
 * opened for them. Read-only — renaming goes through the domain like every other change.
 */
export function profileView(state: WorldState): ProfileView {
  const { title, rank } = titleFor(state);
  const species = new Set(state.creatures.map((creature) => creature.speciesId));
  const best = state.creatures.reduce((top, creature) => Math.max(top, creature.level), 0);
  const progress = objectiveProgress(state);
  return Object.freeze({
    name: validPlayerName(state.playerName) ? state.playerName : DEFAULT_PLAYER_NAME,
    title, rank,
    stats: Object.freeze([
      Object.freeze({ id: 'species', label: 'Tür', value: `${species.size}/${allSpecies.length}` }),
      Object.freeze({ id: 'creatures', label: 'Yaratık', value: `${state.creatures.length}` }),
      Object.freeze({ id: 'level', label: 'En yüksek', value: best ? `Sv ${best}` : '—' }),
      Object.freeze({ id: 'shrines', label: 'Tapınak', value: `${state.shrines.length}/8` }),
      Object.freeze({ id: 'time', label: 'Süre', value: playtimeText(state.worldTick) }),
    ]),
    progress, progressText: `Hedefler %${Math.round(progress * 100)}`,
    editHint: 'Adını değiştirmek için dokun', nameLimit: PLAYER_NAME_LIMIT,
  });
}
/** Why a typed name is refused, or null when it may be saved. */
export function renameRefusal(name: string): string | null {
  if (typeof name !== 'string' || !name.trim()) return 'Bir ad yaz';
  if (name.trim().length > PLAYER_NAME_LIMIT) return `En çok ${PLAYER_NAME_LIMIT} karakter`;
  if (!validPlayerName(name.trim())) return 'Bu ad kullanılamaz';
  return null;
}
/** What the domain should store for what the player typed. */
export const normalizeName = (name: string): string => name.trim().slice(0, PLAYER_NAME_LIMIT);
