// Whale alerts: the viewer picks a minimum size, a side and (optionally) some stocks; while the
// site is open on any page, new whale trades that match raise a toast and a browser notification.
// Settings live on this device only.
import { prefs, api, emit, toast, short } from './core.js';

const KEY = 'whale-alerts';
const DEFAULT = { on: false, min: 50_000, side: 'trades', symbols: [], seen: [], since: 0 };
export const getAlerts = () => ({ ...DEFAULT, ...prefs.get(KEY, {}) });
const save = (a) => {
  prefs.set(KEY, a);
  emit('alerts', a);
};

export async function setAlerts(patch) {
  const a = { ...getAlerts(), ...patch };
  if (patch.on && !getAlerts().on) {
    a.since = Date.now(); // only trades from now on
    a.seen = [];
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission().catch(() => {});
  }
  save(a);
  if (a.on) check();
}

const SIDES = { trades: ['buy', 'sell', 'mint', 'redeem'], buys: ['buy', 'mint'], sells: ['sell', 'redeem'] };
const money = (n) => (n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : '$' + (n / 1e3).toFixed(1) + 'K');

let running = false;
async function check() {
  const a = getAlerts();
  if (!a.on || running || document.hidden) return;
  running = true;
  try {
    const d = await api(`/network/mainnet/whales?min=${a.min}`);
    const seen = new Set(a.seen);
    const fresh = (d.items || [])
      .filter((w) => w.t >= a.since && !seen.has(w.id) && SIDES[a.side].includes(w.side) && (!a.symbols.length || a.symbols.includes(w.symbol)))
      .sort((x, y) => x.t - y.t);
    for (const w of fresh.slice(-5)) {
      const msg = `${w.side.toUpperCase()} ${money(w.usd)} of ${w.symbol} · ${short(w.wallet)}`;
      toast('◆ Whale: ' + msg);
      try {
        if (Notification.permission === 'granted') new Notification('Aeon Network · Whale alert', { body: msg, icon: '/img/icon-192.png', tag: w.id });
      } catch {
        /* unsupported */
      }
    }
    if (fresh.length) save({ ...getAlerts(), seen: [...fresh.map((w) => w.id), ...a.seen].slice(0, 300) });
  } catch {
    /* try again next round */
  } finally {
    running = false;
  }
}

export function startAlerts() {
  setInterval(check, 60_000);
  setTimeout(check, 8_000);
}
