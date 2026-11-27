/**
 * Cache-busting guard: static assets are served cache-first, so a change to a
 * shipped file must come with a new sw.js VERSION, otherwise clients keep
 * running the old bundle.
 *
 * Usage: node scripts/check-sw-version.mjs
 *   BASE_REF  git ref to compare against (default: HEAD~1)
 */
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE_REF || 'HEAD~1';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

let changed;
try {
  changed = git(['diff', '--name-only', `${BASE}..HEAD`]).split('\n').filter(Boolean);
} catch {
  console.log(`SW version guard skipped: no comparable git history (${BASE}).`);
  process.exit(0);
}

if (changed.length === 0) {
  console.log('SW version guard: no changes.');
  process.exit(0);
}

const ZERO = /^0+$/.test(BASE);
if (ZERO) {
  console.log('SW version guard skipped: first push to the branch.');
  process.exit(0);
}

const shipped = changed.filter((file) => /^(assets\/|icons\/)|\.html$|manifest\.webmanifest$/.test(file));
if (shipped.length === 0) {
  console.log('SW version guard: no shipped assets changed.');
  process.exit(0);
}

let swDiff = '';
try {
  swDiff = git(['diff', '-U0', `${BASE}..HEAD`, '--', 'sw.js']);
} catch {
  /* sw.js may be new in this range */
}

const bumped = /^[+-].*VERSION\s*=\s*'[^']+'/m.test(swDiff);

if (!bumped) {
  console.error('sw.js VERSION was not bumped, but shipped files changed:');
  for (const file of shipped) console.error(`  ${file}`);
  console.error("Static assets are cache-first: bump VERSION in sw.js (e.g. 'sokerisport-v1.6.0').");
  process.exit(1);
}

console.log(`SW version guard OK — ${shipped.length} shipped file(s) changed with a VERSION bump.`);
