import { IndexedDbSave } from '../../game/save/indexeddb';
import { BASE_DB_NAME } from './slots';

/**
 * Reads a record without validating it, so the raw export a storage error promises works even
 * when the save is exactly the thing that cannot be loaded. It never writes or deletes.
 */
export async function exportRawRecord(dbName: string = BASE_DB_NAME): Promise<unknown> {
  const save = await IndexedDbSave.open<unknown>({
    name: dbName, initial: () => ({}), validate: () => undefined,
  });
  try { return await save.exportRaw(); } finally { save.close(); }
}
/** Turns the raw record into a download the player keeps; the browser does the saving. */
export function downloadRaw(raw: unknown, name = 'muhur-vadisi-ham-kayit'): void {
  const blob = new Blob([JSON.stringify(raw, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
