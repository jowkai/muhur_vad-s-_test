import type { GameEvent, GameState, InputOwner } from '../contracts';

export function inputOwner(state: GameState, hidden = false): InputOwner {
  if (hidden) return 'none';
  switch (state.mode) {
    case 'exploring': return 'world';
    case 'panel': return 'panel';
    case 'battle': return 'battle';
    default: return 'none';
  }
}
/** Invalid or stale events preserve the exact state and its encounter lock. */
export function transition(state: GameState, event: GameEvent): GameState {
  switch (state.mode) {
    case 'boot': return event.type === 'loaded' ? { mode: 'exploring' } : state;
    case 'exploring':
      if (event.type === 'open-panel') return { mode: 'panel', panel: event.panel };
      if (event.type === 'encounter' && event.encounterId.trim()) return { mode: 'encounter', encounterId: event.encounterId };
      return state;
    case 'panel': return event.type === 'close-panel' ? { mode: 'exploring' } : state;
    case 'encounter':
      return event.type === 'start-battle' && event.encounterId === state.encounterId && event.battleId.trim()
        ? { mode: 'battle', battleId: event.battleId, encounterId: state.encounterId } : state;
    case 'battle':
      return event.type === 'commit' && event.battleId === state.battleId && event.transactionId.trim()
        ? { ...state, mode: 'committing', transactionId: event.transactionId } : state;
    case 'committing':
      if (event.type === 'committed' && event.transactionId === state.transactionId) return { mode: 'exploring' };
      if (event.type === 'commit-failed' && event.transactionId === state.transactionId) return { ...state, mode: 'recovery', error: event.error };
      return state;
    case 'recovery':
      return event.type === 'retry'
        ? { mode: 'committing', transactionId: state.transactionId, battleId: state.battleId, encounterId: state.encounterId } : state;
  }
}
