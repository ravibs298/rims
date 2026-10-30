import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../../config';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { wrap } from '../../utils';
import * as svc from './service';
import { auditQuery, createUserBody, idParam, loginBody, updateUserBody } from './schemas';

export const authRouter = Router();
authRouter.post(
  '/login',
  rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, skip: () => !config.rateLimit.enabled }),
  validate({ body: loginBody }),
  wrap(async (req, res) => {
    res.json(await svc.login(req.body.email, req.body.password, req.ip ?? null));
  }),
);
authRouter.get('/me', authenticate, wrap(async (req, res) => {
  res.json({ user: await svc.publicUser(req.user!.id) });
}));

export const usersRouter = Router();
usersRouter.get('/users', requirePermission('users.read'), wrap(async (_req, res) => {
  res.json({ data: await svc.listUsers() });
}));
usersRouter.post('/users', requirePermission('users.write'), validate({ body: createUserBody }), wrap(async (req, res) => {
  res.status(201).json(await svc.createUser(req.user!.id, req.body, req.ip ?? null));
}));
usersRouter.patch('/users/:id', requirePermission('users.write'), validate({ params: idParam, body: updateUserBody }), wrap(async (req, res) => {
  res.json(await svc.updateUser(req.user!.id, Number(req.params.id), req.body, req.ip ?? null));
}));
usersRouter.get('/roles', requirePermission('users.read'), wrap(async (_req, res) => {
  res.json({ data: await svc.listRoles() });
}));
usersRouter.get('/audit-logs', requirePermission('audit.read'), validate({ query: auditQuery }), wrap(async (req, res) => {
  res.json(await svc.listAudit(req.query));
}));
