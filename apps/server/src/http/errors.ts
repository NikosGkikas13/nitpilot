import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation_error'
  | 'conflict'
  | 'payload_too_large'
  | 'rate_limited'
  | 'server_error';

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_error: 400,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  server_error: 500,
};

/** Throw this from a route to answer with a specific status and message. */
export class HttpError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export function errorBody(code: ErrorCode, message: string, details?: Record<string, unknown>) {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

/** Every error a route throws ends up here (Odyhook's withApiAuth pattern, as Hono's onError). */
export function onError(err: Error, c: Context): Response {
  if (err instanceof HttpError) return c.json(errorBody(err.code, err.message), STATUS[err.code]);
  if (err instanceof ZodError) return c.json(errorBody('validation_error', 'request validation failed', { issues: err.issues }), 400);
  if (err instanceof SyntaxError) return c.json(errorBody('validation_error', 'invalid JSON body'), 400);
  if (err instanceof HTTPException) return err.getResponse();
  console.error('[http] unhandled error:', err);
  return c.json(errorBody('server_error', 'internal server error'), 500);
}
