import type { Element } from './schema';

export const ELEMENTS: readonly Element[] = Object.freeze(
  ['çim', 'su', 'kor', 'buz', 'taş', 'gölge', 'rüzgâr', 'ışık', 'kıvılcım'],
);
/**
 * Single source for elemental advantage. Three cycles plus one mirror pair:
 * çim→su→kor→çim, buz→taş→rüzgâr→buz, ışık↔gölge (both ways strong), and kıvılcım which
 * beats su and rüzgâr while taş grounds it.
 */
const ADVANTAGE: Readonly<Record<Element, readonly Element[]>> = Object.freeze({
  'çim': ['su'],
  'su': ['kor'],
  'kor': ['çim'],
  'buz': ['taş'],
  'taş': ['rüzgâr', 'kıvılcım'],
  'rüzgâr': ['buz'],
  'ışık': ['gölge'],
  'gölge': ['ışık'],
  'kıvılcım': ['su', 'rüzgâr'],
});
export const STRONG = 1.25;
export const WEAK = 0.8;
export const NEUTRAL = 1;
/** Typeless moves pass `null` and always land at 1.0; there is no second copy of this table. */
export function elementEffectiveness(attack: Element | null, defense: Element): number {
  if (!attack) return NEUTRAL;
  if (ADVANTAGE[attack].includes(defense)) return STRONG;
  if (ADVANTAGE[defense].includes(attack)) return WEAK;
  return NEUTRAL;
}
export function strongAgainst(element: Element): readonly Element[] { return ADVANTAGE[element]; }
