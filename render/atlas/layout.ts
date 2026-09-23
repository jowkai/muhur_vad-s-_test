/** Every sprite is stored as three frames side by side: rest, lift, strike. */
export const ATLAS_FRAMES = 3;
export type FrameIndex = 0 | 1 | 2;
export interface UvRect { readonly u0: number; readonly v0: number; readonly u1: number; readonly v1: number }
export interface AtlasCell {
  readonly visualId: string; readonly column: number; readonly row: number;
  readonly frames: readonly UvRect[];
}
export interface AtlasLayout {
  readonly cell: number; readonly columns: number; readonly rows: number;
  readonly width: number; readonly height: number;
  readonly ids: readonly string[]; readonly cells: ReadonlyMap<string, AtlasCell>;
}
const nextPowerOfTwo = (value: number) => 2 ** Math.ceil(Math.log2(Math.max(1, value)));
/**
 * Packs every sprite into one grid: three frames per sprite, laid out left to right, wrapping at
 * the texture width. Pure arithmetic, so the layout can be asserted without a canvas.
 */
export function planAtlas(ids: readonly string[], cell = 96, maxWidth = 2048): AtlasLayout {
  if (!Number.isInteger(cell) || cell < 8 || cell > 512) throw new RangeError('Geçersiz atlas hücresi.');
  if (!Number.isInteger(maxWidth) || maxWidth < cell * ATLAS_FRAMES) throw new RangeError('Atlas genişliği yetersiz.');
  const unique = [...new Set(ids)].filter((id) => id.trim().length > 0).sort();
  const perRow = Math.max(1, Math.floor(maxWidth / (cell * ATLAS_FRAMES)));
  const rows = Math.max(1, Math.ceil(unique.length / perRow));
  const columns = Math.min(unique.length, perRow) * ATLAS_FRAMES;
  const width = nextPowerOfTwo(Math.max(cell * ATLAS_FRAMES, columns * cell));
  const height = nextPowerOfTwo(rows * cell);
  const cells = new Map<string, AtlasCell>();
  unique.forEach((visualId, index) => {
    const row = Math.floor(index / perRow);
    const column = (index % perRow) * ATLAS_FRAMES;
    const frames = Array.from({ length: ATLAS_FRAMES }, (_, frame) => {
      const x = (column + frame) * cell;
      const y = row * cell;
      return Object.freeze({ u0: x / width, v0: 1 - (y + cell) / height, u1: (x + cell) / width, v1: 1 - y / height });
    });
    cells.set(visualId, Object.freeze({ visualId, column, row, frames: Object.freeze(frames) }));
  });
  return Object.freeze({ cell, columns, rows, width, height, ids: Object.freeze(unique), cells });
}
export function frameRect(layout: AtlasLayout, visualId: string, frame: number): UvRect | null {
  const cell = layout.cells.get(visualId);
  if (!cell) return null;
  const index = Math.min(ATLAS_FRAMES - 1, Math.max(0, Math.floor(frame)));
  return cell.frames[index];
}
/** Pixel box of one frame inside the atlas image; the builder draws into exactly this box. */
export function framePixels(layout: AtlasLayout, visualId: string, frame: number): { x: number; y: number; size: number } | null {
  const cell = layout.cells.get(visualId);
  if (!cell) return null;
  const index = Math.min(ATLAS_FRAMES - 1, Math.max(0, Math.floor(frame)));
  return { x: (cell.column + index) * layout.cell, y: cell.row * layout.cell, size: layout.cell };
}
export const IDLE_FRAME_TICKS = 18;
/**
 * Which frame a sprite shows. Reduced motion pins everything to the resting frame, a hit jumps
 * straight to the strike frame, and idle breathes 0 → 1 → 2 → 1 on the fixed step.
 */
export function frameFor(tick: number, options: { readonly reducedMotion?: boolean; readonly hit?: boolean } = {}): FrameIndex {
  if (options.reducedMotion) return 0;
  if (options.hit) return 2;
  if (!Number.isFinite(tick)) return 0;
  const step = Math.floor(Math.max(0, tick) / IDLE_FRAME_TICKS) % 4;
  return (step === 0 ? 0 : step === 2 ? 2 : 1) as FrameIndex;
}
/** How much bigger a creature looks at each cosmetic stage: visible, but never a different plane. */
export const STAGE_SCALE: readonly number[] = Object.freeze([1, 1.12, 1.28]);
export const stageScale = (stage: number) => STAGE_SCALE[Math.min(STAGE_SCALE.length - 1, Math.max(0, Math.floor(stage)))];
