// Stale-while-revalidate cache with in-flight request coalescing and
// disk persistence. This is what keeps free-tier upstream APIs alive:
// N visitors asking for the same thing => at most one upstream call per TTL,
// and when the upstream is rate-limited or down we keep serving the last
// real value (flagged as stale) instead of failing.

import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR } from '../config.js';

const store = new Map(); // key -> { value, at, ttl }
const inflight = new Map(); // key -> Promise
const MAX_ENTRIES = 5000;
const FILE = path.join(CACHE_DIR, 'cache.json');

export async function cached(key, ttlMs, fetcher, { maxStaleMs = 24 * 3600_000 } = {}) {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return { value: hit.value, at: hit.at, stale: false };

  const run = () => {
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      try {
        const value = await fetcher();
        set(key, value, ttlMs);
        return { value, at: Date.now(), stale: false };
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  };

  if (hit && now - hit.at < maxStaleMs) {
    // Serve the last real value right away, refresh in the background.
    run().catch(() => {});
    return { value: hit.value, at: hit.at, stale: true };
  }
  return run();
}

export function set(key, value, ttl = 0) {
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }
  store.delete(key);
  store.set(key, { value, at: Date.now(), ttl });
}

export function peek(key) {
  return store.get(key) || null;
}

// --- persistence: survive restarts without re-hitting every upstream -------

export function loadFromDisk() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const [k, v] of raw) store.set(k, v);
    console.log(`[cache] restored ${store.size} entries`);
  } catch {
    /* first run */
  }
}

export function saveToDisk() {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify([...store.entries()]));
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.warn('[cache] save failed:', err.message);
  }
}
