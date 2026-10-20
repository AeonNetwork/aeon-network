// DNS-over-HTTPS for hosts that are DNS-blocked on some networks.
// In Indonesia, *.robinhood.com resolves to a government block page
// (aduankonten.id) while the servers themselves are reachable. Resolving
// those names through Cloudflare's DoH lets the server reach the public
// Robinhood Chain RPC and CDN. Everything else uses normal system DNS.

import dns from 'node:dns';
import { Agent, setGlobalDispatcher } from 'undici';

const env = process.env;
const DOH_HOSTS = (env.DOH_HOSTS || 'robinhood.com').split(',').map((s) => s.trim()).filter(Boolean);
const enabled = env.DOH !== 'false';
const cache = new Map(); // host -> { addrs, until }

const needsDoh = (host) => enabled && DOH_HOSTS.some((d) => host === d || host.endsWith('.' + d));

async function dohResolve(host) {
  const hit = cache.get(host);
  if (hit && hit.until > Date.now()) return hit.addrs;
  for (const type of ['A', 'AAAA']) {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(6000),
    });
    const body = await res.json();
    const answers = (body.Answer || []).filter((a) => a.type === (type === 'A' ? 1 : 28));
    if (answers.length) {
      const addrs = answers.map((a) => ({ address: a.data, family: type === 'A' ? 4 : 6 }));
      const ttl = Math.max(30, Math.min(...answers.map((a) => a.TTL || 60)));
      cache.set(host, { addrs, until: Date.now() + ttl * 1000 });
      return addrs;
    }
  }
  throw new Error(`DoH: no records for ${host}`);
}

function lookup(host, options, callback) {
  if (typeof options === 'function') [callback, options] = [options, {}];
  if (!needsDoh(host)) return dns.lookup(host, options, callback);
  dohResolve(host).then(
    (addrs) => (options.all ? callback(null, addrs) : callback(null, addrs[0].address, addrs[0].family)),
    // DoH unreachable: fall back to system DNS rather than failing outright.
    () => dns.lookup(host, options, callback),
  );
}

export function installDoh() {
  if (!enabled) return;
  setGlobalDispatcher(new Agent({ connect: { lookup } }));
}
