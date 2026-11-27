import test from 'node:test';
import assert from 'node:assert/strict';

import { outcomeStats, accuracyBand } from '../assets/js/stats.js';
import { migrateEntry } from '../assets/js/storage.js';

const entries = [
  { ts: 3, plannedNadir: 100, plannedCarbs: 60, outcome: { min: 95, carbs: 60, hypo: false } },
  { ts: 2, plannedNadir: 90, plannedCarbs: 40, outcome: { min: 105, carbs: 20, hypo: false } },
  { ts: 1, plannedNadir: 110, plannedCarbs: 50, outcome: { min: 88, carbs: 50, hypo: true } },
];

test('outcome statistics summarise the logged sessions', () => {
  const stats = outcomeStats(entries);
  assert.equal(stats.logged, 3);
  assert.equal(stats.withNadir, 3);
  assert.equal(stats.hypos, 1);
  assert.equal(Math.round(stats.meanDeviation), -4);
  assert.equal(Math.round(stats.meanAbsDeviation), 14);
  assert.equal(stats.worstDeviation, -22);
  assert.equal(stats.carbSamples, 3);
  assert.equal(Math.round(stats.carbAdherence * 100), 83);
});

test('entries without outcomes are ignored', () => {
  const stats = outcomeStats([{ ts: 1, plannedNadir: 90 }, ...entries]);
  assert.equal(stats.logged, 3);
  const empty = outcomeStats([{ ts: 1, plannedNadir: 90 }]);
  assert.equal(empty.logged, 0);
  assert.equal(empty.meanAbsDeviation, null);
  assert.equal(empty.hypos, 0);
});

test('accuracy bands map the mean error to words', () => {
  assert.equal(accuracyBand(8), 'close');
  assert.equal(accuracyBand(20), 'fair');
  assert.equal(accuracyBand(40), 'wide');
  assert.equal(accuracyBand(null), 'unknown');
});

test('a v1 history entry is migrated to the current schema', () => {
  const migrated = migrateEntry({ ts: 42, sport: 'Running', glucose: 132, carbs: 25, level: 'safe', status: 'You are ready' });
  assert.equal(migrated.plannedCarbs, 25);
  assert.equal(migrated.plannedNadir, null);
  assert.equal(migrated.outcome, null);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrateEntry(null), null);
});
