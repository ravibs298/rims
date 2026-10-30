import type { Request, Response, NextFunction } from 'express';
import type { ZodTypeAny } from 'zod';

export const validate =
  (schemas: { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny }) =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) req.query = schemas.query.parse(req.query) as any;
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (e) {
      next(e);
    }
  };
