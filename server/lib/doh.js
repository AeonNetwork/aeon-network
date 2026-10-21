// JSON POST that resolves the host over DNS-over-HTTPS (Cloudflare) instead of the system
// resolver. Some ISPs hijack DNS for crypto hosts (the official Robinhood Chain RPC resolves to
// a block page with the wrong certificate); the TLS check still runs against the real hostname.
import https from 'node:https';

const ips = new Map(); // host -> { ip, until }

async function resolve(host) {
  const hit = ips.get(host);
  if (hit && hit.until > Date.now()) return hit.ip;
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) });
  const answer = ((await r.json()).Answer || []).filter((a) => a.type === 1);
  if (!answer.length) throw new Error(`no address for ${host}`);
  const ip = answer[Math.floor(Math.random() * answer.length)].data;
  ips.set(host, { ip, until: Date.now() + Math.max(60, Math.min(...answer.map((a) => a.TTL))) * 1000 });
  return ip;
}

export async function postJSON(url, body, { timeout = 30_000 } = {}) {
  const u = new URL(url);
  const ip = await resolve(u.hostname);
  const payload = JSON.stringify(body);
  return new Promise((ok, fail) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }, lookup: (_h, o, cb) => (o?.all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4)), timeout },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode === 429) return fail(new Error('rate limited'));
          if (res.statusCode >= 400) return fail(new Error(`HTTP ${res.statusCode}`));
          try {
            ok(JSON.parse(data));
          } catch {
            fail(new Error('bad JSON from RPC'));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', fail);
    req.end(payload);
  });
}
