import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { wrap } from '../../utils';
import { rawBody } from './adapters';
import { configBody, configUpdateBody, eventQuery, idParam, inboundEnvelope } from './schemas';
import * as svc from './service';

export const integrationsPublicRouter = Router();
export const integrationsRouter = Router();
const ip = (req: any) => req.ip ?? null;

// Public machine-to-machine endpoint: authenticated by HMAC signature (X-Signature) + Idempotency-Key, not JWT.
integrationsPublicRouter.post('/integrations/inbound/:name', validate({ params: z.object({ name: z.string().max(64) }), body: inboundEnvelope }), wrap(async (req, res) => {
  const r = await svc.receiveInbound(req.params.name, rawBody(req), req.header('x-signature'), req.header('idempotency-key'), req.body);
  const status = (r.event as any)?.status;
  res.status(r.duplicate ? 200 : status === 'succeeded' ? 201 : 202).json(r);
}));

integrationsRouter.get('/integrations/configs', requirePermission('integrations.read'), wrap(async (_req, res) => res.json({ data: await svc.listConfigs() })));
integrationsRouter.post('/integrations/configs', requirePermission('integrations.manage'), validate({ body: configBody }), wrap(async (req, res) => res.status(201).json(await svc.createConfig(req.user!, req.body, ip(req)))));
integrationsRouter.patch('/integrations/configs/:id', requirePermission('integrations.manage'), validate({ params: idParam, body: configUpdateBody }), wrap(async (req, res) => res.json(await svc.updateConfig(req.user!, Number(req.params.id), req.body, ip(req)))));
integrationsRouter.post('/integrations/configs/:id/test', requirePermission('integrations.manage'), validate({ params: idParam }), wrap(async (req, res) => res.json(await svc.testConnection(req.user!, Number(req.params.id), ip(req)))));
integrationsRouter.get('/integrations/status', requirePermission('integrations.read'), wrap(async (_req, res) => res.json({ data: await svc.status() })));
integrationsRouter.get('/integrations/events', requirePermission('integrations.read'), validate({ query: eventQuery }), wrap(async (req, res) => res.json(await svc.listEvents(req.query))));
integrationsRouter.post('/integrations/events/process', requirePermission('integrations.manage'), wrap(async (_req, res) => {
  const { processed, succeeded } = await svc.processDue();
  res.json({ processed, succeeded });
}));
integrationsRouter.post('/integrations/events/:id/retry', requirePermission('integrations.manage'), validate({ params: idParam }), wrap(async (req, res) => res.json(await svc.retryEvent(req.user!, Number(req.params.id), ip(req)))));
integrationsRouter.get('/integrations/logs', requirePermission('integrations.read'), wrap(async (req, res) => res.json({ data: await svc.listLogs(req.query.config_id ? Number(req.query.config_id) : undefined) })));
integrationsRouter.get('/integrations/reconciliation', requirePermission('integrations.read'), wrap(async (req, res) => res.json(await svc.reconcile(req.user!))));
