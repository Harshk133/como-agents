/**
 * Fixed-window in-memory rate limiter keyed by client address.
 *
 * Behind a reverse proxy (Render, Fly, a gateway) the socket address is the
 * proxy's, so every client shares one bucket. With trustProxy enabled the
 * right-most X-Forwarded-For entry -- the address the proxy itself saw --
 * is used instead; left-most entries are client-controlled and ignored.
 */

export function clientKey(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (xff.length) return xff[xff.length - 1];
  }
  return req.socket?.remoteAddress || 'unknown';
}

export function createRateLimiter({ windowMs, max, now = Date.now }) {
  const buckets = new Map();

  function prune(t) {
    if (buckets.size < 5000) return;
    for (const [key, b] of buckets) if (t >= b.resetAt) buckets.delete(key);
  }

  return {
    /** Record a hit; returns { allowed, retryAfterSec }. */
    hit(key) {
      const t = now();
      prune(t);
      let b = buckets.get(key);
      if (!b || t >= b.resetAt) {
        b = { count: 0, resetAt: t + windowMs };
        buckets.set(key, b);
      }
      b.count += 1;
      return { allowed: b.count <= max, retryAfterSec: Math.ceil((b.resetAt - t) / 1000) };
    },
    /** True when the key is already over the limit, without recording a hit. */
    blocked(key) {
      const b = buckets.get(key);
      return Boolean(b && now() < b.resetAt && b.count >= max);
    },
  };
}
