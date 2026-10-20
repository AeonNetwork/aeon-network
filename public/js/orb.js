// AI page: a particle sphere that listens. Every new block sends a wave across
// its surface; each keystroke ripples it from the front and it leans in while
// you type; sending a question draws every particle into the centre.
// Monochrome canvas, pauses off-screen, static frame for reduced motion.

import { reducedMotion } from './core.js';

const TAU = Math.PI * 2;

export function startOrb(box) {
  box.innerHTML = '<canvas></canvas>';
  const canvas = box.firstChild;
  const ctx = canvas.getContext('2d');
  const N = matchMedia('(max-width: 700px)').matches ? 700 : 1300;

  // Evenly spread points on a unit sphere (Fibonacci lattice).
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = i * golden;
    pts.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, b: 0.45 + Math.random() * 0.55 });
  }

  let w = 0, h = 0, R = 0;
  let yaw = Math.random() * TAU, tilt = 0.35, tiltTarget = 0.35, yawNudge = 0, yawTarget = 0;
  let attention = 0, attentionTarget = 0, lastKey = 0;
  let collapse = 0, collapsing = false;
  const ripples = [];

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const r = box.getBoundingClientRect();
    w = r.width;
    h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    R = Math.min(w, h) * 0.36;
  }

  // World -> view rotation (yaw around Y, then tilt around X) and its inverse.
  const rotate = (p, out) => {
    const cy = Math.cos(yaw + yawNudge), sy = Math.sin(yaw + yawNudge);
    const x = p.x * cy - p.z * sy;
    const z1 = p.x * sy + p.z * cy;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    out.x = x;
    out.y = p.y * ct - z1 * st;
    out.z = p.y * st + z1 * ct;
    return out;
  };
  const unrotate = (v) => {
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const y = v.y * ct + v.z * st;
    const z1 = -v.y * st + v.z * ct;
    const cy = Math.cos(yaw + yawNudge), sy = Math.sin(yaw + yawNudge);
    return { x: v.x * cy + z1 * sy, y, z: -v.x * sy + z1 * cy };
  };
  const addRipple = (dir, strength) => {
    ripples.push({ dir, t0: performance.now(), strength });
    if (ripples.length > 8) ripples.shift();
    kick();
  };

  const v = { x: 0, y: 0, z: 0 };
  let raf = 0, last = performance.now(), visible = true;
  function draw(now) {
    const dt = Math.min(64, now - last);
    last = now;
    if (!reducedMotion) yaw += dt * 0.00012;
    tilt += (tiltTarget - tilt) * 0.05;
    yawNudge += (yawTarget - yawNudge) * 0.05;
    if (now - lastKey > 1200) attentionTarget = 0;
    attention += (attentionTarget - attention) * 0.06;
    if (collapsing) collapse = Math.min(1, collapse + dt / 380);
    for (let i = ripples.length - 1; i >= 0; i--) if (now - ripples[i].t0 > 2200) ripples.splice(i, 1);

    ctx.clearRect(0, 0, w, h);
    const breathe = reducedMotion ? 0 : Math.sin(now / 1800) * 0.015;
    const shrink = 1 - collapse * collapse;
    const cx = w / 2, cy = h / 2;
    for (const p of pts) {
      // Wave displacement: a ring travelling outward over the surface from each ripple origin.
      let disp = 0;
      for (const r of ripples) {
        const age = (now - r.t0) / 1000;
        const d = Math.acos(Math.max(-1, Math.min(1, p.x * r.dir.x + p.y * r.dir.y + p.z * r.dir.z)));
        const front = age * 2.4;
        disp += r.strength * Math.exp(-((d - front) ** 2) / 0.05) * Math.max(0, 1 - age / 2.2);
      }
      const scale = R * (1 + breathe + attention * 0.06 + disp * 0.14) * shrink;
      rotate(p, v);
      const persp = 4 / (4 + v.z);
      const x = cx + v.x * scale * persp;
      const y = cy + v.y * scale * persp;
      const depth = Math.max(0, Math.min(1, 0.55 - v.z * 0.5));
      const alpha = Math.min(1, (0.1 + depth * 0.6) * p.b + disp * 0.7 + attention * 0.08) * (1 - collapse * 0.6);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      const size = (1 + depth * 0.7 + disp * 0.8) * persp;
      ctx.fillRect(x, y, size, size);
    }
    const busy = ripples.length || Math.abs(attention - attentionTarget) > 0.01 || (collapsing && collapse < 1);
    if (visible && !document.hidden && (!reducedMotion || busy)) raf = requestAnimationFrame(draw);
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
    yawTarget = ((e.clientX - r.left) / r.width - 0.5) * 0.6;
    tiltTarget = 0.35 + ((e.clientY - r.top) / r.height - 0.5) * 0.4;
    kick();
  };
  addEventListener('pointermove', onMove);
  const ro = new ResizeObserver(() => {
    resize();
    kick();
  });
  ro.observe(box);
  resize();
  kick();

  let lastBlock = 0;
  return {
    // A new block somewhere on the network: a wave from a random point.
    block() {
      const now = performance.now();
      if (now - lastBlock < 1100) return;
      lastBlock = now;
      const t = Math.random() * TAU, u = Math.random() * 2 - 1, s = Math.sqrt(1 - u * u);
      addRipple({ x: Math.cos(t) * s, y: u, z: Math.sin(t) * s }, 0.55);
    },
    // A keystroke: ripple from the point facing the viewer, and lean in.
    key() {
      lastKey = performance.now();
      attentionTarget = 1;
      const j = () => (Math.random() - 0.5) * 0.5;
      const d = unrotate({ x: j(), y: j(), z: -1 });
      const n = Math.hypot(d.x, d.y, d.z);
      addRipple({ x: d.x / n, y: d.y / n, z: d.z / n }, 0.35);
    },
    // The question was sent: draw everything into the centre.
    collapse() {
      collapsing = true;
      kick();
      return new Promise((r) => setTimeout(r, reducedMotion ? 0 : 400));
    },
    destroy() {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      removeEventListener('pointermove', onMove);
    },
  };
}
