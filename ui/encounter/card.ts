import type { NearbyTarget } from '../../contracts';
import { creatureById, itemById } from '../../content/catalog';
import { creatureAssets, eggAssets, itemAssets } from '../../content/asset-manifest';
import { BIOME_LABEL } from '../hud/labels';

export interface EncounterContext {
  readonly eggSlotsLeft: number; readonly creatureSlotsLeft: number;
  readonly hasHealthyCreature: boolean; readonly inventoryFull: boolean; readonly aggressive?: boolean;
}
export interface EncounterCard {
  readonly entityId: string; readonly kind: NearbyTarget['kind']; readonly name: string;
  readonly level: number | null; readonly element: string | null; readonly behaviour: 'Sakin' | 'Saldırgan';
  readonly spriteUrl: string; readonly spriteSize: 128; readonly hint: string;
  readonly enabled: boolean; readonly disabledReason: string | null; readonly intent: { readonly type: 'interact'; readonly entityId: string };
  readonly biomeLabel: string | null;
}
function sprite(target: NearbyTarget): string {
  if (target.kind === 'creature') return creatureAssets[target.spriteId as keyof typeof creatureAssets]?.front ?? '';
  if (target.kind === 'egg') return eggAssets[target.spriteId.replace('egg_', '') as keyof typeof eggAssets] ?? '';
  return itemAssets[target.spriteId as keyof typeof itemAssets] ?? '';
}
/**
 * Pure card projection for the big proximity panel. It never mutates state: the caller sends the
 * returned `intent` through the world command path, and the domain decides what actually happens.
 */
export function encounterCard(target: NearbyTarget | null, context: EncounterContext): EncounterCard | null {
  if (!target) return null;
  const species = target.kind === 'creature' ? creatureById(target.spriteId) : null;
  const item = target.kind === 'resource' ? itemById(target.spriteId) : null;
  const eggBiome = target.kind === 'egg' ? target.spriteId.replace('egg_', '') as keyof typeof BIOME_LABEL : null;
  let disabledReason: string | null = null;
  if (!target.interactionAllowed) disabledReason = 'Yaklaş';
  else if (target.kind === 'creature' && !context.hasHealthyCreature) disabledReason = 'Ayakta yaratığın yok';
  else if (target.kind === 'egg' && context.eggSlotsLeft <= 0) disabledReason = 'Kuluçka yuvası dolu';
  else if (target.kind === 'resource' && context.inventoryFull) disabledReason = 'Çanta dolu';
  const hint = target.kind === 'creature' ? 'Enter: Savaş' : 'Enter: Topla';
  return Object.freeze({
    entityId: target.entityId, kind: target.kind, name: target.name,
    level: target.kind === 'resource' ? null : target.level,
    element: species?.element ?? null,
    behaviour: context.aggressive ? 'Saldırgan' : 'Sakin',
    spriteUrl: sprite(target), spriteSize: 128,
    hint: disabledReason ? `${hint} · ${disabledReason}` : hint,
    enabled: !disabledReason, disabledReason,
    intent: Object.freeze({ type: 'interact' as const, entityId: target.entityId }),
    biomeLabel: species ? BIOME_LABEL[species.biomeId] : item ? BIOME_LABEL[item.biomeId ?? 'meadow'] : eggBiome ? BIOME_LABEL[eggBiome] : null,
  });
}
