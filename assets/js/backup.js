/**
 * Password-protected local backup.
 *
 * The JSON export is encrypted in the browser with AES-GCM 256; the key is
 * derived from the user's password with PBKDF2-SHA256. No password, salt or key
 * is stored anywhere: losing the password means losing the backup.
 *
 * Plaintext snapshots written by earlier builds are still recognised by
 * parseBackupText() and imported as before.
 */

const FORMAT = 'sokerisport-backup';
const FORMAT_VERSION = 1;

export const MIN_PASSWORD_LENGTH = 8;
export const KDF_ITERATIONS = 250_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(String(text));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Checks the two password fields of the export form before any key derivation.
 * The confirmation exists so a single-character typo cannot produce a backup
 * that nobody can open.
 * @returns {{ok: true} | {ok: false, reason: 'too-short' | 'mismatch'}}
 */
export function validateBackupPassword(password, confirmation = password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: 'too-short' };
  }
  if (password !== confirmation) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}

const weakPassword = () =>
  Object.assign(new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`), {
    code: 'weak-password',
  });

async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** True for an envelope produced by encryptSnapshot(). */
export function isEncryptedBackup(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      value.format === FORMAT &&
      Number(value.formatVersion) === FORMAT_VERSION &&
      typeof value.data === 'string' &&
      value.kdf &&
      typeof value.kdf.salt === 'string' &&
      value.cipher &&
      typeof value.cipher.iv === 'string',
  );
}

/**
 * Encrypts a snapshot (see storage.exportSnapshot) into a JSON-ready envelope.
 * A fresh salt and IV are generated for every export.
 * @throws {Error & {code:'weak-password'}} when the password is too short
 */
export async function encryptSnapshot(snapshot, password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) throw weakPassword();

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, KDF_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(snapshot)),
  );

  return {
    app: 'SokeriSport',
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: KDF_ITERATIONS,
      salt: toBase64(salt),
    },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    data: toBase64(new Uint8Array(ciphertext)),
  };
}

/** A hostile file must not be able to force an expensive KDF run. */
const safeIterations = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 10_000 && number <= 2_000_000 ? number : KDF_ITERATIONS;
};

/**
 * Decrypts an envelope. AES-GCM authenticates the ciphertext, so a wrong
 * password and a modified file both fail here instead of producing garbage.
 * @returns {Promise<{ok: true, snapshot: object} | {ok: false, reason: string}>}
 */
export async function decryptSnapshot(envelope, password) {
  if (!isEncryptedBackup(envelope)) return { ok: false, reason: 'not-encrypted' };
  if (typeof password !== 'string' || password === '') return { ok: false, reason: 'password-required' };

  try {
    const salt = fromBase64(envelope.kdf.salt);
    const iv = fromBase64(envelope.cipher.iv);
    const key = await deriveKey(password, salt, safeIterations(envelope.kdf.iterations));
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, fromBase64(envelope.data));
    const snapshot = JSON.parse(decoder.decode(plaintext));
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.history)) {
      return { ok: false, reason: 'corrupt' };
    }
    return { ok: true, snapshot };
  } catch {
    // Wrong password, tampered ciphertext or unreadable base64.
    return { ok: false, reason: 'bad-password' };
  }
}

/**
 * Classifies the text of a chosen backup file.
 * @returns {{kind:'encrypted', envelope: object} | {kind:'plain', snapshot: object} | {kind:'invalid', reason: string}}
 */
export function parseBackupText(text) {
  let data;
  try {
    data = JSON.parse(String(text ?? ''));
  } catch {
    return { kind: 'invalid', reason: 'not-json' };
  }

  if (isEncryptedBackup(data)) return { kind: 'encrypted', envelope: data };
  if (data && typeof data === 'object' && Array.isArray(data.history)) {
    return { kind: 'plain', snapshot: data };
  }
  return { kind: 'invalid', reason: 'not-a-backup' };
}
