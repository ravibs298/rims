import { Router } from 'express';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { wrap } from '../../utils';
import * as svc from './service';
import { idParam, poBody, poQuery, receiveBody, supplierBody, supplierUpdateBody } from './schemas';

export const suppliersRouter = Router();
const ip = (req: any) => req.ip ?? null;

suppliersRouter.get('/suppliers', requirePermission('suppliers.read', 'po.read'), wrap(async (req, res) => {
  res.json({ data: await svc.listSuppliers(req.query.active as string | undefined) });
}));
suppliersRouter.post('/suppliers', requirePermission('suppliers.write'), validate({ body: supplierBody }), wrap(async (req, res) => {
  res.status(201).json(await svc.createSupplier(req.user!, req.body, ip(req)));
}));
suppliersRouter.get('/suppliers/:id', requirePermission('suppliers.read'), validate({ params: idParam }), wrap(async (req, res) => {
  res.json(await svc.getSupplier(Number(req.params.id)));
}));
suppliersRouter.patch('/suppliers/:id', requirePermission('suppliers.write'), validate({ params: idParam, body: supplierUpdateBody }), wrap(async (req, res) => {
  res.json(await svc.updateSupplier(req.user!, Number(req.params.id), req.body, ip(req)));
}));

suppliersRouter.get('/purchase-orders', requirePermission('po.read'), validate({ query: poQuery }), wrap(async (req, res) => {
  res.json(await svc.listPOs(req.user!, req.query));
}));
suppliersRouter.post('/purchase-orders', requirePermission('po.write'), validate({ body: poBody }), wrap(async (req, res) => {
  res.status(201).json(await svc.createPO(req.user!, req.body, ip(req)));
}));
suppliersRouter.get('/purchase-orders/:id', requirePermission('po.read'), validate({ params: idParam }), wrap(async (req, res) => {
  res.json(await svc.getPO(req.user!, Number(req.params.id)));
}));
suppliersRouter.post('/purchase-orders/:id/approve', requirePermission('po.approve'), validate({ params: idParam }), wrap(async (req, res) => {
  res.json(await svc.approvePO(req.user!, Number(req.params.id), ip(req)));
}));
suppliersRouter.post('/purchase-orders/:id/cancel', requirePermission('po.write'), validate({ params: idParam }), wrap(async (req, res) => {
  res.json(await svc.cancelPO(req.user!, Number(req.params.id), ip(req)));
}));
suppliersRouter.post('/purchase-orders/:id/receive', requirePermission('po.receive'), validate({ params: idParam, body: receiveBody }), wrap(async (req, res) => {
  res.status(201).json(await svc.receivePO(req.user!, Number(req.params.id), req.body, ip(req)));
}));
