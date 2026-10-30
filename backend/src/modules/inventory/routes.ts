import { Router } from 'express';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { wrap } from '../../utils';
import * as svc from './service';
import { adjustBody, balanceQuery, idParam, locationBody, locationUpdateBody, movementQuery, receiveBody, transferBody, valuationQuery } from './schemas';

export const inventoryRouter = Router();
const ip = (req: any) => req.ip ?? null;

inventoryRouter.get('/locations', requirePermission('inventory.read', 'orders.read', 'po.read', 'reports.read', 'scan.use', 'users.read'), wrap(async (req, res) => {
  res.json({ data: await svc.listLocations(req.user!) });
}));
inventoryRouter.post('/locations', requirePermission('locations.write'), validate({ body: locationBody }), wrap(async (req, res) => {
  res.status(201).json(await svc.createLocation(req.user!, req.body, ip(req)));
}));
inventoryRouter.patch('/locations/:id', requirePermission('locations.write'), validate({ params: idParam, body: locationUpdateBody }), wrap(async (req, res) => {
  res.json(await svc.updateLocation(req.user!, Number(req.params.id), req.body, ip(req)));
}));

inventoryRouter.get('/inventory/balances', requirePermission('inventory.read'), validate({ query: balanceQuery }), wrap(async (req, res) => {
  res.json(await svc.balances(req.user!, req.query));
}));
inventoryRouter.get('/inventory/low-stock', requirePermission('inventory.read'), validate({ query: valuationQuery }), wrap(async (req, res) => {
  const loc = req.query.location_id ? Number(req.query.location_id) : undefined;
  res.json({ data: await svc.lowStock(req.user!, loc) });
}));
inventoryRouter.get('/inventory/valuation', requirePermission('inventory.read'), validate({ query: valuationQuery }), wrap(async (req, res) => {
  res.json(await svc.valuation(req.user!, req.query as any));
}));
inventoryRouter.get('/inventory/movements', requirePermission('inventory.read'), validate({ query: movementQuery }), wrap(async (req, res) => {
  res.json(await svc.movements(req.user!, req.query));
}));
inventoryRouter.post('/inventory/adjustments', requirePermission('inventory.adjust'), validate({ body: adjustBody }), wrap(async (req, res) => {
  res.status(201).json(await svc.adjust(req.user!, req.body, ip(req)));
}));
inventoryRouter.post('/inventory/receipts', requirePermission('inventory.adjust'), validate({ body: receiveBody }), wrap(async (req, res) => {
  res.status(201).json(await svc.receive(req.user!, req.body, ip(req)));
}));
inventoryRouter.get('/inventory/transfers', requirePermission('inventory.read'), wrap(async (req, res) => {
  res.json({ data: await svc.listTransfers(req.user!) });
}));
inventoryRouter.post('/inventory/transfers', requirePermission('inventory.transfer'), validate({ body: transferBody }), wrap(async (req, res) => {
  res.status(201).json(await svc.transfer(req.user!, req.body, ip(req)));
}));
