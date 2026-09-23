import { BIOME_IDS, CREATURE_ROLES, type BiomeId, type CreatureRole } from '../contracts';

const ELEMENT_IDS = ['çim', 'su', 'kor', 'buz', 'taş', 'gölge', 'rüzgâr', 'ışık', 'kıvılcım'] as const;

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export const RARITIES: readonly Rarity[] = Object.freeze(['common', 'uncommon', 'rare', 'legendary']);
/**
 * Species passives. The catalogue owns the vocabulary; `src/game/combat/traits.ts` owns what
 * each one does in a fight, so content never carries a second combat formula.
 */
export const TRAIT_IDS = Object.freeze([
  'siperci', 'agir_zirh', 'inatci', 'element_emici',
  'berserk', 'sarjor', 'avci', 'yirtici_pence',
  'kor_zirhi', 'buz_kabuk', 'zehirli_deri', 'isik_halesi',
  'simbiyoz', 'suru', 'tohumcu', 'yanki',
  'gececi', 'gunesci', 'ruzgar_binici', 'kok_saldi',
  'tas_yurek', 'golge_avi', 'hizli_refleks', 'yankikalkan',
] as const);
export type TraitId = typeof TRAIT_IDS[number];
/** v4 spreads learning across twelve tiers, so a level stays meaningful past ten. */
export const UNLOCK_TIERS = Object.freeze([1, 3, 6, 10, 15, 20, 25, 30, 35, 40, 45, 50] as const);
export type UnlockLevel = typeof UNLOCK_TIERS[number];
/** Six moves per tier; across the twelve tiers that gives each of the nine elements eight. */
export const MOVES_PER_TIER = 6;
export type Element = 'çim' | 'su' | 'kor' | 'buz' | 'taş' | 'gölge' | 'rüzgâr' | 'ışık' | 'kıvılcım';
export type MoveEffect =
  | 'guard' | 'mend' | 'poison' | 'burn' | 'slow'
  | 'drain' | 'charge' | 'cleanse' | 'shield' | 'haste' | 'weaken' | 'bulwark';
export const MOVE_EFFECTS: readonly MoveEffect[] = Object.freeze([
  'guard', 'mend', 'poison', 'burn', 'slow',
  'drain', 'charge', 'cleanse', 'shield', 'haste', 'weaken', 'bulwark',
]);
/** Effects that make a move defensive: power 0, no attack dice, one per learn set. */
export const SUPPORT_EFFECTS: readonly MoveEffect[] =
  Object.freeze(['guard', 'mend', 'cleanse', 'shield', 'haste', 'bulwark', 'charge']);
export interface MoveDefinition {
  readonly id: string; readonly name: string;
  /** Typeless moves have no element and always resolve at neutral effectiveness. */
  readonly element: Element | null;
  readonly power: number; readonly accuracy: number; readonly cost: number;
  readonly unlockLevel: UnlockLevel; readonly effect?: MoveEffect;
}
export interface CreatureDefinition {
  readonly id: string; readonly name: string; readonly biomeId: BiomeId;
  readonly element: Element; readonly rarity: Rarity;
  readonly baseHp: number; readonly baseAtk: number; readonly baseDef: number;
  readonly visualBrief: string;
  /** v4: the species passive. One trait per species; several species share a trait. */
  readonly trait: TraitId;
  /**
   * v4 learn set: eight moves spread across the twelve tiers. The player equips four of them
   * at camp, so reaching a new tier is a real choice rather than a stat bump.
   */
  readonly moveIds: readonly string[];
  /** Which half of the ten minute day the species prefers to be out in. */
  readonly activity: 'day' | 'night' | 'any';
  /** v3: what the species can do for the player outside a fight; at most two roles. */
  readonly roles: readonly CreatureRole[];
  /** Silhouette class 1–3; the cosmetic stage grows it further. */
  readonly size: 1 | 2 | 3;
  /** Walking speed multiplier while this creature carries the player. */
  readonly baseSpeed: number;
}
/** What a material is made of; alchemy recipes read these classes, not item ids. */
export type ItemClass = 'plant' | 'mineral' | 'gem' | 'part' | 'essence' | 'wood';
export const ITEM_CLASSES: readonly ItemClass[] = Object.freeze(['plant', 'mineral', 'gem', 'part', 'essence', 'wood']);
export type ItemEffect =
  /** A salve works at camp or, as a v2 battle item, on the creature holding the field. */
  | { readonly kind: 'heal'; readonly value: number; readonly context: 'camp' | 'battle' }
  /** Training tonics hand a creature experience at the camp fire. */
  | { readonly kind: 'grant_xp'; readonly value: number; readonly context: 'camp' }
  /** Tools are carried, not consumed: they open ways in the world. */
  | { readonly kind: 'tool'; readonly value: null; readonly context: 'world' }
  /** A speed tonic; `value` is the multiplier it applies while it lasts. */
  | { readonly kind: 'speed'; readonly value: number; readonly context: 'world' }
  /** A graft teaches one catalogue move to one creature, permanently. */
  | { readonly kind: 'graft'; readonly value: null; readonly context: 'camp'; readonly moveId: string }
  | { readonly kind: 'grant_heat_herb'; readonly value: number; readonly context: 'camp' }
  | { readonly kind: 'revive_fraction'; readonly value: number; readonly context: 'camp' }
  | { readonly kind: 'heal_full'; readonly value: null; readonly context: 'camp' }
  /** Seal tiers: `value` is the capture bonus the tier adds, `null` for the plain seal. */
  | { readonly kind: 'capture_consumable'; readonly value: number | null; readonly context: 'battle' };
interface ItemBase { readonly id: string; readonly name: string; readonly rarity: Rarity; readonly stackLimit: number }
/**
 * v4 crafting tiers. Before this the bag had only two kinds of thing — a material you picked up
 * and a product you used — so every recipe was one flat step from the ground to a finished good.
 * A refined material and a component sit in between: they are crafted, they are not usable, and
 * they may feed another recipe. That is what gives the economy depth.
 */
export type CraftTier = 'refined' | 'component';
export const CRAFT_TIERS: readonly CraftTier[] = Object.freeze(['refined', 'component']);
export type ItemDefinition =
  /** Gathered from the world. */
  | (ItemBase & { readonly biomeId: BiomeId; readonly itemClass: ItemClass; readonly craftTier?: never; readonly effect?: never })
  /** Crafted, inert, and legal as another recipe's input. */
  | (ItemBase & { readonly craftTier: CraftTier; readonly itemClass: ItemClass; readonly biomeId?: never; readonly effect?: never })
  /** Crafted and usable; never an input, so a recipe graph can never loop. */
  | (ItemBase & { readonly effect: ItemEffect; readonly biomeId?: never; readonly craftTier?: never });
/** Stack ceilings by kind: gathered 99, intermediate 50, finished 20. */
export const STACK_LIMITS = Object.freeze({ material: 99, intermediate: 50, product: 20 });
export interface Ingredient { readonly itemId: string; readonly quantity: number }
export interface RecipeDefinition {
  readonly id: string; readonly inputs: readonly Ingredient[];
  readonly output: Ingredient; readonly enabledInMvp: true;
}
/** How the player comes to know a recipe. `parseCatalog` proves every recipe has a channel. */
export type UnlockChannel = 'start' | 'shrine' | 'material' | 'bestiary' | 'role' | 'milestone';
export const UNLOCK_CHANNELS: readonly UnlockChannel[] =
  Object.freeze(['start', 'shrine', 'material', 'bestiary', 'role', 'milestone']);
export interface Catalog {
  readonly schemaVersion: 3; readonly combatAuthority: 'COMBAT.md';
  readonly moves: readonly MoveDefinition[];
  readonly creatures: readonly CreatureDefinition[];
  readonly items: readonly ItemDefinition[];
  readonly recipes: readonly RecipeDefinition[];
}
export class CatalogError extends Error {
  constructor(readonly path: string, reason: string) { super(`${path}: ${reason}`); this.name = 'CatalogError'; }
}
function requireValue(condition: unknown, path: string, reason: string): asserts condition {
  if (!condition) throw new CatalogError(path, reason);
}
function object(value: unknown, path: string): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'nesne bekleniyor');
  return value as Record<string, unknown>;
}
function list(value: unknown, path: string): unknown[] {
  requireValue(Array.isArray(value), path, 'liste bekleniyor'); return value;
}
function text(value: unknown, path: string): asserts value is string {
  requireValue(typeof value === 'string' && value.trim().length > 0, path, 'boş olmayan metin bekleniyor');
}
function positive(value: unknown, path: string): asserts value is number {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value > 0, path, 'pozitif tam sayı bekleniyor');
}
function uniqueRows(rows: unknown[], path: string): Record<string, unknown>[] {
  const ids = new Set<string>();
  return rows.map((row, i) => {
    const current = object(row, `${path}[${i}]`);
    text(current.id, `${path}[${i}].id`);
    requireValue(/^[a-z][a-z0-9_]*$/.test(current.id), path, 'geçersiz kimlik');
    requireValue(!ids.has(current.id), path, `yinelenen kimlik: ${current.id}`);
    ids.add(current.id); return current;
  });
}
function biome(value: unknown, path: string) {
  requireValue(BIOME_IDS.some((id) => id === value), path, 'bilinmeyen biyom');
}
function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep); Object.freeze(value);
  }
  return value;
}
/** v4 content shape. Counts are contract, not convention: the catalogue is validated, not trusted. */
export const CATALOG_COUNTS = Object.freeze({
  creatures: 96, perBiome: 12, materials: 76, intermediates: 32, products: 56,
  items: 164, recipes: 88, moves: 72, learnset: 8,
});
/** Twelve species a region, always the same rarity shape. */
const RARITY_SHAPE = Object.freeze([['common', 6], ['uncommon', 3], ['rare', 2], ['legendary', 1]] as const);
/** Four bands of three tiers; every element must reach every band or a build has a dead level. */
export const TIER_BANDS: readonly (readonly UnlockLevel[])[] =
  Object.freeze([[1, 3, 6], [10, 15, 20], [25, 30, 35], [40, 45, 50]] as const);

/** Validates an external catalog, then returns an isolated deeply frozen snapshot. */
export function parseCatalog(input: unknown): Catalog {
  const root = object(input, 'catalog');
  requireValue(root.schemaVersion === 3, 'schemaVersion', 'desteklenmeyen sürüm');
  requireValue(root.combatAuthority === 'COMBAT.md', 'combatAuthority', 'savaş sözleşmesi değiştirilemez');
  const moves = uniqueRows(list(root.moves, 'moves'), 'moves');
  const creatures = uniqueRows(list(root.creatures, 'creatures'), 'creatures');
  const items = uniqueRows(list(root.items, 'items'), 'items');
  const recipes = uniqueRows(list(root.recipes, 'recipes'), 'recipes');
  requireValue(creatures.length === CATALOG_COUNTS.creatures && items.length === CATALOG_COUNTS.items &&
    recipes.length === CATALOG_COUNTS.recipes, 'catalog', 'içerik sayıları uyuşmuyor');
  requireValue(moves.length === CATALOG_COUNTS.moves, 'moves', `${CATALOG_COUNTS.moves} hareket gerekli`);
  const TONIC_IDS = new Set(['training_tonic', 'master_tonic', 'waking_draught', 'field_tonic']);
  for (const move of moves) {
    text(move.name, `${move.id}.name`);
    requireValue(move.element === null || ELEMENT_IDS.some((value) => value === move.element), `${move.id}.element`, 'geçersiz element');
    requireValue(UNLOCK_TIERS.some((value) => value === move.unlockLevel), `${move.id}.unlockLevel`, 'açılma seviyesi kademe tablosunda değil');
    requireValue(typeof move.accuracy === 'number' && move.accuracy >= 0.7 && move.accuracy <= 1, `${move.id}.accuracy`, 'isabet .70-1.00 arasında olmalı');
    requireValue(typeof move.cost === 'number' && Number.isSafeInteger(move.cost) && move.cost >= 0 && move.cost <= 5, `${move.id}.cost`, 'enerji 0-5 arasında olmalı');
    requireValue(typeof move.power === 'number' && Number.isSafeInteger(move.power) && move.power >= 0 && move.power <= 34, `${move.id}.power`, 'güç 0-34 arasında olmalı');
    if ('effect' in move) requireValue(MOVE_EFFECTS.some((value) => value === move.effect), `${move.id}.effect`, 'bilinmeyen hareket etkisi');
    const support = SUPPORT_EFFECTS.some((value) => value === move.effect);
    requireValue(support ? move.power === 0 : move.power >= 6, `${move.id}.power`, 'destek hareketi 0, saldırı en az 6 güç taşır');
  }
  const moveMap = new Map(moves.map((move) => [move.id, move]));
  requireValue(UNLOCK_TIERS.every((level) => moves.filter((move) => move.unlockLevel === level).length === MOVES_PER_TIER),
    'moves', `her açılma kademesinde ${MOVES_PER_TIER} hareket olmalı`);
  // Every element must reach every band, or a species of that element has a dead stretch of levels.
  for (const element of ELEMENT_IDS) {
    for (const band of TIER_BANDS) {
      requireValue(moves.some((move) => move.element === element && band.some((level) => level === move.unlockLevel)),
        'moves', `${element} elementi ${band[0]}-${band[band.length - 1]} bandında hareketsiz`);
    }
  }
  for (const row of [...creatures, ...items]) {
    text(row.name, `${row.id}.name`);
    requireValue(RARITIES.some((value) => value === row.rarity), `${row.id}.rarity`, 'geçersiz nadirlik');
  }
  for (const row of creatures) {
    biome(row.biomeId, `${row.id}.biomeId`);
    requireValue(ELEMENT_IDS.some((value) => value === row.element), `${row.id}.element`, 'geçersiz element');
    requireValue(TRAIT_IDS.some((value) => value === row.trait), `${row.id}.trait`, 'bilinmeyen tür özelliği');
    for (const key of ['baseHp', 'baseAtk', 'baseDef']) positive(row[key], `${row.id}.${key}`);
    text(row.visualBrief, `${row.id}.visualBrief`);
    const ids = list(row.moveIds, `${row.id}.moveIds`);
    requireValue(ids.length === CATALOG_COUNTS.learnset && new Set(ids).size === CATALOG_COUNTS.learnset,
      `${row.id}.moveIds`, `${CATALOG_COUNTS.learnset} farklı hareket gerekli`);
    const set = ids.map((id, index) => {
      const move = moveMap.get(String(id));
      requireValue(move, `${row.id}.moveIds[${index}]`, 'bilinmeyen hareket');
      return move!;
    });
    // A learn set must be equippable from level one and must keep opening as the creature grows.
    const supports = set.filter((move) => SUPPORT_EFFECTS.some((value) => value === move.effect));
    requireValue(supports.length >= 1 && supports.length <= 2, `${row.id}.moveIds`, 'bir ya da iki destek hareketi olmalı');
    requireValue(set.some((move) => move.element === row.element), `${row.id}.moveIds`, 'en az bir hareket kendi elementinden olmalı');
    requireValue(set.filter((move) => move.unlockLevel === 1).length >= 2, `${row.id}.moveIds`, 'iki seviye 1 hareketi gerekli');
    requireValue(set.filter((move) => Number(move.unlockLevel) >= 25).length >= 2, `${row.id}.moveIds`, 'geç oyunda iki hareket açılmalı');
    for (const band of TIER_BANDS) {
      requireValue(set.some((move) => band.some((level) => level === move.unlockLevel)),
        `${row.id}.moveIds`, `${band[0]}-${band[band.length - 1]} bandında hareket yok`);
    }
    requireValue(['day', 'night', 'any'].some((value) => value === row.activity), `${row.id}.activity`, 'gece/gündüz tercihi geçersiz');
    const roles = list(row.roles ?? [], `${row.id}.roles`);
    requireValue(roles.length <= 2, `${row.id}.roles`, 'bir tür en çok iki rol taşır');
    requireValue(new Set(roles).size === roles.length, `${row.id}.roles`, 'rol tekrar edemez');
    for (const role of roles) requireValue(CREATURE_ROLES.some((value) => value === role), `${row.id}.roles`, 'bilinmeyen rol');
    requireValue([1, 2, 3].some((value) => value === row.size), `${row.id}.size`, 'boyut 1-3 olmalı');
    requireValue(typeof row.baseSpeed === 'number' && row.baseSpeed >= 0.5 && row.baseSpeed <= 2.5, `${row.id}.baseSpeed`, 'taban hız 0.5-2.5 olmalı');
  }
  for (const id of BIOME_IDS) {
    const region = creatures.filter((row) => row.biomeId === id);
    requireValue(region.length === CATALOG_COUNTS.perBiome, id, `biyomda ${CATALOG_COUNTS.perBiome} tür olmalı`);
    for (const [rarity, count] of RARITY_SHAPE) {
      requireValue(region.filter((row) => row.rarity === rarity).length === count, id, `biyomda ${count} ${rarity} tür olmalı`);
    }
    requireValue(region.some((row) => row.activity === 'night'), id, 'biyomda gece türü olmalı');
  }
  // No element may dominate the roster the way taş did in v3, and none may stay a curiosity.
  for (const element of ELEMENT_IDS) {
    const carried = creatures.filter((row) => row.element === element).length;
    requireValue(carried >= 8 && carried <= 12, 'creatures', `${element} elementi ${carried} türde; 8-12 arası olmalı`);
  }
  // Every trait must be lived by a species, exactly as every role must be.
  for (const trait of TRAIT_IDS) {
    requireValue(creatures.some((row) => row.trait === trait), 'creatures', `hiçbir tür ${trait} özelliğini taşımıyor`);
  }
  let materialCount = 0, intermediateCount = 0, productCount = 0;
  for (const item of items) {
    positive(item.stackLimit, `${item.id}.stackLimit`);
    if ('biomeId' in item && item.biomeId !== undefined) {
      materialCount++;
      biome(item.biomeId, `${item.id}.biomeId`);
      requireValue(!('effect' in item) && item.stackLimit === STACK_LIMITS.material, String(item.id), 'materyal etkisiz ve 99 yığın sınırlı olmalı');
      requireValue(ITEM_CLASSES.some((value) => value === item.itemClass), String(item.id), 'materyal sınıfı geçersiz');
    } else if ('craftTier' in item && item.craftTier !== undefined) {
      intermediateCount++;
      requireValue(CRAFT_TIERS.some((value) => value === item.craftTier), String(item.id), 'ara ürün kademesi geçersiz');
      requireValue(!('effect' in item) && item.stackLimit === STACK_LIMITS.intermediate, String(item.id), 'ara ürün etkisiz ve 50 yığın sınırlı olmalı');
      requireValue(ITEM_CLASSES.some((value) => value === item.itemClass), String(item.id), 'ara ürün sınıfı geçersiz');
    } else {
      productCount++;
      requireValue(item.stackLimit === STACK_LIMITS.product, String(item.id), 'ürün yığın sınırı 20 olmalı');
      const effect = object(item.effect, `${item.id}.effect`);
      requireValue(['heal', 'grant_heat_herb', 'grant_xp', 'revive_fraction', 'heal_full', 'capture_consumable', 'tool', 'speed', 'graft'].some((value) => value === effect.kind), String(item.id), 'bilinmeyen etki');
      const contexts = effect.kind === 'capture_consumable' ? ['battle'] : effect.kind === 'heal' ? ['camp', 'battle']
        : effect.kind === 'tool' || effect.kind === 'speed' ? ['world'] : ['camp'];
      requireValue(contexts.some((value) => value === effect.context), String(item.id), 'etki bağlamı yanlış');
      if (effect.kind === 'graft') {
        requireValue(effect.value === null, String(item.id), 'etki değeri null olmalı');
        requireValue(moveMap.has(String(effect.moveId)), String(item.id), 'aşı bilinmeyen hareketi öğretiyor');
      } else if (effect.kind === 'heal_full' || effect.kind === 'tool') {
        requireValue(effect.value === null, String(item.id), 'etki değeri null olmalı');
      } else if (effect.kind === 'speed') {
        requireValue(typeof effect.value === 'number' && effect.value > 1 && effect.value <= 3, String(item.id), 'hız çarpanı geçersiz');
      } else if (effect.kind === 'capture_consumable') {
        requireValue(effect.value === null || (typeof effect.value === 'number' && effect.value > 0 && effect.value <= .3), String(item.id), 'mühür kademesi geçersiz');
      } else if (effect.kind === 'revive_fraction') {
        requireValue(typeof effect.value === 'number' && effect.value > 0 && effect.value <= 1, String(item.id), 'canlandırma oranı geçersiz');
      } else positive(effect.value, `${item.id}.effect.value`);
    }
  }
  requireValue(materialCount === CATALOG_COUNTS.materials, 'items', `${CATALOG_COUNTS.materials} materyal gerekli`);
  requireValue(intermediateCount === CATALOG_COUNTS.intermediates, 'items', `${CATALOG_COUNTS.intermediates} ara ürün gerekli`);
  requireValue(productCount === CATALOG_COUNTS.products, 'items', `${CATALOG_COUNTS.products} ürün gerekli`);
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const isMaterial = (id: string) => 'biomeId' in (itemMap.get(id) ?? {}) && itemMap.get(id)!.biomeId !== undefined;
  const isIntermediate = (id: string) => (itemMap.get(id) as { craftTier?: string } | undefined)?.craftTier !== undefined;
  const outputs = new Set<string>();
  const consumed = new Set<string>();
  for (const recipe of recipes) {
    requireValue(recipe.enabledInMvp === true, String(recipe.id), 'tarif MVP içinde etkin olmalı');
    const inputs = list(recipe.inputs, `${recipe.id}.inputs`);
    requireValue(inputs.length > 0 && inputs.length <= 4, String(recipe.id), 'tarif 1-4 girdi taşır');
    const used = new Set<string>();
    for (const [index, raw] of [...inputs, recipe.output].entries()) {
      const part = object(raw, `${recipe.id}.ingredient`);
      text(part.itemId, `${recipe.id}.itemId`); positive(part.quantity, `${recipe.id}.quantity`);
      const referenced = itemMap.get(part.itemId);
      requireValue(referenced, String(recipe.id), `bilinmeyen eşya: ${part.itemId}`);
      requireValue(part.quantity <= (referenced.stackLimit as number), String(recipe.id), 'tek tarif miktarı yığın sınırını aşıyor');
      if (index < inputs.length) {
        // v4: a chain may stand on gathered material or on another crafted intermediate, but a
        // finished product is never an input, so the graph stays acyclic by construction.
        requireValue(isMaterial(String(part.itemId)) || isIntermediate(String(part.itemId)),
          String(recipe.id), 'girdi materyal veya ara ürün olmalı');
        requireValue(!used.has(String(part.itemId)), String(recipe.id), 'girdi yinelenemez');
        used.add(String(part.itemId)); consumed.add(String(part.itemId));
      } else {
        requireValue(!isMaterial(String(part.itemId)), String(recipe.id), 'çıktı toplanabilir materyal olamaz');
        requireValue(!outputs.has(String(part.itemId)), String(recipe.id), 'çıktı benzersiz olmalı');
        outputs.add(String(part.itemId));
      }
    }
  }
  // Everything crafted is craftable exactly once, and nothing gathered is dead weight.
  for (const item of items) {
    const id = String(item.id);
    if (isMaterial(id)) {
      requireValue(consumed.has(id) || id === 'heat_herb', 'recipes', `${id} hiçbir tarifte kullanılmıyor`);
    } else {
      requireValue(outputs.has(id), 'recipes', `${id} hiçbir tarifle üretilemiyor`);
    }
  }
  requireValue(itemMap.get('heat_herb')?.biomeId === 'meadow', 'heat_herb', 'Isı Otu çayır materyali olmalı');
  requireValue(object(itemMap.get('seal')?.effect, 'seal.effect').kind === 'capture_consumable', 'seal', 'Mühür yakalama sarfı olmalı');
  const effects = items.map((item) => object(item, 'item').effect as ItemEffect | undefined);
  const bonuses = effects.filter((effect) => effect?.kind === 'capture_consumable').map((effect) => effect!.value ?? 0);
  requireValue(bonuses.length === 4 && new Set(bonuses).size === 4 && bonuses.includes(0), 'items', 'dört ayrı mühür kademesi gerekir');
  requireValue(effects.some((effect) => effect?.kind === 'heal' && effect.context === 'battle'), 'items', 'savaşta kullanılacak bir merhem gerekir');
  requireValue(effects.filter((effect) => effect?.kind === 'tool').length === 8, 'items', 'sekiz alet gerekir');
  requireValue(effects.filter((effect) => effect?.kind === 'speed').length >= 2, 'items', 'en az iki hız toniği gerekir');
  requireValue(effects.filter((effect) => effect?.kind === 'graft').length >= 12, 'items', 'en az on iki aşı gerekir');
  for (const role of CREATURE_ROLES) {
    requireValue(creatures.some((row) => (row.roles as string[] | undefined)?.includes(role)), 'creatures', `hiçbir tür ${role} rolünü taşımıyor`);
  }
  requireValue(items.filter((item) => TONIC_IDS.has(String(item.id))).length === TONIC_IDS.size, 'items', 'dört tonik gerekir');
  return freezeDeep(structuredClone({ schemaVersion: root.schemaVersion, combatAuthority: root.combatAuthority, moves, creatures, items, recipes })) as unknown as Catalog;
}
