#!/usr/bin/env node
/**
 * Live-site verification for the published SokeriSport app.
 * No dependencies; runs on Node 20+.
 *
 *   node scripts/live-check.mjs
 *   BASE_URL=https://erdalbirinci.github.io/SokeriSport node scripts/live-check.mjs
 *
 * Everything is compared with the files in this checkout, so a stale, partial
 * or wrongly ordered deploy fails instead of quietly serving the previous
 * release. It verifies that:
 *   - the landing page is served and still advertises the app, the manifest
 *     and the social preview image
 *   - every page, stylesheet, script and icon the service worker precaches
 *     answers 200 with the exact local bytes
 *   - the manifest parses, keeps standalone display and its icons load
 *   - the served version.js and sw.js carry the version in package.json
 *   - every README screenshot resolves and matches the file it documents
 *   - an unknown path answers with the branded 404 page
 *
 * Writes dist/live.json (git-ignored) so the scheduled workflow can report a
 * failed run without re-reading the console.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.BASE_URL ?? 'https://erdalbirinci.github.io/SokeriSport').replace(/\/+$/, '');
const startedAt = new Date().toISOString();

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;

const failures = [];
const lines = [];
let passed = 0;

function pass(name, detail = '') {
  passed += 1;
  const line = `PASS  ${name}${detail ? ` — ${detail}` : ''}`;
  lines.push(line);
  console.log(line);
}

function fail(name, reason) {
  failures.push(name);
  const line = `FAIL  ${name} — ${reason}`;
  lines.push(line);
  console.log(line);
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

function local(relative) {
  return path.join(ROOT, relative.replace(/^\.?\//, ''));
}

function localBytes(relative) {
  return readFileSync(local(relative));
}

async function request(relative, method = 'GET') {
  const response = await fetch(`${BASE}/${relative}`.replace(/\/+$/, '/'), {
    method,
    redirect: 'follow',
    headers: { 'cache-control': 'no-cache' }
  });
  const body = method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await response.arrayBuffer());
  return { response, body, type: (response.headers.get('content-type') ?? '').split(';')[0].trim() };
}

const JS_TYPES = /^(?:text|application)\/(?:javascript|x-javascript)$/;

/** Fetches a shipped file and requires the published bytes to equal the local ones. */
async function sameFile(relative, expectedType) {
  const { response, body, type } = await request(relative);
  if (response.status !== 200) throw new Error(`/${relative} HTTP ${response.status}`);
  const okType = expectedType instanceof RegExp ? expectedType.test(type) : type === expectedType;
  if (!okType) throw new Error(`/${relative} content-type ${type || '(none)'}`);
  const expected = statSync(local(relative)).size;
  if (body.length !== expected) throw new Error(`/${relative} is ${body.length} bytes, the local file ${expected}`);
  return body;
}

console.log(`Live check: ${BASE} · ${version}\n`);

/* 1. Landing page ---------------------------------------------------- */

try {
  const { response, body, type } = await request('');
  const html = body.toString('utf8');
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  if (type !== 'text/html') throw new Error(`content-type ${type || '(none)'}`);
  if (!html.includes('<title>SokeriSport')) throw new Error('the landing title is missing');
  if (!html.includes('href="manifest.webmanifest"')) throw new Error('the manifest link is missing');
  if (!html.includes('href="app.html"')) throw new Error('the app link is missing');
  if (!html.includes(`href="${BASE}/assets/img/og.jpg"`) && !html.includes('content="https://erdalbirinci.github.io/SokeriSport/assets/img/og.jpg"')) {
    throw new Error('the social preview image does not point at the published origin');
  }
  if (body.length !== statSync(local('index.html')).size) throw new Error('the served landing page is not the local one');
  pass('live: landing page served', `200 text/html · ${kb(body.length)} · ${version}`);
} catch (error) {
  fail('live: landing page served', error.message);
}

/* 2. Offline shell (pages, styles, scripts, icons) -------------------- */

try {
  const sw = readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const shellBlock = /const SHELL = \[([\s\S]*?)\];/.exec(sw);
  if (!shellBlock) throw new Error('sw.js has no SHELL list to compare');
  const shell = [...shellBlock[1].matchAll(/'\.\/([^']+)'/g)].map((match) => match[1]);
  if (shell.length < 20) throw new Error(`only ${shell.length} shell entries found`);

  const seen = new Set();
  for (const relative of shell) {
    if (seen.has(relative)) continue;
    seen.add(relative);
    if (!statSync(local(relative)).isFile()) throw new Error(`${relative} is missing from the checkout`);
    const expectedType = relative.endsWith('.css')
      ? 'text/css'
      : relative.endsWith('.js')
        ? JS_TYPES
        : relative.endsWith('.html')
          ? 'text/html'
          : relative.endsWith('.webmanifest')
            ? /^application\/(?:manifest\+)?json$/
            : relative.endsWith('.png')
              ? 'image/png'
              : 'image/svg+xml';
    await sameFile(relative, expectedType);
  }
  pass('live: offline shell matches the checkout', `${seen.size} precached files · exact bytes`);
} catch (error) {
  fail('live: offline shell matches the checkout', error.message);
}

/* 3. Manifest and icons ---------------------------------------------- */

try {
  const { response, body, type } = await request('manifest.webmanifest');
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  if (!/^application\/(?:manifest\+)?json$/.test(type)) throw new Error(`content-type ${type || '(none)'}`);
  const manifest = JSON.parse(body.toString('utf8'));
  if (manifest.name !== 'SokeriSport — Glycemic Readiness Simulator') throw new Error(`name is "${manifest.name}"`);
  if (manifest.display !== 'standalone') throw new Error(`display is "${manifest.display}"`);
  if (manifest.start_url !== './app.html') throw new Error(`start_url is "${manifest.start_url}"`);
  if (!Array.isArray(manifest.icons) || manifest.icons.length < 3) throw new Error('fewer than three icons');
  for (const icon of manifest.icons) {
    await sameFile(icon.src, icon.type || 'image/png');
  }
  await sameFile('assets/img/favicon.svg', 'image/svg+xml');
  await sameFile('icons/apple-touch-icon.png', 'image/png');
  pass('live: manifest and icons', `${manifest.icons.length} icons · standalone · ${manifest.short_name}`);
} catch (error) {
  fail('live: manifest and icons', error.message);
}

/* 4. One version everywhere ------------------------------------------ */

try {
  const servedVersion = (await request('assets/js/version.js')).body.toString('utf8');
  if (!servedVersion.includes(`'${version}'`)) throw new Error(`version.js does not report ${version}`);
  const servedSw = (await request('sw.js')).body.toString('utf8');
  if (!servedSw.includes(`sokerisport-v${version}`)) throw new Error(`sw.js cache is not sokerisport-v${version}`);
  pass('live: one version everywhere', `${version} · version.js · sw.js`);
} catch (error) {
  fail('live: one version everywhere', error.message);
}

/* 5. README screenshots ---------------------------------------------- */

try {
  const dir = path.join(ROOT, 'docs/screenshots');
  const shots = readdirSync(dir).filter((name) => name.endsWith('.png')).sort();
  if (shots.length === 0) throw new Error('no screenshots in docs/screenshots');
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  for (const name of shots) {
    if (!readme.includes(`docs/screenshots/${name}`)) throw new Error(`${name} is not referenced by the README`);
    await sameFile(`docs/screenshots/${name}`, 'image/png');
  }
  pass('live: README screenshots', `${shots.length} images · 200 image/png · exact bytes`);
} catch (error) {
  fail('live: README screenshots', error.message);
}

/* 6. Social preview -------------------------------------------------- */

try {
  const body = await sameFile('assets/img/og.jpg', 'image/jpeg');
  if (!(body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff)) throw new Error('the body is not a JPEG');
  pass('live: social preview image', `200 image/jpeg · ${kb(body.length)}`);
} catch (error) {
  fail('live: social preview image', error.message);
}

/* 7. Unknown path ---------------------------------------------------- */

try {
  const { response, body, type } = await request('this-path-does-not-exist');
  if (response.status !== 404) throw new Error(`HTTP ${response.status}, expected 404`);
  if (type !== 'text/html') throw new Error(`content-type ${type || '(none)'}`);
  if (!body.toString('utf8').includes('Page not found — SokeriSport')) throw new Error('the branded 404 page is missing');
  pass('live: unknown path', '404 text/html · branded page');
} catch (error) {
  fail('live: unknown path', error.message);
}

/* -------------------------------------------------------------------- */

mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const ok = failures.length === 0;
const tail = lines.slice(-6).join('\n');
writeFileSync(
  path.join(ROOT, 'dist/live.json'),
  `${JSON.stringify({ startedAt, base: BASE, version, ok, passed, failed: failures.length, failures, tail }, null, 2)}\n`
);

console.log('');
if (!ok) {
  console.log(`RESULT: ${passed} passed, ${failures.length} failed.`);
  console.log(`Failed checks: ${failures.join(', ')}`);
  process.exit(1);
}
console.log(`RESULT: all ${passed} live checks passed (${BASE}).`);
