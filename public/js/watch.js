// Address watchlist: polls each watched address and notifies when it has a
// new transaction. Runs on every page while the site is open.
import { prefs, api, emit, toast, short } from './core.js';

const MAX = 12;
export const getWatch = () => prefs.get('watch', []);
const save = (list) => {
  prefs.set('watch', list);
  emit('watch', list);
};

export function addWatch(network, address, label) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Enter a valid 0x address');
  const list = getWatch();
  if (list.some((w) => w.network === network && w.address.toLowerCase() === address.toLowerCase())) throw new Error('Already on your watchlist');
  if (list.length >= MAX) throw new Error(`Watchlist is limited to ${MAX} addresses`);
  list.push({ network, address, label: (label || '').trim().slice(0, 40), lastHash: null, lastTime: null, added: Date.now() });
  save(list);
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  check();
}

export function removeWatch(network, address) {
  save(getWatch().filter((w) => !(w.network === network && w.address === address)));
}

let running = false;
async function check() {
  if (running) return;
  running = true;
  try {
    const list = getWatch();
    let changed = false;
    for (const w of list) {
      try {
        const a = await api(`/network/${w.network}/address/${w.address}`);
        const latest = a.history?.[0];
        if (!latest) continue;
        if (w.lastHash && latest.hash !== w.lastHash) {
          const name = w.label || short(w.address);
          const msg = `${name}: new ${latest.method || 'transaction'}${latest.status === 'failed' ? ' (failed)' : ''}`;
          toast('◉ ' + msg);
          try {
            if (Notification.permission === 'granted') new Notification('Aeon Network · Watchlist', { body: msg, icon: '/img/icon-192.png' });
          } catch {
            /* unsupported */
          }
        }
        if (latest.hash !== w.lastHash) {
          w.lastHash = latest.hash;
          w.lastTime = latest.time;
          w.lastMethod = latest.method;
          changed = true;
        }
        w.balanceWei = a.balanceWei;
      } catch {
        /* try again next round */
      }
    }
    if (changed) save(list);
    else emit('watch', list);
  } finally {
    running = false;
  }
}

export function startWatch() {
  setTimeout(check, 3000);
  setInterval(check, 60_000);
}
