// Verschlüsselung mit der Web Crypto API des Browsers (keine externe Bibliothek).
// Schlüssel: PBKDF2-SHA256 aus der Passphrase, 600'000 Iterationen (OWASP-Empfehlung).
// Verfahren: AES-256-GCM (verschlüsselt und erkennt Manipulation).

export interface EncryptedFile {
  format: 'kopf-frei-backup';
  version: 1;
  kdf: { name: 'PBKDF2-SHA256'; iterations: number; salt: string };
  cipher: { name: 'AES-256-GCM'; iv: string };
  data: string;
}

const ITERATIONS = 600_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(pass: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJSON(value: unknown, pass: string): Promise<EncryptedFile> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt, ITERATIONS);
  const plain = enc.encode(JSON.stringify(value));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return {
    format: 'kopf-frei-backup',
    version: 1,
    kdf: { name: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: toB64(salt) },
    cipher: { name: 'AES-256-GCM', iv: toB64(iv) },
    data: toB64(cipher),
  };
}

export async function decryptJSON<T>(file: EncryptedFile, pass: string): Promise<T> {
  if (file?.format !== 'kopf-frei-backup' || file.version !== 1) {
    throw new Error('Das ist keine Backup-Datei dieser App.');
  }
  const key = await deriveKey(pass, fromB64(file.kdf.salt), file.kdf.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(file.cipher.iv) }, key, fromB64(file.data));
  } catch {
    throw new Error('Passphrase falsch oder Datei beschädigt.');
  }
  return JSON.parse(dec.decode(plain)) as T;
}

// ---------- Für den Sync: Schlüssel einmal ableiten, auf dem Gerät nicht exportierbar speichern ----------

export interface Sealed { iv: string; data: string }

export const SYNC_ITERATIONS = ITERATIONS;
export const randomSalt = () => toB64(crypto.getRandomValues(new Uint8Array(16)));

/** Leitet den AES-Schlüssel aus der Passphrase ab. Nicht exportierbar: auch die App selbst kann ihn nicht auslesen. */
export function syncKeyFromPassphrase(pass: string, saltB64: string, iterations: number): Promise<CryptoKey> {
  return deriveKey(pass, fromB64(saltB64), iterations);
}

export async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value))));
  return { iv: toB64(iv), data: toB64(cipher) };
}

export async function unseal<T>(key: CryptoKey, s: Sealed): Promise<T> {
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(s.iv) }, key, fromB64(s.data));
  } catch {
    throw new Error('Entschlüsseln fehlgeschlagen: falsche Passphrase oder beschädigte Datei.');
  }
  return JSON.parse(dec.decode(plain)) as T;
}

/** UTF-8-sicheres Base64 für die GitHub-API */
export const textToB64 = (t: string) => toB64(enc.encode(t));
export const b64ToText = (b: string) => dec.decode(fromB64(b.replace(/\s/g, '')));
