// Maintenance page: count down to the end time, then reload into the live site.
const el = document.getElementById('left');
const end = Number(document.body.dataset.end);
const pad = (n) => String(n).padStart(2, '0');
function tick() {
  if (!el) return; // no countdown on this notice
  const ms = end - Date.now();
  if (ms <= 0) {
    el.textContent = '00:00:00';
    setTimeout(() => location.reload(), 3000);
    return;
  }
  const s = Math.floor(ms / 1000);
  el.textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  setTimeout(tick, 1000 - (Date.now() % 1000));
}
tick();
// Come back as soon as the update finishes early.
setInterval(() => fetch('/api/health', { cache: 'no-store' }).then((r) => r.ok && location.reload()).catch(() => {}), 30_000);
