import type { WorldState } from '../../world/persistence/world-save';

export type SlotId = 'a' | 'b' | 'c';
export const SLOT_IDS: readonly SlotId[] = Object.freeze(['a', 'b', 'c']);
export const SLOT_LABEL: Readonly<Record<SlotId, string>> = Object.freeze({ a: '1. Yuva', b: '2. Yuva', c: '3. Yuva' });
export const BASE_DB_NAME = 'muhur-vadisi';
/** Slot one keeps the original database name, so an existing save is never orphaned. */
export const dbNameFor = (slot: SlotId) => slot === 'a' ? BASE_DB_NAME : `${BASE_DB_NAME}-${slot}`;
export const SLOT_KEY = 'muhur-vadisi:slot';

export type SlotStatus = 'empty' | 'ready' | 'corrupt';
export interface SlotRecord {
  readonly slot: SlotId; readonly status: SlotStatus;
  readonly state?: WorldState | null; readonly error?: string | null;
}
export interface SlotView {
  readonly slot: SlotId; readonly label: string; readonly dbName: string; readonly status: SlotStatus;
  readonly summary: string; readonly canContinue: boolean; readonly canExport: boolean; readonly canStart: boolean;
}
const summaryOf = (record: SlotRecord): string => {
  if (record.status === 'corrupt') return record.error ?? 'Kayıt okunamadı';
  if (record.status === 'empty' || !record.state) return 'Boş — yeni oyun';
  const state = record.state;
  const best = state.creatures.reduce((top, creature) => Math.max(top, creature.level), 0);
  const minutes = Math.floor(state.worldTick / 60 / 60);
  return `${state.creatures.length} yaratık · en yüksek Sv ${best} · ${minutes} dk · ${state.shrines.length}/8 tapınak`;
};
/**
 * Three slots the player can see before the world loads. A corrupt slot never blocks the others:
 * it offers the raw export and a fresh start instead.
 */
export function slotViews(records: readonly SlotRecord[]): readonly SlotView[] {
  return Object.freeze(SLOT_IDS.map((slot) => {
    const record = records.find((entry) => entry.slot === slot) ?? { slot, status: 'empty' as const };
    return Object.freeze({
      slot, label: SLOT_LABEL[slot], dbName: dbNameFor(slot), status: record.status,
      summary: summaryOf(record),
      canContinue: record.status === 'ready',
      canExport: record.status !== 'empty',
      canStart: record.status !== 'ready',
    });
  }));
}
export interface RecoveryView {
  readonly visible: boolean; readonly title: string; readonly message: string;
  readonly actions: readonly { readonly id: 'retry' | 'export' | 'new'; readonly label: string }[];
}
/** What the pre-boot screen says when a record cannot be read. */
export function recoveryView(error: string | null): RecoveryView {
  if (!error) return Object.freeze({ visible: false, title: '', message: '', actions: Object.freeze([]) });
  return Object.freeze({
    visible: true,
    title: 'Kayıt açılamadı',
    message: `${error} Ham kaydı dışa aktarabilir, sonra yeni bir oyuna başlayabilirsin; mevcut kayıt silinmez.`,
    actions: Object.freeze([
      Object.freeze({ id: 'retry' as const, label: 'Tekrar dene' }),
      Object.freeze({ id: 'export' as const, label: 'Ham kaydı indir' }),
      Object.freeze({ id: 'new' as const, label: 'Yeni oyun' }),
    ]),
  });
}
export function rememberSlot(slot: SlotId, storage?: { setItem(key: string, value: string): void } | null): boolean {
  try {
    const target = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
    if (!target) return false;
    target.setItem(SLOT_KEY, slot);
    return true;
  } catch { return false; }
}
export function rememberedSlot(storage?: { getItem(key: string): string | null } | null): SlotId {
  try {
    const target = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
    const value = target?.getItem(SLOT_KEY);
    return SLOT_IDS.includes(value as SlotId) ? value as SlotId : 'a';
  } catch { return 'a'; }
}
