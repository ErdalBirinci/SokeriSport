/**
 * Representative scenarios for the golden tests.
 * Regenerate the expected output with: node scripts/update-golden.mjs
 */
export const SCENARIOS = [
  { id: 'morning-run-iob', input: { glucose: 132, trend: 'slowDown', iob: 1.8, sport: 'kosu', durationMin: 75, intensity: 3, leadTimeMin: 20 } },
  { id: 'basketball-steady', input: { glucose: 168, trend: 'flat', iob: 0.4, sport: 'basketbol', durationMin: 90, intensity: 4, leadTimeMin: 30 } },
  { id: 'cycling-long', input: { glucose: 120, trend: 'flat', iob: 0.6, sport: 'bisiklet', durationMin: 180, intensity: 2, leadTimeMin: 45 } },
  { id: 'low-start', input: { glucose: 72, trend: 'down', iob: 0.2, sport: 'yuruyus', durationMin: 45, intensity: 2, leadTimeMin: 15 } },
  { id: 'hypo-stop', input: { glucose: 58, trend: 'flat', iob: 0, sport: 'kosu', durationMin: 60, intensity: 3, leadTimeMin: 20 } },
  { id: 'ketones-high', input: { glucose: 280, trend: 'up', iob: 2.5, sport: 'futbol', durationMin: 90, intensity: 4, ketones: 'high', leadTimeMin: 30 } },
  { id: 'hyper-no-ketones', input: { glucose: 310, trend: 'flat', iob: 0.3, sport: 'tenis', durationMin: 60, intensity: 3, ketones: 'none', leadTimeMin: 25 } },
  { id: 'slow-carbs-heat', input: { glucose: 110, trend: 'slowDown', iob: 1.2, sport: 'kosu', durationMin: 120, intensity: 3, carbType: 'slow', heat: true, leadTimeMin: 25 } },
  { id: 'mdi-no-pump', input: { glucose: 150, trend: 'flat', iob: 0.9, sport: 'yuzme', durationMin: 60, intensity: 3, pump: false, leadTimeMin: 20 } },
  { id: 'heavy-iob-iod', input: { glucose: 210, trend: 'doubleDown', iob: 4, sport: 'hiit', durationMin: 45, intensity: 4, leadTimeMin: 10 } },
];
