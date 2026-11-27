/**
 * SokeriSport — Deterministic Glycemic Readiness Rule Engine
 * ----------------------------------------------------------
 * Pure JavaScript. No side effects, no randomness: the same input always
 * produces the same output. Runs the same way in the browser and in Node (tests).
 *
 * Model layers:
 *   1) Input normalisation (unit conversion + safe range clamping)
 *   2) Rule engine    — guideline-based thresholds and carb/basal calculation
 *   3) Simulation     — deterministic glucose projection in 5-minute steps
 *   4) Risk scores    — hypo / late hypo / hyper
 *
 * Note: thresholds derived from clinical guidelines (sources in science.html)
 * and transparent modelling assumptions are marked separately.
 */

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

export const MGDL_PER_MMOL = 18.0182;
export const STEP_MIN = 5;
export const HORIZON_AFTER_MIN = 180;

/**
 * Rule constants.
 * [K] = threshold from clinical guidelines, [V] = modelling assumption (transparent).
 */
export const RULES = {
  HYPO_STOP: 70, // [K] <70 mg/dL exercise is contraindicated
  LOW_START: 90, // [K] starting below 90 mg/dL is not advised
  SAFE_FLOOR: 85, // [V] "coverable" safe floor with carbohydrate
  PRE_TARGET: 140, // [K] middle of the 126–180 mg/dL pre-exercise target
  TARGET_LOW: 90,
  TARGET_HIGH: 180,
  HYPER_CHECK: 250, // [K] ketone check threshold (13.9 mmol/L)
  HYPER_STOP: 300, // [K] no exercise if ketones are present
  MAX_PRE_CARBS: 50, // [K] single pre-load ceiling
  MAX_G_PER_HOUR: 60, // [K] gastric tolerance / absorption ceiling
  CARB_GLUCOSE_BASE: 3.5, // [V] 1 g CHO ≈ 3.5 mg/dL at 70 kg (observed effect)
  EXERCISE_DRAW: 0.35, // [V] share of oxidised CHO reflected in plasma
  PRE_PLASMA_SHARE: 0.85, // [V] share of resting CHO that reaches plasma
  DURING_PLASMA_SHARE: 0.35, // [V] during exercise most CHO is oxidised in muscle
  SAFE_IOB: 0.8, // [K] acceptable IOB ceiling before exercise
  LATE_HYPO_HORIZON: 180, // [K] late hypoglycemia up to 6–12 hours
  SLOW_CARB_SHARE: 0.75, // [V] slow carbohydrate delivers less glucose in the bridge window
  SLOW_CARB_LAG_MIN: 15, // [V] slow carbohydrate starts absorbing later
  SLOW_CARB_DUR_MUL: 1.9, // [V] slow carbohydrate keeps absorbing longer
  HEAT_SENSITIVITY: 1.12, // [V] heat raises skin perfusion → faster insulin action
  HEAT_OXIDATION: 1.05, // [V] small extra thermoregulatory carbohydrate cost
};

/* ------------------------------------------------------------------ */
/* Trend arrows (Dexcom CGM arrow semantics)                           */
/* ------------------------------------------------------------------ */

export const TRENDS = [
  { id: 'doubleUp', glyph: '⇈', label: 'Rising fast', rate: 3.0, hint: '>3 mg/dL/min' },
  { id: 'up', glyph: '↑', label: 'Rising', rate: 2.0, hint: '2–3 mg/dL/min' },
  { id: 'slowUp', glyph: '↗', label: 'Rising slowly', rate: 1.0, hint: '1–2 mg/dL/min' },
  { id: 'flat', glyph: '→', label: 'Steady', rate: 0, hint: '±1 mg/dL/min' },
  { id: 'slowDown', glyph: '↘', label: 'Falling slowly', rate: -1.0, hint: '1–2 mg/dL/min' },
  { id: 'down', glyph: '↓', label: 'Falling', rate: -2.0, hint: '2–3 mg/dL/min' },
  { id: 'doubleDown', glyph: '⇊', label: 'Falling fast', rate: -3.0, hint: '<3 mg/dL/min' },
];

export const TREND_BY_ID = Object.fromEntries(TRENDS.map((t) => [t.id, t]));

/* ------------------------------------------------------------------ */
/* Sport profiles                                                      */
/* ------------------------------------------------------------------ */

export const CATEGORIES = {
  IHE: {
    id: 'IHE',
    label: 'High-intensity intervals',
    short: 'IHE',
    basalBase: 50,
    color: '#FF8A3D',
    summary:
      'Cycles of sprint, jump and rest. Catecholamines lift glucose in the first minutes; a sharp drop comes at the end of the session.',
  },
  ENDURANCE: {
    id: 'ENDURANCE',
    label: 'Endurance',
    short: 'END',
    basalBase: 40,
    color: '#2F6BFF',
    summary:
      'Continuous, rhythmic load. Muscle glycogen use and rising insulin sensitivity make glucose fall steadily.',
  },
  MIXED: {
    id: 'MIXED',
    label: 'Mixed / interval',
    short: 'MIX',
    basalBase: 35,
    color: '#8B5CF6',
    summary: 'Short bursts plus recovery. Glucose rises often and can drop hours after the session.',
  },
  STRENGTH: {
    id: 'STRENGTH',
    label: 'Strength',
    short: 'STR',
    basalBase: 20,
    color: '#0EA5E9',
    summary: 'Heavy sets release adrenaline and growth hormone; glucose mostly rises or stays flat.',
  },
  LOW: {
    id: 'LOW',
    label: 'Low intensity',
    short: 'LOW',
    basalBase: 25,
    color: '#10B981',
    summary: 'Easy pace. Small but long-lasting effect; a drop is still possible, especially with IOB on board.',
  },
};

/**
 * oxidation   : hourly carbohydrate oxidation at moderate intensity (g/h)  [K]
 * sensitivity : insulin sensitivity multiplier during exercise             [V]
 * adrenergic  : temporary glucose rise in the first 20 min of an IHE session [V]
 */
export const SPORTS = [
  { id: 'basketbol', name: 'Basketball', category: 'IHE', oxidation: 42, sensitivity: 1.45, adrenergic: 22, glyph: '🏀', note: 'Sprint–rest cycles; a rise in the first 20 min, then a sharp drop risk.' },
  { id: 'halisaha', name: 'Indoor soccer', category: 'IHE', oxidation: 46, sensitivity: 1.5, adrenergic: 24, glyph: '⚽', note: 'Small pitch plus constant tempo; carb use is higher than in football.' },
  { id: 'futbol', name: 'Football', category: 'IHE', oxidation: 44, sensitivity: 1.45, adrenergic: 20, glyph: '🥅', note: 'Repeated high intensity for 90 minutes; the drop becomes clear in the second half.' },
  { id: 'tenis', name: 'Tennis', category: 'IHE', oxidation: 32, sensitivity: 1.3, adrenergic: 12, glyph: '🎾', note: 'Breaks between points provide rest; overall load is moderate.' },
  { id: 'bisiklet', name: 'Cycling', category: 'ENDURANCE', oxidation: 60, sensitivity: 1.65, adrenergic: 2, glyph: '🚴', note: 'Steady tempo; 60 g of carbohydrate per hour is tolerable.' },
  { id: 'kosu', name: 'Running', category: 'ENDURANCE', oxidation: 58, sensitivity: 1.7, adrenergic: 3, glyph: '🏃', note: 'The largest rise in insulin sensitivity; the riskiest combination with IOB.' },
  { id: 'yuzme', name: 'Swimming', category: 'ENDURANCE', oxidation: 50, sensitivity: 1.55, adrenergic: 2, glyph: '🏊', note: 'Full body, low joint load; hypo symptoms are hard to notice in the water.' },
  { id: 'kurek', name: 'Rowing', category: 'ENDURANCE', oxidation: 55, sensitivity: 1.6, adrenergic: 6, glyph: '🚣', note: 'A mix of power and endurance; intensity climbs when the rhythm breaks.' },
  { id: 'hiit', name: 'HIIT', category: 'MIXED', oxidation: 28, sensitivity: 1.25, adrenergic: 26, glyph: '⏱', note: 'Short and intense; glucose often rises and falls hours later.' },
  { id: 'kuvvet', name: 'Strength', category: 'STRENGTH', oxidation: 22, sensitivity: 1.15, adrenergic: 18, glyph: '🏋', note: 'Heavy sets can raise glucose; added after cardio they lower it.' },
  { id: 'yuruyus', name: 'Walking', category: 'LOW', oxidation: 18, sensitivity: 1.25, adrenergic: 0, glyph: '🚶', note: 'Light but long-lasting; ideal after a meal.' },
];

export const SPORT_BY_ID = Object.fromEntries(SPORTS.map((s) => [s.id, s]));

export const INTENSITIES = [
  { id: 1, label: 'Light', rpe: 'RPE 3–4', mul: 0.7, hint: 'You can keep talking' },
  { id: 2, label: 'Moderate', rpe: 'RPE 5–6', mul: 1.0, hint: 'Breathing quickens, talking continues' },
  { id: 3, label: 'High', rpe: 'RPE 7–8', mul: 1.25, hint: 'Only short sentences' },
  { id: 4, label: 'Maximal', rpe: 'RPE 9–10', mul: 1.45, hint: 'Talking is difficult' },
];

export const INTENSITY_BY_ID = Object.fromEntries(INTENSITIES.map((i) => [i.id, i]));

export const KETONES = [
  { id: 'none', label: 'None / not measured', risk: 0 },
  { id: 'trace', label: 'Trace', risk: 1 },
  { id: 'moderate', label: 'Moderate', risk: 2 },
  { id: 'high', label: 'High', risk: 3 },
];

export const DEFAULTS = {
  unit: 'mgdl',
  glucose: 140,
  trend: 'flat',
  iob: 0,
  diaHours: 4,
  isf: 45,
  carbRatio: 10,
  weightKg: 74,
  sport: 'basketbol',
  durationMin: 75,
  intensity: 3,
  leadTimeMin: 20,
  ketones: 'none',
  pump: true,
  basalRate: 0.9,
  targetGlucose: 140,
  carbType: 'fast',
  heat: false,
  iobEstimated: false,
};

/* ------------------------------------------------------------------ */
/* Helpers                                                         */
/* ------------------------------------------------------------------ */

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const round5 = (v) => Math.round(v / 5) * 5;
const round1 = (v) => Math.round(v * 10) / 10;

export const toMmol = (mgdl) => mgdl / MGDL_PER_MMOL;
export const fromMmol = (mmol) => mmol * MGDL_PER_MMOL;

/** Plasma glucose rise per gram of carbohydrate (mg/dL/g). */
export function carbGlucoseFactor(weightKg) {
  const w = clamp(num(weightKg, DEFAULTS.weightKg), 30, 160);
  return RULES.CARB_GLUCOSE_BASE * (70 / w);
}

/** Readable glucose string for the preferred unit. */
export function formatGlucose(mgdl, unit = 'mgdl') {
  if (unit === 'mmol') return `${toMmol(mgdl).toFixed(1)} mmol/L`;
  return `${Math.round(mgdl)} mg/dL`;
}

/** Compact number format (for the chart axis). */
export function glucoseNumber(mgdl, unit = 'mgdl') {
  return unit === 'mmol' ? Math.round(toMmol(mgdl) * 10) / 10 : Math.round(mgdl);
}

/* ------------------------------------------------------------------ */
/* Input normalisation                                                */
/* ------------------------------------------------------------------ */

export function normalizeInput(raw = {}) {
  const unit = raw.unit === 'mmol' ? 'mmol' : 'mgdl';
  const conv = (v) => (unit === 'mmol' ? fromMmol(num(v, 0)) : num(v, 0));

  const input = {
    unit,
    glucose: clamp(conv(raw.glucose ?? (unit === 'mmol' ? toMmol(DEFAULTS.glucose) : DEFAULTS.glucose)), 30, 600),
    trend: TREND_BY_ID[raw.trend] ? raw.trend : DEFAULTS.trend,
    iob: clamp(num(raw.iob, 0), 0, 30),
    diaHours: clamp(num(raw.diaHours, DEFAULTS.diaHours), 2, 7),
    isf: clamp(conv(raw.isf ?? (unit === 'mmol' ? toMmol(DEFAULTS.isf) : DEFAULTS.isf)), 3, 300),
    carbRatio: clamp(num(raw.carbRatio, DEFAULTS.carbRatio), 2, 60),
    weightKg: clamp(num(raw.weightKg, DEFAULTS.weightKg), 30, 160),
    sport: SPORT_BY_ID[raw.sport] ? raw.sport : DEFAULTS.sport,
    durationMin: clamp(num(raw.durationMin, DEFAULTS.durationMin), 10, 240),
    intensity: clamp(Math.round(num(raw.intensity, DEFAULTS.intensity)), 1, 4),
    leadTimeMin: clamp(num(raw.leadTimeMin, DEFAULTS.leadTimeMin), 0, 180),
    ketones: KETONES.some((k) => k.id === raw.ketones) ? raw.ketones : 'none',
    carbType: raw.carbType === 'slow' ? 'slow' : 'fast',
    heat: Boolean(raw.heat),
    pump: Boolean(raw.pump),
    basalRate: clamp(num(raw.basalRate, DEFAULTS.basalRate), 0, 5),
    targetGlucose: clamp(conv(raw.targetGlucose ?? (unit === 'mmol' ? toMmol(DEFAULTS.targetGlucose) : DEFAULTS.targetGlucose)), 90, 220),
    iobEstimated: Boolean(raw.iobEstimated),
  };
  return input;
}

/* ------------------------------------------------------------------ */
/* Main entry point                                                   */
/* ------------------------------------------------------------------ */

/**
 * @param {object} raw user input
 * @returns {object} full plan + simulation
 */
export function buildPlan(raw = {}) {
  const input = normalizeInput(raw);
  const sport = SPORT_BY_ID[input.sport];
  const trend = TREND_BY_ID[input.trend];
  const level = INTENSITY_BY_ID[input.intensity];
  const weight = input.weightKg;
  const carbFactor = carbGlucoseFactor(weight);
  const durationH = input.durationMin / 60;
  const ketoneRisk = KETONES.find((k) => k.id === input.ketones).risk;
  const carbShape =
    input.carbType === 'slow'
      ? { lagExtra: RULES.SLOW_CARB_LAG_MIN, durMul: RULES.SLOW_CARB_DUR_MUL, share: RULES.SLOW_CARB_SHARE }
      : { lagExtra: 0, durMul: 1, share: 1};
  const heatMul = input.heat ? RULES.HEAT_SENSITIVITY : 1;

  /* --- 1. Derived quantities --------------------------------------- */
  const oxidation = sport.oxidation * level.mul * (input.heat ? RULES.HEAT_OXIDATION : 1); // g/h
  const sensitivity = sport.sensitivity * heatMul;
  const startProjected = input.glucose + trend.rate * input.leadTimeMin;
  const iobExposure = input.iob * input.isf * sensitivity;
  const safeFloor = RULES.SAFE_FLOOR;
  const effectiveIobDrop = Math.min(iobExposure, Math.max(0, startProjected - safeFloor));
  const exerciseDraw = oxidation * durationH * carbFactor * RULES.EXERCISE_DRAW;
  /**
   * The pre-dose only bridges the start of the session; the remaining draw
   * belongs to the in-session schedule (prevents double counting). For sessions
   * under 45 min the bridge equals the whole session.
   */
  const bridgeMin = input.durationMin >= 45 ? Math.min(input.durationMin, 45) : input.durationMin;
  const preDraw = oxidation * (bridgeMin / 60) * carbFactor * RULES.EXERCISE_DRAW;
  const adrenergicCredit = sport.adrenergic * (input.intensity >= 3 ? 1 : 0.65);
  const target = input.targetGlucose;

  /* --- 2. Carbohydrate need ---------------------------------------- */
  const rawDeficit = target - startProjected + effectiveIobDrop + preDraw - adrenergicCredit;
  // Slow carbohydrate delivers less glucose per gram inside the bridge window,
  // so the same deficit needs a larger dose.
  const needGramsRaw = rawDeficit / (carbFactor * carbShape.share);
  const weightCap = weight * 0.6;
  const preCap = Math.round(clamp(Math.min(RULES.MAX_PRE_CARBS, weightCap), 10, 60));

  let grams = Math.max(0, needGramsRaw);
  let trendAdjust = 0;
  if (trend.rate <= -2) trendAdjust += 10;
  else if (trend.rate <= -1) trendAdjust += 5;
  else if (trend.rate >= 2) trendAdjust -= 5;
  grams += trendAdjust;

  // High glucose + low IOB: adding carbohydrate makes no sense.
  if (startProjected > 250 && input.iob < 0.5) grams = 0;
  if (startProjected > 200) grams = Math.min(grams, 15);

  const gramsUncapped = Math.max(0, grams);
  // Calculations below 10 g are not a meaningful dose: treated as "not needed".
  const preGrams = gramsUncapped < 10 ? 0 : clamp(round5(gramsUncapped), 10, preCap);
  const preCapped = gramsUncapped > preCap + 2.5;


  const timingMin = input.durationMin >= 90 || sport.category === 'ENDURANCE' ? 25 : 15;
  /** Above the single-dose ceiling a second, smaller portion is scheduled. */
  const splitGrams =
    preCapped && gramsUncapped - preCap >= 15 ? Math.min(20, Math.round((gramsUncapped - preCap) / 5) * 5) : 0;
  const carbNote =
    input.carbType === 'slow'
      ? 'Slow carbohydrate (oats, bread, banana): a flatter and later rise. Start 10–15 min earlier and keep a fast source (gel or juice) in reserve.'
      : 'Fast-acting carbohydrate (gel, juice, glucose tablet). Peaks in roughly 15 minutes.';
  const preCarb = {
    mode: preGrams > 0 ? 'exercise' : 'none',
    grams: preGrams,
    timingMin: Math.min(timingMin, Math.max(10, input.leadTimeMin)),
    capped: preCapped,
    uncappedGrams: Math.round(gramsUncapped),
    cap: preCap,
    carbType: input.carbType,
    split: splitGrams ? { grams: splitGrams, afterMin: 20 } : null,
    note:
      preGrams === 0
        ? 'No extra carbohydrate advised before exercise. Your glucose range does not call for it.'
        : `${carbNote} ${preCapped ? 'Your need is above the ceiling: too much in one dose upsets the stomach, so the rest is split.' : ''}`.trim(),
  };

  // In hypoglycemia the treatment protocol applies, not the exercise plan.
  if (input.glucose < RULES.HYPO_STOP) {
    preCarb.mode = 'treat';
    preCarb.grams = 15;
    preCarb.timingMin = 0;
    preCarb.capped = false;
    preCarb.note =
      'Hypoglycemia treatment: take 15–20 g of fast carbohydrate, wait 15 minutes and recheck. Do not start exercising before you are above 90 mg/dL; do not give insulin.';
  }

  /* --- 3. During-session plan -------------------------------------- */
  const perHour = Math.min(RULES.MAX_G_PER_HOUR, Math.round(oxidation));
  const schedule = [];
  if (input.durationMin >= 45) {
    const firstDose = startProjected > 180 ? 45 : sport.category === 'IHE' ? 25 : 30;
    const interval = sport.category === 'ENDURANCE' ? 35 : 30;
    const dose = round5(clamp(perHour / 2, 5, 30));
    for (let m = firstDose; m <= input.durationMin - 10; m += interval) {
      schedule.push({ minute: m, grams: dose, label: `${m} min` });
    }
  }
  const duringTotal = schedule.reduce((a, s) => a + s.grams, 0);
  const during = {
    perHour,
    total: duringTotal,
    schedule,
    needed: schedule.length > 0,
    note:
      input.durationMin < 45
        ? 'Sessions under 45 minutes rarely need extra carbohydrate; a CGM check every 20–30 min is enough.'
        : `The ${perHour} g/h target is based on the oxidation rate measured for ${sport.name} at ${level.label.toLowerCase()} intensity.`,
    hydration: input.heat
      ? 'Hot conditions: 600–900 ml of fluid per hour plus electrolytes; expect a faster insulin effect and check sooner.'
      : input.durationMin >= 60
        ? '500–800 ml of fluid per hour; add electrolytes when it is warm.'
        : '200–400 ml of fluid per hour.',
  };

  /* --- 4. Basal reduction scenario --------------------------------- */
  let reduction = CATEGORIES[sport.category].basalBase;
  reduction += durationH >= 2.5 ? 25 : durationH >= 1.5 ? 15 : durationH >= 1 ? 5 : -10;
  if (input.iob >= 1.5) reduction -= 10;
  else if (input.iob <= 0.3) reduction += 5;
  if (startProjected <= 100) reduction += 10;
  if (startProjected >= 230) reduction -= 15;
  reduction = clamp(Math.round(reduction / 5) * 5, 0, 80);

  const startBeforeMin =
    sport.category === 'ENDURANCE' ? (input.durationMin >= 90 ? 90 : 60) : sport.category === 'IHE' ? 45 : 30;
  const endAfterMin = input.durationMin >= 90 || sport.category === 'ENDURANCE' ? 45 : 30;
  const tempRate =
    input.pump && input.basalRate > 0 ? Math.round(input.basalRate * (1 - reduction / 100) * 100) / 100 : null;

  const basal = {
    applicable: input.pump,
    reductionPercent: reduction,
    startBeforeMin,
    endAfterMin,
    tempRate,
    currentRate: input.basalRate,
    steps: input.pump
      ? [
          { id: 'before', label: 'Before', fromMin: -startBeforeMin, toMin: 0, percent: reduction },
          { id: 'session', label: 'Session', fromMin: 0, toMin: input.durationMin, percent: reduction },
          { id: 'after', label: 'After', fromMin: input.durationMin, toMin: input.durationMin + endAfterMin, percent: Math.round(reduction / 2) },
        ]
      : [],
    programText: input.pump
      ? [
          `Temporary basal: ${reduction}% reduction${tempRate ? ` (${tempRate} U/h from ${input.basalRate} U/h)` : ''}`,
          `Start: ${startBeforeMin} min before exercise`,
          `End: ${endAfterMin} min after the finish, then back to ${input.basalRate} U/h`,
          `Session: ${input.durationMin} min · ${CATEGORIES[sport.category].label}`,
        ].join('\n')
      : 'No pump: basal protocol does not apply.',
    note: input.pump
      ? `Temporary basal: ${reduction}% reduction → ${tempRate} U/h. Ramp the reduction back up gradually after high-intensity and long sessions.`
      : 'Without an insulin pump the basal protocol does not apply: the carb strategy and bolus timing are the basis.',
    mdiNote:
      'On MDI: do not start exercising within 2–3 hours of your last rapid-acting bolus; do not change your long-acting insulin dose.',
  };

  /* --- 5. After / recovery ----------------------------------------- */
  const recoveryRate =
    durationH >= 2 && input.intensity >= 3 ? 1.2 : durationH >= 1 ? 0.8 : durationH >= 0.5 ? 0.5 : 0.3;
  const afterCarbs = round5(clamp(weight * recoveryRate, 0, 180));
  const protein = durationH >= 1 && input.intensity >= 2 ? Math.min(30, Math.round(weight * 0.3)) : 0;
  const after = {
    carbsG: afterCarbs,
    proteinG: protein,
    note:
      'Recovery carbohydrate should be taken within the first 30–60 minutes together with protein. Fatty/high-fibre choices slow absorption.',
    overnight:
      durationH >= 1.5 || input.intensity >= 3
        ? 'Risk of overnight late hypoglycemia: consider 15–20 g of slow carbohydrate before bed and a 10–20% basal reduction overnight. Set an alarm.'
        : 'Keep your CGM alarm on overnight; a check every 3 hours is advised.',
  };

  /* --- 6. IOB clearance / postponing ------------------------------- */
  const iobClearMin =
    input.iob > RULES.SAFE_IOB
      ? Math.round(input.diaHours * 60 * (1 - RULES.SAFE_IOB / input.iob))
      : 0;
  const timing = {
    iobClearMin,
    delayRecommended: iobClearMin >= 45 || (input.iob > 1.5 && input.glucose < 120),
    text:
      iobClearMin >= 45
        ? `Starting with ${round1(input.iob)} U of IOB is risky. Waiting at least ${iobClearMin} min (or bridging with carbohydrate and starting at an easy pace) brings IOB down to the ${RULES.SAFE_IOB} U band.`
        : 'IOB is within the acceptable band for exercise.',
  };

  /* --- 7. Simulation ----------------------------------------------- */
  const simulation = simulate(input, { preCarb, during, sport, oxidation, carbFactor, trend, level, carbShape, sensitivity });

  /* --- 8. Status + risk -------------------------------------------- */
  const risks = {
    hypo: hypoRisk(simulation.nadir, iobExposure, trend.rate, simulation.nadirDuringExercise),
    lateHypo: lateHypoRisk(input, simulation, afterCarbs),
    hyper: clamp(Math.round(((simulation.peak - 250) / 2) | 0), 0, 100),
  };
  risks.overall = clamp(Math.round(risks.hypo * 0.6 + risks.lateHypo * 0.3 + risks.hyper * 0.1), 0, 100);

  const status = resolveStatus({ input, ketoneRisk, startProjected, simulation, risks, timing });

  /* --- 9. Warnings ------------------------------------------------ */
  const warnings = buildWarnings({
    input,
    sport,
    trend,
    ketoneRisk,
    simulation,
    risks,
    startProjected,
    preCarb,
    timing,
  });

  /* --- 10. Transparent calculation breakdown ---------------------- */
  const rationale = [
    {
      label: 'Starting projection',
      expression: `${Math.round(input.glucose)} + (${trend.rate > 0 ? '+' : ''}${trend.rate} mg/dL/min × ${input.leadTimeMin} min)`,
      value: `${Math.round(startProjected)} mg/dL`,
      hint: 'Your reading now, carried forward with the CGM trend arrow for the time left before exercise.',
    },
    {
      label: 'Drop caused by IOB',
      expression: `${round1(input.iob)} U × ${Math.round(input.isf)} mg/dL/U × ${sensitivity.toFixed(2)} (exercise sensitivity)`,
      value: `−${Math.round(effectiveIobDrop)} mg/dL${effectiveIobDrop < iobExposure - 1 ? ` (cap: ${Math.round(iobExposure)})` : ''}`,
      hint: 'Active insulin is multiplied by your sensitivity factor and the sport\u2019s exercise multiplier, then capped so it never claims more than the distance to the safe floor.',
    },
    {
      label: `Bridge window (${bridgeMin} min)`,
      expression: `${Math.round(oxidation)} g/h × ${(bridgeMin / 60).toFixed(2)} h × ${carbFactor.toFixed(2)} mg/dL/g × 0.35`,
      value: `−${Math.round(preDraw)} mg/dL`,
      hint: 'Only the first part of the session is bridged by the pre-dose; the rest belongs to the in-session schedule, so the two are never double counted.',
    },
    {
      label: 'Catecholamine credit',
      expression: `${sport.name} · ${sport.category === 'IHE' || sport.category === 'MIXED' ? 'adrenaline effect in the first 20 min' : 'negligible'}`,
      value: `+${Math.round(adrenergicCredit)} mg/dL`,
      hint: 'Sprint and interval work releases adrenaline, which lifts glucose in the opening minutes and buys a small carbohydrate credit.',
    },
    {
      label: 'Carb source',
      expression: `${input.carbType === 'slow' ? 'Slow (oats, bread, banana)' : 'Fast (gel, juice, tablet)'} · plasma share ×${carbShape.share}`,
      value: `1 g per ${(carbFactor * carbShape.share).toFixed(2)} mg/dL`,
      hint: 'Slow carbohydrate delivers less glucose per gram inside the bridge window, so the same deficit needs a larger dose with a flatter, later rise.',
    },
    ...(input.heat
      ? [
          {
            label: 'Heat correction',
            expression: `insulin sensitivity ×${RULES.HEAT_SENSITIVITY.toFixed(2)} · oxidation ×${RULES.HEAT_OXIDATION.toFixed(2)}`,
            value: 'applied',
            hint: 'In the heat skin blood flow rises: insulin is absorbed faster and sweating adds a small carbohydrate cost.',
          },
        ]
      : []),
    {
      label: 'Net gap / surplus',
      expression: `${Math.round(target)} − ${Math.round(startProjected)} + ${Math.round(effectiveIobDrop)} + ${Math.round(preDraw)} − ${Math.round(adrenergicCredit)}`,
      value: `${rawDeficit > 0 ? '−' : '+'}${Math.abs(Math.round(rawDeficit))} mg/dL`,
      hint: 'The distance from the target after every correction has been applied. A positive gap means carbohydrate is needed.',
    },
    {
      label: '1 g per 3.5 mg/dL',
      expression: `${Math.round(needGramsRaw)} g raw need ${trendAdjust !== 0 ? `(trend correction ${trendAdjust > 0 ? '+' : ''}${trendAdjust} g)` : ''}`,
      value: `${preGrams} g (cap ${preCap} g)`,
      hint: 'The gap divided by the glucose rise per gram, then rounded to 5 g and capped for a single dose.',
    },
  ];

  /* --- 11. Checkpoints -------------------------------------------- */
  const checks = [
    { at: '15 min before exercise', text: `${formatGlucose(startProjected, input.unit)} expected; if your reading is below that, do not follow the plan.` },
    { at: 'At the start (0 min)', text: 'CGM + fingerstick confirmation; keep 15 g of fast carbohydrate in your pocket.' },
    { at: `${Math.round(Math.min(45, input.durationMin / 2))} min`, text: 'First interim check; if the trend arrow has turned down, move the in-session dose earlier.' },
    { at: 'Finish +30 min', text: 'Recovery carbohydrate and first check.' },
    { at: 'Finish +2 h', text: 'Late-drop scan; add 15 g if below 100 mg/dL.' },
  ];

  return {
    input,
    sport,
    level,
    trend,
    numbers: {
      glucose: input.glucose,
      target,
      startProjected,
      iobExposure,
      effectiveIobDrop,
      exerciseDraw,
      preDraw,
      bridgeMin,
      adrenergicCredit,
      rawDeficit,
      needGramsRaw,
      carbFactor,
      oxidation,
      perHour,
      preCap,
      sensitivity,
      durationH,
      carbShare: carbShape.share,
    },
    status,
    preCarb,
    during,
    basal,
    after,
    timing,
    risks,
    warnings,
    rationale,
    checks,
    simulation,
  };
}

/* ------------------------------------------------------------------ */
/* Simulation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Glucose projection in 5-minute steps.
 * Plan = recommended carbohydrates; Baseline = if no carbohydrate is taken.
 */
export function simulate(input, plan) {
  const sport = plan.sport;
  const carbFactor = plan.carbFactor;
  const oxidation = plan.oxidation;
  const trend = plan.trend;
  const carbShape = plan.carbShape || { lagExtra: 0, durMul: 1, share: 1 };
  const sens = plan.sensitivity || sport.sensitivity;
  const exStart = input.leadTimeMin;
  const exEnd = exStart + input.durationMin;
  const horizon = input.durationMin + HORIZON_AFTER_MIN;

  const events = [];
  if (plan.preCarb.grams > 0) {
    events.push({ minute: Math.max(0, exStart - plan.preCarb.timingMin), grams: plan.preCarb.grams, kind: 'pre' });
  }
  if (plan.preCarb.split) {
    events.push({
      minute: Math.max(0, exStart - plan.preCarb.timingMin + plan.preCarb.split.afterMin),
      grams: plan.preCarb.split.grams,
      kind: 'pre',
    });
  }
  plan.during.schedule.forEach((s) => events.push({ minute: exStart + s.minute, grams: s.grams, kind: 'during' }));

  const markers = [
    { minute: 0, kind: 'now', label: 'Now' },
    { minute: exStart, kind: 'start', label: 'Exercise start' },
    { minute: exEnd, kind: 'end', label: 'Exercise end' },
  ];
  events.forEach((e) => markers.push({ minute: e.minute, kind: 'carb', label: `${e.grams} g`, grams: e.grams }));

  const run = (withCarbs) => {
    const pts = [];
    let g = input.glucose;
    const dropPerMin = (input.iob * input.isf) / (input.diaHours * 60);
    for (let t = 0; t <= horizon; t += STEP_MIN) {
      const drift = trend.rate * Math.exp(-t / 30);
      const mul = sensitivityAt(t, exStart, exEnd, sens);
      let delta = 0;

      // active insulin
      if (t < input.diaHours * 60) delta -= dropPerMin * mul;
      // trend drift
      delta += drift;

      // muscle glucose draw
      if (t >= exStart && t < exEnd) {
        const burnPerMin = oxidation / 60;
        delta -= burnPerMin * carbFactor * RULES.EXERCISE_DRAW;
        const u = t - exStart;
        if (u < 20) delta += (sport.adrenergic / 20) * (1 - u / 20);
      }

      // carbohydrate absorption
      if (withCarbs) {
        for (const e of events) {
          // Pre-exercise carbohydrate follows the chosen carb type; in-session
          // fuel is always fast (gel, drink, glucose tablet).
          const lag = (e.kind === 'pre' ? 10 + carbShape.lagExtra : 5);
          const dur = e.kind === 'pre' ? 35 * carbShape.durMul : 30;
          if (t >= e.minute + lag && t < e.minute + lag + dur) {
            const share =
              (e.kind === 'pre' ? RULES.PRE_PLASMA_SHARE : RULES.DURING_PLASMA_SHARE) *
              (e.kind === 'pre' ? carbShape.share : 1);
            delta += (e.grams / dur) * carbFactor * share;
          }
        }
      }

      // counter-regulation (the body's partial defence)
      if (g < 70) delta += 0.42;
      else if (g < 90) delta += 0.2;
      else if (g < 110) delta += 0.06;

      // insulin-independent clearance that rises with hyperglycemia (renal threshold + mass effect) [V]
      if (g > 180) delta -= (g - 180) * 0.014;

      g = clamp(g + delta * STEP_MIN, 40, 350);
      pts.push({ t, g: Math.round(g * 10) / 10 });
    }
    return pts;
  };

  const points = run(true);
  const baseline = run(false);

  const nadirOf = (arr, from = 0, to = Infinity) =>
    arr.filter((p) => p.t >= from && p.t <= to).reduce((a, p) => (p.g < a.g ? p : a), arr[0]);
  const peakOf = (arr) => arr.reduce((a, p) => (p.g > a.g ? p : a), arr[0]);

  return {
    points,
    baseline,
    markers,
    events,
    horizon,
    exStart,
    exEnd,
    nadir: nadirOf(points).g,
    nadirAt: nadirOf(points).t,
    nadirDuringExercise: nadirOf(points, exStart, exEnd).g,
    baselineNadir: nadirOf(baseline).g,
    peak: peakOf(points).g,
    endGlucose: points[points.length - 1].g,
  };
}

function sensitivityAt(t, exStart, exEnd, s) {
  if (t < exStart) {
    const ramp = exStart > 0 ? Math.min(1, t / Math.max(1, exStart)) : 1;
    return 1 + (s - 1) * 0.3 * ramp;
  }
  if (t <= exEnd) return s;
  const k = Math.min(1, (t - exEnd) / 120);
  return s + (1 - s) * k;
}

/* ------------------------------------------------------------------ */
/* Risk scores                                                       */
/* ------------------------------------------------------------------ */

function hypoRisk(nadir, iobExposure, trendRate, nadirDuring) {
  let s = 0;
  if (nadir < 70) s += 42 + (70 - nadir) * 1.1;
  else if (nadir < 85) s += 22 + (85 - nadir) * 1.1;
  else if (nadir < 100) s += 10;
  s += Math.min(18, iobExposure / 8);
  if (trendRate <= -2) s += 10;
  else if (trendRate <= -1) s += 5;
  if (nadirDuring < 80) s += 8;
  return clamp(Math.round(s), 0, 100);
}

function lateHypoRisk(input, sim, afterCarbs) {
  let s = 8;
  if (input.durationMin >= 90) s += 16;
  if (input.durationMin >= 150) s += 8;
  if (input.intensity >= 3) s += 12;
  if (SPORT_BY_ID[input.sport].category === 'ENDURANCE') s += 8;
  if (input.iob > 1) s += 10;
  if (sim.endGlucose < 100) s += 14;
  if (afterCarbs < input.weightKg * 0.5) s += 10;
  return clamp(Math.round(s), 0, 100);
}

/* ------------------------------------------------------------------ */
/* Status decision                                                        */
/* ------------------------------------------------------------------ */

function resolveStatus({ input, ketoneRisk, startProjected, simulation, risks, timing }) {
  const g = input.glucose;
  const when =
    simulation.nadirAt > simulation.exEnd
      ? `at minute ${simulation.nadirAt}, after the session`
      : `at minute ${simulation.nadirAt}`;

  if (ketoneRisk >= 2 && g >= RULES.HYPER_CHECK) {
    return {
      level: 'stop',
      title: 'Do not exercise',
      headline: 'Ketones are high and glucose is above 250 mg/dL.',
      detail:
        'This combination raises the risk of ketoacidosis. Drink fluids, repeat the ketone test and postpone exercise until your glucose improves. Contact your care team if needed.',
    };
  }
  if (g < RULES.HYPO_STOP) {
    return {
      level: 'stop',
      title: 'Treat the hypoglycemia first',
      headline: `${Math.round(g)} mg/dL — not safe for exercise.`,
      detail:
        'Take 15–20 g of fast-acting carbohydrate, wait 15 minutes and recheck. Do not start exercising before you are above 90 mg/dL. Do not give insulin.',
    };
  }
  if (g >= RULES.HYPER_STOP) {
    return {
      level: 'act',
      title: 'Check your ketones first',
      headline: `${Math.round(g)} mg/dL — at the hyperglycemia threshold.`,
      detail:
        'Check ketones. If trace/negative, a short easy session with plenty of fluid can be considered; if positive, do not exercise. High intensity can push hyperglycemia further up.',
    };
  }
  if (startProjected < RULES.LOW_START) {
    return {
      level: 'act',
      title: 'Take carbs before you start',
      headline: `Estimated start ${Math.round(startProjected)} mg/dL.`,
      detail: `Glucose will be low when the session starts. ${simulation.nadir < 70 ? 'Even with the plan, hypoglycemia appears: ' : ''}Take the recommended carbohydrate, recheck after 15 minutes and only then start.`,
    };
  }
  if (simulation.nadir < 70) {
    return {
      level: 'act',
      title: 'Follow the plan or postpone',
      headline: `The simulation drops to ${Math.round(simulation.nadir)} mg/dL ${when}.`,
      detail:
        'IOB and exercise draw together produce hypoglycemia. Either take the recommended carbohydrate or wait until IOB falls. Starting at an easy pace is also an option.',
    };
  }
  if (
    simulation.nadir < 85 ||
    risks.overall >= 55 ||
    startProjected > 220 ||
    (timing && timing.delayRecommended && input.iob > RULES.SAFE_IOB && startProjected < 170)
  ) {
    return {
      level: 'watch',
      title: 'Start with caution',
      headline: `Simulated nadir ${Math.round(simulation.nadir)} mg/dL.`,
      detail: 'The plan is workable; still check every 20–30 minutes and carry backup carbohydrate.',
    };
  }
  return {
    level: 'safe',
    title: 'You are ready',
    headline: `The simulated course stays in the ${Math.round(simulation.nadir)}–${Math.round(simulation.peak)} mg/dL band.`,
    detail: 'With the recommended plan glucose stays in the target range. Still do a check in the first 30 minutes.',
  };
}

/* ------------------------------------------------------------------ */
/* Warnings                                                            */
/* ------------------------------------------------------------------ */

function buildWarnings({ input, sport, trend, ketoneRisk, simulation, risks, startProjected, preCarb, timing }) {
  const w = [];
  if (input.iob > 1.5) {
    w.push({
      level: 'danger',
      title: 'High IOB',
      text: `${round1(input.iob)} U of active insulin carries a potential drop of ${Math.round(input.iob * input.isf * sport.sensitivity)} mg/dL during exercise.`,
    });
  } else if (input.iob > RULES.SAFE_IOB) {
    w.push({
      level: 'warn',
      title: 'IOB above the acceptable band',
      text: `${round1(input.iob)} U of IOB on board. The carb plan was calculated accordingly.`,
    });
  }
  if (trend.rate <= -1) {
    w.push({
      level: trend.rate <= -2 ? 'danger' : 'warn',
      title: 'Trend is down',
      text: `${trend.label}: ${Math.abs(trend.rate)} mg/dL/min. A drop of ${Math.abs(Math.round(trend.rate * input.leadTimeMin))} mg/dL is expected in ${input.leadTimeMin} minutes.`,
    });
  }
  if (startProjected >= 250) {
    w.push({
      level: 'warn',
      title: 'High starting glucose',
      text: 'High-intensity exercise can push glucose even higher. Start at an easy pace and build up gradually.',
    });
  }
  if (ketoneRisk === 1 && input.glucose >= RULES.HYPER_CHECK) {
    w.push({ level: 'warn', title: 'Trace ketones', text: 'Drink plenty of fluid and re-test ketones within 60 minutes.' });
  }
  if (simulation.baselineNadir < 70) {
    w.push({
      level: 'warn',
      title: 'No-carb scenario',
      text: `Without any carbohydrate the simulation drops to ${Math.round(simulation.baselineNadir)} mg/dL. That is where the plan earns its keep.`,
    });
  }
  if (risks.lateHypo >= 55) {
    w.push({
      level: 'warn',
      title: 'Overnight hypoglycemia risk',
      text: 'The session is long and/or intense. Plan your evening basal and bedtime carbohydrate, and set an alarm.',
    });
  }
  if (preCarb.capped) {
    w.push({
      level: 'info',
      title: 'Carbohydrate ceiling',
      text: `The calculated need is ${preCarb.uncappedGrams} g; capped at ${preCarb.cap} g for single-dose safety. The rest is spread across the session.`,
    });
  }
  if (timing.delayRecommended) {
    w.push({ level: 'info', title: 'Option to postpone', text: timing.text });
  }
  if (input.iobEstimated) {
    w.push({ level: 'info', title: 'Estimated IOB', text: 'No IOB entered: cautious mode assumed 1.5 U. Enter the exact value from your pump or app.' });
  }
  if (input.heat) {
    w.push({
      level: 'info',
      title: 'Hot conditions',
      text: 'Heat speeds up insulin absorption: check 15 minutes earlier than planned and add electrolytes to your fluid.',
    });
  }
  return w;
}

/* ------------------------------------------------------------------ */
/* Counterfactuals — "what would change the verdict?"                  */
/* ------------------------------------------------------------------ */

const LEVEL_RANK = { stop: 0, act: 1, watch: 2, safe: 3 };

/**
 * Re-runs the same deterministic engine against small, realistic changes and
 * keeps the ones that improve the verdict. No new clinical claim: every
 * variant goes through the same thresholds and formulas.
 */
export function suggestAlternatives(raw = {}, limit = 3) {
  const base = buildPlan(raw);
  const baseRank = LEVEL_RANK[base.status.level];
  if (baseRank >= LEVEL_RANK.safe) return [];

  const input = { ...base.input, unit: 'mgdl' };
  const found = [];

  const add = (label, patch, detail) => {
    const next = buildPlan({ ...input, ...patch });
    const rank = LEVEL_RANK[next.status.level];
    if (rank <= baseRank) return;
    found.push({
      id: label.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, ''),
      label,
      detail,
      patch,
      gain: rank - baseRank,
      level: next.status.level,
      status: next.status.title,
      grams: next.preCarb.grams,
      nadir: Math.round(next.simulation.nadir),
    });
  };

  if (input.iob > RULES.SAFE_IOB) add('Wait for the IOB to fall', { iob: 0 }, `${round1(input.iob)} U → 0 U`);

  const laterLead = Math.min(180, input.leadTimeMin + 30);
  if (laterLead > input.leadTimeMin && input.leadTimeMin < 90) {
    add('Start later', { leadTimeMin: laterLead }, `${input.leadTimeMin} → ${laterLead} min`);
  }

  const shorter = Math.max(10, Math.round((input.durationMin * 0.6) / 5) * 5);
  if (shorter < input.durationMin) {
    add('Shorten the session', { durationMin: shorter }, `${input.durationMin} → ${shorter} min`);
  }

  if (input.intensity > 1) {
    add(
      'One step easier',
      { intensity: input.intensity - 1 },
      `${INTENSITY_BY_ID[input.intensity].label} → ${INTENSITY_BY_ID[input.intensity - 1].label}`,
    );
  }
  if (input.carbType === 'slow') add('Switch to fast carbohydrate', { carbType: 'fast' }, 'faster rise before the start');
  if (input.heat) add('Move out of the heat', { heat: false }, 'normal insulin absorption');
  if (input.glucose < 100) add('Treat first, then start', { glucose: 110 }, `${Math.round(input.glucose)} → 110 mg/dL`);

  // Combined reset: the same advice the stop path gives when nothing else helps.
  add(
    'Treat first, wait, then start',
    {
      glucose: Math.max(Math.round(input.glucose), 115),
      iob: 0,
      leadTimeMin: Math.max(input.leadTimeMin, 30),
    },
    'glucose at or above 115 mg/dL, no IOB, 30 min later',
  );

  return found.sort((a, b) => b.gain - a.gain || b.nadir - a.nadir).slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Helper exports                                            */
/* ------------------------------------------------------------------ */

/** Converts the result into shareable plain text. */
export function planToText(plan) {
  const { input, status, preCarb, basal, during, after, numbers } = plan;
  const u = (v) => formatGlucose(v, input.unit);
  const lines = [
    `SokeriSport — ${plan.sport.name} · ${input.durationMin} min · ${plan.level.label}`,
    `Status: ${status.title} — ${status.headline}`,
    '',
    `Starting glucose: ${u(input.glucose)} (trend ${plan.trend.glyph})`,
    `IOB: ${input.iob} U · Estimated start: ${u(numbers.startProjected)}`,
    '',
    preCarb.mode === 'treat'
      ? 'HYPOGLYCEMIA FIRST: 15–20 g fast carbohydrate, recheck in 15 min'
      : `BEFORE EXERCISE: ${preCarb.grams > 0 ? `${preCarb.grams} g fast carbohydrate, ${preCarb.timingMin} min before` : 'no extra carbohydrate needed'}`,
    `CARB TYPE: ${preCarb.carbType === 'slow' ? 'slow — start 10–15 min earlier' : 'fast — peaks in ~15 min'}${preCarb.split ? ` · split: ${preCarb.grams} g now + ${preCarb.split.grams} g at +${preCarb.split.afterMin} min` : ''}`,
    basal.applicable
      ? `BASAL: ${basal.reductionPercent}% reduction, start ${basal.startBeforeMin} min before${basal.tempRate ? ` (${basal.tempRate} U/h)` : ''}`
      : 'BASAL: no pump — carb strategy applies',
    `DURING: ${during.needed ? `${during.perHour} g/h (${during.schedule.map((s) => `${s.minute}: ${s.grams} g`).join(', ')})` : 'no extra carbohydrate'}`,
    `AFTER: ${after.carbsG} g carbohydrate${after.proteinG ? ` + ${after.proteinG} g protein` : ''}`,
    '',
    `Simulation: nadir ${u(plan.simulation.nadir)}, peak ${u(plan.simulation.peak)}`,
    '',
    'For education only; not a treatment decision.',
  ];
  return lines.join('\n');
}
