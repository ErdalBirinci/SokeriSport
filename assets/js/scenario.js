/**
 * Scenario state: sanitisation and share-link serialisation.
 *
 * The interface keeps every glucose value in mg/dL and the display unit
 * separately. A profile read from localStorage, a hand-edited share link or an
 * imported backup is untrusted input: without this layer a single unknown sport
 * id or an out-of-range number could leave the form in a state the engine and
 * the DOM cannot render. Pure functions only: no DOM, no storage, so both are
 * covered by the tests.
 */

import { DEFAULTS, SPORTS, TRENDS, KETONES, INTENSITIES, toMmol, fromMmol } from './engine.js';

/** Bounds mirror the form controls and normalizeInput(). */
export const BOUNDS = {
  glucose: [30, 600],
  iob: [0, 30],
  diaHours: [2, 7],
  isf: [3, 300],
  carbRatio: [2, 60],
  weightKg: [30, 160],
  durationMin: [10, 240],
  leadTimeMin: [0, 120],
  basalRate: [0, 5],
  targetGlucose: [90, 220],
};

const SPORT_IDS = new Set(SPORTS.map((sport) => sport.id));
const TREND_IDS = new Set(TRENDS.map((trend) => trend.id));
const KETONE_IDS = new Set(KETONES.map((ketone) => ketone.id));
const INTENSITY_IDS = new Set(INTENSITIES.map((level) => level.id));

const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

const bounded = (value, fallback, [lo, hi]) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(hi, Math.max(lo, number));
};

const boolean = (value, fallback) => (value === undefined || value === null ? fallback : Boolean(value));

/**
 * Returns a complete, valid state object. Unknown keys are dropped, enums fall
 * back to their default and every number is clamped to the range the interface
 * and the engine both accept.
 *
 * @param {object} raw      untrusted state (profile, link, backup, history)
 * @param {object} [base]   values used when `raw` is missing a field
 * @returns {object} state in mg/dL, safe to assign and render
 */
export function sanitizeState(raw = {}, base = DEFAULTS) {
  const source = asObject(raw);
  const fallback = { ...DEFAULTS, ...asObject(base) };

  const unit = source.unit === 'mmol' || source.unit === 'mgdl' ? source.unit : fallback.unit;
  const intensity = Math.round(bounded(source.intensity, fallback.intensity, [1, 4]));

  return {
    unit,
    glucose: bounded(source.glucose, fallback.glucose, BOUNDS.glucose),
    trend: TREND_IDS.has(source.trend) ? source.trend : fallback.trend,
    iob: bounded(source.iob, fallback.iob, BOUNDS.iob),
    diaHours: bounded(source.diaHours, fallback.diaHours, BOUNDS.diaHours),
    isf: bounded(source.isf, fallback.isf, BOUNDS.isf),
    carbRatio: bounded(source.carbRatio, fallback.carbRatio, BOUNDS.carbRatio),
    weightKg: bounded(source.weightKg, fallback.weightKg, BOUNDS.weightKg),
    sport: SPORT_IDS.has(source.sport) ? source.sport : fallback.sport,
    durationMin: bounded(source.durationMin, fallback.durationMin, BOUNDS.durationMin),
    intensity: INTENSITY_IDS.has(intensity) ? intensity : fallback.intensity,
    leadTimeMin: bounded(source.leadTimeMin, fallback.leadTimeMin, BOUNDS.leadTimeMin),
    ketones: KETONE_IDS.has(source.ketones) ? source.ketones : fallback.ketones,
    carbType: source.carbType === 'slow' ? 'slow' : source.carbType === 'fast' ? 'fast' : fallback.carbType,
    heat: boolean(source.heat, fallback.heat),
    pump: boolean(source.pump, fallback.pump),
    basalRate: bounded(source.basalRate, fallback.basalRate, BOUNDS.basalRate),
    targetGlucose: bounded(source.targetGlucose, fallback.targetGlucose, BOUNDS.targetGlucose),
    iobEstimated: boolean(source.iobEstimated, fallback.iobEstimated),
  };
}

/** Rounds a stored mg/dL value the way the interface displays it. */
const displayValue = (mgdl, unit) =>
  unit === 'mmol' ? Math.round(toMmol(mgdl) * 10) / 10 : Math.round(mgdl);

/**
 * The current scenario as a URL hash (without the leading #).
 * Health values stay in the URL only because the user chose to copy the link.
 */
export function encodeScenario(state) {
  const safe = sanitizeState(state);
  const g = (mgdl) => String(displayValue(mgdl, safe.unit));
  const params = new URLSearchParams();

  params.set('u', safe.unit);
  params.set('g', g(safe.glucose));
  params.set('tr', safe.trend);
  params.set('iob', String(safe.iob));
  params.set('s', safe.sport);
  params.set('d', String(Math.round(safe.durationMin)));
  params.set('i', String(safe.intensity));
  params.set('l', String(Math.round(safe.leadTimeMin)));
  params.set('k', safe.ketones);
  params.set('p', safe.pump ? '1' : '0');
  params.set('b', String(safe.basalRate));
  params.set('isf', g(safe.isf));
  params.set('dia', String(safe.diaHours));
  params.set('w', String(Math.round(safe.weightKg)));
  params.set('tg', g(safe.targetGlucose));
  params.set('ct', safe.carbType);
  // Both flags are always present, including when false: a link must reproduce
  // the scenario it was copied from, not inherit whatever the reader had set.
  params.set('ht', safe.heat ? '1' : '0');
  params.set('ie', safe.iobEstimated ? '1' : '0');

  return params.toString();
}

/**
 * Reads a share link hash into a valid state, or null when the hash carries no
 * scenario. Missing fields keep the current state; the unit in the link decides
 * how its numbers are interpreted, so a converted link can never be mixed up.
 */
export function decodeScenario(hash, base = DEFAULTS) {
  const raw = String(hash ?? '').replace(/^#/, '');
  if (!raw) return null;

  const params = new URLSearchParams(raw);
  const unit = params.get('u') === 'mmol' ? 'mmol' : 'mgdl';
  const current = { ...DEFAULTS, ...asObject(base), unit };

  const text = (key) => {
    const value = params.get(key);
    return value === null || value.trim() === '' ? null : value;
  };
  const number = (key, fallback) => {
    const value = text(key);
    if (value === null) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  // Values in the link are in the link's unit; the state is always mg/dL.
  const glucose = (key, fallback) => {
    const value = number(key, null);
    if (value === null) return fallback;
    return unit === 'mmol' ? fromMmol(value) : value;
  };

  if (text('g') === null) return null;

  const next = {
    unit,
    glucose: glucose('g', current.glucose),
    trend: text('tr') ?? current.trend,
    iob: number('iob', current.iob),
    sport: text('s') ?? current.sport,
    durationMin: number('d', current.durationMin),
    intensity: number('i', current.intensity),
    leadTimeMin: number('l', current.leadTimeMin),
    ketones: text('k') ?? current.ketones,
    pump: text('p') === null ? current.pump : text('p') !== '0',
    basalRate: number('b', current.basalRate),
    isf: glucose('isf', current.isf),
    diaHours: number('dia', current.diaHours),
    weightKg: number('w', current.weightKg),
    targetGlucose: glucose('tg', current.targetGlucose),
    carbType: text('ct') ?? current.carbType,
    heat: text('ht') === null ? current.heat : text('ht') === '1',
    iobEstimated: text('ie') === null ? current.iobEstimated : text('ie') === '1',
  };

  return sanitizeState(next, current);
}
