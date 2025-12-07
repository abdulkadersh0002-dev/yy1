export function ok(res, data = {}, extra = {}) {
  const payload = {
    success: true,
    ...data,
    timestamp: extra.timestamp ?? Date.now()
  };
  return res.status(extra.statusCode ?? 200).json(payload);
}

export function badRequest(res, error, extra = {}) {
  const payload = {
    success: false,
    error: typeof error === 'string' ? error : error?.message || 'Bad request',
    timestamp: extra.timestamp ?? Date.now()
  };
  return res.status(extra.statusCode ?? 400).json(payload);
}

export function notFound(res, error = 'Not found', extra = {}) {
  const payload = {
    success: false,
    error,
    timestamp: extra.timestamp ?? Date.now()
  };
  return res.status(extra.statusCode ?? 404).json(payload);
}

export function serverError(res, error, extra = {}) {
  const message = typeof error === 'string' ? error : error?.message || 'Internal server error';

  const payload = {
    success: false,
    error: 'Internal server error',
    message,
    timestamp: extra.timestamp ?? Date.now()
  };
  return res.status(extra.statusCode ?? 500).json(payload);
}
