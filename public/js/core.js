// Shared state, API client, formatting and DOM helpers.

const listeners = new Map();
export const on = (ev, fn) => {
  if (!listeners.has(ev)) listeners.set(ev, new Set());
  listeners.get(ev).add(fn);
  return () => listeners.get(ev).delete(fn);
};
export const emit = (ev, data) => listeners.get(ev)?.forEach((fn) => fn(data));

export const state = {
  config: null,
  network: 'mainnet',
  wallet: null, // { address, chainId, provider, info }
  ethUsd: null,
  streamOk: false,
};

export const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('aeon:' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('aeon:' + key, JSON.stringify(value));
    } catch {
      /* private mode */
    }
  },
};

export async function api(path, opts = {}) {
  const res = await fetch('/api' + path, { headers: { accept: 'application/json' }, ...opts });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}
export const netApi = (path) => api(`/network/${state.network}${path}`);
export const net = () => state.config.networks[state.network];

// ---------- formatting ----------
export function fmtNum(n, digits = 2) {
  if (n == null || !isFinite(n)) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: digits });
}
export function fmtInt(n) {
  if (n == null || !isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}
export function fmtUsd(n, digits = 2) {
  if (n == null || !isFinite(n)) return '—';
  if (Math.abs(n) < 1e-9) n = 0;
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return '$' + (n / 1e3).toFixed(1) + 'K';
  if (a > 0 && a < 0.01) return '$' + n.toPrecision(2);
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: Math.min(digits, a < 1000 ? 2 : 0) });
}
export function fmtCompact(n) {
  if (n == null || !isFinite(n)) return '—';
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
}
export function fmtPct(n, digits = 2) {
  if (n == null || !isFinite(n)) return '—';
  return (n > 0 ? '+' : '') + n.toFixed(digits) + '%';
}
export const gwei = (wei) => (wei == null ? '—' : (wei / 1e9 < 0.01 ? (wei / 1e9).toPrecision(3) : (wei / 1e9).toFixed(3)));
export function ago(t) {
  if (!t) return '—';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 2) return 'just now';
  if (s < 60) return Math.floor(s) + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
export const short = (a, n = 6) => (!a ? '' : a.length <= n + 5 ? a : a.slice(0, n) + '…' + a.slice(-4));
export function fromWei(wei, decimals = 18, digits = 6) {
  const b = BigInt(wei ?? 0);
  const neg = b < 0n;
  const v = neg ? -b : b;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, '0').slice(0, digits).replace(/0+$/, '');
  return (neg ? '-' : '') + whole.toLocaleString('en-US') + (frac ? '.' + frac : '');
}
export const weiToEth = (wei) => Number(BigInt(wei ?? 0)) / 1e18;
export function toWei(str, decimals = 18) {
  const [w, f = ''] = String(str).trim().split('.');
  if (!/^\d*$/.test(w) || !/^\d*$/.test(f) || (!w && !f)) throw new Error('Invalid amount');
  return BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

// ---------- DOM ----------
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
export function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  document.getElementById('toasts').append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, 4000);
}
// Logos go through the server: some CDNs are DNS-blocked for visitors.
export const icon = (u) => (u ? '/api/icon?u=' + encodeURIComponent(u) : '');

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Links inside the app (explorer routes).
export const link = {
  block: (n) => `#/explorer/block/${n}`,
  tx: (h) => `#/explorer/tx/${h}`,
  address: (a) => `#/explorer/address/${a}`,
  token: (a) => `#/token/${a}`,
};
export const addrLink = (a, n = 6) => (a ? `<a class="mono link" href="${link.address(a)}" title="${esc(a)}">${esc(short(a, n))}</a>` : '<span class="dim">—</span>');
export const txLink = (h, n = 10) => `<a class="mono link" href="${link.tx(h)}" title="${esc(h)}">${esc(short(h, n))}</a>`;

export const COLORS = {
  ink: '#fafafa',
  ink2: '#a3a3a3',
  ink3: '#6b6b6b',
  line: 'rgba(255,255,255,0.14)',
  grid: 'rgba(255,255,255,0.07)',
  fill: 'rgba(255,255,255,0.08)',
  bg: '#000000',
};

// ---------- provenance & sharing ----------
// Every on-chain object links to the independent explorer so anyone can verify it.
export const verifyUrl = (kind, id) => `${net().explorer.replace(/\/$/, '')}/${kind}${id != null ? '/' + id : ''}`;
export const verifyLink = (kind, id, label = 'verify ↗') => `<a class="link" href="${esc(verifyUrl(kind, id))}" target="_blank" rel="noopener noreferrer" title="Open on Blockscout">${label}</a>`;

// /s/... links render a preview card for WhatsApp, X, Telegram, etc.
export async function share(kind, id, title) {
  const url = `${location.origin}/s/${kind}/${state.network}/${id}`;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) return await navigator.share({ title, url });
    await navigator.clipboard.writeText(url);
    toast('Share link copied');
  } catch (err) {
    if (err?.name !== 'AbortError') toast(url);
  }
}
