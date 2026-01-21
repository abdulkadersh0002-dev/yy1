function withRequestId(res, payload) {
  const requestId = res?.locals?.requestId;
  if (!requestId) {
    return payload;
  }
  return {
    ...payload,
    requestId
  };
}

export function ok(res, data = {}, extra = {}) {
  const payload = withRequestId(res, {
    success: true,
    ...data,
    timestamp: extra.timestamp ?? Date.now()
  });
  return res.status(extra.statusCode ?? 200).json(payload);
}

export function badRequest(res, error, extra = {}) {
  const payload = withRequestId(res, {
    success: false,
    error: typeof error === 'string' ? error : error?.message || 'Bad request',
    timestamp: extra.timestamp ?? Date.now()
  });
  return res.status(extra.statusCode ?? 400).json(payload);
}

export function notFound(res, error = 'Not found', extra = {}) {
  const payload = withRequestId(res, {
    success: false,
    error,
    timestamp: extra.timestamp ?? Date.now()
  });
  return res.status(extra.statusCode ?? 404).json(payload);
}

export function serviceUnavailable(res, error = 'Service unavailable', extra = {}) {
  const payload = withRequestId(res, {
    success: false,
    error: typeof error === 'string' ? error : error?.message || 'Service unavailable',
    timestamp: extra.timestamp ?? Date.now()
  });
  return res.status(extra.statusCode ?? 503).json(payload);
}

export function serverError(res, error, extra = {}) {
  const message = typeof error === 'string' ? error : error?.message || 'Internal server error';

  const nodeEnv = String(extra.nodeEnv ?? process.env.NODE_ENV ?? '').toLowerCase();
  const includeMessage = nodeEnv !== 'production';

  const payload = withRequestId(res, {
    success: false,
    error: 'Internal server error',
    timestamp: extra.timestamp ?? Date.now()
  });

  if (includeMessage) {
    payload.message = message;
  }

  return res.status(extra.statusCode ?? 500).json(payload);
}
