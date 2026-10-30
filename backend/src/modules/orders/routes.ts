import { Router } from 'express';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { wrap } from '../../utils';
import * as svc from './service';
import { cancelBody, createOrderBody, idParam, orderQuery, shipBody } from './schemas';

export const ordersRouter = Router();
const ip = (req: any) => req.ip ?? null;

ordersRouter.get('/orders', requirePermission('orders.read'), validate({ query: orderQuery }), wrap(async (req, res) => {
  res.json(await svc.listOrders(req.user!, req.query));
}));
ordersRouter.post('/orders', requirePermission('orders.write'), validate({ body: createOrderBody }), wrap(async (req, res) => {
  res.status(201).json(await svc.createOrder(req.user!, req.body, ip(req)));
}));
ordersRouter.get('/orders/:id', requirePermission('orders.read'), validate({ params: idParam }), wrap(async (req, res) => {
  res.json(await svc.getOrder(req.user!, Number(req.params.id)));
}));
ordersRouter.post('/orders/:id/fulfill', requirePermission('orders.fulfill'), validate({ params: idParam }), wrap(async (req, res) => {
  res.json(await svc.fulfill(req.user!, Number(req.params.id)));
}));
ordersRouter.post('/orders/:id/cancel', requirePermission('orders.write'), validate({ params: idParam, body: cancelBody }), wrap(async (req, res) => {
  res.json(await svc.cancel(req.user!, Number(req.params.id), req.body.reason, ip(req)));
}));
ordersRouter.post('/orders/:id/ship', requirePermission('orders.fulfill'), validate({ params: idParam, body: shipBody }), wrap(async (req, res) => {
  res.json(await svc.ship(req.user!, Number(req.params.id), req.body.carrier, req.body.tracking_number, ip(req)));
}));
ordersRouter.post('/orders/:id/deliver', requirePermission('orders.fulfill'), validate({ params: idParam }), wrap(async (req, res) => {
  res.json(await svc.deliver(req.user!, Number(req.params.id), ip(req)));
}));
