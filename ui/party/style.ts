/** Styling for the six-slot strip; it lives in the bottom dock under the tab bar. */
export const PARTY_CSS = `
.mv-party{display:flex;gap:8px;padding:8px;pointer-events:auto;max-width:100%;overflow-x:auto;scrollbar-width:none;
  background:radial-gradient(120% 120% at 50% -30%, #24382f 0%, #0f1b18f2 70%);
  border:2px solid var(--mv-edge,#d9bd7c);border-radius:16px;box-shadow:0 0 0 1px #0d1714 inset}
.mv-party::-webkit-scrollbar{display:none}
.mv-party-slot{display:flex;flex-direction:column;align-items:center;gap:3px;width:104px;min-height:112px;padding:8px 6px;
  border-radius:14px;border:1px solid #d9bd7c44;background:linear-gradient(180deg,#1b2d26,#14201c);
  color:#f6efdd;font:inherit;font-size:12px;cursor:pointer}
.mv-party-slot[disabled]{cursor:not-allowed;opacity:.6}
.mv-party-slot.mv-empty{border-style:dashed;opacity:.5}
.mv-party-slot.mv-active{border-color:#d9bd7c;background:#26382f}
.mv-party-slot.mv-fainted .mv-party-sprite{filter:grayscale(1);opacity:.5}
.mv-party-slot:focus-visible{outline:3px solid #f0c987;outline-offset:2px}
.mv-party-sprite{display:block;width:52px;height:52px;background-size:contain;background-repeat:no-repeat;background-position:center}
.mv-party-name{max-width:92px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mv-party-level{font-size:11px;color:#cfdcc3}
.mv-party-roles{display:flex;gap:3px;min-height:14px}
.mv-party-role{display:inline-block;padding:0 5px;border-radius:7px;font-size:10px;line-height:14px;
  background:#d9bd7c;color:#14231d;font-weight:600}
.mv-party-role[data-locked="true"]{background:#3f5347;color:#cfdcc3}
.mv-party-slot.mv-mounted{border-color:#e7c884;box-shadow:0 0 0 2px #e7c88455}
.mv-party-track{display:block;width:86px;height:7px;border-radius:3px;background:#22322c;overflow:hidden}
.mv-party-fill{display:block;height:100%;background:#8fc07a}
.mv-party-fill.mv-low{background:#e1734f}
.mv-party-hp{font-size:10px;color:#e6dcc0}
@media (max-width:640px){
 .mv-party{width:100%;gap:4px;padding:4px}
 .mv-party-slot{width:auto;flex:1 1 0;min-width:52px;min-height:88px;padding:6px 3px}
 .mv-party-sprite{width:38px;height:38px}
 .mv-party-name{display:none}
 .mv-party-roles{display:none}
 .mv-party-track{width:100%}
}`;
