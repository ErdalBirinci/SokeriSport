/**
 * SokeriSport — simulator interface.
 * The engine is pure; this file only maps form ↔ state ↔ results.
 */

import {
  SPORTS,
  SPORT_BY_ID,
  TRENDS,
  INTENSITIES,
  CATEGORIES,
  DEFAULTS,
  buildPlan,
  suggestAlternatives,
  planToText,
  formatGlucose,
  glucoseNumber,
  toMmol,
  fromMmol,
} from './engine.js';
import { drawTimeline } from './chart.js';
import {
  loadProfile,
  saveProfile,
  loadHistory,
  pushHistory,
  clearHistory,
  updateHistoryEntry,
  storageAvailable,
  exportSnapshot,
  importSnapshot,
} from './storage.js';
import { outcomeStats, accuracyBand } from './stats.js';
import { sanitizeState, encodeScenario, decodeScenario } from './scenario.js';
import { historyToCsv } from './csv.js';
import {
  encryptSnapshot,
  decryptSnapshot,
  parseBackupText,
  validateBackupPassword,
  MIN_PASSWORD_LENGTH,
} from './backup.js';
import { APP_VERSION } from './version.js';

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const state = { ...DEFAULTS };
let plan = null;
let currentBand = null;
let currentAlternatives = [];
let showBaseline = true;
let raf = null;
let saveTimer = null;
/** Timestamp of the entry the outcome form writes to (set by "Save result"). */
let lastSavedTs = null;
const outcomeDraft = { start: '', min: '', carbs: '', hypo: false };

const $ = (id) => document.getElementById(id);

const els = {
  glucose: $('glucose'),
  glucoseUnit: $('glucoseUnit'),
  quickGlucose: $('quickGlucose'),
  trends: $('trends'),
  iob: $('iob'),
  iobUnknown: $('iobUnknown'),
  leadTime: $('leadTime'),
  leadTimeOut: $('leadTimeOut'),
  sportPicker: $('sportPicker'),
  sportCatHint: $('sportCatHint'),
  duration: $('duration'),
  durationOut: $('durationOut'),
  intensity: $('intensity'),
  intensityHint: $('intensityHint'),
  weightKg: $('weightKg'),
  isf: $('isf'),
  isfUnit: $('isfUnit'),
  carbRatio: $('carbRatio'),
  diaHours: $('diaHours'),
  targetGlucose: $('targetGlucose'),
  targetUnit: $('targetUnit'),
  ketones: $('ketones'),
  carbType: $('carbType'),
  heat: $('heat'),
  pump: $('pump'),
  basalField: $('basalField'),
  basalRate: $('basalRate'),
  resetBtn: $('resetBtn'),
  profileSave: $('profileSave'),
  results: $('results'),
  historySection: $('historySection'),
  historyList: $('historyList'),
  statsBox: $('statsBox'),
  compareA: $('compareA'),
  compareB: $('compareB'),
  compareOut: $('compareOut'),
  compareRun: $('compareRun'),
  backupExport: $('backupExport'),
  backupImport: $('backupImport'),
  backupFile: $('backupFile'),
  backupPassword: $('backupPassword'),
  backupPasswordConfirm: $('backupPasswordConfirm'),
  backupConfirm: $('backupConfirm'),
  storageNotice: $('storageNotice'),
  onboarding: $('onboarding'),
  historyExport: $('historyExport'),
  clearHistory: $('clearHistory'),
  srStatus: $('srStatus'),
  toast: $('toast'),
  netBadge: $('netBadge'),
  netText: $('netText'),
  mobileBar: $('mobileBar'),
  mbValue: $('mbValue'),
  mbMeta: $('mbMeta'),
  mbDot: $('mbDot'),
};

/* ------------------------------------------------------------------ */
/* Helpers                                                         */
/* ------------------------------------------------------------------ */

const isMmol = () => state.unit === 'mmol';
const unitText = () => (isMmol() ? 'mmol/L' : 'mg/dL');

const disp = {
  glucose: () => (isMmol() ? Number(toMmol(state.glucose).toFixed(1)) : Math.round(state.glucose)),
  isf: () => (isMmol() ? Number(toMmol(state.isf).toFixed(1)) : Math.round(state.isf)),
  target: () => (isMmol() ? Number(toMmol(state.targetGlucose).toFixed(1)) : Math.round(state.targetGlucose)),
  quick: (mgdl) => (isMmol() ? Number(toMmol(mgdl).toFixed(1)) : mgdl),
};

function readNumber(el, fallback) {
  const v = parseFloat(String(el.value).replace(',', '.'));
  return Number.isFinite(v) ? v : fallback;
}

function paintRange(el) {
  const min = Number(el.min);
  const max = Number(el.max);
  const v = Number(el.value);
  const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
  el.style.setProperty('--pct', `${pct}%`);
}

let toastTimer = null;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 2400);
}

/* ------------------------------------------------------------------ */
/* Kurulum                                                             */
/* ------------------------------------------------------------------ */

function buildControls() {
  els.trends.innerHTML = TRENDS.map(
    (t) => `
      <button type="button" class="trend-btn" data-trend="${t.id}" role="radio" aria-checked="false"
        aria-label="${t.label} — ${t.hint}" title="${t.label} · ${t.hint}">
        <span>${t.glyph}</span>
        <small>${t.rate > 0 ? '+' : ''}${t.rate}</small>
      </button>`,
  ).join('');

  els.sportPicker.innerHTML = SPORTS.map(
    (s) => `
      <button type="button" class="sport-btn" data-sport="${s.id}" role="radio" aria-checked="false"
        title="${s.name} — ${s.note}">
        <i>${s.glyph}</i><span>${s.name}</span>
      </button>`,
  ).join('');

  els.intensity.innerHTML = INTENSITIES.map(
    (i) => `<button type="button" data-intensity="${i.id}" role="radio" aria-checked="false">${i.label}</button>`,
  ).join('');
}

function updateActiveFlags() {
  els.trends.querySelectorAll('[data-trend]').forEach((b) => {
    const on = b.dataset.trend === state.trend;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  els.sportPicker.querySelectorAll('[data-sport]').forEach((b) => {
    const on = b.dataset.sport === state.sport;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  els.intensity.querySelectorAll('[data-intensity]').forEach((b) => {
    const on = Number(b.dataset.intensity) === state.intensity;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  els.carbType?.querySelectorAll('[data-carb]').forEach((b) => {
    const on = b.dataset.carb === (state.carbType || 'fast');
    b.tabIndex = on ? 0 : -1;
  });
}

/** Arrow keys move through a radio group (one tab stop, like native radios). */
function enableRoving(container, selector) {
  if (!container) return;
  container.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const items = [...container.querySelectorAll(selector)];
    const index = items.indexOf(document.activeElement);
    if (index === -1) return;
    event.preventDefault();
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const next = items[(index + step + items.length) % items.length];
    next.focus();
    next.click();
  });
}

/** Unit buttons carry their state for assistive technology, not only a class. */
function paintUnitToggle() {
  document.querySelectorAll('[data-unit]').forEach((button) => {
    const on = button.dataset.unit === state.unit;
    button.classList.toggle('is-active', on);
    button.setAttribute('aria-pressed', String(on));
  });
}

const isTyping = (el) => document.activeElement === el;

/** Writes a value without stealing focus from the active field. */
function setField(el, value) {
  if (isTyping(el)) return;
  const next = String(value);
  if (el.value !== next) el.value = next;
}

/**
 * Clamps a typed number to the field's own min/max when the field is left.
 * Keeps the visible value and the stored state in step, so a saved history
 * entry can never claim a glucose the engine never used.
 */
function clampOnChange(el, apply, label = '') {
  if (!el) return;
  el.addEventListener('change', () => {
    const value = readNumber(el, null);
    if (value === null) return;
    const min = Number(el.min);
    const max = Number(el.max);
    const bounded = Math.min(max, Math.max(min, value));
    if (!Number.isFinite(bounded) || bounded === value) return;
    apply(bounded);
    el.value = String(bounded);
    render();
    toast(`Adjusted to ${bounded}${label ? ` ${label}` : ''}`);
  });
}

/** Writes the state into the form fields (also used when the unit changes). */
function syncForm() {
  setField(els.glucose, disp.glucose());
  els.glucose.step = isMmol() ? '0.1' : '1';
  els.glucose.min = isMmol() ? '1.7' : '30';
  els.glucose.max = isMmol() ? '33' : '600';
  els.glucoseUnit.textContent = unitText();

  setField(els.iob, state.iob);
  setField(els.leadTime, state.leadTimeMin);
  els.leadTimeOut.textContent = `${state.leadTimeMin} min`;
  paintRange(els.leadTime);

  setField(els.duration, state.durationMin);
  els.durationOut.textContent = `${state.durationMin} min`;
  paintRange(els.duration);

  setField(els.weightKg, state.weightKg);
  setField(els.isf, disp.isf());
  els.isf.step = isMmol() ? '0.1' : '1';
  // The numeric range follows the unit, otherwise the mmol field inherits the
  // mg/dL bounds (3–300) and rejects a valid 2.5 mmol/L/U.
  els.isf.min = isMmol() ? '0.2' : '3';
  els.isf.max = isMmol() ? '16.7' : '300';
  els.isfUnit.textContent = isMmol() ? 'mmol/L/U' : 'mg/dL/U';
  setField(els.carbRatio, state.carbRatio);
  setField(els.diaHours, state.diaHours);
  setField(els.targetGlucose, disp.target());
  els.targetGlucose.step = isMmol() ? '0.1' : '1';
  els.targetGlucose.min = isMmol() ? '5' : '90';
  els.targetGlucose.max = isMmol() ? '12.2' : '220';
  els.targetUnit.textContent = unitText();
  els.ketones.value = state.ketones;
  if (els.carbType) {
    els.carbType.querySelectorAll('[data-carb]').forEach((b) => {
      const on = b.dataset.carb === (state.carbType || 'fast');
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
    });
  }
  if (els.heat) els.heat.checked = Boolean(state.heat);
  els.pump.checked = state.pump;
  setField(els.basalRate, state.basalRate);
  els.basalField.hidden = !state.pump;
  els.iobUnknown.checked = state.iobEstimated;
  els.iob.disabled = state.iobEstimated;

  els.quickGlucose.querySelectorAll('[data-v]').forEach((b) => {
    b.textContent = String(disp.quick(Number(b.dataset.v)));
  });

  els.sportCatHint.textContent = CATEGORIES[SPORT_BY_ID[state.sport].category].label;
  const lvl = INTENSITIES.find((i) => i.id === state.intensity) || INTENSITIES[0];
  els.intensityHint.textContent = `${lvl.rpe} · ${lvl.hint}`;

  updateActiveFlags();
  paintUnitToggle();
}

/* ------------------------------------------------------------------ */
/* Result rendering                                                       */
/* ------------------------------------------------------------------ */

function render() {
  if (raf) return;
  const run = () => {
    raf = null;
    paint();
  };
  // rAF does not run in background tabs; setTimeout is used there.
  raf = document.hidden ? setTimeout(run, 0) : requestAnimationFrame(run);
}

/**
 * The engine speaks the display unit (it normalises mmol/L itself), while the
 * app keeps every value in mg/dL. This is the single place that converts.
 */
function engineInput() {
  const raw = { ...state };
  if (isMmol()) {
    raw.glucose = toMmol(state.glucose);
    raw.isf = toMmol(state.isf);
    raw.targetGlucose = toMmol(state.targetGlucose);
  }
  if (raw.iobEstimated) raw.iob = 1.5;
  return raw;
}

function paint() {
  const raw = engineInput();
  plan = buildPlan(raw);
  currentBand = buildBand(raw, plan);
  currentAlternatives = suggestAlternatives(raw);

  const u = state.unit;
  const G = (v) => formatGlucose(v, u);
  const n = plan.numbers;
  const s = plan.status;
  const st = plan.simulation;

  const doseLabel =
    plan.preCarb.grams > 0 ? `${plan.preCarb.grams}<small>g</small>` : `0<small>g</small>`;

  const carbSource =
    plan.preCarb.carbType === 'slow' ? 'Slow-acting carbohydrate' : 'Fast-acting carbohydrate';
  const doseTiming =
    plan.preCarb.timingMin === 0 ? 'Now — before exercise' : `${plan.preCarb.timingMin} min before exercise`;
  const doseMeta =
    plan.preCarb.mode === 'treat'
      ? `<b>Now — before exercise</b>15–20 g fast carbohydrate · recheck in 15 min`
      : plan.preCarb.grams > 0
        ? `<b>${doseTiming}</b>${carbSource} · ceiling ${plan.preCarb.cap} g`
        : `<b>No extra carbohydrate needed</b>Glucose is enough for this session · see the in-session plan`;

  const duringValue = plan.during.needed ? `${plan.during.perHour}<small>g/h</small>` : `—`;
  const preText =
    plan.preCarb.mode === 'treat'
      ? 'Take it now · recheck in 15 min'
      : plan.preCarb.grams > 0
        ? plan.preCarb.timingMin === 0
          ? 'Take it now'
          : `take it ${plan.preCarb.timingMin} min before`
        : 'No extra dose needed';
  const basalValue = plan.basal.applicable ? `−${plan.basal.reductionPercent}%` : `—`;

  const scheduleChips = plan.during.schedule
    .map((x) => `<span>${x.minute}′ · ${x.grams} g</span>`)
    .join('');

  const warningHtml = plan.warnings.length
    ? `<div class="card">
         <div class="card__head"><div><h3>Warnings</h3><p>${plan.warnings.length} items</p></div></div>
         <div class="warnings">
           ${plan.warnings
             .map(
               (w) => `<div class="warning warning--${w.level}">
                 <i>${w.level === 'danger' ? '!' : w.level === 'warn' ? '∆' : 'i'}</i>
                 <div><b>${w.title}</b><p>${w.text}</p></div>
               </div>`,
             )
             .join('')}
         </div>
       </div>`
    : '';

  const drop = (v) => (v < 0.5 ? '0' : `−${Math.round(isMmol() ? toMmol(v) : v)}`);

  const riskRow = (label, value) => `
    <div class="risk">
      <div class="risk__top"><b>${label}</b><span>${value}/100</span></div>
      <div class="risk__bar"><i style="width:${Math.max(3, value)}%"></i></div>
    </div>`;

  els.results.innerHTML = `
    <section class="verdict verdict--${s.level}">
      <div class="verdict__top">
        <span class="status-pill status-pill--${s.level}"><i></i>${s.title}</span>
        <span class="verdict__sport">
          ${plan.sport.name} · ${state.durationMin} min · ${plan.level.label} · ${plan.trend.glyph} ${plan.trend.label.toLowerCase()}
        </span>
      </div>
      <h2>${doseCopy(plan)}</h2>
      <p class="verdict__headline">${s.headline}</p>
      <p class="verdict__detail">${s.detail}</p>

      <div class="verdict__dose">
        <div class="dose-big">${doseLabel}</div>
        <div class="dose-meta">${doseMeta}</div>
      </div>

      <div class="verdict__actions">
        <button type="button" class="btn btn--primary btn--sm" data-action="copy">
          Copy plan
        </button>
        <button type="button" class="btn btn--soft btn--sm" data-action="save">Save result</button>
        <button type="button" class="btn btn--ghost btn--sm" data-action="link">Copy link</button>
        <button type="button" class="btn btn--ghost btn--sm" data-action="print">Print</button>
        <button type="button" class="btn btn--ghost btn--sm" data-action="diagnostics">Copy diagnostics</button>
      </div>
    </section>

    ${alternativesHtml()}

    <div class="metrics">
      <div class="metric metric--accent">
        <span>Estimated start</span>
        <b>${isMmol() ? toMmol(n.startProjected).toFixed(1) : Math.round(n.startProjected)}<small>${isMmol() ? 'mmol/L' : 'mg/dL'}</small></b>
        <em>${plan.trend.rate === 0 ? 'trend steady' : `${plan.trend.rate > 0 ? '+' : ''}${plan.trend.rate} mg/dL/min × ${state.leadTimeMin} min`}</em>
      </div>
      <div class="metric">
        <span>IOB effect</span>
        <b>${drop(n.effectiveIobDrop)}<small>${isMmol() ? 'mmol/L' : 'mg/dL'}</small></b>
        <em>${state.iobEstimated ? 'estimated 1.5 U' : `${state.iob} U × ${sensitivityText()}`}</em>
      </div>
      <div class="metric">
        <span>Muscle draw</span>
        <b>${drop(n.exerciseDraw)}<small>${isMmol() ? 'mmol/L' : 'mg/dL'}</small></b>
        <em>${Math.round(n.oxidation)} g/h · ${state.durationMin} min</em>
      </div>
      <div class="metric">
        <span>Simulated nadir</span>
        <b>${isMmol() ? toMmol(st.nadir).toFixed(1) : Math.round(st.nadir)}<small>${isMmol() ? 'mmol/L' : 'mg/dL'}</small></b>
        <em>minute ${st.nadirAt}${st.nadir < 70 ? ' · hypo' : ''}</em>
      </div>
    </div>

    <div class="card">
      <div class="card__head">
        <div>
          <h3>3-hour projection</h3>
          <p>If the plan is followed and no carbohydrate is taken</p>
        </div>
        <label class="toggle">
          <input type="checkbox" id="baselineToggle" ${showBaseline ? 'checked' : ''} />
          No-plan scenario
        </label>
      </div>
      <div class="chart-wrap"><canvas id="chart" role="img" aria-label="Glucose projection chart" aria-describedby="chartSummary"></canvas></div>
      <p class="sr-only" id="chartSummary">${chartSummaryText()}</p>
      <div class="chart-foot">
        <div class="legend">
          <span><i></i>Plan</span>
          <span><i class="dash"></i>No plan</span>
          <span><i class="band"></i>Target band</span>
          <span><i class="soft"></i>Timing ±10 min</span>
        </div>
        <span>Nadir ${G(st.nadir)} · peak ${G(st.peak)} · finish ${G(st.endGlucose)}</span>
      </div>
    </div>

    <div class="plan-grid">
      <article class="plan">
        <div class="plan__head">
          <span class="plan__icon">🍽</span>
          <h3>Before exercise<span>carbohydrate</span></h3>
        </div>
        <div class="plan__value">${plan.preCarb.grams}<small> g</small></div>
        <p class="plan__text">${preText}</p>
        <p class="plan__note">${plan.preCarb.note}</p>
      </article>

      <article class="plan">
        <div class="plan__head">
          <span class="plan__icon">⚡</span>
          <h3>During session<span>hourly target</span></h3>
        </div>
        <div class="plan__value">${duringValue}</div>
        ${scheduleChips ? `<div class="schedule">${scheduleChips}</div>` : ''}
        <p class="plan__text">${plan.during.needed ? `${plan.during.total} g planned in total` : 'No extra carbohydrate planned'}</p>
        <p class="plan__note">${plan.during.note} ${plan.during.hydration}</p>
      </article>

      <article class="plan">
        <div class="plan__head">
          <span class="plan__icon">💉</span>
          <h3>Basal scenario<span>${plan.basal.applicable ? 'temporary basal' : 'MDI user'}</span></h3>
        </div>
        <div class="plan__value">${basalValue}</div>
        <p class="plan__text">
          ${
            plan.basal.applicable
              ? `start ${plan.basal.startBeforeMin} min before, taper out ${plan.basal.endAfterMin} min after the end${plan.basal.tempRate ? ` · ${plan.basal.tempRate} U/h` : ''}`
              : 'No pump: carb strategy'
          }
        </p>
        ${basalStepsHtml()}
        <p class="plan__note">${plan.basal.applicable ? plan.basal.note : plan.basal.mdiNote}</p>
        ${plan.basal.applicable ? '<button type="button" class="link-btn" data-action="copy-program">Copy pump program</button>' : ''}
      </article>

      <article class="plan">
        <div class="plan__head">
          <span class="plan__icon">🥗</span>
          <h3>After<span>recovery</span></h3>
        </div>
        <div class="plan__value">${plan.after.carbsG}<small> g</small>${plan.after.proteinG ? `<small> + ${plan.after.proteinG} g protein</small>` : ''}</div>
        <p class="plan__text">The first 60 minutes after the end</p>
        <p class="plan__note">${plan.after.overnight}</p>
      </article>
    </div>

    ${warningHtml}

    <div class="card">
      <div class="card__head"><div><h3>Risk profile</h3><p>0–100 scores derived from the simulation</p></div></div>
      <div class="risks">
        ${riskRow('Hypoglycemia', plan.risks.hypo)}
        ${riskRow('Late hypoglycemia', plan.risks.lateHypo)}
        ${riskRow('Hyperglycemia', plan.risks.hyper)}
      </div>
    </div>

    <div class="card">
      <div class="card__head"><div><h3>Calculation breakdown</h3><p>Same input → same result</p></div>
        <a class="toggle" href="science.html#formulas">Formulas ↗</a>
      </div>
      <div class="math">
        ${plan.rationale
          .map(
            (r) => `<details class="math__row">
              <summary>
                <span class="math__label">${r.label}</span>
                <span class="math__val">${r.value}</span>
                <span class="math__chev" aria-hidden="true">›</span>
              </summary>
              <p class="math__expr">${r.expression}</p>
              ${r.hint ? `<p class="math__hint">${r.hint}</p>` : ''}
              <a class="math__link" href="science.html#formulas">Formula and sources ↗</a>
            </details>`,
          )
          .join('')}
      </div>
    </div>

    <div class="card">
      <div class="card__head"><div><h3>Checkpoints</h3><p>When to check during the session</p></div></div>
      <ul class="checks">
        ${plan.checks.map((c) => `<li><b>${c.at}</b><span>${c.text}</span></li>`).join('')}
      </ul>
    </div>

    ${outcomeCard()}
  `;

  syncForm();
  drawChart();
  renderHistory();
  updateMobileBar();
  announce();
  scheduleSave();
}

/** Mobile sticky bar: reach the plan in one tap. */
function updateMobileBar() {
  if (!plan || !els.mobileBar) return;
  els.mobileBar.hidden = false;
  els.mbValue.textContent =
    plan.preCarb.mode === 'treat'
      ? '15 g — hypo treatment'
      : plan.preCarb.grams > 0
        ? `${plan.preCarb.grams} g before`
        : plan.during.needed
          ? `During: ${plan.during.perHour} g/h`
          : 'No extra carbohydrate';
  els.mbMeta.textContent = `${plan.sport.name} · ${state.durationMin} min · basal −${plan.basal.reductionPercent}%`;
  els.mbDot.className = `mobile-bar__dot is-${plan.status.level}`;
}

function doseCopy(p) {
  if (p.status.level === 'stop') return p.status.title;
  if (p.preCarb.grams === 0) return 'You can start without carbohydrate';
  return `${p.preCarb.grams} g carbohydrate before exercise`;
}

function sensitivityText() {
  const sens = SPORT_BY_ID[state.sport].sensitivity.toFixed(2);
  const isf = isMmol() ? toMmol(state.isf).toFixed(1) : Math.round(state.isf);
  return `${isf} ${isMmol() ? 'mmol/L' : 'mg/dL'}/U × ${sens}`;
}

function drawChart() {
  const canvas = $('chart');
  if (!canvas || !plan) return;
  drawTimeline(canvas, {
    points: plan.simulation.points,
    baseline: plan.simulation.baseline,
    uncertainty: currentBand,
    unit: state.unit,
    markers: plan.simulation.markers,
    exStart: plan.simulation.exStart,
    exEnd: plan.simulation.exEnd,
    showBaseline,
  });
  canvas.dataset.band = currentBand ? 'on' : 'off';
}

/* ------------------------------------------------------------------ */
/* Nearby actions: alternatives, basal steps, sharing, backup          */
/* ------------------------------------------------------------------ */

function alternativesHtml() {
  if (!currentAlternatives.length) return '';
  return `
    <div class="card card--alt">
      <div class="card__head"><div><h3>What would change this?</h3><p>Same engine, one change at a time</p></div></div>
      <ul class="alts">
        ${currentAlternatives
          .map(
            (alt) => `<li>
              <button type="button" class="alt" data-alt="${alt.id}">
                <b>${alt.label}</b>
                <span>${alt.detail} → ${alt.status.toLowerCase()} · nadir ${Math.round(alt.nadir)} mg/dL</span>
              </button>
            </li>`,
          )
          .join('')}
      </ul>
      <p class="alts__note">Tap one to apply it to the form.</p>
    </div>`;
}

function applyAlternative(id) {
  const alt = currentAlternatives.find((item) => item.id === id);
  if (!alt) return;
  // Alternatives are produced by the engine in mg/dL, which is what state
  // stores; the display unit is applied only at the form boundary.
  const patch = { ...alt.patch, unit: state.unit };
  // "Wait for the IOB to fall" sets a concrete value: cautious mode would
  // otherwise keep overwriting it with the assumed 1.5 U.
  if ('iob' in patch) patch.iobEstimated = false;
  Object.assign(state, sanitizeState(patch, state));
  syncForm();
  render();
  toast(`Applied: ${alt.label.toLowerCase()}`);
}

function basalStepsHtml() {
  const steps = plan?.basal?.steps || [];
  if (!steps.length) return '';
  return `
    <div class="basal-steps" role="img" aria-label="${steps.map((step) => `${step.label} minus ${step.percent} percent`).join(', ')}">
      ${steps
        .map(
          (step) => `<span class="basal-steps__step">
            <i style="--h:${Math.max(10, step.percent)}%"></i>
            <b>−${step.percent}%</b>
            <em>${step.label}</em>
          </span>`,
        )
        .join('')}
    </div>`;
}

function chartSummaryText() {
  if (!plan) return '';
  const G = (value) => formatGlucose(value, state.unit);
  const sim = plan.simulation;
  return `Projection over ${sim.horizon} minutes. Exercise from minute ${sim.exStart} to ${sim.exEnd}. Nadir ${G(sim.nadir)} at minute ${sim.nadirAt}, peak ${G(sim.peak)}, finishes at ${G(sim.endGlucose)}.`;
}

/** URL-safe copy of the current scenario (health data: the user chooses to share it). */
function shareUrl() {
  return `${location.origin}${location.pathname}#${encodeScenario(state)}`;
}

/** Applies a share link; a partial or hand-edited hash cannot break the form. */
function applyHash() {
  const next = decodeScenario(location.hash, state);
  if (!next) return false;
  Object.assign(state, next);
  return true;
}

function diagnosticsText() {
  return JSON.stringify(
    {
      app: 'SokeriSport',
      version: APP_VERSION,
      generatedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      unit: state.unit,
      inputs: {
        glucoseMgdl: Math.round(state.glucose),
        trend: state.trend,
        iob: state.iob,
        sport: state.sport,
        durationMin: state.durationMin,
        intensity: state.intensity,
        leadTimeMin: state.leadTimeMin,
        ketones: state.ketones,
        pump: state.pump,
        basalRate: state.basalRate,
        isf: state.isf,
        diaHours: state.diaHours,
        weightKg: state.weightKg,
        targetGlucose: state.targetGlucose,
        carbType: state.carbType,
        heat: state.heat,
        iobEstimated: state.iobEstimated,
      },
      plan: plan
        ? {
            status: plan.status.title,
            level: plan.status.level,
            preCarbs: plan.preCarb.grams,
            duringPerHour: plan.during.perHour,
            basalPercent: plan.basal.reductionPercent,
            nadir: Math.round(plan.simulation.nadir),
            peak: Math.round(plan.simulation.peak),
            rationale: plan.rationale.map((row) => `${row.label}: ${row.expression} = ${row.value}`),
          }
        : null,
    },
    null,
    2,
  );
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
      toast(ok ? message : 'Copy failed — select the text manually');
    } catch {
      toast('Copy failed — select the text manually');
    }
    area.remove();
    return ok;
  }
}

async function copyProgram() {
  if (!plan?.basal?.programText) return;
  await copyText(plan.basal.programText, 'Pump program copied');
}

/* --- history: personal accuracy ---------------------------------- */

function renderStats() {
  if (!els.statsBox) return;
  const history = loadHistory();
  const stats = outcomeStats(history);
  if (!history.length) {
    els.statsBox.hidden = true;
    return;
  }
  if (!stats.logged) {
    els.statsBox.hidden = false;
    els.statsBox.innerHTML = `
      <h4>Plan vs reality</h4>
      <p class="stats__note">Add the lowest reading after a session and this panel starts comparing the plan with what actually happened. Two minutes per session is enough.</p>`;
    return;
  }

  const G = (value) => formatGlucose(value, state.unit);
  const band = accuracyBand(stats.meanAbsDeviation);
  const bandText = {
    close: 'The plan and reality usually agree.',
    fair: 'The plan is close, with some spread.',
    wide: 'The plan and reality differ — worth reviewing with your team.',
    unknown: 'Not enough logged outcomes yet.',
  }[band];

  els.statsBox.hidden = false;
  els.statsBox.innerHTML = `
    <h4>Plan vs reality</h4>
    <div class="stats">
      <div><b>${stats.logged}</b><span>logged sessions</span></div>
      <div><b>${stats.meanAbsDeviation === null ? '—' : G(stats.meanAbsDeviation)}</b><span>mean difference at the nadir</span></div>
      <div><b>${stats.hypos}</b><span>hypos reported</span></div>
      <div><b>${stats.carbAdherence === null ? '—' : `${Math.round(stats.carbAdherence * 100)}%`}</b><span>carbohydrate vs plan</span></div>
    </div>
    <p class="stats__note">${bandText}</p>`;
}

/* --- history: compare two plans ---------------------------------- */

function renderCompareOptions() {
  if (!els.compareA || !els.compareB) return;
  const entries = loadHistory();
  const options = entries
    .map(
      (entry) =>
        `<option value="${entry.ts}">${entry.sport} · ${formatGlucose(entry.glucose, state.unit)} · ${entry.durationMin ?? '?'} min</option>`,
    )
    .join('');

  const keepA = els.compareA.value;
  const keepB = els.compareB.value;
  els.compareA.innerHTML = options;
  els.compareB.innerHTML = options;
  if (entries.length > 1) els.compareB.selectedIndex = 1;
  if (keepA) els.compareA.value = keepA;
  if (keepB) els.compareB.value = keepB;
}

function compareRow(label, a, b, suffix = '') {
  const same = a === b;
  const cell = (value) => `${value === '—' || value === null || value === undefined ? '—' : `${value}${suffix}`}`;
  return `<tr><th scope="row">${label}</th><td>${cell(a)}</td><td>${cell(b)}</td><td class="${same ? 'is-same' : 'is-diff'}">${same ? 'same' : 'differs'}</td></tr>`;
}

function runCompare() {
  if (!els.compareOut || !els.compareA) return;
  const entries = loadHistory();
  const a = entries.find((entry) => entry.ts === Number(els.compareA.value));
  const b = entries.find((entry) => entry.ts === Number(els.compareB.value));
  if (!a || !b) {
    els.compareOut.innerHTML = '<p class="stats__note">Pick two saved simulations.</p>';
    return;
  }

  const planned = (entry) => entry.plannedCarbs ?? entry.carbs;
  // Glucose columns follow the unit toggle; the rest is unit-free.
  const G = (value) => (value === null || value === undefined || value === '' ? '—' : glucoseNumber(value, state.unit));
  const gSuffix = isMmol() ? ' mmol/L' : ' mg/dL';
  els.compareOut.innerHTML = `
    <table class="compare">
      <thead><tr><th></th><th>${new Date(a.ts).toLocaleDateString('en-GB')}</th><th>${new Date(b.ts).toLocaleDateString('en-GB')}</th><th></th></tr></thead>
      <tbody>
        ${compareRow('Sport', a.sport, b.sport)}
        ${compareRow('Duration', a.durationMin ?? '—', b.durationMin ?? '—', ' min')}
        ${compareRow('Intensity', a.intensity ?? '—', b.intensity ?? '—')}
        ${compareRow('Start glucose', G(a.glucose), G(b.glucose), gSuffix)}
        ${compareRow('Planned carbohydrate', planned(a), planned(b), ' g')}
        ${compareRow('Planned nadir', G(a.plannedNadir), G(b.plannedNadir), gSuffix)}
        ${compareRow('Outcome nadir', G(a.outcome?.min), G(b.outcome?.min), gSuffix)}
      </tbody>
    </table>`;
}

/* --- backup / restore -------------------------------------------- */

/** Downloads a generated file without a server round trip. */
function downloadFile(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** The confirmation field only appears once a password is being typed. */
function syncBackupConfirm() {
  if (!els.backupConfirm) return;
  const typed = (els.backupPassword?.value || '').length > 0;
  els.backupConfirm.hidden = !typed;
  if (!typed && els.backupPasswordConfirm) els.backupPasswordConfirm.value = '';
}

function clearBackupPasswords() {
  if (els.backupPassword) els.backupPassword.value = '';
  if (els.backupPasswordConfirm) els.backupPasswordConfirm.value = '';
  syncBackupConfirm();
}

async function exportBackup() {
  const password = els.backupPassword?.value || '';
  const confirmation = els.backupPasswordConfirm?.value || '';
  const check = validateBackupPassword(password, confirmation);
  if (!check.ok) {
    if (check.reason === 'too-short') {
      toast(`Set a backup password of at least ${MIN_PASSWORD_LENGTH} characters`);
      els.backupPassword?.focus();
    } else {
      toast('The two passwords do not match');
      els.backupPasswordConfirm?.focus();
    }
    return;
  }

  try {
    const envelope = await encryptSnapshot(exportSnapshot(), password);
    downloadFile(
      JSON.stringify(envelope, null, 2),
      `sokerisport-backup-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json',
    );
    // The password is never stored: clearing both fields also keeps it out of
    // screenshots and shared screens after the export.
    clearBackupPasswords();
    toast('Encrypted backup exported — keep the password safe');
  } catch {
    toast('Backup could not be encrypted');
  }
}

async function importBackup(file) {
  if (!file) return;

  let text;
  try {
    text = await file.text();
  } catch {
    toast('That file could not be read');
    return;
  }

  const parsed = parseBackupText(text);
  if (parsed.kind === 'invalid') {
    toast('That file is not a SokeriSport backup');
    return;
  }

  let snapshot = parsed.snapshot;
  if (parsed.kind === 'encrypted') {
    const typed = els.backupPassword?.value || '';
    const password = typed || window.prompt('Password for this backup') || '';
    const decrypted = await decryptSnapshot(parsed.envelope, password);
    if (!decrypted.ok) {
      toast(
        decrypted.reason === 'password-required'
          ? 'This backup is encrypted — enter its password'
          : 'Wrong password — the backup was not restored',
      );
      return;
    }
    snapshot = decrypted.snapshot;
    clearBackupPasswords();
  }

  if (!window.confirm('Restoring replaces the profile and simulations stored on this device. Continue?')) return;

  const result = importSnapshot(snapshot);
  if (!result.ok) {
    toast(
      result.reason === 'newer-schema'
        ? 'That backup comes from a newer version'
        : 'That file is not a SokeriSport backup',
    );
    return;
  }
  // The imported profile is what the form should now show.
  Object.assign(state, sanitizeState(loadProfile() ?? {}, state));
  syncForm();
  render();
  toast(`Backup restored — ${result.restored} simulations`);
}

/* --- onboarding -------------------------------------------------- */

const PRESETS = [
  {
    id: 'morning-run',
    title: 'Morning run with IOB on board',
    note: '132 mg/dL, falling, 1.8 U IOB, 75 min',
    patch: { glucose: 132, trend: 'slowDown', iob: 1.8, sport: 'kosu', durationMin: 75, intensity: 3, leadTimeMin: 20 },
  },
  {
    id: 'basketball',
    title: 'Evening basketball',
    note: '168 mg/dL, steady, 90 min of intervals',
    patch: { glucose: 168, trend: 'flat', iob: 0.4, sport: 'basketbol', durationMin: 90, intensity: 4, leadTimeMin: 30 },
  },
  {
    id: 'low',
    title: 'Starting low',
    note: '72 mg/dL, falling — see the stop path',
    patch: { glucose: 72, trend: 'down', iob: 0.2, sport: 'yuruyus', durationMin: 45, intensity: 2, leadTimeMin: 15 },
  },
];

const ONBOARDING_KEY = 'sokerisport.onboarding.dismissed';

function renderOnboarding() {
  if (!els.onboarding) return;
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(ONBOARDING_KEY) === '1';
  } catch {
    dismissed = true;
  }
  if (dismissed || loadProfile()) {
    els.onboarding.hidden = true;
    return;
  }

  els.onboarding.hidden = false;
  els.onboarding.innerHTML = `
    <div class="onboarding__head">
      <div><h3>First time here?</h3><p>Load an example, then change one value and watch the plan react.</p></div>
      <button type="button" class="link-btn" data-onboarding-close>Dismiss</button>
    </div>
    <div class="onboarding__list">
      ${PRESETS.map(
        (preset) => `<button type="button" class="onboarding__item" data-preset="${preset.id}">
          <b>${preset.title}</b><span>${preset.note}</span>
        </button>`,
      ).join('')}
    </div>`;
}

function dismissOnboarding() {
  try {
    localStorage.setItem(ONBOARDING_KEY, '1');
  } catch {
    /* ignore */
  }
  if (els.onboarding) els.onboarding.hidden = true;
}

/**
 * Uncertainty band: the same plan with ±10 min of timing error and ±0.3 U of
 * IOB error. The engine is deterministic, so these runs cost nothing extra.
 */
function buildBand(raw, main) {
  const shift = (patch) => buildPlan({ ...raw, ...patch }).simulation.points;
  const runs = [
    shift({ leadTimeMin: Math.max(0, raw.leadTimeMin - 10) }),
    shift({ leadTimeMin: Math.min(180, raw.leadTimeMin + 10) }),
  ];
  if (Number(raw.iob) > 0) {
    runs.push(shift({ iob: Math.max(0, Number(raw.iob) - 0.3) }));
    runs.push(shift({ iob: Math.min(30, Number(raw.iob) + 0.3) }));
  }

  const base = main.simulation.points;
  const low = base.map((p, i) => ({ t: p.t, g: Math.min(p.g, ...runs.map((r) => r[i].g)) }));
  const high = base.map((p, i) => ({ t: p.t, g: Math.max(p.g, ...runs.map((r) => r[i].g)) }));
  return { low, high };
}

/**
 * Screen-reader announcement for the verdict (aria-live region). Debounced:
 * announcing every keystroke would interrupt the user with partial sentences.
 */
let announceTimer = null;
function announce() {
  if (!els.srStatus || !plan) return;
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    if (!plan || !els.srStatus) return;
    els.srStatus.textContent = `${plan.status.title}. ${plan.status.headline} ${plan.status.detail}`;
  }, 600);
}

/** "How did it go" card: plan vs what actually happened. */
function outcomeCard() {
  const unit = unitText();
  const entry = lastSavedTs ? loadHistory().find((h) => h.ts === lastSavedTs) : null;
  const outcome = entry?.outcome;
  const disabled = lastSavedTs ? '' : 'disabled';
  const summary = outcome ? outcomeSummary(entry) : '';

  return `
    <div class="card" id="outcomeCard">
      <div class="card__head">
        <div>
          <h3>How did it go?</h3>
          <p>${lastSavedTs ? 'Compare the plan with what actually happened' : 'Save the result first, then log the outcome'}</p>
        </div>
      </div>
      <div class="outcome" ${lastSavedTs ? '' : 'aria-disabled="true"'}>
        <label><span>Start glucose (${unit})</span>
          <input type="number" inputmode="decimal" data-outcome="start" value="${outcomeDraft.start}" ${disabled} />
        </label>
        <label><span>Lowest reading (${unit})</span>
          <input type="number" inputmode="decimal" data-outcome="min" value="${outcomeDraft.min}" ${disabled} />
        </label>
        <label><span>Carbs taken (g)</span>
          <input type="number" inputmode="numeric" data-outcome="carbs" value="${outcomeDraft.carbs}" ${disabled} />
        </label>
        <label class="toggle">
          <input type="checkbox" data-outcome="hypo" ${outcomeDraft.hypo ? 'checked' : ''} ${disabled} />
          Hypo during or after
        </label>
        <button type="button" class="btn btn--primary btn--sm" data-action="save-outcome" ${disabled}>Save outcome</button>
      </div>
      <p class="outcome__summary" data-outcome-summary>${summary}</p>
    </div>`;
}

function outcomeSummary(entry) {
  const o = entry.outcome || {};
  const parts = [];
  const G = (value) => formatGlucose(value, state.unit);
  if (Number.isFinite(o.start) && Number.isFinite(entry.glucose)) {
    parts.push(`start ${G(o.start)} instead of ${G(entry.glucose)}`);
  }
  if (Number.isFinite(o.min) && Number.isFinite(entry.plannedNadir)) {
    const diff = o.min - entry.plannedNadir;
    parts.push(
      `lowest ${G(o.min)} (plan ${G(entry.plannedNadir)}, ${diff >= 0 ? '+' : '-'}${glucoseNumber(Math.abs(diff), state.unit)})`,
    );
  }
  if (Number.isFinite(o.carbs) && Number.isFinite(entry.plannedCarbs)) {
    parts.push(`${Math.round(o.carbs)} g carbohydrate (plan ${entry.plannedCarbs} g)`);
  }
  if (o.hypo) parts.push('hypo reported');
  if (parts.length === 0) return '';
  return `Logged: ${parts.join(' · ')}.`;
}

/* ------------------------------------------------------------------ */
/* Olaylar                                                             */
/* ------------------------------------------------------------------ */

function bind() {
  els.trends.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-trend]');
    if (!btn) return;
    state.trend = btn.dataset.trend;
    render();
  });

  els.sportPicker.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sport]');
    if (!btn) return;
    state.sport = btn.dataset.sport;
    render();
  });

  els.intensity.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-intensity]');
    if (!btn) return;
    state.intensity = Number(btn.dataset.intensity);
    render();
  });

  els.quickGlucose.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-v]');
    if (!btn) return;
    state.glucose = Number(btn.dataset.v);
    els.glucose.value = String(disp.glucose());
    render();
  });

  els.glucose.addEventListener('input', () => {
    const v = readNumber(els.glucose, null);
    if (v === null) return;
    state.glucose = isMmol() ? fromMmol(v) : v;
    render();
  });
  clampOnChange(els.glucose, (v) => (state.glucose = isMmol() ? fromMmol(v) : v), unitText());

  els.iob.addEventListener('input', () => {
    state.iob = readNumber(els.iob, state.iob);
    render();
  });
  clampOnChange(els.iob, (v) => (state.iob = v), 'U');

  els.iobUnknown.addEventListener('change', () => {
    state.iobEstimated = els.iobUnknown.checked;
    syncForm();
    render();
  });

  els.leadTime.addEventListener('input', () => {
    state.leadTimeMin = Number(els.leadTime.value);
    els.leadTimeOut.textContent = `${state.leadTimeMin} min`;
    paintRange(els.leadTime);
    render();
  });

  els.duration.addEventListener('input', () => {
    state.durationMin = Number(els.duration.value);
    els.durationOut.textContent = `${state.durationMin} min`;
    paintRange(els.duration);
    render();
  });

  const numeric = [
    ['weightKg', (v) => (state.weightKg = v)],
    ['isf', (v) => (state.isf = isMmol() ? fromMmol(v) : v)],
    ['carbRatio', (v) => (state.carbRatio = v)],
    ['diaHours', (v) => (state.diaHours = v)],
    ['targetGlucose', (v) => (state.targetGlucose = isMmol() ? fromMmol(v) : v)],
    ['basalRate', (v) => (state.basalRate = v)],
  ];

  numeric.forEach(([id, setter]) => {
    const el = $(id);
    el.addEventListener('input', () => {
      const v = readNumber(el, null);
      if (v === null) return;
      setter(v);
      render();
    });
    clampOnChange(el, setter);
  });

  els.ketones.addEventListener('change', () => {
    state.ketones = els.ketones.value;
    render();
  });

  els.pump.addEventListener('change', () => {
    state.pump = els.pump.checked;
    els.basalField.hidden = !state.pump;
    render();
  });

  document.querySelectorAll('[data-unit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.unit === btn.dataset.unit) return;
      state.unit = btn.dataset.unit;
      syncForm();
      render();
    });
  });

  els.results.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'copy') await copyPlan();
    if (btn.dataset.action === 'save') saveResult();
    if (btn.dataset.action === 'print') window.print();
    if (btn.dataset.action === 'save-outcome') saveOutcome();
    if (btn.dataset.action === 'copy-program') await copyProgram();
    if (btn.dataset.action === 'link') await copyText(shareUrl(), 'Link copied — it contains your glucose values');
    if (btn.dataset.action === 'diagnostics') await copyText(diagnosticsText(), 'Diagnostics copied');
  });

  els.results.addEventListener('click', (e) => {
    const alt = e.target.closest('[data-alt]');
    if (alt) applyAlternative(alt.dataset.alt);
  });

  els.results.addEventListener('input', (e) => {
    const field = e.target.closest('[data-outcome]');
    if (!field || field.dataset.outcome === 'hypo') return;
    outcomeDraft[field.dataset.outcome] = field.value;
  });

  els.results.addEventListener('change', (e) => {
    if (e.target.id === 'baselineToggle') {
      showBaseline = e.target.checked;
      drawChart();
    }
    const field = e.target.closest('[data-outcome]');
    if (field && field.dataset.outcome === 'hypo') outcomeDraft.hypo = field.checked;
  });

  if (els.carbType) {
    els.carbType.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-carb]');
      if (!btn) return;
      state.carbType = btn.dataset.carb;
      syncForm();
      render();
    });
  }

  if (els.heat) {
    els.heat.addEventListener('change', () => {
      state.heat = els.heat.checked;
      render();
    });
  }

  if (els.historyExport) els.historyExport.addEventListener('click', exportCsv);
  if (els.compareRun) els.compareRun.addEventListener('click', runCompare);
  if (els.backupPassword) els.backupPassword.addEventListener('input', syncBackupConfirm);
  if (els.backupExport) els.backupExport.addEventListener('click', exportBackup);
  if (els.backupImport) els.backupImport.addEventListener('click', () => els.backupFile?.click());
  if (els.backupFile) {
    els.backupFile.addEventListener('change', async (event) => {
      await importBackup(event.target.files?.[0]);
      event.target.value = '';
    });
  }

  if (els.onboarding) {
    els.onboarding.addEventListener('click', (event) => {
      if (event.target.closest('[data-onboarding-close]')) {
        dismissOnboarding();
        return;
      }
      const preset = event.target.closest('[data-preset]');
      if (!preset) return;
      const found = PRESETS.find((item) => item.id === preset.dataset.preset);
      if (!found) return;
      Object.assign(state, sanitizeState({ ...found.patch, unit: state.unit }, state));
      syncForm();
      render();
      dismissOnboarding();
      toast(`Example loaded: ${found.title}`);
    });
  }

  enableRoving(els.trends, '[data-trend]');
  enableRoving(els.sportPicker, '[data-sport]');
  enableRoving(els.intensity, '[data-intensity]');
  enableRoving(els.carbType, '[data-carb]');

  els.resetBtn.addEventListener('click', () => {
    Object.assign(state, sanitizeState(DEFAULTS));
    syncForm();
    render();
    toast('Settings reset to defaults');
  });

  els.profileSave.addEventListener('click', () => {
    saveProfile(profilePayload());
    toast('Profile saved');
  });

  els.clearHistory.addEventListener('click', () => {
    if (loadHistory().length === 0) {
      toast('History is already empty');
      return;
    }
    // Destructive and local-only: ask, and point at the backup first.
    if (!window.confirm('Delete every simulation stored on this device? Export a backup first if you want to keep them.')) return;
    clearHistory();
    lastSavedTs = null;
    renderHistory();
    paint();
    toast('History cleared');
  });

  els.historyList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-load]');
    if (!btn) return;
    const entry = loadHistory().find((h) => h.ts === Number(btn.dataset.load));
    if (!entry) return;
    Object.assign(state, sanitizeState({ ...entry.state, unit: state.unit }, state));
    syncForm();
    render();
    toast('Simulation restored');
  });

  els.mobileBar.addEventListener('click', (e) => {
    if (!e.target.closest('#mbGo')) return;
    els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  if ('IntersectionObserver' in window) {
    const barObserver = new IntersectionObserver(
      ([entry]) => {
        els.mobileBar.classList.toggle('is-muted', entry.isIntersecting && entry.intersectionRatio > 0.1);
      },
      { threshold: [0, 0.1, 0.35] },
    );
    barObserver.observe(els.results);
  }

  // The profile write is debounced: a quick tab close must not lose the last edit.
  window.addEventListener('pagehide', flushProfile);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushProfile();
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawChart, 160);
  });

  // Printing: stamp the date and open the calculation rows so the care team
  // sees the formulas on paper. Closed again afterwards.
  window.addEventListener('beforeprint', () => {
    const stamp = $('printDate');
    if (stamp) stamp.textContent = new Date().toLocaleDateString('en-GB');
    document.querySelectorAll('details.math__row').forEach((row) => {
      if (!row.open) {
        row.open = true;
        row.dataset.autoOpened = '1';
      }
    });
  });

  window.addEventListener('afterprint', () => {
    document.querySelectorAll('details.math__row[data-auto-opened]').forEach((row) => {
      row.open = false;
      delete row.dataset.autoOpened;
    });
  });
}

async function copyPlan() {
  if (!plan) return;
  await copyText(planToText(plan), 'Plan copied to clipboard');
}

function profilePayload() {
  return {
    unit: state.unit,
    weightKg: state.weightKg,
    isf: state.isf,
    carbRatio: state.carbRatio,
    diaHours: state.diaHours,
    targetGlucose: state.targetGlucose,
    pump: state.pump,
    basalRate: state.basalRate,
    sport: state.sport,
    intensity: state.intensity,
    durationMin: state.durationMin,
    leadTimeMin: state.leadTimeMin,
    trend: state.trend,
  };
}

let storageWarned = false;

/** Local writes are best-effort: say so instead of losing data silently. */
function warnStorageBlocked() {
  if (storageWarned) return;
  storageWarned = true;
  if (els.storageNotice) {
    els.storageNotice.hidden = false;
    els.storageNotice.textContent =
      'This browser blocked local storage: settings and history will not be kept after a reload. The simulator and CSV export still work.';
  }
  toast('Local storage is unavailable — nothing is being saved');
}

function flushProfile() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!saveProfile(profilePayload())) warnStorageBlocked();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushProfile, 700);
}

function saveResult() {
  if (!plan) return;
  const ts = Date.now();
  // Persist the values the engine actually used, not a transient typed value
  // the user has not left yet (e.g. 9000 before the field clamps to 600).
  const used = plan.input;
  const result = pushHistory({
    ts,
    sport: plan.sport.name,
    sportGlyph: plan.sport.glyph,
    glucose: Math.round(used.glucose),
    carbs: plan.preCarb.grams,
    level: plan.status.level,
    status: plan.status.title,
    durationMin: used.durationMin,
    intensity: plan.level.label,
    plannedCarbs: plan.preCarb.grams + plan.during.total,
    plannedNadir: Math.round(plan.simulation.nadir),
    plannedPeak: Math.round(plan.simulation.peak),
    duringPerHour: plan.during.perHour,
    basalPercent: plan.basal.reductionPercent,
    state: {
      ...state,
      glucose: used.glucose,
      iob: used.iob,
      isf: used.isf,
      carbRatio: used.carbRatio,
      weightKg: used.weightKg,
      durationMin: used.durationMin,
      leadTimeMin: used.leadTimeMin,
      basalRate: used.basalRate,
      diaHours: used.diaHours,
      targetGlucose: used.targetGlucose,
    },
  });

  if (!result.ok) {
    toast('Could not save: local storage is full or blocked');
    return;
  }

  lastSavedTs = ts;
  Object.assign(outcomeDraft, { start: '', min: '', carbs: '', hypo: false });
  paint();
  toast(
    result.dropped
      ? 'Saved — the oldest simulation was dropped'
      : 'Simulation added to history',
  );
}

/** Merges the "how did it go" form into the saved history entry. */
function saveOutcome() {
  if (!lastSavedTs) {
    toast('Save the result first');
    return;
  }
  const toMg = (value) => {
    const n = parseFloat(String(value).replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    return Math.round(isMmol() ? fromMmol(n) : n);
  };
  const outcome = {
    start: toMg(outcomeDraft.start),
    min: toMg(outcomeDraft.min),
    carbs: outcomeDraft.carbs === '' ? null : Number(outcomeDraft.carbs),
    hypo: Boolean(outcomeDraft.hypo),
  };
  if (outcome.start === null && outcome.min === null && outcome.carbs === null && !outcome.hypo) {
    toast('Enter at least one outcome value');
    return;
  }

  updateHistoryEntry(lastSavedTs, { outcome });
  const entry = loadHistory().find((h) => h.ts === lastSavedTs);
  const summary = document.querySelector('[data-outcome-summary]');
  if (summary && entry) summary.textContent = outcomeSummary(entry);
  renderHistory();
  toast('Outcome saved');
}

/** CSV export for the care team: plan, outcome and the input snapshot. */
function exportCsv() {
  const rows = loadHistory();
  if (rows.length === 0) {
    toast('No simulations to export');
    return;
  }

  downloadFile(
    historyToCsv(rows),
    `sokerisport-history-${new Date().toISOString().slice(0, 10)}.csv`,
    'text/csv;charset=utf-8',
  );
  toast('History exported as CSV');
}

function renderHistory() {
  const list = loadHistory();
  els.historySection.hidden = list.length === 0;
  els.historyList.innerHTML = list
    .map((h) => {
      const o = h.outcome;
      const badge = o
        ? `<em class="history__outcome${o.hypo ? ' is-hypo' : ''}" title="Logged outcome">${o.hypo ? 'hypo' : 'logged'}${Number.isFinite(o.min) ? ` · ${Math.round(o.min)}` : ''}</em>`
        : '';
      return `
      <li>
        <button type="button" class="link-btn" data-load="${h.ts}" title="Restore this simulation">
          ${h.sportGlyph || '•'} ${h.sport}
        </button>
        <b>${glucoseNumber(h.glucose, state.unit)} ${isMmol() ? 'mmol/L' : 'mg/dL'} → ${h.carbs} g</b>
        ${badge}
        <time>${new Date(h.ts).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
      </li>`;
    })
    .join('');

  renderStats();
  renderCompareOptions();
}

/* ------------------------------------------------------------------ */
/* Network status                                                           */
/* ------------------------------------------------------------------ */

function paintNetwork() {
  const offline = !navigator.onLine;
  els.netBadge.classList.toggle('is-offline', offline);
  els.netText.textContent = offline ? 'Offline' : 'Offline ready';
  els.netBadge.title = offline ? 'No connection — the app runs locally' : 'All files cached';
}

/* ------------------------------------------------------------------ */
/* Boot                                                              */
/* ------------------------------------------------------------------ */

function init() {
  // A profile from an older build, a corrupted key or a hand-edited value must
  // never reach the renderer: sanitize before the first paint.
  const saved = loadProfile();
  if (saved) Object.assign(state, sanitizeState(saved, DEFAULTS));

  const fromLink = applyHash();

  buildControls();
  bind();
  paintNetwork();
  window.addEventListener('online', paintNetwork);
  window.addEventListener('offline', paintNetwork);

  if (els.storageNotice && !storageAvailable()) {
    els.storageNotice.hidden = false;
    els.storageNotice.textContent =
      'This browser blocks local storage, so the profile, history and backup are unavailable. The simulator and the CSV export still work.';
  }

  syncForm();
  render();
  renderOnboarding();

  if (fromLink) toast('Scenario loaded from the link');
}

init();
