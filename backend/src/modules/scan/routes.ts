import { Router } from 'express';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { wrap } from '../../utils';
import { identifierBody, identifierParams, idParam } from '../catalog/schemas';
import { listRfidAdapters } from './rfid';
import { actionBody, resolveBody } from './schemas';
import * as svc from './service';

export const scanRouter = Router();

scanRouter.post('/scan/resolve', requirePermission('scan.use'), validate({ body: resolveBody }), wrap(async (req, res) => {
  res.json({ product: await svc.resolve(req.user!, req.body.id_type, req.body.value, req.body.reader) });
}));
scanRouter.post('/scan/actions', requirePermission('scan.use'), validate({ body: actionBody }), wrap(async (req, res) => {
  res.status(201).json(await svc.runAction(req.user!, req.body, req.ip ?? null));
}));
scanRouter.get('/scan/events', requirePermission('scan.use'), wrap(async (_req, res) => {
  res.json({ data: await svc.recentScans() });
}));
scanRouter.get('/scan/rfid/readers', requirePermission('scan.use'), wrap(async (_req, res) => {
  res.json({ data: listRfidAdapters() });
}));

scanRouter.get('/products/:id/identifiers', requirePermission('products.read'), validate({ params: idParam }), wrap(async (req, res) => {
  res.json({ data: await svc.listIdentifiers(Number(req.params.id)) });
}));
scanRouter.post('/products/:id/identifiers', requirePermission('products.write'), validate({ params: idParam, body: identifierBody }), wrap(async (req, res) => {
  res.status(201).json(await svc.addIdentifier(req.user!, Number(req.params.id), req.body.id_type, req.body.value, req.ip ?? null));
}));
scanRouter.delete('/products/:id/identifiers/:identifierId', requirePermission('products.write'), validate({ params: identifierParams }), wrap(async (req, res) => {
  await svc.removeIdentifier(req.user!, Number(req.params.id), Number(req.params.identifierId), req.ip ?? null);
  res.status(204).end();
}));
