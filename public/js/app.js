import { state, api, on, emit, $, $$, prefs, short, toast } from './core.js';
import { reveal, auroraPulse } from './fx.js';
import { startWatch } from './watch.js';
import { chooseWallet, restore } from './wallet.js';

// Every route lives under the network: #/, #/explorer/..., #/ecosystem, #/tokens, #/wallet, #/ai
const views = {
  network: () => import('./views/network.js'),
  stocks: () => import('./views/stocks.js'),
  portfolio: () => import('./views/portfolio.js'),
  explorer: () => import('./views/explorer.js'),
  ecosystem: () => import('./views/ecosystem.js'),
  tokens: () => import('./views/tokens.js'),
  wallet: () => import('./views/wallet.js'),
  ai: () => import('./views/ai.js'),
  docs: () => import('./views/docs.js'),
  status: () => import('./views/status.js'),
  check: () => import('./views/check.js'),
  token: () => import('./views/token.js'),
  faq: () => import('./views/faq.js'),
  legal: () => import('./views/legal.js'),
  notfound: () => import('./views/notfound.js'),
};
const TITLES = {
  network: 'Aeon Network — The live hub for Robinhood Chain',
  stocks: 'Tokenized Stocks · Aeon Network',
  portfolio: 'Portfolio · Aeon Network',
  explorer: 'Explorer · Aeon Network',
  ecosystem: 'Ecosystem · Aeon Network',
  tokens: 'Tokens · Aeon Network',
  wallet: 'Watchlist · Aeon Network',
  ai: 'Network AI · Aeon Network',
  docs: 'Docs · Aeon Network',
  status: 'Status · Aeon Network',
  check: 'Wallet check · Aeon Network',
  token: 'Token · Aeon Network',
  faq: 'FAQ · Aeon Network',
  legal: 'Disclaimer, privacy & terms · Aeon Network',
  notfound: 'Not found · Aeon Network',
};

let cleanup = null;
async function route() {
  const [, name = '', ...rest] = location.hash.replace(/^#/, '').split('/');
  const alias = { '': 'network', chain: 'network', markets: 'network', terminal: 'network' };
  const key = views[alias[name] ?? name] ? alias[name] ?? name : 'notfound';
  const mod = await views[key]();
  const main = document.getElementById('view');
  cleanup?.();
  cleanup = null;
  main.innerHTML = '';
  scrollTo({ top: 0, behavior: 'instant' });
  cleanup = mod.render(main, rest.map(decodeURIComponent)) || null;
  reveal(main);
  $$('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === key));
  document.title = TITLES[key];
}
addEventListener('hashchange', route);

// Any [data-copy] button copies its value.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  navigator.clipboard.writeText(b.dataset.copy).then(
    () => {
      toast('Copied: ' + short(b.dataset.copy, 8));
      b.textContent = 'Copied';
      setTimeout(() => (b.textContent = 'Copy'), 1500);
    },
    () => toast('Copy failed. Select the address and copy it manually.', 'err'),
  );
});

// Broken logo -> initials placeholder.
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (img?.tagName !== 'IMG' || !img.classList.contains('logo')) return;
    const ph = document.createElement('span');
    ph.className = 'logo ph';
    ph.style.cssText = img.style.cssText;
    ph.textContent = (img.dataset.sym || '?').slice(0, 2).toUpperCase();
    img.replaceWith(ph);
  },
  true,
);

// ---------------- live stream ----------------
function connectStream() {
  const es = new EventSource('/api/stream');
  es.addEventListener('block', (e) => {
    const d = JSON.parse(e.data);
    emit('block', d);
    if (d.network === state.network) {
      auroraPulse();
      setStatus({ ok: true });
    }
  });
  es.addEventListener('txs', (e) => emit('txs', JSON.parse(e.data)));
  es.addEventListener('pulse', (e) => emit('pulse', JSON.parse(e.data)));
  es.addEventListener('chain-health', (e) => {
    const d = JSON.parse(e.data);
    if (d.network === state.network) setStatus(d.health);
  });
  es.onopen = () => {
    state.streamOk = true;
    footer();
  };
  es.onerror = () => {
    state.streamOk = false;
    footer();
  };
}

let lastBlockAt = 0;
on('block', ({ network, block }) => {
  if (network === state.network) {
    lastBlockAt = Date.now();
    footer(block.number);
  }
});
function footer(blockNo) {
  const el = $('#footStatus');
  if (blockNo) el.dataset.block = blockNo;
  el.textContent = `${state.streamOk ? 'LIVE' : 'OFFLINE'} · ${state.network.toUpperCase()}${el.dataset.block ? ' · #' + Number(el.dataset.block).toLocaleString('en-US') : ''}`;
}
setInterval(() => {
  if (lastBlockAt && Date.now() - lastBlockAt > 60_000) setStatus({ ok: false, error: 'no new blocks for 60s' });
}, 10_000);

function setStatus(h) {
  const dot = $('#statusDot');
  dot.classList.toggle('ok', h?.ok === true);
  dot.classList.toggle('bad', h?.ok === false);
  dot.title = h?.ok ? 'RPC online' : `RPC unreachable${h?.error ? ': ' + h.error : ''}`;
}

// ---------------- network switch ----------------
function renderSwitch() {
  $$('#netSwitch [data-net]').forEach((b) => b.classList.toggle('active', b.dataset.net === state.network));
}
function setNetwork(n) {
  if (n === state.network) return;
  state.network = n;
  prefs.set('network', n);
  renderSwitch();
  $('#footStatus').dataset.block = '';
  footer();
  emit('network', n);
  checkHealth();
}
$('#netSwitch').addEventListener('click', (e) => {
  const b = e.target.closest('[data-net]');
  if (b) setNetwork(b.dataset.net);
});
on('set-network', setNetwork);

function checkHealth() {
  api(`/network/${state.network}/overview`)
    .then((o) => setStatus(o.health))
    .catch(() => setStatus({ ok: false }));
}

// ---------------- optional wallet ----------------
// Never required. Connected: the button shows the address and opens a check of that wallet.
function renderWalletBtn() {
  const label = $('#walletBtn .btn-label');
  label.textContent = state.wallet ? short(state.wallet.address, 5) : 'Connect';
  $('#walletBtn').title = state.wallet ? 'Check my wallet' : 'Optional — every page works without connecting';
}
$('#walletBtn').addEventListener('click', () => (state.wallet ? (location.hash = `#/check/${state.wallet.address}`) : chooseWallet()));
on('wallet', renderWalletBtn);

// ---------------- boot ----------------
async function boot() {
  try {
    state.config = await api('/config');
  } catch {
    document.getElementById('view').innerHTML = '<div class="notice">Cannot reach the Aeon Network server. Run <code>npm start</code>.</div>';
    return;
  }
  state.network = prefs.get('network', state.config.defaultNetwork);
  if (!state.config.networks[state.network]) state.network = state.config.defaultNetwork;
  renderSwitch();
  footer();
  checkHealth();
  const loadPrice = () => api('/eth-price').then((p) => (state.ethUsd = p.usd)).catch(() => {});
  loadPrice();
  setInterval(loadPrice, 120_000);
  connectStream();
  restore();
  startWatch();
  route();
}
boot();
