import './style.css';
import { startGame, type GameShell } from './app/shell';
import { RecoveryScreen } from './ui/recovery/recovery-screen';
import { downloadRaw, exportRawRecord } from './ui/recovery/raw-export';
import { BASE_DB_NAME, dbNameFor, rememberSlot, rememberedSlot } from './ui/recovery/slots';

/** Entry point: the G00 preview scene is gone; this boots the real game. */
export async function mountGame(root: HTMLElement): Promise<GameShell> {
  root.replaceChildren();
  const stage = document.createElement('main');
  stage.className = 'mv-stage';
  stage.setAttribute('aria-label', 'Mühür Vadisi');
  const status = document.createElement('p');
  status.className = 'mv-boot';
  status.setAttribute('role', 'status');
  status.textContent = 'Vadi yükleniyor…';
  stage.append(status);
  root.append(stage);
  try {
    const shell = await startGame(stage);
    status.remove();
    return shell;
  } catch (error) {
    status.className = 'mv-boot mv-boot-error';
    const message = error instanceof Error ? error.message : 'Oyun başlatılamadı. Tarayıcıyı yenileyip tekrar deneyin.';
    status.textContent = `Oyun başlatılamadı: ${message}`;
    // The world never opened, so the slot screen is the only way out: retry, take the raw record
    // out, or start a fresh game in a slot. Nothing here deletes a save.
    const screen = new RecoveryScreen(stage, {
      onRetry: () => window.location.reload(),
      onExport: () => void exportRawRecord(dbNameFor(rememberedSlot())).then((raw) => downloadRaw(raw, BASE_DB_NAME)).catch(() => undefined),
      onContinue: (slot) => { rememberSlot(slot); window.location.reload(); },
      onStart: (slot) => { rememberSlot(slot); window.location.reload(); },
    });
    screen.update([{ slot: rememberedSlot(), status: 'corrupt', error: message }], message);
    throw error;
  }
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('app');
  if (root) {
    const pending = mountGame(root).catch(() => null);
    import.meta.hot?.dispose(() => { void pending.then((shell) => shell?.dispose()); });
  }
}
