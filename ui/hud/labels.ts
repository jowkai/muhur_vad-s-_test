import { BIOME_IDS, type BiomeId } from '../../contracts';

/** Display names live with the UI; the domain only ever passes biome ids. */
export const BIOME_LABEL: Readonly<Record<BiomeId, string>> = Object.freeze({
  meadow: 'Şafak Çayırı', forest: 'Fısıltı Ormanı', earth: 'Paslı Kanyon', desert: 'Kehribar Çölü',
  sea: 'Mercan Kıyısı', ice: 'Akbuz Yaylası', volcanic: 'Gecebazalt', flame: 'Kor Çanağı',
});
export const BIOME_ORDER: readonly BiomeId[] = BIOME_IDS;
export const MODE_LABEL = Object.freeze({
  boot: 'Yükleniyor', exploring: 'Keşif', panel: 'Panel', encounter: 'Karşılaşma',
  battle: 'Savaş', committing: 'Kaydediliyor', recovery: 'Kayıt hatası',
});
export function biomeLabel(id: BiomeId): string {
  const label = BIOME_LABEL[id];
  if (!label) throw new RangeError('Bilinmeyen biyom.');
  return label;
}
