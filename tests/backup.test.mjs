/**
 * Encrypted backup: round-trips, failure modes and compatibility with the
 * plaintext files written by earlier builds.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encryptSnapshot,
  decryptSnapshot,
  isEncryptedBackup,
  parseBackupText,
  validateBackupPassword,
  MIN_PASSWORD_LENGTH,
} from '../assets/js/backup.js';

const PASSWORD = 'correct horse battery';
const snapshot = {
  app: 'SokeriSport',
  schemaVersion: 2,
  exportedAt: '2026-11-27T10:00:00.000Z',
  profile: { unit: 'mmol', weightKg: 74, isf: 45 },
  history: [
    { ts: 1, sport: 'Running', glucose: 132, plannedNadir: 95, outcome: { min: 88, hypo: false } },
  ],
};

test('an export is encrypted, not just renamed', async () => {
  const envelope = await encryptSnapshot(snapshot, PASSWORD);
  assert.equal(isEncryptedBackup(envelope), true);

  const packed = JSON.stringify(envelope);
  assert.ok(!packed.includes('Running'), 'sport name must not be readable');
  assert.ok(!packed.includes('132'), 'glucose value must not be readable');
  assert.ok(!packed.includes(PASSWORD), 'the password must never be inside the file');
  assert.equal(envelope.kdf.name, 'PBKDF2');
  assert.equal(envelope.kdf.hash, 'SHA-256');
  assert.equal(envelope.cipher.name, 'AES-GCM');
  assert.ok(envelope.data.length > 100);
});

test('salt and IV are fresh for every export', async () => {
  const first = await encryptSnapshot(snapshot, PASSWORD);
  const second = await encryptSnapshot(snapshot, PASSWORD);
  assert.notEqual(first.kdf.salt, second.kdf.salt);
  assert.notEqual(first.cipher.iv, second.cipher.iv);
  assert.notEqual(first.data, second.data);
});

test('the right password restores the snapshot exactly', async () => {
  const envelope = await encryptSnapshot(snapshot, PASSWORD);
  const result = await decryptSnapshot(envelope, PASSWORD);
  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot, snapshot);
});

test('a wrong password fails and returns no data', async () => {
  const envelope = await encryptSnapshot(snapshot, PASSWORD);
  const result = await decryptSnapshot(envelope, 'wrong password');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bad-password');
  assert.equal(result.snapshot, undefined);
});

test('a missing password is reported before any decryption attempt', async () => {
  const envelope = await encryptSnapshot(snapshot, PASSWORD);
  const result = await decryptSnapshot(envelope, '');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'password-required');
});

test('tampering with the ciphertext is detected', async () => {
  const envelope = await encryptSnapshot(snapshot, PASSWORD);
  const index = 20;
  const flipped = envelope.data[index] === 'A' ? 'B' : 'A';
  const tampered = { ...envelope, data: envelope.data.slice(0, index) + flipped + envelope.data.slice(index + 1) };

  const result = await decryptSnapshot(tampered, PASSWORD);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bad-password');
});

test('the export form rejects a typo in the confirmation field', () => {
  assert.deepEqual(validateBackupPassword('correct horse battery', 'correct horse battery'), { ok: true });
  assert.deepEqual(validateBackupPassword('correct horse battery', 'correct horse batterz'), {
    ok: false,
    reason: 'mismatch',
  });
  assert.deepEqual(validateBackupPassword('short', 'short'), { ok: false, reason: 'too-short' });
  assert.deepEqual(validateBackupPassword('', ''), { ok: false, reason: 'too-short' });
});

test('a one-character typo would otherwise make the backup unreadable', async () => {
  const password = 'correct horse battery';
  const typo = 'correct horse batterz';
  const envelope = await encryptSnapshot(snapshot, password);

  assert.equal(validateBackupPassword(password, typo).ok, false);
  const attempt = await decryptSnapshot(envelope, typo);
  assert.equal(attempt.ok, false);
});

test('a short password is refused instead of silently weakening the backup', async () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  await assert.rejects(
    () => encryptSnapshot(snapshot, 'short'),
    (error) => error.code === 'weak-password',
  );
  await assert.rejects(
    () => encryptSnapshot(snapshot, ''),
    (error) => error.code === 'weak-password',
  );
});

test('plaintext backups from earlier builds are still recognised', () => {
  const parsed = parseBackupText(JSON.stringify(snapshot));
  assert.equal(parsed.kind, 'plain');
  assert.deepEqual(parsed.snapshot, snapshot);
});

test('an encrypted envelope is recognised from the file text', async () => {
  const envelope = await encryptSnapshot(snapshot, PASSWORD);
  const parsed = parseBackupText(JSON.stringify(envelope, null, 2));
  assert.equal(parsed.kind, 'encrypted');
  assert.equal(parsed.envelope.formatVersion, 1);
});

test('unrelated JSON and broken text are rejected', () => {
  assert.equal(parseBackupText('not json').kind, 'invalid');
  assert.equal(parseBackupText('').kind, 'invalid');
  assert.equal(parseBackupText('{}').kind, 'invalid');
  assert.equal(parseBackupText(JSON.stringify({ history: 'nope' })).kind, 'invalid');
});

test('a decrypted payload that is not a backup is rejected', async () => {
  const envelope = await encryptSnapshot({ hello: 'world' }, PASSWORD);
  const result = await decryptSnapshot(envelope, PASSWORD);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'corrupt');
});

test('a plain envelope-shaped object without a payload is refused', () => {
  assert.equal(isEncryptedBackup({ format: 'sokerisport-backup', formatVersion: 1 }), false);
  assert.equal(isEncryptedBackup(snapshot), false);
});
