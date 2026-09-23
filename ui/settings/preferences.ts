/** Everything the player can set. Nothing here touches the save: preferences are per device. */
export type ActionId = 'up' | 'down' | 'left' | 'right' | 'interact' | 'pause';
export interface Preferences {
  readonly volume: number;
  readonly reducedMotion: boolean;
  readonly keys: Readonly<Record<ActionId, string>>;
}
export const ACTIONS: readonly { readonly id: ActionId; readonly label: string }[] = Object.freeze([
  Object.freeze({ id: 'up', label: 'İleri' }),
  Object.freeze({ id: 'down', label: 'Geri' }),
  Object.freeze({ id: 'left', label: 'Sola' }),
  Object.freeze({ id: 'right', label: 'Sağa' }),
  Object.freeze({ id: 'interact', label: 'Etkileşim' }),
  Object.freeze({ id: 'pause', label: 'Duraklat' }),
]);
export const DEFAULT_PREFERENCES: Preferences = Object.freeze({
  volume: .6, reducedMotion: false,
  keys: Object.freeze({ up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', interact: 'Enter', pause: 'KeyP' }),
});
export const PREFERENCES_KEY = 'muhur-vadisi:preferences';
/** Keys the game needs for itself; a binding may never take one of them. */
export const RESERVED_KEYS: readonly string[] = Object.freeze(['Escape', 'Tab', 'F5']);
const clamp = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, Math.round(value * 100) / 100)) : fallback;
const validKey = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 24 && !RESERVED_KEYS.includes(value);
/** Anything stored by an older build, or by nobody at all, still reads as a full valid set. */
export function normalizePreferences(raw: unknown): Preferences {
  const record = raw && typeof raw === 'object' ? raw as Partial<Preferences> : {};
  const storedKeys = record.keys && typeof record.keys === 'object' ? record.keys as Record<string, unknown> : {};
  const keys: Record<ActionId, string> = { ...DEFAULT_PREFERENCES.keys };
  for (const action of ACTIONS) {
    const candidate = storedKeys[action.id];
    if (validKey(candidate)) keys[action.id] = candidate;
  }
  // A duplicate binding would silently disable an action, so the later one falls back.
  const seen = new Set<string>();
  for (const action of ACTIONS) {
    if (seen.has(keys[action.id])) keys[action.id] = DEFAULT_PREFERENCES.keys[action.id];
    seen.add(keys[action.id]);
  }
  return Object.freeze({
    volume: clamp(record.volume, DEFAULT_PREFERENCES.volume),
    reducedMotion: record.reducedMotion === true,
    keys: Object.freeze(keys),
  });
}
export interface PreferenceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
function store(explicit?: PreferenceStore | null): PreferenceStore | null {
  if (explicit) return explicit;
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
/** Reading never throws: a private window, a blocked origin or broken JSON all give defaults. */
export function loadPreferences(explicit?: PreferenceStore | null): Preferences {
  try {
    const raw = store(explicit)?.getItem(PREFERENCES_KEY);
    return normalizePreferences(raw ? JSON.parse(raw) : null);
  } catch { return DEFAULT_PREFERENCES; }
}
/** Writing never throws either; it answers whether the preference will survive a reload. */
export function savePreferences(preferences: Preferences, explicit?: PreferenceStore | null): boolean {
  try {
    const target = store(explicit);
    if (!target) return false;
    target.setItem(PREFERENCES_KEY, JSON.stringify(normalizePreferences(preferences)));
    return true;
  } catch { return false; }
}
export interface RebindResult { readonly preferences: Preferences; readonly error: string | null }
/** Rebinding is a pure step: it either returns a new set or says why it refused. */
export function rebind(preferences: Preferences, action: ActionId, key: string): RebindResult {
  if (!ACTIONS.some((entry) => entry.id === action)) return { preferences, error: 'Bilinmeyen eylem' };
  if (!validKey(key)) return { preferences, error: 'Bu tuş kullanılamaz' };
  const taken = ACTIONS.find((entry) => entry.id !== action && preferences.keys[entry.id] === key);
  if (taken) return { preferences, error: `Bu tuş "${taken.label}" için kullanılıyor` };
  return {
    preferences: Object.freeze({ ...preferences, keys: Object.freeze({ ...preferences.keys, [action]: key }) }),
    error: null,
  };
}
export const resetPreferences = (): Preferences => DEFAULT_PREFERENCES;
