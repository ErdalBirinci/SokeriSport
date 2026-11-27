/**
 * Rule engine tests — determinism and clinical threshold behaviour.
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPlan,
  simulate,
  normalizeInput,
  toMmol,
  carbGlucoseFactor,
  planToText,
  RULES,
  SPORTS,
  TRENDS,
} from '../assets/js/engine.js';

const base = {
  unit: 'mgdl',
  glucose: 150,
  trend: 'flat',
  iob: 1.2,
  diaHours: 4,
  isf: 45,
  carbRatio: 10,
  weightKg: 75,
  sport: 'kosu',
  durationMin: 75,
  intensity: 3,
  leadTimeMin: 20,
  ketones: 'none',
  pump: true,
  basalRate: 0.9,
  targetGlucose: 140,
};

test('the same input always produces the same plan', () => {
  const a = JSON.stringify(buildPlan(base));
  const b = JSON.stringify(buildPlan(base));
  assert.equal(a, b);
});

test('catalogue is consistent: every sport has a valid category and positive values', () => {
  assert.ok(SPORTS.length >= 10);
  for (const s of SPORTS) {
    assert.ok(s.oxidation > 0, `${s.id} oxidation`);
    assert.ok(s.sensitivity >= 1, `${s.id} sensitivity`);
  }
  assert.equal(TRENDS.length, 7);
});

test('exercise is stopped below 70 mg/dL', () => {
  const plan = buildPlan({ ...base, glucose: 62, iob: 0 });
  assert.equal(plan.status.level, 'stop');
  assert.match(plan.status.title, /hypoglycemia/i);
});

test('high ketones + high glucose stops exercise', () => {
  const plan = buildPlan({ ...base, glucose: 280, ketones: 'high' });
  assert.equal(plan.status.level, 'stop');
});

test('carbohydrate is recommended at low glucose', () => {
  const plan = buildPlan({ ...base, glucose: 95, iob: 0, trend: 'flat' });
  assert.ok(plan.preCarb.grams > 0, 'carbohydrate should be recommended');
  assert.ok(['act', 'watch', 'safe'].includes(plan.status.level));
});

test('carbohydrate need rises as IOB rises', () => {
  const low = buildPlan({ ...base, iob: 0.3 });
  const high = buildPlan({ ...base, iob: 2 });
  assert.ok(high.preCarb.grams >= low.preCarb.grams);
  assert.ok(high.numbers.effectiveIobDrop > low.numbers.effectiveIobDrop);
});

test('a longer session contains more carbohydrate', () => {
  const short = buildPlan({ ...base, durationMin: 30 });
  const long = buildPlan({ ...base, durationMin: 180 });
  const total = (p) => p.preCarb.grams + p.during.total;
  assert.ok(total(long) > total(short));
  assert.equal(short.during.needed, false);
  assert.ok(long.during.schedule.length >= 3);
});

test('the carbohydrate dose ceiling is never exceeded', () => {
  const plan = buildPlan({ ...base, iob: 6, glucose: 300, targetGlucose: 140 });
  assert.ok(plan.preCarb.grams <= plan.preCarb.cap);
  assert.ok(plan.preCarb.grams <= RULES.MAX_PRE_CARBS);
});

test('mmol/L input gives an equivalent result to mg/dL', () => {
  const mg = buildPlan({ ...base, glucose: 150, isf: 45, targetGlucose: 140 });
  const mmol = buildPlan({
    ...base,
    unit: 'mmol',
    glucose: Number(toMmol(150).toFixed(2)),
    isf: Number(toMmol(45).toFixed(2)),
    targetGlucose: Number(toMmol(140).toFixed(2)),
  });
  assert.ok(Math.abs(mg.preCarb.grams - mmol.preCarb.grams) <= 5);
  assert.ok(Math.abs(mg.numbers.startProjected - mmol.numbers.startProjected) < 1);
});

test('a falling trend requires more carbohydrate', () => {
  const flat = buildPlan({ ...base, trend: 'flat' });
  const falling = buildPlan({ ...base, trend: 'down' });
  assert.ok(falling.preCarb.grams >= flat.preCarb.grams);
  assert.ok(falling.numbers.startProjected < flat.numbers.startProjected);
});

test('basal reduction stays within 0–80', () => {
  for (const durationMin of [15, 75, 240]) {
    const plan = buildPlan({ ...base, durationMin });
    assert.ok(plan.basal.reductionPercent >= 0 && plan.basal.reductionPercent <= 80);
  }
});

test('the planned simulation tracks better than the no-carb scenario', () => {
  const plan = buildPlan({ ...base, glucose: 160, iob: 2, durationMin: 90, sport: 'kosu' });
  assert.ok(plan.simulation.nadir >= plan.simulation.baselineNadir);
  assert.ok(plan.simulation.points.length > 20);
});

test('the simulation is deterministic and within limits', () => {
  const plan = buildPlan({ ...base, durationMin: 120 });
  const again = simulate(plan.input, {
    preCarb: plan.preCarb,
    during: plan.during,
    sport: plan.sport,
    oxidation: plan.numbers.oxidation,
    carbFactor: plan.numbers.carbFactor,
    trend: plan.trend,
    level: plan.level,
  });
  assert.deepEqual(plan.simulation.points, again.points);
  for (const p of plan.simulation.points) {
    assert.ok(p.g >= 40 && p.g <= 350, `glucose limit: ${p.g}`);
  }
});

test('normalizeInput clamps the ranges', () => {
  const input = normalizeInput({ glucose: 9000, iob: 99, durationMin: 9999, weightKg: 5, intensity: 9 });
  assert.equal(input.glucose, 600);
  assert.equal(input.iob, 30);
  assert.equal(input.durationMin, 240);
  assert.equal(input.weightKg, 30);
  assert.equal(input.intensity, 4);
});

test('the carbohydrate coefficient falls as body weight rises', () => {
  assert.ok(carbGlucoseFactor(50) > carbGlucoseFactor(100));
});

test('planToText produces shareable text', () => {
  const plan = buildPlan(base);
  const text = planToText(plan);
  assert.match(text, /SokeriSport/);
  assert.match(text, /BEFORE EXERCISE/);
  assert.match(text, /For education only/);
});

test('the warning list is never empty in critical situations', () => {
  const plan = buildPlan({ ...base, iob: 4, trend: 'doubleDown', glucose: 110 });
  assert.ok(plan.warnings.length >= 2);
  assert.ok(plan.risks.hypo > 40);
});
