// Hero visualization: Robinhood Chain as a ring of particles.
// The ring is the chain; its bright "head" segment is the latest block and
// advances with every new block. Each block grows a particle tree out of the
// head, sized by its transaction count. Labelled trees show real data
// (blocks, most-called contracts, most-held stock tokens). Monochrome canvas,
// pauses when off-screen, static frame for reduced motion.

import { reducedMotion } from './core.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);

export function startRing(box) {
  box.innerHTML = '<canvas class="ring-canvas"></canvas><div class="ring-labels"></div>';
  const canvas = box.querySelector('canvas');
  const labelsEl = box.querySelector('.ring-labels');
  const ctx = canvas.getContext('2d');
  const small = matchMedia('(max-width: 700px)').matches;

  // ---------- ring particles (local 3D frame, ring in the x/z plane) ----------
  const RING_N = small ? 900 : 1700;
  const ring = [];
  for (let i = 0; i < RING_N; i++) {
    const a = (i / RING_N) * TAU + rand(-0.004, 0.004);
    const band = Math.random() < 0.8 ? rand(-0.035, 0.035) : rand(-0.09, 0.09);
    const r = 1 + band;
    ring.push({ a, x: Math.cos(a) * r, y: rand(-0.012, 0.012) + (Math.random() < 0.08 ? rand(-0.05, 0.05) : 0), z: Math.sin(a) * r, b: rand(0.35, 1) });
  }

  // ---------- trees ----------
  const trees = [];
  let headAngle = rand(0, TAU);
  let anchorAngle = rand(0, TAU);
  const MAX_TREES = small ? 9 : 16;
  let lastTree = 0;

  function growTree(angle, size, label, kind) {
    const pts = [];
    const ox = Math.cos(angle), oz = Math.sin(angle);
    const up = Math.random() < 0.85 ? -1 : 1; // most trees rise, some hang below
    const branch = (x, y, z, dx, dy, dz, len, depth) => {
      const steps = Math.max(4, Math.round(len * 60));
      for (let s = 0; s < steps; s++) {
        dx += rand(-0.08, 0.08);
        dy += rand(-0.06, 0.06);
        dz += rand(-0.08, 0.08);
        const n = Math.hypot(dx, dy, dz) || 1;
        dx /= n; dy /= n; dz /= n;
        const step = len / steps;
        x += dx * step; y += dy * step; z += dz * step;
        const dens = 2;
        for (let k = 0; k < dens; k++) pts.push({ x: x + rand(-0.006, 0.006) * (1 + depth), y: y + rand(-0.006, 0.006) * (1 + depth), z: z + rand(-0.006, 0.006) * (1 + depth), d: pts.length });
        if (depth < 2 && Math.random() < 0.07 + depth * 0.05) branch(x, y, z, dx + rand(-0.6, 0.6), dy + rand(-0.3, 0.3), dz + rand(-0.6, 0.6), len * rand(0.35, 0.6), depth + 1);
      }
      // Leaf cluster at the tip.
      for (let k = 0; k < 6 + depth * 4; k++) pts.push({ x: x + rand(-0.03, 0.03), y: y + rand(-0.03, 0.03), z: z + rand(-0.03, 0.03), d: pts.length });
    };
    const len = 0.16 + Math.min(1, size) * 0.42;
    branch(ox, 0, oz, ox * 0.35, up * rand(0.9, 1.2), oz * 0.35, len, 0);
    const tip = pts.reduce((m, p) => (up < 0 ? (p.y < m.y ? p : m) : p.y > m.y ? p : m), pts[0]);
    let labelEl = null;
    if (label) {
      labelEl = document.createElement('div');
      labelEl.className = 'ring-label' + (kind === 'block' ? ' is-block' : '');
      labelEl.textContent = label;
      labelsEl.append(labelEl);
    }
    trees.push({ pts, born: performance.now(), grow: 1400 + pts.length * 1.5, life: kind === 'block' ? 16_000 : Infinity, tip, labelEl, kind });
    // Keep the scene light: drop the oldest block trees first.
    while (trees.length > MAX_TREES) {
      const idx = trees.findIndex((t) => t.kind === 'block');
      const [old] = trees.splice(idx >= 0 ? idx : 0, 1);
      old.labelEl?.remove();
    }
  }

  // ---------- projection ----------
  let w = 0, h = 0, cx = 0, cy = 0, R = 0, wide = true;
  let rot = rand(0, TAU);
  let tilt = 0.34; // radians around X: a flat ellipse seen slightly from above
  let tiltTarget = tilt, yawNudge = 0, yawTarget = 0;
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const r = box.getBoundingClientRect();
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    wide = w > 760;
    cx = wide ? w * 0.67 : w * 0.5;
    cy = wide ? h * 0.66 : h * 0.68;
    R = wide ? Math.min(w * 0.24, 340) : w * 0.38;
  }
  const project = (p, out) => {
    const ca = Math.cos(rot + yawNudge), sa = Math.sin(rot + yawNudge);
    const x = p.x * ca - p.z * sa;
    const z1 = p.x * sa + p.z * ca;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const y = p.y * ct + z1 * st;
    const z = p.y * st + z1 * ct;
    const f = 6;
    const s = f / (f + z);
    out.x = cx + x * R * s;
    out.y = cy + y * R * s * 0.98;
    out.z = z;
    out.s = s;
    return out;
  };

  // ---------- render ----------
  const tmp = { x: 0, y: 0, z: 0, s: 1 };
  let raf = 0, last = performance.now(), visible = true;
  function draw(now) {
    const dt = Math.min(64, now - last);
    last = now;
    if (!reducedMotion) rot += dt * 0.000045;
    tilt += (tiltTarget - tilt) * 0.04;
    yawNudge += (yawTarget - yawNudge) * 0.04;
    ctx.clearRect(0, 0, w, h);

    // Ring: brightness by depth; the head arc (latest block) glows.
    for (const p of ring) {
      project(p, tmp);
      let d = (p.a - headAngle) % TAU;
      if (d < 0) d += TAU;
      const head = d > TAU - 0.5 ? 1 - (TAU - d) / 0.5 : 0; // trailing arc behind the head
      const depth = Math.max(0, Math.min(1, 0.55 - tmp.z * 0.45));
      const alpha = Math.min(1, (0.12 + depth * 0.55) * p.b + head * 0.9);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      const sz = (head > 0.2 ? 1.8 : 1.15) * tmp.s;
      ctx.fillRect(tmp.x, tmp.y, sz, sz);
    }

    // Trees: grow in, block trees fade out at the end of their life.
    for (let i = trees.length - 1; i >= 0; i--) {
      const t = trees[i];
      const age = now - t.born;
      if (age > t.life) {
        t.labelEl?.remove();
        trees.splice(i, 1);
        continue;
      }
      const fade = t.life === Infinity ? 1 : Math.min(1, (t.life - age) / 4000);
      const shown = reducedMotion ? t.pts.length : Math.min(t.pts.length, Math.floor((age / t.grow) * t.pts.length));
      for (let k = 0; k < shown; k++) {
        const p = t.pts[k];
        project(p, tmp);
        const depth = Math.max(0, Math.min(1, 0.6 - tmp.z * 0.45));
        const fresh = shown - k < 30 ? 0.35 : 0; // growing tips are brighter
        ctx.fillStyle = `rgba(255,255,255,${Math.min(1, (0.18 + depth * 0.6 + fresh) * fade)})`;
        const sz = 1.1 * tmp.s;
        ctx.fillRect(tmp.x, tmp.y, sz, sz);
      }
      if (t.labelEl) {
        project(t.tip, tmp);
        const behind = tmp.z > 0.55;
        const grown = shown >= t.pts.length * 0.8;
        const lw = (t.lw ||= t.labelEl.offsetWidth) / 2 + 8;
        const x = Math.max(lw, Math.min(w - lw, tmp.x));
        const overText = wide && x - lw < w * 0.5; // keep the headline readable
        t.labelEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(30, tmp.y))}px)`;
        t.labelEl.style.opacity = grown && !behind && !overText ? fade : 0;
      }
    }
    if (!reducedMotion && visible && !document.hidden) raf = requestAnimationFrame(draw);
    else raf = 0;
  }

  const kick = () => {
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(draw);
    }
  };
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) kick();
  });
  io.observe(box);
  const onVis = () => !document.hidden && kick();
  document.addEventListener('visibilitychange', onVis);
  const onMove = (e) => {
    const r = box.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - 0.5;
    const ny = (e.clientY - r.top) / r.height - 0.5;
    yawTarget = nx * 0.25;
    tiltTarget = 0.34 + ny * 0.1;
  };
  box.addEventListener('pointermove', onMove);
  const ro = new ResizeObserver(() => {
    resize();
    kick();
  });
  ro.observe(box);
  resize();
  kick();

  return {
    // A new block: advance the head and grow a tree there.
    block(number, txs) {
      headAngle = (headAngle + 0.03) % TAU;
      const now = performance.now();
      if (now - lastTree < 1400) return kick();
      lastTree = now;
      const label = number != null ? `#${number.toLocaleString('en-US')} · ${txs} tx` : null;
      growTree(headAngle, Math.min(1, 0.15 + txs / 40), label, 'block');
      kick();
    },
    // Long-lived labelled trees for real context (contracts, stock tokens).
    anchor(label, weight) {
      anchorAngle += TAU / 6 + rand(-0.15, 0.15);
      growTree(anchorAngle, Math.min(1, 0.35 + weight), label, 'anchor');
      kick();
    },
    destroy() {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      box.removeEventListener('pointermove', onMove);
    },
  };
}
