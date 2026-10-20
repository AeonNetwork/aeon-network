// Token bucket for outbound calls + sliding window for inbound visitors.

export class TokenBucket {
  constructor(perMinute) {
    this.capacity = Math.max(1, perMinute);
    this.tokens = this.capacity;
    this.refillPerMs = this.capacity / 60_000;
    this.last = Date.now();
    this.blockedUntil = 0;
  }
  refill() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.refillPerMs);
    this.last = now;
  }
  tryTake() {
    if (Date.now() < this.blockedUntil) return false;
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
  // Called when upstream answers 429: stop asking for a while.
  backoff(ms) {
    this.blockedUntil = Date.now() + ms;
    this.tokens = 0;
  }
}

export function ipLimiter({ max, windowMs }) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, arr] of hits) {
      const kept = arr.filter((t) => t > cutoff);
      kept.length ? hits.set(ip, kept) : hits.delete(ip);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => t > now - windowMs);
    if (arr.length >= max) {
      const retry = Math.ceil((arr[0] + windowMs - now) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: `Usage limit reached. Try again in ${retry} seconds.` });
    }
    arr.push(now);
    hits.set(ip, arr);
    next();
  };
}

// One shared ceiling per UTC day across all visitors.
export function dailyCap(max, message) {
  let day = '';
  let used = 0;
  return (req, res, next) => {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) (day = today), (used = 0);
    if (used >= max) {
      const reset = Math.ceil((Date.parse(today + 'T00:00:00Z') + 86_400_000 - Date.now()) / 1000);
      res.set('Retry-After', String(reset));
      return res.status(429).json({ error: message });
    }
    used++;
    next();
  };
}
