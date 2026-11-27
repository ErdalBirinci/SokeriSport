/**
 * Golden scenarios: a refactor must not silently change the clinical output.
 * If a change is intended, regenerate with `node scripts/update-golden.mjs`
 * and review the diff as part of the pull request.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildPlan } from '../assets/js/engine.js';
import { SCENARIOS } from './fixtures/scenarios.mjs';
import { snapshot } from './fixtures/snapshot.mjs';

const expected = JSON.parse(readFileSync(new URL('./fixtures/plans.json', import.meta.url), 'utf8'));

for (const scenario of SCENARIOS) {
  test(`golden plan: ${scenario.id}`, () => {
    assert.deepEqual(snapshot(buildPlan(scenario.input)), expected[scenario.id]);
  });
}

test('a plan is generated fast enough for live typing', () => {
  const input = SCENARIOS[0].input;
  buildPlan(input); // warm up

  const runs = 200;
  const started = process.hrtime.bigint();
  for (let i = 0; i < runs; i += 1) buildPlan(input);
  const perPlan = Number(process.hrtime.bigint() - started) / 1e6 / runs;

  // Each keystroke builds the plan, its uncertainty variants and the
  // alternatives; anything near a millisecond would make the form feel slow.
  assert.ok(perPlan < 5, `one plan took ${perPlan.toFixed(2)} ms`);
  console.log(`plan build: ${perPlan.toFixed(2)} ms each`);
});
