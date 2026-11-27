/**
 * Dependency-free canvas timeline.
 * Target bands, plan/baseline scenario lines, carbohydrate and exercise markers.
 */

import { glucoseNumber, toMmol } from './engine.js';

const CSS = {
  line: '#2F6BFF',
  band: 'rgba(47,107,255,0.10)',
  lineSoft: 'rgba(47,107,255,0.14)',
  base: 'rgba(90,100,120,0.55)',
  grid: 'rgba(16,24,40,0.07)',
  text: 'rgba(90,100,120,0.9)',
  hypo: 'rgba(239,68,68,0.10)',
  target: 'rgba(16,185,129,0.09)',
  hyper: 'rgba(245,158,11,0.10)',
  carb: '#FF8A3D',
  ex: '#0EA5E9',
};

export function drawTimeline(canvas, opts) {
  const { points, baseline, uncertainty = null, unit = 'mgdl', markers = [], exStart = 0, exEnd = 0, showBaseline = true } = opts;
  if (!canvas || !points || points.length === 0) return;

  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(280, canvas.clientWidth || 640);
  const h = Math.max(200, canvas.clientHeight || 260);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const padL = 44;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const bandPoints = uncertainty && uncertainty.low && uncertainty.high ? uncertainty.low.concat(uncertainty.high) : [];
  const all = (showBaseline ? points.concat(baseline || []) : points).concat(bandPoints);
  const maxT = points[points.length - 1].t;
  const dataMin = Math.min(...all.map((p) => p.g));
  const dataMax = Math.max(...all.map((p) => p.g));
  const yMin = Math.min(55, dataMin - 15);
  const yMax = Math.max(230, dataMax + 20);

  const X = (t) => padL + (t / maxT) * innerW;
  const Y = (g) => padT + innerH - ((g - yMin) / (yMax - yMin)) * innerH;

  // --- background bands
  const band = (from, to, color) => {
    const y1 = Y(Math.min(yMax, Math.max(yMin, to)));
    const y2 = Y(Math.min(yMax, Math.max(yMin, from)));
    ctx.fillStyle = color;
    ctx.fillRect(padL, y1, innerW, Math.max(0, y2 - y1));
  };
  band(yMin, 70, CSS.hypo);
  band(70, 180, CSS.target);
  band(180, 250, 'rgba(245,158,11,0.05)');
  band(250, yMax, CSS.hyper);

  // --- exercise window
  if (exEnd > exStart) {
    ctx.fillStyle = 'rgba(14,165,233,0.06)';
    ctx.fillRect(X(exStart), padT, X(exEnd) - X(exStart), innerH);
  }

  // --- grid
  ctx.strokeStyle = CSS.grid;
  ctx.lineWidth = 1;
  ctx.font = '11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillStyle = CSS.text;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  const stepY = unit === 'mmol' ? (yMax - yMin > 180 ? 5 : 2) : yMax - yMin > 220 ? 100 : 50;
  const yStart = Math.ceil(yMin / stepY) * stepY;
  for (let g = yStart; g <= yMax; g += stepY) {
    const y = Y(g);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(unit === 'mmol' ? toMmol(g) * 10 : g) / (unit === 'mmol' ? 10 : 1)), padL - 8, y);
  }

  // --- x axis
  const tickMin = maxT > 180 ? 60 : maxT > 90 ? 30 : 15;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let t = 0; t <= maxT; t += tickMin) {
    const x = X(t);
    ctx.strokeStyle = CSS.grid;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + innerH);
    ctx.stroke();
    ctx.fillStyle = CSS.text;
    ctx.fillText(t === 0 ? '0' : `${t}′`, x, padT + innerH + 8);
  }

  // --- uncertainty band (timing / dose sensitivity)
  if (bandPoints.length) {
    ctx.beginPath();
    uncertainty.high.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.t), Y(p.g)) : ctx.lineTo(X(p.t), Y(p.g))));
    for (let i = uncertainty.low.length - 1; i >= 0; i -= 1) ctx.lineTo(X(uncertainty.low[i].t), Y(uncertainty.low[i].g));
    ctx.closePath();
    ctx.fillStyle = CSS.band;
    ctx.fill();
  }

  // --- baseline scenario
  if (showBaseline && baseline && baseline.length) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = CSS.base;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    baseline.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.t), Y(p.g)) : ctx.lineTo(X(p.t), Y(p.g))));
    ctx.stroke();
    ctx.restore();
  }

  // --- plan line + fill
  const grad = ctx.createLinearGradient(0, padT, 0, padT + innerH);
  grad.addColorStop(0, 'rgba(47,107,255,0.30)');
  grad.addColorStop(1, 'rgba(47,107,255,0.02)');

  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.t), Y(p.g)) : ctx.lineTo(X(p.t), Y(p.g))));
  ctx.lineTo(X(maxT), padT + innerH);
  ctx.lineTo(X(0), padT + innerH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.t), Y(p.g)) : ctx.lineTo(X(p.t), Y(p.g))));
  ctx.strokeStyle = CSS.line;
  ctx.lineWidth = 2.4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // --- carbohydrate markers
  markers
    .filter((m) => m.kind === 'carb')
    .forEach((m) => {
      const x = X(m.minute);
      ctx.strokeStyle = 'rgba(255,138,61,0.75)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, padT + 4);
      ctx.lineTo(x, padT + innerH);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = CSS.carb;
      ctx.beginPath();
      ctx.arc(x, padT + 4, 3.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = CSS.carb;
      ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`${m.grams}g`, x, padT + 10);
    });

  // --- exercise boundaries
  [[exStart, 'start'], [exEnd, 'finish']].forEach(([t, label]) => {
    if (t <= 0 || t > maxT) return;
    const x = X(t);
    ctx.strokeStyle = 'rgba(14,165,233,0.55)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + innerH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(14,165,233,0.9)';
    ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, x, padT - 2);
  });

  // --- last point
  const last = points[points.length - 1];
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = CSS.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(X(last.t), Y(last.g), 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

export function unitLabel(unit) {
  return unit === 'mmol' ? 'mmol/L' : 'mg/dL';
}

export { glucoseNumber };
