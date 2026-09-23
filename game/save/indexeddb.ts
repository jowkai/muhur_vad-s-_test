import type { SavePort } from '../../contracts';

export class SaveError extends Error {
  constructor(readonly code: 'corrupt' | 'version' | 'quota' | 'storage' | 'mutation', message: string) {
    super(message); this.name = 'SaveError';
  }
}
function storageError(error: unknown): SaveError {
  if (error instanceof SaveError) return error;
  return new SaveError(error instanceof DOMException && error.name === 'QuotaExceededError' ? 'quota' : 'storage',
    error instanceof DOMException && error.name === 'QuotaExceededError'
      ? 'Kayıt alanı dolu. Kaydınızı dışa aktarın, alan açıp tekrar deneyin.'
      : 'Kayıt işlemi tamamlanamadı. Mevcut kayıt silinmedi; tekrar deneyin.');
}
interface Envelope<T> { version: 2; state: T; migrated?: boolean }
interface Ledger<T> { result: Envelope<T> }
export type FaultPoint = 'after-backup' | 'after-state' | 'after-ledger';
export interface SaveOptions<T> {
  name: string;
  initial: () => T;
  /** Domain schema lives with its owner; invalid data must throw. Never repairs silently. */
  validate: (value: unknown) => asserts value is T;
  factory?: IDBFactory;
  /**
   * Pure schema upgrade applied before validation. A record it changes is written back in the
   * same transaction with the previous raw value kept as `backup`; it never deletes anything.
   */
  migrate?: (state: unknown) => unknown;
  /** For transaction-abort tests only, not a simulation of successful storage. */
  fault?: (point: FaultPoint) => void;
}

/** One readwrite transaction spans state, previous backup and command results. */
export class IndexedDbSave<T> implements SavePort<T> {
  private constructor(private readonly db: IDBDatabase, private readonly options: SaveOptions<T>) {}

  static open<T>(options: SaveOptions<T>): Promise<IndexedDbSave<T>> {
    return new Promise((resolve, reject) => {
      let abandoned = false;
      let request: IDBOpenDBRequest;
      try { request = (options.factory ?? indexedDB).open(options.name, 1); }
      catch (error) { reject(storageError(error)); return; }
      request.onupgradeneeded = () => {
        request.result.createObjectStore('records');
        request.result.createObjectStore('commands');
      };
      request.onblocked = () => {
        abandoned = true;
        reject(new SaveError('storage', 'Kayıt başka bir sekmede açık. Diğer sekmeyi kapatıp tekrar deneyin.'));
      };
      request.onerror = () => reject(storageError(request.error));
      request.onsuccess = () => {
        if (abandoned) { request.result.close(); return; }
        request.result.onversionchange = () => request.result.close();
        resolve(new IndexedDbSave(request.result, options));
      };
    });
  }

  private decode(raw: unknown): Envelope<T> {
    if (!raw || typeof raw !== 'object' || !('version' in raw)) throw new SaveError('corrupt', 'Kayıt yapısı bozuk. Ham kaydı dışa aktarabilirsiniz; veri silinmedi.');
    if (raw.version !== 1 && raw.version !== 2) throw new SaveError('version', 'Bu kayıt sürümü desteklenmiyor. Ham kaydı dışa aktarın; veri silinmedi.');
    // v1 storage envelope used data; v2 uses state. Gameplay schema is independently validated.
    const state: unknown = raw.version === 1 ? ('data' in raw ? raw.data : undefined) : ('state' in raw ? raw.state : undefined);
    let upgraded = state;
    try { if (this.options.migrate) upgraded = this.options.migrate(state); }
    catch { throw new SaveError('corrupt', 'Kayıt yükseltilemedi. Ham kaydı dışa aktarabilirsiniz; veri silinmedi.'); }
    try { this.options.validate(upgraded); }
    catch { throw new SaveError('corrupt', 'Kayıt içeriği geçersiz. Ham kaydı dışa aktarabilirsiniz; veri silinmedi.'); }
    return { version: 2, state: upgraded, migrated: upgraded !== state };
  }

  private transaction<R>(mode: IDBTransactionMode, work: (tx: IDBTransaction, finish: (result: R) => void, fail: (error: unknown) => void) => void): Promise<R> {
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = this.db.transaction(['records', 'commands'], mode); }
      catch (error) { reject(storageError(error)); return; }
      let result: R;
      let failure: unknown;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(storageError(failure ?? tx.error));
      const fail = (error: unknown) => { failure = error; tx.abort(); };
      try { work(tx, (value) => { result = value; }, fail); }
      catch (error) { fail(error); }
    });
  }

  load(): Promise<T | null> {
    return this.transaction('readwrite', (tx, finish, fail) => {
      const records = tx.objectStore('records');
      const request = records.get('current');
      request.onsuccess = () => {
        try {
          if (request.result === undefined) { finish(null); return; }
          const decoded = this.decode(request.result);
          if (request.result.version === 1 || decoded.migrated) {
            records.put(request.result, 'backup');
            records.put({ version: 2, state: decoded.state } satisfies Envelope<T>, 'current');
          }
          finish(decoded.state);
        } catch (error) { fail(error); }
      };
    });
  }

  transact(commandId: string, mutate: (draft: T) => void): Promise<T> {
    if (!commandId.trim()) return Promise.reject(new SaveError('mutation', 'İşlem kimliği boş olamaz.'));
    return this.transaction('readwrite', (tx, finish, fail) => {
      const records = tx.objectStore('records');
      const commands = tx.objectStore('commands');
      const current = records.get('current');
      current.onsuccess = () => {
        try {
          const state = current.result === undefined ? this.options.initial() : this.decode(current.result).state;
          this.options.validate(state);
          const prior = commands.get(commandId);
          prior.onsuccess = () => {
            try {
              if (prior.result !== undefined) {
                const entry = prior.result as Ledger<T>;
                finish(this.decode(entry.result).state); return;
              }
              const draft = structuredClone(state);
              const returned: unknown = mutate(draft);
              if (returned && typeof returned === 'object' && 'then' in returned) {
                // Observe a rejected async callback but never allow its draft to commit.
                void Promise.resolve(returned).catch(() => undefined);
                throw new SaveError('mutation', 'Kayıt değişikliği eşzamanlı olmalı; async/await kullanılamaz.');
              }
              this.options.validate(draft);
              const result: Envelope<T> = { version: 2, state: draft };
              if (current.result !== undefined) records.put(current.result, 'backup');
              this.options.fault?.('after-backup');
              records.put(result, 'current');
              this.options.fault?.('after-state');
              commands.put({ result } satisfies Ledger<T>, commandId);
              this.options.fault?.('after-ledger');
              finish(structuredClone(draft));
            } catch (error) { fail(error); }
          };
        } catch (error) { fail(error); }
      };
    });
  }

  /** Includes unvalidated/corrupt records and the ledger; never modifies storage. */
  exportRaw(): Promise<{ records: [IDBValidKey, unknown][]; commands: [IDBValidKey, unknown][] }> {
    return this.transaction('readonly', (tx, finish) => {
      const result: { records: [IDBValidKey, unknown][]; commands: [IDBValidKey, unknown][] } = { records: [], commands: [] };
      for (const name of ['records', 'commands'] as const) {
        const cursor = tx.objectStore(name).openCursor();
        cursor.onsuccess = () => {
          if (cursor.result) { result[name].push([cursor.result.key, cursor.result.value]); cursor.result.continue(); }
        };
      }
      finish(result);
    });
  }

  close(): void { this.db.close(); }
}
