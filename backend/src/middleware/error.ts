import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors';
import { logger } from '../logger';

const send = (res: Response, req: Request, status: number, code: string, message: string, details?: unknown) =>
  res.status(status).json({ error: { code, message, details, requestId: req.requestId } });

export function notFoundHandler(req: Request, res: Response) {
  send(res, req, 404, 'NOT_FOUND', 'Route not found');
}

// Never leaks stack traces, SQL, tokens or passwords to clients.
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return send(res, req, 400, 'VALIDATION_ERROR', 'Invalid request', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  if (err instanceof AppError) return send(res, req, err.status, err.code, err.message, err.details);
  if (err?.type === 'entity.parse.failed') return send(res, req, 400, 'INVALID_JSON', 'Malformed JSON body');
  if (err?.type === 'entity.too.large') return send(res, req, 413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
  switch (err?.code) {
    case 'ER_DUP_ENTRY':
      return send(res, req, 409, 'DUPLICATE', 'A record with the same unique value already exists');
    case 'ER_NO_REFERENCED_ROW_2':
      return send(res, req, 409, 'REFERENCE_NOT_FOUND', 'A referenced record does not exist');
    case 'ER_ROW_IS_REFERENCED_2':
      return send(res, req, 409, 'IN_USE', 'The record is referenced by other records');
    case 'ER_CHECK_CONSTRAINT_VIOLATED':
      return send(res, req, 409, 'CONSTRAINT_VIOLATION', 'The operation violates a data constraint (for example, insufficient stock)');
  }
  logger.error('unhandled_error', { requestId: req.requestId, path: req.path, message: err?.message, stack: err?.stack });
  send(res, req, 500, 'INTERNAL_ERROR', 'Internal server error');
}
