const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX_REQUESTS = 30;

export function createRateLimiter({
  windowMs = DEFAULT_WINDOW_MS,
  max = DEFAULT_MAX_REQUESTS,
  logger,
} = {}) {
  const hits = new Map();
  let cleanupTimer = null;

  const cleanup = () => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) {
        hits.delete(key);
      }
    }
  };

  const scheduleCleanup = () => {
    if (cleanupTimer) {
      return;
    }
    cleanupTimer = setInterval(
      () => {
        cleanup();
      },
      Math.max(1000, Math.min(windowMs, 60000))
    );
    cleanupTimer.unref?.();
  };

  scheduleCleanup();

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const identity = req.identity?.id || 'anonymous';
    const ip =
      req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
    const key = `${identity}|${ip}|${req.method}|${req.path}`;
    const existing = hits.get(key);

    if (!existing || existing.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (existing.count >= max) {
      logger?.warn?.({ key, windowMs, max }, 'Rate limit exceeded');
      const requestId = res?.locals?.requestId;
      return res.status(429).json({
        success: false,
        error: 'Too many requests',
        ...(requestId ? { requestId } : null),
      });
    }

    existing.count += 1;
    hits.set(key, existing);

    if (hits.size > max * 10) {
      cleanup();
    }

    return next();
  };
}
