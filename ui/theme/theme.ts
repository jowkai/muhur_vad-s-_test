/**
 * One place for the valley's look. Every panel, strip and card reads these tokens, so a change
 * of mood is a change here and nowhere else. Colours are checked for contrast in the tests.
 */
export interface ThemeTokens {
  readonly ink: string; readonly inkSoft: string; readonly parchment: string;
  readonly deep: string; readonly panel: string; readonly panelEdge: string;
  readonly gold: string; readonly goldSoft: string; readonly ember: string; readonly moss: string;
  readonly scrim: string; readonly focus: string;
  readonly radius: string; readonly radiusSmall: string; readonly target: string;
  readonly display: string; readonly body: string;
}
export const THEME: ThemeTokens = Object.freeze({
  ink: '#f6efdd', inkSoft: '#cfdcc3', parchment: '#1b2a24',
  deep: '#0b1512', panel: '#13211c', panelEdge: '#d9bd7c',
  gold: '#e7c884', goldSoft: '#8a7442', ember: '#e58b5a', moss: '#8fc07a',
  scrim: '#060d0cd9', focus: '#f6d79a',
  radius: '18px', radiusSmall: '12px', target: '44px',
  display: '"Iowan Old Style", "Palatino Linotype", Georgia, serif',
  body: 'system-ui, -apple-system, "Segoe UI", sans-serif',
});
/** Minimum touch target and minimum text contrast the theme promises. */
export const TARGET_PX = 44;
export const MIN_CONTRAST = 4.5;
const channel = (value: number) => {
  const linear = value / 255;
  return linear <= .03928 ? linear / 12.92 : ((linear + .055) / 1.055) ** 2.4;
};
export function luminance(hex: string): number {
  const value = Number.parseInt(hex.replace('#', '').slice(0, 6), 16);
  return .2126 * channel((value >> 16) & 255) + .7152 * channel((value >> 8) & 255) + .0722 * channel(value & 255);
}
/** WCAG contrast ratio; the panels keep body text above {@link MIN_CONTRAST}. */
export function contrast(a: string, b: string): number {
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}
/** The tokens as CSS custom properties, so the stylesheets below never repeat a colour. */
export const THEME_VARIABLES = `:root{
  --mv-ink:${THEME.ink};--mv-ink-soft:${THEME.inkSoft};--mv-parchment:${THEME.parchment};
  --mv-deep:${THEME.deep};--mv-panel:${THEME.panel};--mv-edge:${THEME.panelEdge};
  --mv-gold:${THEME.gold};--mv-gold-soft:${THEME.goldSoft};--mv-ember:${THEME.ember};--mv-moss:${THEME.moss};
  --mv-scrim:${THEME.scrim};--mv-focus:${THEME.focus};
  --mv-radius:${THEME.radius};--mv-radius-sm:${THEME.radiusSmall};--mv-target:${THEME.target};
  --mv-display:${THEME.display};--mv-body:${THEME.body};
}`;
/**
 * The fantasy dressing: a carved gold frame, a parchment field and a corner flourish drawn with
 * gradients only — no image, no font download, nothing fetched from anywhere.
 */
export const THEME_CSS = `${THEME_VARIABLES}
.mv-panel{background:var(--mv-scrim)}
.mv-panel-frame{
  background:
    radial-gradient(120% 90% at 50% -10%, #24382f 0%, transparent 60%),
    repeating-linear-gradient(135deg, #16241f 0 12px, #15221d 12px 24px);
  border:2px solid var(--mv-edge);
  border-radius:var(--mv-radius);
  box-shadow:0 0 0 1px #0d1714 inset, 0 18px 48px #04090899;
  color:var(--mv-ink);
  font-family:var(--mv-body);
}
.mv-panel-frame::before{
  content:'';position:absolute;inset:8px;border:1px solid #d9bd7c33;border-radius:calc(var(--mv-radius) - 6px);pointer-events:none;
}
.mv-panel-head h2{font-family:var(--mv-display);letter-spacing:.02em;
  background:linear-gradient(180deg, var(--mv-gold), #c49a52);-webkit-background-clip:text;background-clip:text;color:transparent}
.mv-panel-head p{color:var(--mv-ink-soft)}
.mv-panel button{border-color:var(--mv-gold-soft);color:var(--mv-ink);background:linear-gradient(180deg,#1c2e27,#152420)}
.mv-panel button:hover:not(:disabled){border-color:var(--mv-gold)}
.mv-panel button[aria-pressed="true"]{background:linear-gradient(180deg,var(--mv-gold),#c49a52);color:#14231d;border-color:var(--mv-gold)}
.mv-panel button:focus-visible,.mv-grid-cell:focus-visible{outline:3px solid var(--mv-focus);outline-offset:2px}
.mv-grid-cell{background:linear-gradient(180deg,#1a2a24,#142019);border-color:#3f5347}
.mv-grid-cell[aria-selected="true"]{border-color:var(--mv-gold);box-shadow:0 0 0 1px var(--mv-gold) inset}
.mv-detail{background:radial-gradient(120% 100% at 0% 0%, #22342c, #14211c);border-color:#3f5347}
.mv-detail h3{font-family:var(--mv-display);color:var(--mv-gold)}
.mv-detail p{color:var(--mv-ink-soft)}
.mv-objective b{font-family:var(--mv-display);color:var(--mv-gold)}`;
export const THEME_STYLE_ID = 'muhur-theme-style';
/** Installs the theme once per document; the panels call it before they draw. */
export function installTheme(root: Document = document): void {
  if (root.getElementById(THEME_STYLE_ID)) return;
  const style = root.createElement('style');
  style.id = THEME_STYLE_ID;
  style.textContent = THEME_CSS;
  root.head.append(style);
}
