import { CanvasTexture, NearestFilter, type Texture } from 'three';
import { creatureAssets, eggAssets, itemAssets } from '../../content/asset-manifest';
import { ATLAS_FRAMES, framePixels, planAtlas, type AtlasLayout } from './layout';

/** Every drawing the world can show, by the visual id the render frame uses. */
export function spriteSources(): ReadonlyMap<string, string> {
  const sources = new Map<string, string>();
  for (const [id, pair] of Object.entries(creatureAssets)) sources.set(id, pair.front);
  for (const [biomeId, url] of Object.entries(eggAssets)) sources.set(`egg_${biomeId}`, url);
  for (const [id, url] of Object.entries(itemAssets)) sources.set(id, url);
  return sources;
}
export interface SpriteAtlasOptions { readonly cell?: number; readonly sources?: ReadonlyMap<string, string> }
/**
 * One canvas, one texture, one material for every sprite in the world. Each drawing is rasterised
 * three times with a small lift and lean, which is what the UV animation steps through; nothing
 * is fetched from a remote host and no drawing is mirrored.
 */
export class SpriteAtlas {
  readonly layout: AtlasLayout;
  readonly texture: Texture;
  readonly ready: Promise<void>;
  private readonly canvas: HTMLCanvasElement;
  private disposed = false;
  constructor(options: SpriteAtlasOptions = {}) {
    const sources = options.sources ?? spriteSources();
    this.layout = planAtlas([...sources.keys()], options.cell ?? 96);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.layout.width;
    this.canvas.height = this.layout.height;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.magFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    this.ready = this.paint(sources);
  }
  private async paint(sources: ReadonlyMap<string, string>): Promise<void> {
    const context = this.canvas.getContext('2d');
    if (!context) return;
    await Promise.all([...sources].map(async ([visualId, url]) => {
      const image = await load(url);
      if (!image || this.disposed) return;
      for (let frame = 0; frame < ATLAS_FRAMES; frame++) {
        const box = framePixels(this.layout, visualId, frame);
        if (!box) continue;
        // Frame 0 rests, frame 1 lifts a little, frame 2 leans into the strike.
        const lift = frame === 1 ? box.size * .04 : frame === 2 ? box.size * .02 : 0;
        const squash = frame === 2 ? .94 : 1;
        const width = box.size * squash;
        context.drawImage(image, box.x + (box.size - width) / 2, box.y - lift, width, box.size);
      }
      this.texture.needsUpdate = true;
    }));
  }
  get width(): number { return this.layout.width; }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.texture.dispose();
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}
function load(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
