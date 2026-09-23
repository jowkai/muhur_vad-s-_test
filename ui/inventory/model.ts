import { itemById, items } from '../../content/catalog';
import { itemAssets } from '../../content/asset-manifest';
import type { ContentState } from '../../content/alchemy';
import { BIOME_LABEL } from '../hud/labels';

export const INVENTORY_COLUMNS = 6;
export type InventoryFilter = 'all' | 'material' | 'effect';
export interface InventoryCell {
  readonly index: number; readonly row: number; readonly column: number;
  readonly itemId: string | null; readonly name: string; readonly quantity: number;
  readonly stackLimit: number; readonly full: boolean; readonly iconUrl: string;
  readonly rarity: string | null; readonly origin: string | null; readonly matches: boolean;
}
export interface InventoryTooltip {
  readonly itemId: string; readonly name: string; readonly quantity: number;
  readonly rarity: string; readonly origin: string; readonly effect: string | null;
}
export interface InventoryView {
  readonly columns: number; readonly cells: readonly InventoryCell[];
  readonly used: number; readonly capacity: number; readonly full: boolean;
  readonly filter: InventoryFilter; readonly selected: InventoryTooltip | null; readonly summary: string;
}
const RARITY_LABEL: Record<string, string> = { common: 'Sık', uncommon: 'Seyrek', rare: 'Ender' };
const CONTEXT_LABEL: Record<string, string> = { camp: 'Kampta kullanılır', battle: 'Savaşta kullanılır', world: 'Yanında taşınır' };
const CLASS_LABEL: Record<string, string> = {
  plant: 'Bitki', mineral: 'Mineral', gem: 'Değerli taş', part: 'Yaratık parçası', essence: 'Esans', wood: 'Odun',
};
const EFFECT_LABEL: Record<string, (value: number | null) => string> = {
  heal: (value) => `${value} can yeniler`,
  heal_full: () => 'Canı tamamen yeniler',
  revive_fraction: (value) => `Baygın yaratığı %${Math.round((value ?? 0) * 100)} canla uyandırır`,
  grant_heat_herb: (value) => `${value} Isı Otu verir`,
  capture_consumable: (value) => value ? `Yakalama şansını %${Math.round(value * 100)} artırır` : 'Yakalama denemesinde harcanır',
  grant_xp: (value) => `${value} tecrübe kazandırır`,
  tool: () => 'Dünyada yol açar',
  speed: (value) => `Hızı ×${value} yapar`,
  graft: () => 'Bir yaratığa yeni bir hareket aşılar',
};
export function effectText(itemId: string): string | null {
  const effect = itemById(itemId)?.effect;
  if (!effect) return null;
  return `${EFFECT_LABEL[effect.kind](effect.value as number | null)} · ${CONTEXT_LABEL[effect.context]}`;
}
const originOf = (itemId: string) => {
  const item = itemById(itemId);
  if (!item) return null;
  // A material says where it came from and what it is made of; a product says it was brewed.
  if ('itemClass' in item && item.biomeId) return `${BIOME_LABEL[item.biomeId]} · ${CLASS_LABEL[item.itemClass] ?? 'Materyal'}`;
  return item.effect ? 'Simya ürünü' : null;
};
/** Grid projection of the saved inventory. Filters and sorting never rewrite the record. */
export function inventoryView(state: Pick<ContentState, 'inventory'>, options: { filter?: InventoryFilter; selectedIndex?: number | null } = {}): InventoryView {
  const filter = options.filter ?? 'all';
  const cells = state.inventory.map((stack, index): InventoryCell => {
    const item = stack ? itemById(stack.itemId) : null;
    const kind: InventoryFilter = item?.effect ? 'effect' : 'material';
    return Object.freeze({
      index, row: Math.floor(index / INVENTORY_COLUMNS), column: index % INVENTORY_COLUMNS,
      itemId: stack?.itemId ?? null, name: item?.name ?? '', quantity: stack?.quantity ?? 0,
      stackLimit: item?.stackLimit ?? 0, full: !!item && !!stack && stack.quantity >= item.stackLimit,
      iconUrl: stack ? itemAssets[stack.itemId as keyof typeof itemAssets] ?? '' : '',
      rarity: item ? RARITY_LABEL[item.rarity] : null, origin: stack ? originOf(stack.itemId) : null,
      matches: !stack ? filter === 'all' : filter === 'all' || filter === kind,
    });
  });
  const chosen = options.selectedIndex ?? null;
  const cell = chosen === null ? null : cells[chosen] ?? null;
  const used = cells.filter((entry) => entry.itemId).length;
  return Object.freeze({
    columns: INVENTORY_COLUMNS, cells: Object.freeze(cells), used, capacity: cells.length,
    full: used >= cells.length, filter,
    selected: cell?.itemId ? Object.freeze({
      itemId: cell.itemId, name: cell.name, quantity: cell.quantity,
      rarity: cell.rarity!, origin: cell.origin ?? '—', effect: effectText(cell.itemId),
    }) : null,
    summary: `${used}/${cells.length} yuva dolu`,
  });
}
/** Arrow-key movement across the 6-column grid; edges hold instead of wrapping. */
export function moveSelection(index: number, key: string, size: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= size) throw new RangeError('Geçersiz yuva.');
  const row = Math.floor(index / INVENTORY_COLUMNS), column = index % INVENTORY_COLUMNS;
  switch (key) {
    case 'ArrowRight': return column === INVENTORY_COLUMNS - 1 || index + 1 >= size ? index : index + 1;
    case 'ArrowLeft': return column === 0 ? index : index - 1;
    case 'ArrowDown': return index + INVENTORY_COLUMNS >= size ? index : index + INVENTORY_COLUMNS;
    case 'ArrowUp': return row === 0 ? index : index - INVENTORY_COLUMNS;
    case 'Home': return row * INVENTORY_COLUMNS;
    case 'End': return Math.min(size - 1, row * INVENTORY_COLUMNS + INVENTORY_COLUMNS - 1);
    default: return index;
  }
}
export const ALL_ITEM_IDS: readonly string[] = Object.freeze(items.map((item) => item.id));
