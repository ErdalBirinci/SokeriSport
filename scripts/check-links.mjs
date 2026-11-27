/**
 * Internal link checker: every local href/src in the HTML pages must point at a
 * file that exists, and every "#anchor" must exist in the target page.
 * Usage: node scripts/check-links.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['index.html', 'app.html', 'science.html', 'guide.html', '404.html'].filter((p) => fs.existsSync(path.join(ROOT, p)));

const EXTERNAL = /^(?:[a-z]+:|\/\/|#|data:)/i;

/** Collects every id="…" in a page so anchors can be verified. */
function idsOf(file) {
  const html = fs.readFileSync(file, 'utf8');
  const ids = new Set();
  for (const match of html.matchAll(/\sid="([^"]+)"/g)) ids.add(match[1]);
  return ids;
}

const anchorCache = new Map();
function anchorsOf(file) {
  if (!anchorCache.has(file)) anchorCache.set(file, idsOf(file));
  return anchorCache.get(file);
}

const problems = [];

for (const page of PAGES) {
  const file = path.join(ROOT, page);
  const html = fs.readFileSync(file, 'utf8');

  for (const match of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
    const raw = match[1].trim();
    if (!raw || EXTERNAL.test(raw)) continue;

    const [target, hash] = raw.split('#');
    const cleanTarget = target.split('?')[0];
    const resolved = cleanTarget ? path.resolve(path.dirname(file), cleanTarget) : file;

    if (cleanTarget) {
      let exists = fs.existsSync(resolved);
      if (exists && fs.statSync(resolved).isDirectory()) exists = fs.existsSync(path.join(resolved, 'index.html'));
      if (!exists) {
        problems.push(`${page} → "${raw}": target not found`);
        continue;
      }
    }

    if (!hash) continue;
    const anchorFile = cleanTarget
      ? fs.statSync(resolved).isDirectory()
        ? path.join(resolved, 'index.html')
        : resolved
      : file;
    if (!anchorFile.endsWith('.html')) continue;
    if (!anchorsOf(anchorFile).has(hash)) {
      problems.push(`${page} → "${raw}": anchor #${hash} missing in ${path.relative(ROOT, anchorFile)}`);
    }
  }
}

if (problems.length) {
  console.error(`Broken internal links (${problems.length}):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`Links OK — ${PAGES.length} pages checked.`);
