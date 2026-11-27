/**
 * Local profile + simulation history. No server, entirely on the device.
 *
 * Storage is versioned: entries written by older builds are migrated on read,
 * and a snapshot (profile + history) can be exported and imported again.
 */

const PROFILE_KEY = 'sokerisport.profile.v1';
const HISTORY_KEY = 'sokerisport.history.v1';
const MAX_HISTORY = 12;

/** Bump when the shape of a stored entry changes; add a migration step below. */
export const SCHEMA_VERSION = 2;

let availability = null;

function safeRead(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    availability = false;
    return false;
  }
}

/** False when the browser blocks localStorage (private mode, policy, quota). */
export function storageAvailable() {
  if (availability !== null) return availability;
  try {
    const probe = '__sokerisport_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    availability = true;
  } catch {
    availability = false;
  }
  return availability;
}

const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

/**
 * Brings an entry up to SCHEMA_VERSION.
 * v1 → v2: plan snapshot (plannedCarbs / plannedNadir / plannedPeak) and the
 * optional outcome block.
 */
export function migrateEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const carbs = finite(entry.plannedCarbs) ?? finite(entry.carbs) ?? 0;
  const migrated = {
    ...entry,
    ts: Number(entry.ts) || Date.now(),
    sport: typeof entry.sport === 'string' ? entry.sport : 'Session',
    glucose: finite(entry.glucose) ?? 0,
    carbs: finite(entry.carbs) ?? carbs,
    plannedCarbs: carbs,
    plannedNadir: finite(entry.plannedNadir),
    plannedPeak: finite(entry.plannedPeak),
    outcome: entry.outcome && typeof entry.outcome === 'object' ? entry.outcome : null,
    schemaVersion: SCHEMA_VERSION,
  };
  return migrated;
}

export function loadProfile() {
  const p = safeRead(PROFILE_KEY);
  return p && typeof p === 'object' ? p : null;
}

export function saveProfile(profile) {
  return safeWrite(PROFILE_KEY, profile);
}

export function clearProfile() {
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* ignore */
  }
}

export function loadHistory() {
  const raw = safeRead(HISTORY_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.map(migrateEntry).filter(Boolean);
}

export function pushHistory(entry) {
  const list = loadHistory();
  list.unshift(migrateEntry(entry));
  safeWrite(HISTORY_KEY, list.slice(0, MAX_HISTORY));
  return loadHistory();
}

/**
 * Merges a patch into one entry (used to record what actually happened after
 * a session). An `outcome` patch is merged field by field so partial updates
 * keep earlier values.
 */
export function updateHistoryEntry(ts, patch) {
  const list = loadHistory();
  const index = list.findIndex((entry) => entry.ts === ts);
  if (index === -1) return list;

  const entry = list[index];
  list[index] = { ...entry, ...patch };
  if (patch.outcome) list[index].outcome = { ...(entry.outcome || {}), ...patch.outcome };

  safeWrite(HISTORY_KEY, list);
  return list;
}

export function findHistoryEntry(ts) {
  return loadHistory().find((entry) => entry.ts === ts) || null;
}

export function clearHistory() {
  safeWrite(HISTORY_KEY, []);
  return [];
}

/** Full backup: profile + history + schema version, ready to be written to a file. */
export function exportSnapshot() {
  return {
    app: 'SokeriSport',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    profile: loadProfile(),
    history: loadHistory(),
  };
}

/**
 * Restores a snapshot produced by exportSnapshot().
 * @returns {{ok: boolean, reason?: string, restored?: number}}
 */
export function importSnapshot(payload) {
  let data = payload;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return { ok: false, reason: 'not-json' };
    }
  }
  if (!data || typeof data !== 'object') return { ok: false, reason: 'empty' };
  if (finite(data.schemaVersion) !== null && Number(data.schemaVersion) > SCHEMA_VERSION) {
    return { ok: false, reason: 'newer-schema' };
  }
  if (!Array.isArray(data.history)) return { ok: false, reason: 'no-history' };

  const history = data.history.map(migrateEntry).filter(Boolean).slice(0, MAX_HISTORY);
  const wrote = safeWrite(HISTORY_KEY, history);
  if (data.profile && typeof data.profile === 'object') saveProfile(data.profile);
  return wrote ? { ok: true, restored: history.length } : { ok: false, reason: 'write-failed' };
}
