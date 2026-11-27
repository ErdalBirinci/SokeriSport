/**
 * Scenario layer: hostile profiles, hand-edited share links and unit changes
 * must never produce a state the form or the engine cannot use.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULTS, toMmol } from '../assets/js/engine.js';
import { sanitizeState, encodeScenario, decodeScenario, BOUNDS } from '../assets/js/scenario.js';

test('sanitizeState drops unknown enums and keeps the defaults', () => {
  const state = sanitizeState({ sport: 'curling', trend: 'sideways', ketones: 'lots', carbType: 'liquid' });
  assert.equal(state.sport, DEFAULTS.sport);
  assert.equal(state.trend, DEFAULTS.trend);
  assert.equal(state.ketones, DEFAULTS.ketones);
  assert.equal(state.carbType, DEFAULTS.carbType);
});

test('sanitizeState clamps every number to the interface range', () => {
  const state = sanitizeState({
    glucose: 9000,
    iob: -4,
    isf: 0,
    weightKg: 5,
    durationMin: 999,
    intensity: 12,
    leadTimeMin: -30,
    basalRate: 90,
    targetGlucose: 1,
    diaHours: 0.2,
  });
  assert.equal(state.glucose, BOUNDS.glucose[1]);
  assert.equal(state.iob, 0);
  assert.equal(state.isf, BOUNDS.isf[0]);
  assert.equal(state.weightKg, BOUNDS.weightKg[0]);
  assert.equal(state.durationMin, BOUNDS.durationMin[1]);
  assert.equal(state.intensity, 4);
  assert.equal(state.leadTimeMin, 0);
  assert.equal(state.basalRate, BOUNDS.basalRate[1]);
  assert.equal(state.targetGlucose, BOUNDS.targetGlucose[0]);
  assert.equal(state.diaHours, BOUNDS.diaHours[0]);
});

test('sanitizeState survives values that are not a state at all', () => {
  for (const raw of [null, undefined, 'nope', 42, [], { glucose: 'abc', iob: NaN }]) {
    const state = sanitizeState(raw);
    assert.equal(state.sport, DEFAULTS.sport);
    assert.ok(Number.isFinite(state.glucose));
    assert.ok(Number.isFinite(state.iob));
  }
});

test('sanitizeState keeps valid values and drops unknown keys', () => {
  const state = sanitizeState({ glucose: 132, sport: 'kosu', intensity: 2, unit: 'mmol', extra: 'x' });
  assert.equal(state.glucose, 132);
  assert.equal(state.sport, 'kosu');
  assert.equal(state.intensity, 2);
  assert.equal(state.unit, 'mmol');
  assert.ok(!('extra' in state));
});

test('sanitizeState treats non-boolean flags as booleans, not strings', () => {
  const state = sanitizeState({ pump: 0, heat: 1, iobEstimated: null });
  assert.equal(state.pump, false);
  assert.equal(state.heat, true);
  assert.equal(state.iobEstimated, DEFAULTS.iobEstimated);
});

test('a share link round-trips in mg/dL', () => {
  const state = sanitizeState({
    glucose: 168,
    sport: 'basketbol',
    durationMin: 90,
    intensity: 4,
    leadTimeMin: 30,
    iob: 0.4,
    isf: 45,
    targetGlucose: 140,
    pump: false,
    basalRate: 0.85,
    carbType: 'slow',
    heat: true,
  });
  const decoded = decodeScenario(`#${encodeScenario(state)}`);
  assert.deepEqual(decoded, state);
});

test('a share link round-trips in mmol/L without double conversion', () => {
  const state = sanitizeState({ unit: 'mmol', glucose: 132, isf: 45, targetGlucose: 140 });
  const decoded = decodeScenario(`#${encodeScenario(state)}`);
  assert.ok(Math.abs(toMmol(decoded.glucose) - toMmol(state.glucose)) < 0.06);
  assert.ok(Math.abs(decoded.isf - state.isf) < 0.2);
  assert.equal(decoded.unit, 'mmol');
  assert.ok(Math.abs(decoded.glucose - 132) < 1);
});

test('a cautious-mode flag survives the link', () => {
  const decoded = decodeScenario(`#${encodeScenario({ ...DEFAULTS, iobEstimated: true })}`);
  assert.equal(decoded.iobEstimated, true);
});

test('the link carries heat and cautious mode even when both are off', () => {
  const hash = encodeScenario(sanitizeState({ ...DEFAULTS, heat: false, iobEstimated: false }));
  assert.match(hash, /(?:^|&)ht=0(?:&|$)/);
  assert.match(hash, /(?:^|&)ie=0(?:&|$)/);

  // The reader's current scenario has both on; the link must override them.
  const current = sanitizeState({ ...DEFAULTS, heat: true, iobEstimated: true });
  const decoded = decodeScenario(`#${hash}`, current);
  assert.equal(decoded.heat, false);
  assert.equal(decoded.iobEstimated, false);
});

test('both flags round-trip on and off', () => {
  for (const heat of [true, false]) {
    for (const iobEstimated of [true, false]) {
      const state = sanitizeState({ ...DEFAULTS, heat, iobEstimated });
      const decoded = decodeScenario(`#${encodeScenario(state)}`);
      assert.equal(decoded.heat, heat, `heat ${heat}`);
      assert.equal(decoded.iobEstimated, iobEstimated, `iobEstimated ${iobEstimated}`);
    }
  }
});

test('a hand-edited link cannot crash the form', () => {
  const decoded = decodeScenario('#u=mmol&g=7.3&i=99&s=../../etc&tr=nope&d=9999&isf=0&ie=maybe');
  assert.equal(decoded.intensity, 4);
  assert.equal(decoded.sport, DEFAULTS.sport);
  assert.equal(decoded.trend, DEFAULTS.trend);
  assert.equal(decoded.durationMin, BOUNDS.durationMin[1]);
  assert.equal(decoded.isf, BOUNDS.isf[0]);
  assert.equal(decoded.iobEstimated, false);
  assert.ok(Math.abs(decoded.glucose - 131.5) < 1);
});

test('a hash without a glucose value is not a scenario', () => {
  assert.equal(decodeScenario(''), null);
  assert.equal(decodeScenario('#'), null);
  assert.equal(decodeScenario('#iob=2&s=kosu'), null);
  assert.equal(decodeScenario('#g='), null);
});

test('missing link fields keep the current state', () => {
  const current = sanitizeState({ ...DEFAULTS, sport: 'yuzme', durationMin: 40, unit: 'mgdl' });
  const decoded = decodeScenario('#g=150', current);
  assert.equal(decoded.sport, 'yuzme');
  assert.equal(decoded.durationMin, 40);
  assert.equal(decoded.glucose, 150);
});

test('the encoded link is stable for the same state', () => {
  const state = sanitizeState({ glucose: 140, sport: 'kosu' });
  assert.equal(encodeScenario(state), encodeScenario(state));
  assert.ok(encodeScenario(state).includes('g=140'));
});
