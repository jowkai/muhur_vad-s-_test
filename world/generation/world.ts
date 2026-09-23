import { BIOME_IDS, type BiomeId, type VecXZ } from '../../contracts';
import { GAME_CONFIG } from '../../config';
import { creaturesInBiome, tutorialEgg } from '../../content/catalog';
import { randomAt } from './random';

export const GENERATOR_VERSION = 1;
export interface Region { readonly biomeId: BiomeId; readonly center: VecXZ; readonly entrance: VecXZ }
export interface Road { readonly from: VecXZ; readonly to: VecXZ }
export interface StarterSpawn {
  readonly entityId: string; readonly kind: 'egg' | 'creature'; readonly position: VecXZ;
  readonly speciesId: string; readonly level: 1 | 2; readonly aggressive: false;
}
export interface WorldDefinition {
  readonly seed: string; readonly generatorVersion: 1; readonly camp: VecXZ;
  readonly regions: readonly Region[]; readonly roads: readonly Road[];
  readonly starters: readonly StarterSpawn[]; readonly phases: readonly number[];
}
const CENTERS: Readonly<Record<BiomeId, VecXZ>> = {
  meadow: { x: 0, z: 0 }, forest: { x: -530, z: -280 }, earth: { x: -550, z: 510 },
  desert: { x: 450, z: 540 }, sea: { x: 880, z: 100 }, ice: { x: -30, z: -760 },
  volcanic: { x: 590, z: -580 }, flame: { x: 780, z: -700 },
};
const half = GAME_CONFIG.worldSize / 2;
const snap = (value: number) => Math.floor((value + half) / GAME_CONFIG.cellSize) * GAME_CONFIG.cellSize - half + GAME_CONFIG.cellSize / 2;
const point = (x: number, z: number): VecXZ => Object.freeze({ x: snap(x), z: snap(z) });
export function createWorld(seed: string = GAME_CONFIG.seed): WorldDefinition {
  if (typeof seed !== 'string' || !seed.trim()) throw new RangeError('Dünya tohumu boş olamaz.');
  const camp = point(0, 0);
  const regions = BIOME_IDS.map((biomeId) => {
    const base = CENTERS[biomeId];
    const jitter = biomeId === 'meadow' ? 0 : 32;
    const center = point(base.x + (randomAt(seed, `region-${biomeId}`, 0) - 0.5) * jitter,
      base.z + (randomAt(seed, `region-${biomeId}`, 1) - 0.5) * jitter);
    const entrance = biomeId === 'sea' ? point(center.x - 65, center.z) : center;
    return Object.freeze({ biomeId, center, entrance });
  });
  const volcanic = regions.find((region) => region.biomeId === 'volcanic')!;
  const roads = regions.filter((region) => region.biomeId !== 'meadow').map((region) => Object.freeze({
    from: region.biomeId === 'flame' ? volcanic.entrance : camp, to: region.entrance,
  }));
  // Four species live in the meadow now; the tutorial only ever hands out the common ones.
  const species = creaturesInBiome('meadow').filter((entry) => entry.rarity === 'common');
  const placements = [{ x: 9, z: 15 }, { x: -15, z: 9 }, { x: 23, z: -9 }, { x: -23, z: -17 }];
  const starters = placements.map((position, index): StarterSpawn => Object.freeze({
    entityId: `${seed.length}:${seed}:g${GENERATOR_VERSION}:starter:${index}`,
    kind: index < 2 ? 'egg' : 'creature', position: point(position.x, position.z),
    speciesId: index < 2 ? tutorialEgg.speciesId : species[index % species.length].id,
    level: index === 3 ? 2 : 1, aggressive: false,
  }));
  return Object.freeze({ seed, generatorVersion: GENERATOR_VERSION, camp, regions: Object.freeze(regions),
    roads: Object.freeze(roads), starters: Object.freeze(starters),
    phases: Object.freeze(Array.from({ length: 4 }, (_, i) => randomAt(seed, 'terrain-phase', i) * Math.PI * 2)),
  });
}
