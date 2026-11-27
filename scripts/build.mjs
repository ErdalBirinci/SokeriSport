/**
 * Production build: copies only public files into dist/.
 * Usage: node scripts/build.mjs
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');

const files = ['index.html', 'app.html', 'science.html', 'guide.html', '404.html', 'manifest.webmanifest', 'sw.js'];
const dirs = ['assets', 'icons'];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const f of files) await cp(join(root, f), join(dist, f));
for (const d of dirs) await cp(join(root, d), join(dist, d), { recursive: true });

console.log('dist/ ready:', [...files, ...dirs].join(', '));
