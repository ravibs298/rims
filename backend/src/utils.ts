import type { Request, Response, RequestHandler } from 'express';
import { randomBytes } from 'crypto';

export const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/** Small WHERE builder; every value is bound as a parameter. */
export class Where {
  clauses: string[] = [];
  params: any[] = [];
  add(sql: string, ...p: any[]) {
    this.clauses.push(sql);
    this.params.push(...p);
    return this;
  }
  /** null = unrestricted; [] = no access */
  addIn(col: string, ids: number[] | null) {
    if (ids === null) return this;
    if (ids.length === 0) return this.add('1=0');
    return this.add(`${col} IN (?)`, ids);
  }
  get sql() {
    return this.clauses.length ? 'WHERE ' + this.clauses.join(' AND ') : '';
  }
}

export const pageParams = (page: number, pageSize: number) => ({ limit: pageSize, offset: (page - 1) * pageSize });
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const ref = (prefix: string) =>
  `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex').toUpperCase()}`;
