/**
 * Regenerates tests/fixtures/plans.json from the current engine.
 * Run it only when a clinical change is intended: the diff is the review.
 * Usage: node scripts/update-golden.mjs
 */
import { writeFileSync } from 'node:fs';
import { buildPlan } from '../assets/js/engine.js';
import { SCENARIOS } from '../tests/fixtures/scenarios.mjs';
import { snapshot } from '../tests/fixtures/snapshot.mjs';

const out = {};
for (const scenario of SCENARIOS) out[scenario.id] = snapshot(buildPlan(scenario.input));

writeFileSync(new URL('../tests/fixtures/plans.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
console.log(`Golden fixture written for ${SCENARIOS.length} scenarios.`);
