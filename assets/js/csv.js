/**
 * CSV export for the care team. Pure: the history list goes in, a CSV document
 * comes out, so the escaping rules are covered by the tests.
 */

const HEADER = [
  'date',
  'sport',
  'duration_min',
  'intensity',
  'glucose_mgdl',
  'planned_carbs_g',
  'planned_per_hour_g',
  'planned_basal_percent',
  'planned_nadir_mgdl',
  'actual_start_mgdl',
  'actual_lowest_mgdl',
  'actual_carbs_g',
  'hypo_reported',
];

/**
 * Quotes one cell. A value that starts with = + - @ (or a control character) is
 * prefixed with an apostrophe: spreadsheets would otherwise run an imported
 * backup's sport name as a formula. Timestamps start with a digit and are safe.
 */
export function csvCell(value) {
  if (value === null || value === undefined || value === '') return '';
  const text = String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

const value = (input) => (input === null || input === undefined || input === '' ? '' : input);

/** @param {Array<object>} entries history entries (already migrated) */
export function historyToCsv(entries = []) {
  const rows = entries.map((entry) =>
    [
      new Date(entry.ts).toISOString(),
      entry.sport,
      value(entry.durationMin),
      value(entry.intensity),
      Number.isFinite(Number(entry.glucose)) ? Math.round(Number(entry.glucose)) : '',
      value(entry.plannedCarbs ?? entry.carbs),
      value(entry.duringPerHour),
      value(entry.basalPercent),
      value(entry.plannedNadir),
      value(entry.outcome?.start),
      value(entry.outcome?.min),
      value(entry.outcome?.carbs),
      entry.outcome?.hypo ? 'yes' : 'no',
    ]
      .map(csvCell)
      .join(','),
  );

  return [HEADER.join(','), ...rows].join('\n');
}
