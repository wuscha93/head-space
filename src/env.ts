// Umgebung: „live“ (echte Daten) oder „test“ (Beispieldaten, kein Sync).
// Wird beim Bauen festgelegt (KF_ENV=test bun run build.mjs). Beide Apps liegen auf derselben
// Domain (wuscha93.github.io) und teilen sich damit den Browser-Speicher. Deshalb trennt
// diese Datei alles, was im Browser gespeichert wird.

declare const __APP_ENV__: string;

export type Env = 'live' | 'test';
export const ENV: Env = typeof __APP_ENV__ === 'string' && __APP_ENV__ === 'test' ? 'test' : 'live';
export const IS_TEST = ENV === 'test';

/** Name der lokalen Datenbank. Live bleibt unverändert „kopf-frei“ (bestehende Daten). */
export const DB_NAME = IS_TEST ? 'kopf-frei-test' : 'kopf-frei';

/** Schlüssel für localStorage. Live behält die bisherigen Namen. */
export const storageKey = (name: string) => (IS_TEST ? `test:${name}` : name);
