import { LOADOUT_SIZE, PARTY_LIMIT } from './index';
import type { GameCommand, InputOwner } from './index';

export function commandOwner(command: GameCommand): InputOwner {
  switch (command.type) {
    case 'move': case 'interact': case 'open-panel': case 'gather': case 'visit-shrine': return 'world';
    case 'close-panel': case 'craft': case 'use-item': case 'set-active': case 'travel': return 'panel';
    case 'attack': case 'capture': case 'flee': case 'switch-party': case 'use-battle-item': return 'battle';
    case 'ride': case 'dismount': case 'fell': return 'world';
    case 'graft': case 'rename': case 'set-loadout': return 'panel';
  }
}
export type DispatchResult<T> = { accepted: true; value: T } | { accepted: false; reason: 'invalid' | 'owner' | 'id-conflict' };
function fingerprintOf(command: GameCommand): string {
  return JSON.stringify(command, (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    }
    return value;
  });
}
/** Session routing/deduplication only. Durable idempotency belongs to SavePort. */
export class CommandBus<T> {
  private readonly completed = new Map<string, { command: string; value: T }>();
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly owner: () => InputOwner, private readonly handle: (command: GameCommand) => Promise<T>) {}

  dispatch(command: GameCommand): Promise<DispatchResult<T>> {
    // Snapshot at submission so callers cannot mutate a queued intent.
    const snapshot = structuredClone(command);
    const run = this.queue.then(() => this.execute(snapshot));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async execute(command: GameCommand): Promise<DispatchResult<T>> {
    if (!command.commandId.trim() || !Number.isSafeInteger(command.tick) || command.tick < 0 ||
      (command.type === 'move' && (!Number.isFinite(command.direction.x) || !Number.isFinite(command.direction.z))) ||
      (command.type === 'attack' && ![0, 1, 2, 3].includes(command.slot)) ||
      (command.type === 'switch-party' && (!Number.isInteger(command.index) || command.index < 0 || command.index >= PARTY_LIMIT)) ||
      (command.type === 'use-battle-item' && !command.itemId.trim()) ||
      (command.type === 'set-loadout' && (!command.creatureId.trim() || command.moveIds.length !== LOADOUT_SIZE ||
        new Set(command.moveIds).size !== LOADOUT_SIZE ||
        command.moveIds.some((id) => typeof id !== 'string' || !id.trim())))) return { accepted: false, reason: 'invalid' };
    const fingerprint = fingerprintOf(command);
    const previous = this.completed.get(command.commandId);
    if (previous) return previous.command === fingerprint
      ? { accepted: true, value: structuredClone(previous.value) } : { accepted: false, reason: 'id-conflict' };
    if (commandOwner(command) !== this.owner()) return { accepted: false, reason: 'owner' };
    const value = await this.handle(command);
    this.completed.set(command.commandId, { command: fingerprint, value: structuredClone(value) });
    return { accepted: true, value };
  }
}
