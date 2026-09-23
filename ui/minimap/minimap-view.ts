import type { MinimapMarker, MinimapView as MinimapModel } from './model';

export interface MinimapDialOptions {
  /** Terrain atlas is produced by the render layer; the UI only composites it under the fog. */
  readonly atlas?: () => CanvasImageSource | null;
  readonly devicePixelRatio?: number;
}
const INK = '#16231f';
const BONE = '#f1ead6';
const BRASS = '#d9bd7c';
const HOSTILE = '#e1734f';
/**
 * Real circular clipping on a 2D canvas: no second Three.js pass. Colour is never the only
 * signal, so every marker kind also has its own outline shape.
 */
export class MinimapDial {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly caption: HTMLElement;
  private readonly readout: HTMLElement;
  private disposed = false;
  constructor(host: HTMLElement, private readonly options: MinimapDialOptions = {}) {
    this.root = document.createElement('section');
    this.root.className = 'mv-minimap';
    this.root.setAttribute('aria-label', 'Yakın çevre haritası');
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Minimap çizim bağlamı açılamadı.');
    this.context = context;
    this.caption = document.createElement('p');
    this.caption.className = 'mv-minimap-caption';
    this.readout = document.createElement('p');
    this.readout.className = 'mv-minimap-readout';
    this.readout.setAttribute('role', 'status');
    this.root.append(this.canvas, this.caption, this.readout);
    host.append(this.root);
  }
  update(view: MinimapModel): void {
    if (this.disposed) return;
    const { viewport } = view;
    const dpr = Math.min(this.options.devicePixelRatio ?? (globalThis.devicePixelRatio || 1), 2);
    if (this.canvas.width !== Math.round(viewport.size * dpr)) {
      this.canvas.width = Math.round(viewport.size * dpr);
      this.canvas.height = Math.round(viewport.size * dpr);
    }
    this.canvas.style.width = `${viewport.size}px`;
    this.canvas.style.height = `${viewport.size}px`;
    this.root.style.setProperty('--mv-size', `${viewport.size}px`);
    const ctx = this.context;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewport.size, viewport.size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(viewport.center, viewport.center, viewport.radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, viewport.size, viewport.size);
    const atlas = this.options.atlas?.();
    if (atlas) ctx.drawImage(atlas, 0, 0, viewport.size, viewport.size);
    ctx.strokeStyle = '#2d3f38';
    ctx.lineWidth = 1;
    for (let ring = 1; ring <= 3; ring++) {
      ctx.beginPath();
      ctx.arc(viewport.center, viewport.center, viewport.radius * ring / 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const marker of view.markers) this.drawMarker(marker);
    this.drawPlayer(view);
    ctx.restore();
    ctx.strokeStyle = BRASS;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(viewport.center, viewport.center, viewport.radius - 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = BONE;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('K', viewport.center, 14);
    this.canvas.setAttribute('aria-label', `${view.biome.label} · ${view.markers.length} yakın işaret`);
    this.caption.textContent = view.biome.label;
    this.readout.textContent = view.selectedLabel ? `Seçili hedef: ${view.selectedLabel}` : 'Seçili hedef yok';
  }
  private drawPlayer(view: MinimapModel): void {
    const ctx = this.context;
    ctx.save();
    ctx.translate(view.player.x, view.player.y);
    ctx.rotate(view.player.yaw);
    ctx.fillStyle = BONE;
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  private drawMarker(marker: MinimapMarker): void {
    const ctx = this.context;
    ctx.save();
    ctx.translate(marker.x, marker.y);
    ctx.lineWidth = marker.selected ? 2.5 : 1.5;
    ctx.strokeStyle = marker.shape === 'hostile-claw' ? HOSTILE : BRASS;
    ctx.fillStyle = marker.selected ? BONE : '#b9c9ac';
    ctx.beginPath();
    switch (marker.shape) {
      case 'oval': ctx.ellipse(0, 0, 3.4, 4.6, 0, 0, Math.PI * 2); break;
      case 'diamond': ctx.moveTo(0, -4.5); ctx.lineTo(4, 0); ctx.lineTo(0, 4.5); ctx.lineTo(-4, 0); ctx.closePath(); break;
      case 'star':
        for (let i = 0; i < 10; i++) {
          const radius = i % 2 ? 2.2 : 5.2, angle = -Math.PI / 2 + i * Math.PI / 5;
          ctx[i ? 'lineTo' : 'moveTo'](Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        ctx.closePath(); break;
      default:
        for (const offset of [-3.2, 0, 3.2]) { ctx.moveTo(offset, -4.5); ctx.lineTo(offset + 1.4, 4.5); }
        break;
    }
    if (marker.shape === 'claw' || marker.shape === 'hostile-claw') ctx.stroke();
    else { ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.remove();
  }
}
