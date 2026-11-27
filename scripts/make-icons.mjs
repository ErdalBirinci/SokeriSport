/**
 * Dependency-free PNG icon generator.
 * Brand mark: gradient background + light ring + ECG pulse line.
 * Usage: node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (edge, v) => clamp01((v - edge) / 1.6);

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / len2);
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Builds the RGBA buffer of a single icon (supersample = 3). */
function render(size, { maskable = false, fullBleed = false } = {}) {
  const SS = 3;
  const W = size * SS;
  const out = Buffer.alloc(W * W * 4);
  const center = W / 2;
  const radius = maskable ? W * 0.19 : W * 0.285;
  const stroke = W * (maskable ? 0.045 : 0.062);
  const corner = W * 0.225;

  const pulse = [
    [-0.155, 0.015],
    [-0.075, 0.015],
    [-0.028, -0.085],
    [0.02, 0.095],
    [0.062, -0.012],
    [0.155, -0.012],
  ].map(([x, y]) => [center + x * W, center + y * W]);

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let alpha = 255;

      if (!fullBleed) {
        // rounded-square mask
        const qx = Math.abs(x - center) - (W / 2 - corner);
        const qy = Math.abs(y - center) - (W / 2 - corner);
        const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - corner;
        alpha = Math.round(255 * (1 - smooth(0, d)));
        if (alpha <= 0) {
          out[i + 3] = 0;
          continue;
        }
      }

      // degrade zemin
      const t = clamp01((x / W) * 0.45 + (y / W) * 0.55);
      let r = lerp(74, 0, t);
      let g = lerp(128, 179, t);
      let b = lerp(255, 156, t);

      // top-left highlight
      const glow = clamp01(1 - Math.hypot(x - W * 0.3, y - W * 0.24) / (W * 0.62));
      r = lerp(r, 255, glow * 0.22);
      g = lerp(g, 255, glow * 0.22);
      b = lerp(b, 255, glow * 0.22);

      const dx = x - center;
      const dy = y - center;
      const dCenter = Math.hypot(dx, dy);

      // ring (gap on the right → gauge feel)
      let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (angle < 0) angle += 360;
      const inGap = angle > 330 || angle < 22;
      const ringDist = Math.abs(dCenter - radius) - stroke / 2;
      let ink = 0;
      if (!inGap) ink = Math.max(ink, 1 - smooth(0, ringDist));

      // pulse line
      let pulseDist = Infinity;
      for (let s = 0; s < pulse.length - 1; s++) {
        const d = distToSegment(x, y, pulse[s][0], pulse[s][1], pulse[s + 1][0], pulse[s + 1][1]);
        if (d < pulseDist) pulseDist = d;
      }
      ink = Math.max(ink, 1 - smooth(0, pulseDist - stroke * 0.36));

      if (ink > 0) {
        r = lerp(r, 255, ink);
        g = lerp(g, 255, ink);
        b = lerp(b, 255, ink);
      }

      out[i] = Math.round(r);
      out[i + 1] = Math.round(g);
      out[i + 2] = Math.round(b);
      out[i + 3] = alpha;
    }
  }

  // downsample (box filter)
  const final = Buffer.alloc(size * size * 4);
  const n = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * W + (x * SS + sx)) * 4;
          const pa = out[i + 3];
          r += out[i] * pa;
          g += out[i + 1] * pa;
          b += out[i + 2] * pa;
          a += pa;
        }
      }
      const o = (y * size + x) * 4;
      if (a === 0) {
        final[o] = 0;
        final[o + 1] = 0;
        final[o + 2] = 0;
        final[o + 3] = 0;
      } else {
        final[o] = Math.round(r / a);
        final[o + 1] = Math.round(g / a);
        final[o + 2] = Math.round(b / a);
        final[o + 3] = Math.round(a / n);
      }
    }
  }

  return final;
}

const root = join(process.cwd(), 'icons');
mkdirSync(root, { recursive: true });

const jobs = [
  { file: 'icon-192.png', size: 192, opts: {} },
  { file: 'icon-512.png', size: 512, opts: {} },
  { file: 'maskable-512.png', size: 512, opts: { maskable: true, fullBleed: true } },
  { file: 'apple-touch-icon.png', size: 180, opts: { fullBleed: true } },
];

for (const job of jobs) {
  const path = join(root, job.file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePNG(job.size, job.size, render(job.size, job.opts)));
  console.log(`✓ ${job.file} (${job.size}×${job.size})`);
}

/* maskable must be a full square: the edges stay filled with the gradient */
console.log('Icons ready → icons/');
