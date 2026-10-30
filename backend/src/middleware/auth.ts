import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { one, query } from '../db';
import { forbidden, unauthorized } from '../errors';
import { computeLocationScope } from '../modules/auth/access';

export interface AuthUser {
  id: number;
  email: string;
  fullName: string;
  role: string;
  permissions: Set<string>;
  /** null = all locations; [] = none */
  locationIds: number[] | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}

export async function loadAuthUser(id: number): Promise<AuthUser | null> {
  const u = await one<any>(
    `SELECT u.id, u.email, u.full_name, u.is_active, r.name AS role
       FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE u.id = ?`,
    [id],
  );
  if (!u || !u.is_active) return null;
  const perms = await query<{ code: string }>(
    `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
       JOIN roles r ON r.id = rp.role_id WHERE r.name = ?`,
    [u.role],
  );
  const locs = await query<{ location_id: number }>('SELECT location_id FROM user_locations WHERE user_id = ?', [id]);
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    role: u.role,
    permissions: new Set(perms.map((p) => p.code)),
    locationIds: computeLocationScope(u.role, locs.map((l) => l.location_id)),
  };
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized('NO_TOKEN', 'Authentication required');
    let payload: any;
    try {
      payload = jwt.verify(header.slice(7), config.jwt.secret, { algorithms: ['HS256'] });
    } catch {
      throw unauthorized('INVALID_TOKEN', 'Invalid or expired token');
    }
    const user = await loadAuthUser(Number(payload.sub));
    if (!user) throw unauthorized('INVALID_TOKEN', 'Invalid or expired token');
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

/** Allows the request if the user holds ANY of the listed permissions. */
export const requirePermission =
  (...codes: string[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const u = req.user;
    if (!u) return next(unauthorized('NO_TOKEN', 'Authentication required'));
    if (!codes.some((c) => u.permissions.has(c))) return next(forbidden());
    next();
  };

export const can = (u: AuthUser, code: string) => u.permissions.has(code);
