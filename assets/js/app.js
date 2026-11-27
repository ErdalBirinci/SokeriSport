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
  planToText,
  formatGlucose,
  toMmol,
  fromMmol,
} from './engine.js';
import { drawTimeline } from './chart.js';
import { loadProfile, saveProfile, loadHistory, pushHistory, clearHistory } from './storage.js';

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const state = { ...DEFAULTS };
let plan = null;
let showBaseline = true;
let raf = null;
let saveTimer = null;

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
  pump: $('pump'),
  basalField: $('basalField'),
  basalRate: $('basalRate'),
  resetBtn: $('resetBtn'),
  profileSave: $('profileSave'),
  results: $('results'),
  historySection: $('historySection'),
  historyList: $('historyList'),
  clearHistory: $('clearHistory'),
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
        title="${t.label} · ${t.hint}">
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
  });
  els.sportPicker.querySelectorAll('[data-sport]').forEach((b) => {
    const on = b.dataset.sport === state.sport;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', String(on));
  });
  els.intensity.querySelectorAll('[data-intensity]').forEach((b) => {
    const on = Number(b.dataset.intensity) === state.intensity;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', String(on));
  });
}

const isTyping = (el) => document.activeElement === el;

/** Writes a value without stealing focus from the active field. */
function setField(el, value) {
  if (isTyping(el)) return;
  const next = String(value);
  if (el.value !== next) el.value = next;
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
  els.isfUnit.textContent = isMmol() ? 'mmol/L/U' : 'mg/dL/U';
  setField(els.carbRatio, state.carbRatio);
  setField(els.diaHours, state.diaHours);
  setField(els.targetGlucose, disp.target());
  els.targetGlucose.step = isMmol() ? '0.1' : '1';
  els.targetUnit.textContent = unitText();
  els.ketones.value = state.ketones;
  els.pump.checked = state.pump;
  setField(els.basalRate, state.basalRate);
  els.basalField.hidden = !state.pump;
  els.iobUnknown.checked = state.iobEstimated;
  els.iob.disabled = state.iobEstimated;

  els.quickGlucose.querySelectorAll('[data-v]').forEach((b) => {
    b.textContent = String(disp.quick(Number(b.dataset.v)));
  });

  els.sportCatHint.textContent = CATEGORIES[SPORT_BY_ID[state.sport].category].label;
  const lvl = INTENSITIES.find((i) => i.id === state.intensity);
  els.intensityHint.textContent = `${lvl.rpe} · ${lvl.hint}`;

  updateActiveFlags();
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

function paint() {
  const raw = { ...state };
  if (raw.iobEstimated) raw.iob = 1.5;
  plan = buildPlan(raw);

  const u = state.unit;
  const G = (v) => formatGlucose(v, u);
  const n = plan.numbers;
  const s = plan.status;
  const st = plan.simulation;

  const doseLabel =
    plan.preCarb.grams > 0 ? `${plan.preCarb.grams}<small>g</small>` : `0<small>g</small>`;

  const doseMeta =
    plan.preCarb.mode === 'treat'
      ? `<b>Now — before exercise</b>15–20 g fast carbohydrate · recheck in 15 min`
      : plan.preCarb.grams > 0
        ? `<b>${plan.preCarb.timingMin} min before exercise</b>Fast-acting carbohydrate · ceiling ${plan.preCarb.cap} g`
        : `<b>No extra carbohydrate needed</b>Glucose is enough for this session · see the in-session plan`;

  const duringValue = plan.during.needed ? `${plan.during.perHour}<small>g/h</small>` : `—`;
  const preText =
    plan.preCarb.mode === 'treat'
      ? 'Take it now · recheck in 15 min'
      : plan.preCarb.grams > 0
        ? `take it ${plan.preCarb.timingMin} min before`
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
        <button type="button" class="btn btn--ghost btn--sm" data-action="print">Print</button>
      </div>
    </section>

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
      <div class="chart-wrap"><canvas id="chart" role="img" aria-label="Glucose projection chart"></canvas></div>
      <div class="chart-foot">
        <div class="legend">
          <span><i></i>Plan</span>
          <span><i class="dash"></i>No plan</span>
          <span><i class="band"></i>Target band</span>
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
        <p class="plan__note">${plan.basal.applicable ? plan.basal.note : plan.basal.mdiNote}</p>
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
            (r) => `<div class="math__row">
              <span class="math__label">${r.label}</span>
              <span class="math__expr">${r.expression}</span>
              <span class="math__val">${r.value}</span>
            </div>`,
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
  `;

  syncForm();
  drawChart();
  renderHistory();
  updateMobileBar();
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
  return `${Math.round(isMmol() ? toMmol(state.isf) : state.isf)} ${isMmol() ? 'mmol/L' : 'mg/dL'}/U × ${sens}`;
}

function drawChart() {
  const canvas = $('chart');
  if (!canvas || !plan) return;
  drawTimeline(canvas, {
    points: plan.simulation.points,
    baseline: plan.simulation.baseline,
    unit: state.unit,
    markers: plan.simulation.markers,
    exStart: plan.simulation.exStart,
    exEnd: plan.simulation.exEnd,
    showBaseline,
  });
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

  els.iob.addEventListener('input', () => {
    state.iob = readNumber(els.iob, state.iob);
    render();
  });

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
      document.querySelectorAll('[data-unit]').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.unit === state.unit);
      });
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
  });

  els.results.addEventListener('change', (e) => {
    if (e.target.id === 'baselineToggle') {
      showBaseline = e.target.checked;
      drawChart();
    }
  });

  els.resetBtn.addEventListener('click', () => {
    Object.assign(state, DEFAULTS, { pump: DEFAULTS.pump });
    syncForm();
    render();
    toast('Settings reset to defaults');
  });

  els.profileSave.addEventListener('click', () => {
    saveProfile(profilePayload());
    toast('Profile saved');
  });

  els.clearHistory.addEventListener('click', () => {
    clearHistory();
    renderHistory();
    toast('History cleared');
  });

  els.historyList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-load]');
    if (!btn) return;
    const entry = loadHistory().find((h) => h.ts === Number(btn.dataset.load));
    if (!entry) return;
    Object.assign(state, entry.state);
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

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawChart, 160);
  });
}

async function copyPlan() {
  if (!plan) return;
  const text = planToText(plan);
  try {
    await navigator.clipboard.writeText(text);
    toast('Plan copied to clipboard');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast('Plan copied to clipboard');
    } catch {
      toast('Copy failed — select the text manually');
    }
    ta.remove();
  }
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

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveProfile(profilePayload()), 700);
}

function saveResult() {
  if (!plan) return;
  pushHistory({
    ts: Date.now(),
    sport: plan.sport.name,
    sportGlyph: plan.sport.glyph,
    glucose: Math.round(state.glucose),
    carbs: plan.preCarb.grams,
    level: plan.status.level,
    status: plan.status.title,
    state: { ...state },
  });
  renderHistory();
  toast('Simulation added to history');
}

function renderHistory() {
  const list = loadHistory();
  els.historySection.hidden = list.length === 0;
  els.historyList.innerHTML = list
    .map(
      (h) => `
      <li>
        <button type="button" class="link-btn" data-load="${h.ts}" title="Restore this simulation">
          ${h.sportGlyph || '•'} ${h.sport}
        </button>
        <b>${Math.round(h.glucose)} → ${h.carbs} g</b>
        <time>${new Date(h.ts).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
      </li>`,
    )
    .join('');
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
  const saved = loadProfile();
  if (saved && typeof saved === 'object') {
    Object.keys(DEFAULTS).forEach((k) => {
      if (saved[k] !== undefined) state[k] = saved[k];
    });
    // if a unit was saved, start the interface with it
    document.querySelectorAll('[data-unit]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.unit === state.unit);
    });
  }

  buildControls();
  bind();
  paintNetwork();
  window.addEventListener('online', paintNetwork);
  window.addEventListener('offline', paintNetwork);

  syncForm();
  render();
}

init();
