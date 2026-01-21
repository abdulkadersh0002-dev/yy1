import { randomUUID } from 'node:crypto';

const HEADER_NAME = 'x-request-id';

function sanitizeRequestId(value) {
  if (!value) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > 128) {
    return normalized.slice(0, 128);
  }
  return normalized;
}

export function requestIdMiddleware() {
  return (req, res, next) => {
    const incoming = sanitizeRequestId(req.headers?.[HEADER_NAME]);
    const requestId = incoming || randomUUID();

    req.requestId = requestId;
    res.locals.requestId = requestId;
    res.setHeader(HEADER_NAME, requestId);
    next();
  };
}
