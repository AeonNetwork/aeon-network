// Small visual helpers: rolling digits, change flashes, canvas sizing,
// and the aurora that brightens when the network produces a block.

import { reducedMotion } from './core.js';

export function reveal(root = document) {
  root.querySelectorAll('.reveal').forEach((el, i) => {
    el.style.setProperty('--d', `${Math.min(i, 12) * 40}ms`);
    requestAnimationFrame(() => el.classList.add('in'));
  });
}

// Digits roll to the new value instead of snapping.
export function odometer(el, text) {
  if (!el) return;
  if (reducedMotion) return void (el.textContent = text);
  if (el.dataset.odo === text) return;
  const prev = el.dataset.odo;
  el.dataset.odo = text;
  if (!el.firstElementChild?.classList.contains('odo') || prev?.length !== text.length) {
    el.innerHTML = `<span class="odo">${[...text]
      .map((c) => (/\d/.test(c) ? `<span class="odo-d"><span>${'0123456789'.split('').map((d) => `<i>${d}</i>`).join('')}</span></span>` : `<span>${c}</span>`))
      .join('')}</span>`;
  }
  const cells = el.firstElementChild.children;
  [...text].forEach((c, i) => {
    const cell = cells[i];
    if (/\d/.test(c) && cell?.classList.contains('odo-d')) cell.firstElementChild.style.transform = `translateY(${-Number(c) * 1.1}em)`;
    else if (cell) cell.textContent = c;
  });
}

export function flash(el) {
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

// Brighten every aurora on screen briefly: one pulse per new block.
let lastPulse = 0;
export function auroraPulse() {
  if (reducedMotion || Date.now() - lastPulse < 900) return;
  lastPulse = Date.now();
  document.querySelectorAll('.aurora').forEach((a) => {
    a.classList.remove('pulse');
    void a.offsetWidth;
    a.classList.add('pulse');
  });
}

export function fitCanvas(canvas) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const { width, height } = canvas.getBoundingClientRect();
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: width, h: height };
}
