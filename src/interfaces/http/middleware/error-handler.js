import { ZodError } from 'zod';

function isZodError(error) {
  if (!error) {
    return false;
  }
  if (error instanceof ZodError) {
    return true;
  }
  return error.name === 'ZodError' && Array.isArray(error.issues);
}

function formatZodIssues(issues = []) {
  return issues.map((issue) => ({
    path: Array.isArray(issue.path) ? issue.path.join('.') : '',
    message: issue.message,
    code: issue.code
  }));
}

export function createErrorHandler({ logger, nodeEnv } = {}) {
  const resolvedNodeEnv = String(nodeEnv ?? process.env.NODE_ENV ?? '').toLowerCase();
  const includeMessage = resolvedNodeEnv !== 'production';

  return (err, req, res, _next) => {
    const requestId = req?.requestId || res?.locals?.requestId || undefined;

    if (res.headersSent) {
      return;
    }

    if (isZodError(err)) {
      logger?.warn?.({ requestId, err }, 'Validation error');
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        requestId,
        details: formatZodIssues(err.issues)
      });
    }

    const status =
      (Number.isInteger(err?.statusCode) && err.statusCode) ||
      (Number.isInteger(err?.status) && err.status) ||
      500;

    const payload = {
      success: false,
      error: status >= 500 ? 'Internal server error' : 'Request failed',
      requestId
    };
    if (includeMessage && err?.message) {
      payload.message = err.message;
    }

    if (status >= 500) {
      logger?.error?.({ requestId, err }, 'Server error');
    } else {
      logger?.warn?.({ requestId, err }, 'Request error');
    }

    return res.status(status).json(payload);
  };
}
