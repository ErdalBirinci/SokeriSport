/**
 * The version shown in diagnostics, the package and the service-worker cache
 * must not drift apart: a stale number makes bug reports unusable and a stale
 * cache version keeps users on the old bundle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { APP_VERSION } from '../assets/js/version.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the app version matches package.json', () => {
  const { version } = JSON.parse(read('package.json'));
  assert.equal(APP_VERSION, version);
});

test('the service worker cache version carries the same release', () => {
  const match = read('sw.js').match(/VERSION\s*=\s*'([^']+)'/);
  assert.ok(match, 'sw.js has no VERSION constant');
  assert.ok(match[1].endsWith(APP_VERSION), `${match[1]} should end with ${APP_VERSION}`);
});

test('the new modules are part of the offline shell', () => {
  const shell = read('sw.js');
  for (const file of ['scenario.js', 'csv.js', 'backup.js', 'version.js']) {
    assert.ok(shell.includes(`assets/js/${file}`), `sw.js SHELL is missing ${file}`);
  }
});
