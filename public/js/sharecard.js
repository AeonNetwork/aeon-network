// Portfolio share card: a 1200x675 image of a wallet's stock portfolio (value, today's change,
// 7-day line, top positions), drawn in the browser from the data already on the page.
import { esc, short, toast, $ } from './core.js';

const W = 1200, H = 675;
const usd = (n) => (Math.abs(n) >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : Math.abs(n) >= 1e4 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 }));

function loadMark() {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = '/img/logo.svg';
  });
}

export async function drawPortfolioCard(p) {
  await document.fonts.ready;
  const c = document.createElement('canvas');
  c.width = W * 2;
  c.height = H * 2;
  const x = c.getContext('2d');
  x.scale(2, 2);
  const font = (w, s, mono) => `${w} ${s}px ${mono ? '"Geist Mono", monospace' : 'Geist, system-ui, sans-serif'}`;

  // background, grid, corner ticks
  const g = x.createRadialGradient(W * 0.75, H * 0.45, 40, W * 0.75, H * 0.45, W * 0.8);
  g.addColorStop(0, '#171717');
  g.addColorStop(1, '#000');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(255,255,255,0.05)';
  x.lineWidth = 1;
  for (let i = 0; i < W; i += 48) x.beginPath(), x.moveTo(i + 0.5, 0), x.lineTo(i + 0.5, H), x.stroke();
  for (let j = 0; j < H; j += 48) x.beginPath(), x.moveTo(0, j + 0.5), x.lineTo(W, j + 0.5), x.stroke();
  x.strokeStyle = '#fff';
  x.lineWidth = 3;
  x.beginPath(), x.moveTo(24, 44), x.lineTo(24, 24), x.lineTo(44, 24), x.stroke();
  x.beginPath(), x.moveTo(W - 44, H - 24), x.lineTo(W - 24, H - 24), x.lineTo(W - 24, H - 44), x.stroke();

  // brand
  const mark = await loadMark();
  if (mark) x.drawImage(mark, 60, 56, 30, 30);
  x.fillStyle = '#fafafa';
  x.font = font(600, 14, true);
  x.letterSpacing = '4px';
  x.fillText('AEON', 102, 77);
  x.fillStyle = '#6b6b6b';
  x.fillText('NETWORK', 160, 77);
  x.textAlign = 'right';
  x.fillText('STOCK PORTFOLIO · ROBINHOOD CHAIN', W - 60, 77);
  x.textAlign = 'left';
  x.letterSpacing = '0px';

  // value and change
  x.fillStyle = '#6b6b6b';
  x.font = font(500, 13, true);
  x.letterSpacing = '3px';
  x.fillText('PORTFOLIO VALUE', 60, 150);
  x.letterSpacing = '0px';
  x.fillStyle = '#fafafa';
  x.font = font(700, 84, true);
  x.fillText(usd(p.stocksValueUsd), 56, 232);
  const ch = p.change24hUsd, pct = p.change24hPct;
  if (ch != null) {
    x.font = font(600, 22, true);
    x.fillStyle = ch >= 0 ? '#fafafa' : '#a3a3a3';
    x.fillText(`${ch >= 0 ? '▲' : '▼'} ${usd(Math.abs(ch))}${pct != null ? ` (${(pct * 100).toFixed(2)}%)` : ''} today`, 60, 274);
  }

  // 7-day line
  const v = (p.history || []).map((h) => h.v).filter((n) => n != null);
  if (v.length > 1) {
    const L = 60, T = 310, Wd = 500, Hd = 130, lo = Math.min(...v), hi = Math.max(...v);
    const px = (i) => L + (i / (v.length - 1)) * Wd, py = (n) => T + (1 - (n - lo) / (hi - lo || 1)) * Hd;
    const fill = x.createLinearGradient(0, T, 0, T + Hd);
    fill.addColorStop(0, 'rgba(255,255,255,0.22)');
    fill.addColorStop(1, 'rgba(255,255,255,0)');
    x.beginPath();
    v.forEach((n, i) => (i ? x.lineTo(px(i), py(n)) : x.moveTo(px(i), py(n))));
    x.lineTo(px(v.length - 1), T + Hd), x.lineTo(L, T + Hd), x.closePath();
    x.fillStyle = fill;
    x.fill();
    x.beginPath();
    v.forEach((n, i) => (i ? x.lineTo(px(i), py(n)) : x.moveTo(px(i), py(n))));
    x.strokeStyle = '#fafafa';
    x.lineWidth = 2.5;
    x.stroke();
    x.fillStyle = '#6b6b6b';
    x.font = font(500, 12, true);
    x.fillText('7 DAYS', L, T + Hd + 24);
  }

  // top positions
  const hs = (p.holdings || []).filter((h) => h.valueUsd).slice(0, 5);
  const total = p.stocksValueUsd || 1;
  const BX = 640, BY = 130, BW = 500;
  x.strokeStyle = 'rgba(255,255,255,0.3)';
  x.lineWidth = 1;
  x.fillStyle = 'rgba(0,0,0,0.6)';
  x.fillRect(BX, BY, BW, 70 + hs.length * 64);
  x.strokeRect(BX + 0.5, BY + 0.5, BW, 70 + hs.length * 64);
  x.fillStyle = '#6b6b6b';
  x.font = font(500, 12, true);
  x.letterSpacing = '3px';
  x.fillText(`TOP POSITIONS · ${p.holdings.length} TOTAL`, BX + 22, BY + 40);
  x.letterSpacing = '0px';
  hs.forEach((h, i) => {
    const y = BY + 70 + i * 64;
    x.strokeStyle = 'rgba(255,255,255,0.12)';
    x.beginPath(), x.moveTo(BX, y + 0.5), x.lineTo(BX + BW, y + 0.5), x.stroke();
    x.fillStyle = '#fafafa';
    x.font = font(700, 20, true);
    x.fillText(h.symbol, BX + 22, y + 30);
    x.fillStyle = '#6b6b6b';
    x.font = font(500, 13);
    x.fillText((h.name || '').slice(0, 26), BX + 22, y + 50);
    const w = h.valueUsd / total;
    x.strokeStyle = 'rgba(255,255,255,0.35)';
    x.strokeRect(BX + 250.5, y + 22.5, 120, 10);
    x.fillStyle = '#fafafa';
    x.fillRect(BX + 251, y + 23, 119 * w, 9);
    x.fillStyle = '#a3a3a3';
    x.font = font(500, 13, true);
    x.fillText(`${(w * 100).toFixed(1)}%`, BX + 252, y + 52);
    x.textAlign = 'right';
    x.fillStyle = '#fafafa';
    x.font = font(700, 19, true);
    x.fillText(usd(h.valueUsd), BX + BW - 22, y + 38);
    x.textAlign = 'left';
  });

  // footer
  x.fillStyle = '#fafafa';
  x.fillRect(60, H - 96, 300, 44);
  x.fillStyle = '#000';
  x.font = font(600, 18, true);
  x.fillText('getaeon.network', 78, H - 67);
  x.fillStyle = '#6b6b6b';
  x.font = font(500, 14, true);
  x.fillText(`Wallet ${short(p.address, 8)} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · live on-chain data`, 380, H - 69);
  return c;
}

// Show the card with download and share buttons.
export async function openPortfolioCard(p) {
  const canvas = await drawPortfolioCard(p);
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
  const url = URL.createObjectURL(blob);
  const name = `aeon-portfolio-${p.address.slice(2, 8)}.png`;
  const m = $('#modal');
  m.innerHTML = `<h3>Share card</h3><img src="${url}" alt="Portfolio share card" class="pf-card-img"><p>Download the card, then attach it to your post. The link below opens this live portfolio.</p>
    <div class="modal-foot" style="gap:8px;flex-wrap:wrap"><button class="btn btn-sm" id="cardClose">Close</button>${navigator.canShare?.({ files: [new File([blob], name, { type: 'image/png' })] }) ? '<button class="btn btn-sm" id="cardShare">Share…</button>' : ''}<a class="btn btn-sm" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${encodeURIComponent('My stock portfolio on Robinhood Chain, live on @getaeon_network')}&url=${encodeURIComponent(location.origin + '/#/portfolio/' + p.address)}">Post on X</a><a class="btn btn-sm btn-primary" href="${url}" download="${esc(name)}">Download</a></div>`;
  m.classList.add('modal-wide');
  m.showModal();
  $('#cardClose', m).addEventListener('click', () => m.close());
  $('#cardShare', m)?.addEventListener('click', () => navigator.share({ files: [new File([blob], name, { type: 'image/png' })], text: 'My stock portfolio on Robinhood Chain', url: location.origin + '/#/portfolio/' + p.address }).catch(() => {}));
  m.addEventListener('close', () => (URL.revokeObjectURL(url), m.classList.remove('modal-wide')), { once: true });
  toast('Card ready');
}
