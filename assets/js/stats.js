/**
 * Descriptive statistics over the local history: how well did the plan match
 * what actually happened. Pure functions, no DOM, no storage.
 *
 * This is not a personal model: it only summarises the entries the user chose
 * to log.
 */

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

/**
 * @param {Array<{plannedNadir?:number, plannedCarbs?:number, outcome?:{start?:number,min?:number,carbs?:number,hypo?:boolean}}>} entries
 */
export function outcomeStats(entries = []) {
  const logged = entries.filter((entry) => entry && entry.outcome);
  const withNadir = logged.filter((entry) => num(entry.outcome.min) !== null && num(entry.plannedNadir) !== null);

  const deviations = withNadir.map((entry) => Number(entry.outcome.min) - Number(entry.plannedNadir));
  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
  const meanAbs = deviations.length ? mean(deviations.map(Math.abs)) : null;
  const worst = deviations.length ? deviations.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a)) : null;

  const withCarbs = logged.filter((entry) => num(entry.outcome.carbs) !== null && num(entry.plannedCarbs) !== null);
  const adherence = withCarbs.map((entry) => (Number(entry.plannedCarbs) > 0 ? Number(entry.outcome.carbs) / Number(entry.plannedCarbs) : null)).filter((v) => v !== null);

  return {
    logged: logged.length,
    withNadir: withNadir.length,
    meanDeviation: mean(deviations),
    meanAbsDeviation: meanAbs,
    worstDeviation: worst,
    hypos: logged.filter((entry) => entry.outcome.hypo).length,
    carbAdherence: adherence.length ? mean(adherence) : null,
    carbSamples: adherence.length,
  };
}

/** One-line verdict for the summary card. */
export function accuracyBand(meanAbsDeviation) {
  if (!Number.isFinite(meanAbsDeviation)) return 'unknown';
  if (meanAbsDeviation <= 10) return 'close';
  if (meanAbsDeviation <= 25) return 'fair';
  return 'wide';
}
