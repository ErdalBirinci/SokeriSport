/** science.html — feeds the sport and trend tables from the engine. */

import { SPORTS, CATEGORIES, TRENDS } from './engine.js';

const sportBody = document.getElementById('sportTableBody');
if (sportBody) {
  sportBody.innerHTML = SPORTS.map(
    (s) => `
      <tr>
        <td><b>${s.glyph} ${s.name}</b></td>
        <td>${CATEGORIES[s.category].label}</td>
        <td>${s.oxidation} g/h</td>
        <td>×${s.sensitivity.toFixed(2)}</td>
        <td>${s.adrenergic > 0 ? `+${s.adrenergic}` : '—'}</td>
      </tr>`,
  ).join('');
}

const trendTable = document.getElementById('trendTable');
if (trendTable) {
  trendTable.innerHTML = TRENDS.map(
    (t) => `
      <div class="trend-cell">
        <b>${t.glyph}</b>
        <span>${t.label}</span>
        <code>${t.rate > 0 ? '+' : ''}${t.rate} mg/dL/min</code>
      </div>`,
  ).join('');
}

document.querySelectorAll('#year').forEach((el) => {
  el.textContent = String(new Date().getFullYear());
});
