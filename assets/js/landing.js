/** Landing page: sport cards, 3D parallax, scroll reveal. */

import { SPORTS, SPORT_BY_ID, CATEGORIES } from './engine.js';

const grid = document.getElementById('sportGridLanding');

if (grid) {
  grid.innerHTML = SPORTS.map(
    (s) => `
      <article class="sport-card">
        <div class="sport-card__glyph" aria-hidden="true">${s.glyph}</div>
        <h3>${s.name}</h3>
        <span class="sport-card__cat">${CATEGORIES[s.category].label}</span>
        <div class="sport-card__vals">
          <div><span>Oxidation</span><b>${s.oxidation} g/h</b></div>
          <div><span>Sensitivity</span><b>×${s.sensitivity.toFixed(2)}</b></div>
        </div>
      </article>`,
  ).join('');
}

/* --- year ------------------------------------------------------------ */
document.querySelectorAll('#year').forEach((el) => {
  el.textContent = String(new Date().getFullYear());
});

/* --- scroll reveal --------------------------------------------------- */
const reveals = Array.from(document.querySelectorAll('.reveal'));

if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );

  reveals.forEach((el) => {
    const r = el.getBoundingClientRect();
    const alreadyVisible = r.top < window.innerHeight * 0.9;
    el.classList.add('is-armed');
    if (alreadyVisible) {
      el.classList.remove('is-armed');
      el.classList.add('is-in');
    } else {
      io.observe(el);
    }
  });
} else {
  reveals.forEach((el) => el.classList.add('is-in'));
}

// No section should stay hidden when printing or taking a full-page shot.
window.addEventListener('beforeprint', () => {
  reveals.forEach((el) => el.classList.add('is-in'));
});

/* --- 3D scene parallax ---------------------------------------------- */
const scene = document.querySelector('[data-scene]');
const stage = document.querySelector('[data-stage]');

if (scene && stage && window.matchMedia('(hover: hover)').matches) {
  let targetX = 0;
  let targetY = 0;
  let currentX = 0;
  let currentY = 0;
  let running = false;

  const tick = () => {
    currentX += (targetX - currentX) * 0.08;
    currentY += (targetY - currentY) * 0.08;
    stage.style.setProperty('--ry', `${currentX.toFixed(2)}deg`);
    stage.style.setProperty('--rx', `${currentY.toFixed(2)}deg`);

    if (Math.abs(targetX - currentX) > 0.05 || Math.abs(targetY - currentY) > 0.05) {
      requestAnimationFrame(tick);
    } else {
      running = false;
    }
  };

  scene.addEventListener('pointermove', (e) => {
    const r = scene.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    targetX = px * 14;
    targetY = -py * 10;
    if (!running) {
      running = true;
      requestAnimationFrame(tick);
    }
  });

  scene.addEventListener('pointerleave', () => {
    targetX = 0;
    targetY = 0;
    if (!running) {
      running = true;
      requestAnimationFrame(tick);
    }
  });
}

/* --- FAQ: only one accordion open ----------------------------------- */
document.querySelectorAll('.faq__item').forEach((item) => {
  item.addEventListener('toggle', () => {
    if (!item.open) return;
    document.querySelectorAll('.faq__item[open]').forEach((other) => {
      if (other !== item) other.open = false;
    });
  });
});

export { SPORT_BY_ID };
