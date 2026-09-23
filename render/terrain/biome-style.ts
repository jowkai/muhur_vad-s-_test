import type { BiomeId } from '../../contracts';

export type DecorKind = 'tree' | 'rock' | 'shrub';
export interface BiomeStyle {
  /** Ground base and accent drive vertex colours; they never carry information alone. */
  readonly ground: number; readonly accent: number; readonly pattern: 'grass' | 'canopy' | 'dune' | 'wave' | 'crack' | 'strata' | 'basalt' | 'ember';
  readonly tree: { readonly trunk: number; readonly crown: number; readonly shape: 'cone' | 'sphere' | 'column' | 'fan' };
  readonly rock: { readonly color: number; readonly shape: 'boulder' | 'shard' | 'slab' };
  readonly shrub: { readonly color: number; readonly shape: 'tuft' | 'coral' | 'crystal' | 'flame' };
  readonly density: number;
}
/**
 * Each biome has its own silhouette and pattern, so colour is never the only difference.
 * Albedo values are authored for the project's lit scene (hemisphere 2 + directional 2.5); they
 * read roughly twice as bright on screen, so a nominally dark palette renders as the design hue.
 */
export const BIOME_STYLE: Readonly<Record<BiomeId, BiomeStyle>> = Object.freeze({
  meadow: { ground: 0x415c23, accent: 0x5f7a2c, pattern: 'grass',
    tree: { trunk: 0x3b2c1c, crown: 0x2c5222, shape: 'sphere' }, rock: { color: 0x494f42, shape: 'boulder' },
    shrub: { color: 0x7d8c2e, shape: 'tuft' }, density: 0.5 },
  forest: { ground: 0x1e3b23, accent: 0x14291a, pattern: 'canopy',
    tree: { trunk: 0x2c2013, crown: 0x123021, shape: 'cone' }, rock: { color: 0x37402f, shape: 'boulder' },
    shrub: { color: 0x39572a, shape: 'tuft' }, density: 1 },
  earth: { ground: 0x5c3a20, accent: 0x7a4d24, pattern: 'strata',
    tree: { trunk: 0x3d2a17, crown: 0x60502a, shape: 'fan' }, rock: { color: 0x6d4a2b, shape: 'slab' },
    shrub: { color: 0x7a6330, shape: 'tuft' }, density: 0.7 },
  desert: { ground: 0x8a6a2c, accent: 0xa8873c, pattern: 'dune',
    tree: { trunk: 0x6a5228, crown: 0x87763a, shape: 'fan' }, rock: { color: 0x7e6634, shape: 'shard' },
    shrub: { color: 0x968236, shape: 'tuft' }, density: 0.35 },
  sea: { ground: 0x115a63, accent: 0x2b8a8c, pattern: 'wave',
    tree: { trunk: 0x5a4c2e, crown: 0x2a7a63, shape: 'fan' }, rock: { color: 0x47585e, shape: 'boulder' },
    shrub: { color: 0x9a4d3e, shape: 'coral' }, density: 0.45 },
  ice: { ground: 0x41708f, accent: 0x6b9ec0, pattern: 'crack',
    tree: { trunk: 0x3c4b57, crown: 0x77a6c4, shape: 'cone' }, rock: { color: 0x5a7d95, shape: 'shard' },
    shrub: { color: 0x9ecbe4, shape: 'crystal' }, density: 0.55 },
  volcanic: { ground: 0x241f3e, accent: 0x3b3161, pattern: 'basalt',
    tree: { trunk: 0x1e1a2c, crown: 0x4a3a78, shape: 'column' }, rock: { color: 0x2f2a46, shape: 'slab' },
    shrub: { color: 0x6d4fb4, shape: 'crystal' }, density: 0.8 },
  flame: { ground: 0x50190f, accent: 0x8f3213, pattern: 'ember',
    tree: { trunk: 0x2f120d, crown: 0xa8441a, shape: 'column' }, rock: { color: 0x4d2116, shape: 'shard' },
    shrub: { color: 0xc25f18, shape: 'flame' }, density: 0.6 },
});
export const DECOR_KINDS: readonly DecorKind[] = Object.freeze(['tree', 'rock', 'shrub']);
/** Shared-resource key: two chunks in the same biome reuse one geometry and one material. */
export function decorKey(kind: DecorKind, biomeId: BiomeId, part: 'geometry' | 'material' | 'trunk'): string {
  return `${kind}:${biomeId}:${part}`;
}
