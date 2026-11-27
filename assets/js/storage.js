/**
 * Local profile + simulation history. No server, entirely on the device.
 */

const PROFILE_KEY = 'sokerisport.profile.v1';
const HISTORY_KEY = 'sokerisport.history.v1';
const MAX_HISTORY = 12;

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
    return false;
  }
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
  const h = safeRead(HISTORY_KEY);
  return Array.isArray(h) ? h : [];
}

export function pushHistory(entry) {
  const list = loadHistory();
  list.unshift(entry);
  safeWrite(HISTORY_KEY, list.slice(0, MAX_HISTORY));
  return loadHistory();
}

export function clearHistory() {
  safeWrite(HISTORY_KEY, []);
  return [];
}
