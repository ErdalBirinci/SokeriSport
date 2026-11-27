/**
 * CSV export: correct columns, correct quoting, and no spreadsheet formulas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { csvCell, historyToCsv } from '../assets/js/csv.js';

test('cells are quoted and embedded quotes are doubled', () => {
  assert.equal(csvCell('Indoor soccer'), '"Indoor soccer"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(0), '"0"');
});

test('values that a spreadsheet would execute are neutralised', () => {
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell('+1+1'), `"'+1+1"`);
  assert.equal(csvCell('-2'), `"'-2"`);
  assert.equal(csvCell('@SUM(A1)'), `"'@SUM(A1)"`);
  assert.equal(csvCell('2026-11-27T10:00:00.000Z'), '"2026-11-27T10:00:00.000Z"');
});

test('an empty history still produces the header', () => {
  const csv = historyToCsv([]);
  assert.equal(csv.split('\n').length, 1);
  assert.match(csv, /^date,sport,duration_min/);
});

test('each history entry becomes one row with plan and outcome values', () => {
  const csv = historyToCsv([
    {
      ts: Date.UTC(2026, 10, 27, 9, 30),
      sport: 'Running',
      durationMin: 75,
      intensity: 'High',
      glucose: 132,
      plannedCarbs: 40,
      duringPerHour: 45,
      basalPercent: 50,
      plannedNadir: 95,
      outcome: { start: 130, min: 88, carbs: 35, hypo: true },
    },
  ]);
  const [header, row] = csv.split('\n');
  assert.equal(header.split(',').length, row.split(',').length);
  assert.match(row, /2026-11-27T09:30:00.000Z/);
  assert.match(row, /"Running"/);
  assert.match(row, /"132"/);
  assert.match(row, /"88"/);
  assert.match(row, /"yes"$/);
});

test('missing outcome values stay empty instead of printing undefined', () => {
  const csv = historyToCsv([{ ts: Date.UTC(2026, 0, 2), sport: 'Walking', glucose: 140, carbs: 0 }]);
  assert.ok(!/undefined/.test(csv));
  assert.match(csv, /"no"$/);
});
