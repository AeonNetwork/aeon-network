// Monochrome canvas charts (one series each, so the box title names it):
// area/line over time and bars over time, with a crosshair + tooltip on hover.

import { COLORS } from './core.js';
import { fitCanvas } from './fx.js';

const PAD = { l: 8, r: 58, t: 10, b: 22 };

function niceTicks(min, max, count = 4) {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

export function timeChart(box, points, { type = 'area', format = (v) => String(v), timeFormat = 'day', label = '' } = {}) {
  box.innerHTML = '<canvas></canvas><div class="chart-tip"></div>';
  const canvas = box.querySelector('canvas');
  const tip = box.querySelector('.chart-tip');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', label);
  let hover = null;
  let data = points.filter((p) => p.v != null);

  const fmtTime = (t) => {
    const d = new Date(t);
    if (timeFormat === 'minute') return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  function draw() {
    const { ctx, w, h } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    if (!data.length) {
      ctx.fillStyle = COLORS.ink3;
      ctx.font = '12px Geist, sans-serif';
      ctx.fillText('No data yet', PAD.l, h / 2);
      return;
    }
    const pw = w - PAD.l - PAD.r, ph = h - PAD.t - PAD.b;
    const max = Math.max(...data.map((p) => p.v));
    const min = type === 'bar' ? 0 : Math.min(...data.map((p) => p.v));
    const lo = type === 'bar' ? 0 : Math.max(min >= 0 ? 0 : -Infinity, min - (max - min) * 0.08);
    const hi = max + (max - lo) * 0.08 || 1;
    const X = (i) => PAD.l + (data.length === 1 ? pw / 2 : (i / (data.length - 1)) * pw);
    const Y = (v) => PAD.t + ph - ((v - lo) / (hi - lo)) * ph;

    ctx.font = '10.5px "Geist Mono", monospace';
    ctx.textBaseline = 'middle';
    for (const v of niceTicks(lo, hi)) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(w - PAD.r, y);
      ctx.stroke();
      ctx.fillStyle = COLORS.ink3;
      ctx.fillText(format(v), w - PAD.r + 8, y);
    }
    ctx.textAlign = 'center';
    const labels = Math.max(2, Math.floor(pw / 90));
    for (let k = 0; k < labels; k++) {
      const i = Math.round((k / (labels - 1)) * (data.length - 1));
      ctx.fillStyle = COLORS.ink3;
      ctx.fillText(fmtTime(data[i].t), Math.min(w - PAD.r - 20, Math.max(PAD.l + 20, X(i))), h - PAD.b / 2 + 2);
    }
    ctx.textAlign = 'left';

    if (type === 'bar') {
      const bw = Math.min(28, Math.max(1, (pw / data.length) * 0.7));
      data.forEach((p, i) => {
        const y = Y(p.v);
        ctx.fillStyle = hover === i ? COLORS.ink : 'rgba(255,255,255,0.55)';
        ctx.fillRect(X(i) - bw / 2, y, bw, PAD.t + ph - y);
      });
    } else {
      ctx.beginPath();
      data.forEach((p, i) => (i ? ctx.lineTo(X(i), Y(p.v)) : ctx.moveTo(X(i), Y(p.v))));
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
      if (type === 'area') {
        const g = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + ph);
        g.addColorStop(0, 'rgba(255,255,255,0.18)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.lineTo(X(data.length - 1), PAD.t + ph);
        ctx.lineTo(X(0), PAD.t + ph);
        ctx.closePath();
        ctx.fillStyle = g;
        ctx.fill();
      }
    }

    if (hover != null) {
      const p = data[hover];
      const x = X(hover);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, PAD.t);
      ctx.lineTo(Math.round(x) + 0.5, PAD.t + ph);
      ctx.stroke();
      ctx.setLineDash([]);
      if (type !== 'bar') {
        ctx.beginPath();
        ctx.arc(x, Y(p.v), 4, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.ink;
        ctx.fill();
        ctx.strokeStyle = COLORS.bg;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      tip.innerHTML = `<span class="dim">${fmtTime(p.t)}${timeFormat === 'minute' ? '' : ', ' + new Date(p.t).getFullYear()}</span><b>${format(p.v, true)}</b>`;
      tip.style.opacity = 1;
      const tw = tip.offsetWidth;
      tip.style.transform = `translate(${x + 12 + tw > w - PAD.r ? x - 12 - tw : x + 12}px, ${PAD.t}px)`;
    } else tip.style.opacity = 0;
  }

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const pw = r.width - PAD.l - PAD.r;
    hover = Math.max(0, Math.min(data.length - 1, Math.round(((x - PAD.l) / pw) * (data.length - 1))));
    draw();
  });
  canvas.addEventListener('pointerleave', () => {
    hover = null;
    draw();
  });
  const ro = new ResizeObserver(draw);
  ro.observe(box);
  draw();
  return {
    update(next) {
      data = next.filter((p) => p.v != null);
      draw();
    },
    destroy: () => ro.disconnect(),
  };
}

// Squarified treemap: one tile per item, area ∝ value. Monochrome, with
// logos, hover highlight and click-through.
export function treemap(box, items, { format = (v) => String(v), onClick = () => {}, label = '' } = {}) {
  box.innerHTML = '<canvas></canvas><div class="chart-tip"></div>';
  const canvas = box.querySelector('canvas');
  const tip = box.querySelector('.chart-tip');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', label);
  const data = items.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const images = new Map();
  let rects = [];
  let hover = -1;

  for (const d of data.slice(0, 40)) {
    if (!d.icon) continue;
    const img = new Image();
    img.onload = () => draw();
    img.src = d.icon;
    images.set(d.id, img);
  }

  function layout(w, h) {
    const out = [];
    const scale = (w * h) / total;
    const nodes = data.map((d) => ({ d, area: d.value * scale }));
    let x = 0, y = 0, W = w, H = h;
    let row = [];
    const worst = (r, side) => {
      const s = r.reduce((a, n) => a + n.area, 0);
      const max = Math.max(...r.map((n) => n.area)), min = Math.min(...r.map((n) => n.area));
      return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
    };
    const place = (r) => {
      const s = r.reduce((a, n) => a + n.area, 0);
      if (W >= H) {
        const cw = s / H;
        let cy = y;
        for (const n of r) {
          const ch = n.area / cw;
          out.push({ ...n, x, y: cy, w: cw, h: ch });
          cy += ch;
        }
        x += cw;
        W -= cw;
      } else {
        const ch = s / W;
        let cx = x;
        for (const n of r) {
          const cw = n.area / ch;
          out.push({ ...n, x: cx, y, w: cw, h: ch });
          cx += cw;
        }
        y += ch;
        H -= ch;
      }
    };
    for (const n of nodes) {
      const side = Math.min(W, H);
      if (!row.length || worst([...row, n], side) <= worst(row, side)) row.push(n);
      else {
        place(row);
        row = [n];
      }
    }
    if (row.length) place(row);
    return out;
  }

  function draw() {
    const { ctx, w, h } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    rects = layout(w, h);
    rects.forEach((r, i) => {
      const share = r.d.value / total;
      ctx.fillStyle = i === hover ? 'rgba(255,255,255,0.22)' : `rgba(255,255,255,${0.04 + Math.min(0.14, share * 0.9)})`;
      ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx.strokeStyle = i === hover ? COLORS.ink : COLORS.line;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      if (r.w < 34 || r.h < 26) return;
      const pad = 8;
      let tx = r.x + pad;
      const img = images.get(r.d.id);
      const big = r.w > 90 && r.h > 60;
      if (img?.complete && img.naturalWidth && r.w > 56 && r.h > 40) {
        const s = big ? 22 : 16;
        ctx.save();
        ctx.beginPath();
        ctx.arc(tx + s / 2, r.y + pad + s / 2, s / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.filter = i === hover ? 'none' : 'grayscale(1)';
        ctx.drawImage(img, tx, r.y + pad, s, s);
        ctx.restore();
        tx += s + 6;
      }
      ctx.fillStyle = COLORS.ink;
      ctx.textBaseline = 'top';
      ctx.font = `600 ${big ? 13 : 11}px Geist, sans-serif`;
      ctx.fillText(r.d.label, tx, r.y + pad + (big ? 4 : 2), r.w - (tx - r.x) - pad);
      if (r.h > 44) {
        ctx.fillStyle = COLORS.ink2;
        ctx.font = `500 ${big ? 11.5 : 10}px "Geist Mono", monospace`;
        ctx.fillText(format(r.d.value), r.x + pad, r.y + r.h - pad - (big ? 13 : 11), r.w - pad * 2);
      }
    });
  }

  const at = (e) => {
    const b = canvas.getBoundingClientRect();
    const x = e.clientX - b.left, y = e.clientY - b.top;
    return { x, y, i: rects.findIndex((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) };
  };
  canvas.addEventListener('pointermove', (e) => {
    const { x, y, i } = at(e);
    if (i !== hover) {
      hover = i;
      draw();
    }
    canvas.style.cursor = i >= 0 ? 'pointer' : 'default';
    if (i < 0) return void (tip.style.opacity = 0);
    const d = rects[i].d;
    tip.innerHTML = `<b>${d.label}</b><span class="dim">${d.sub || ''}</span><span>${format(d.value, true)} · ${((d.value / total) * 100).toFixed(1)}%</span>`;
    tip.style.opacity = 1;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.transform = `translate(${Math.min(x + 14, canvas.clientWidth - tw - 4)}px, ${Math.min(y + 14, canvas.clientHeight - th - 4)}px)`;
  });
  canvas.addEventListener('pointerleave', () => {
    hover = -1;
    tip.style.opacity = 0;
    draw();
  });
  canvas.addEventListener('click', (e) => {
    const { i } = at(e);
    if (i >= 0) onClick(rects[i].d);
  });
  const ro = new ResizeObserver(draw);
  ro.observe(box);
  return { destroy: () => ro.disconnect() };
}
