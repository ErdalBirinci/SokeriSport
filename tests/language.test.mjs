/**
 * Language guard — the product is English only. This test fails the build if
 * Turkish text or the old Turkish unit shorthands (dk, sa, g/sa, /dk …) leak
 * back into the shipped sources.
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Build output, screenshots, dependencies and the tests themselves are skipped.
const SKIP_DIRS = new Set(['dist', 'screens', 'node_modules', 'icons', 'tests', '.git']);
const EXTENSIONS = /\.(?:html|js|mjs|css|md|json|webmanifest)$/;

// ç ğ ı ş ö ü Ç Ğ İ Ş Ö Ü — escaped so this file does not match itself.
const TURKISH_CHARS = /[\u00e7\u011f\u0131\u015f\u00f6\u00fc\u00c7\u011e\u0130\u015e\u00d6\u00dc]/;

// dk = min, sa / g/sa = h / g/h, mg/dL/dk, Ü/sa
const LEGACY_UNITS = /\b(?:dk|sa)\b|\/dk\b|\/sa\b/;

function collectSources() {
  const files = [];

  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (EXTENSIONS.test(entry.name)) files.push(full);
    }
  })(ROOT);

  return files.map((file) => ({
    relative: path.relative(ROOT, file).split(path.sep).join('/'),
    text: fs.readFileSync(file, 'utf8'),
  }));
}

function findMatches(sources, pattern) {
  const hits = [];
  for (const { relative, text } of sources) {
    text.split('\n').forEach((line, index) => {
      if (!pattern.test(line)) return;
      hits.push(`${relative}:${index + 1} → ${line.trim().slice(0, 120)}`);
    });
  }
  return hits;
}

const sources = collectSources();

test('the scan covers the shipped HTML, JS, CSS and README', () => {
  const names = sources.map((source) => source.relative);
  assert.ok(sources.length >= 15, `expected at least 15 source files, found ${sources.length}`);
  for (const required of ['index.html', 'app.html', 'science.html', 'README.md', 'assets/js/engine.js', 'assets/css/app.css', 'sw.js']) {
    assert.ok(names.includes(required), `scan is missing ${required}`);
  }
});

test('no Turkish characters in the shipped sources', () => {
  const hits = findMatches(sources, TURKISH_CHARS);
  assert.deepEqual(hits, [], `Turkish characters found:\n${hits.join('\n')}`);
});

test('no legacy Turkish unit shorthands (dk, sa, g/sa) in the shipped sources', () => {
  const hits = findMatches(sources, LEGACY_UNITS);
  assert.deepEqual(hits, [], `legacy unit shorthands found:\n${hits.join('\n')}`);
});
