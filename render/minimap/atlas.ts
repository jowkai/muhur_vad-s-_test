import type { VecXZ } from '../../contracts';
import type { Discovery } from '../../world/discovery/discovery';
import type { WorldDefinition } from '../../world/generation/world';
import { sampleTerrain } from '../../world/terrain/terrain';
import { BIOME_STYLE } from '../terrain/biome-style';

export const ATLAS_RESOLUTION = 64;
export const ATLAS_REPAINT_METRES = 3;
const channels = (color: number) => [(color >> 16) & 255, (color >> 8) & 255, color & 255] as const;
export const FOG_COLOUR = [16, 24, 22] as const;
/**
 * Colour for one atlas pixel. Undiscovered ground stays fog, and roads, deep water and lava keep
 * their own tone so the dial reads like the world it mirrors.
 */
export function atlasPixel(world: WorldDefinition, point: VecXZ, discovered: boolean): readonly [number, number, number] {
  if (!discovered) return FOG_COLOUR;
  const cell = sampleTerrain(world, point);
  const style = BIOME_STYLE[cell.biomeId];
  const base = channels(cell.road ? 0x6b5a3a : cell.hazard === 'deep-water' ? 0x123448 : cell.hazard === 'lava' ? 0x8a2f14 : style.ground);
  // Lift the albedo the same way the lit scene does, so the dial matches the world.
  return [Math.min(255, base[0] * 2), Math.min(255, base[1] * 2), Math.min(255, base[2] * 2)];
}
/**
 * Low-resolution terrain layer under the minimap markers. It paints only what the player has
 * discovered, repaints at most once every few metres, and never touches gameplay state.
 */
export class MinimapAtlas {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private painted: VecXZ | null = null;
  private paintedCells = -1;
  constructor(private readonly world: WorldDefinition, private readonly radius = 96, resolution = ATLAS_RESOLUTION) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = resolution;
    this.canvas.height = resolution;
    const context = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Minimap atlası çizilemedi.');
    this.context = context;
    this.image = context.createImageData(resolution, resolution);
    this.image.data.fill(255);
  }
  /** Returns the atlas to draw, repainting first when the player moved or revealed more ground. */
  current(player: VecXZ, discovery: Discovery): CanvasImageSource {
    const moved = !this.painted || Math.hypot(player.x - this.painted.x, player.z - this.painted.z) >= ATLAS_REPAINT_METRES;
    // Reading `size` keeps this O(1); serialising the discovery set here cost whole frames.
    const cells = discovery.size;
    if (moved || cells !== this.paintedCells) {
      this.paint(player, discovery);
      this.painted = { ...player };
      this.paintedCells = cells;
    }
    return this.canvas;
  }
  private paint(player: VecXZ, discovery: Discovery): void {
    const size = this.canvas.width;
    const metresPerPixel = (this.radius * 2) / size;
    const data = this.image.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = (y * size + x) * 4;
        const point = {
          x: player.x + (x + 0.5 - size / 2) * metresPerPixel,
          z: player.z + (y + 0.5 - size / 2) * metresPerPixel,
        };
        const colour = atlasPixel(this.world, point, discovery.has(point));
        data[index] = colour[0]; data[index + 1] = colour[1]; data[index + 2] = colour[2]; data[index + 3] = 255;
      }
    }
    this.context.putImageData(this.image, 0, 0);
  }
  dispose(): void { this.canvas.width = 0; this.canvas.height = 0; }
}
