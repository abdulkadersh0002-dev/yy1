import { badRequest } from './http-response.js';

export function parseRequestBody(schema, req, res, options = {}) {
  const parseResult = schema.safeParse(req.body || {});
  if (parseResult.success) {
    return parseResult.data;
  }

  const issues = parseResult.error?.issues || [];
  const details = issues.map((issue) => ({
    path: issue.path?.length ? issue.path.join('.') : 'body',
    message: issue.message
  }));

  badRequest(res, options.errorMessage || 'Invalid request body', { details });
  return null;
}

export function parseRequestQuery(schema, req, res, options = {}) {
  const parseResult = schema.safeParse(req.query || {});
  if (parseResult.success) {
    return parseResult.data;
  }

  const issues = parseResult.error?.issues || [];
  const details = issues.map((issue) => ({
    path: issue.path?.length ? issue.path.join('.') : 'query',
    message: issue.message
  }));

  badRequest(res, options.errorMessage || 'Invalid request query', { details });
  return null;
}

export function parseRequestBodyWithValidator(validator, req, res, options = {}) {
  const payload = options.payload ?? req.body ?? {};
  try {
    return validator(payload);
  } catch (error) {
    if (error?.name === 'ZodError' || error?.code === 'INVALID_PAYLOAD') {
      const issues = error?.issues || [];
      const details = issues.map((issue) => ({
        path: issue.path?.length ? issue.path.join('.') : 'body',
        message: issue.message
      }));
      badRequest(res, options.errorMessage || 'Invalid request body', {
        details: details.length ? details : undefined
      });
      return null;
    }
    throw error;
  }
}
