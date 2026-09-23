import type { CommandIntent, PanelId } from '../../contracts';

/** The five things the bottom bar opens, in the order they appear on screen. */
export interface TabDefinition {
  readonly id: PanelId; readonly label: string; readonly key: string; readonly hint: string;
}
export const TABS: readonly TabDefinition[] = Object.freeze([
  Object.freeze({ id: 'inventory', label: 'Çanta', key: 'i', hint: 'Topladıkların' }),
  Object.freeze({ id: 'alchemy', label: 'Simya', key: 'c', hint: 'Tarifler ve üretim' }),
  Object.freeze({ id: 'camp', label: 'Kamp', key: 'k', hint: 'İyileştirme, kuluçka, bahçe' }),
  Object.freeze({ id: 'bestiary', label: 'Defter', key: 'b', hint: 'Görülen türler' }),
  Object.freeze({ id: 'objectives', label: 'Hedefler', key: 'o', hint: 'Sekiz hedef' }),
]);
/** Minimum touch target the bar and every control inside it must keep. */
export const TAB_TARGET_PX = 44;

export interface TabItem extends TabDefinition {
  readonly active: boolean; readonly enabled: boolean;
  readonly shortcut: string; readonly intent: CommandIntent;
}
/**
 * Pure projection of the bar: which tab is open, which are reachable and what each one sends.
 * The bar publishes intents like every other control; it never opens a panel by itself.
 */
export function tabItems(options: {
  readonly open: PanelId | null; readonly locked?: boolean; readonly unavailable?: readonly PanelId[];
} = { open: null }): readonly TabItem[] {
  return Object.freeze(TABS.map((tab) => Object.freeze({
    ...tab,
    active: options.open === tab.id,
    // A battle or a commit owns the input, so the bar greys out instead of stealing it.
    enabled: !options.locked && !options.unavailable?.includes(tab.id),
    shortcut: tab.key.toUpperCase(),
    intent: Object.freeze({ type: 'open-panel', panel: tab.id }) as CommandIntent,
  })));
}
/** The shortcut a key press maps to, or null when the key belongs to something else. */
export function tabForKey(key: string): TabDefinition | null {
  const lower = key.toLowerCase();
  return TABS.find((tab) => tab.key === lower) ?? null;
}
