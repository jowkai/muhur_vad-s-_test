import { objectiveList, objectiveProgress, type ObjectiveView } from '../../world/objectives';
import type { WorldState } from '../../world/persistence/world-save';

export interface ObjectiveRow extends ObjectiveView {
  readonly percent: number; readonly progressText: string; readonly status: 'done' | 'open';
}
export interface ObjectivesPanelView {
  readonly open: readonly ObjectiveRow[]; readonly done: readonly ObjectiveRow[];
  readonly completed: number; readonly total: number;
  readonly ratio: number; readonly summary: string;
}
/**
 * Two lists, one derived from the save: what is still open and what is finished. Rows keep the
 * objective's own numbers, so the panel never invents progress of its own.
 */
export function objectivesPanelView(state: WorldState): ObjectivesPanelView {
  const rows = objectiveList(state).map((objective): ObjectiveRow => Object.freeze({
    ...objective,
    percent: Math.round(objective.ratio * 100),
    progressText: `${objective.value}/${objective.target} ${objective.unit}`,
    status: objective.done ? 'done' : 'open',
  }));
  const done = rows.filter((row) => row.status === 'done');
  const open = rows.filter((row) => row.status === 'open');
  return Object.freeze({
    open: Object.freeze(open), done: Object.freeze(done),
    completed: done.length, total: rows.length, ratio: objectiveProgress(state),
    summary: `${done.length}/${rows.length} hedef tamamlandı`,
  });
}
