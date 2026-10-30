import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { wrap } from '../../utils';
import { supplierMetrics } from '../suppliers/service';
import * as svc from './service';

const id = z.coerce.number().int().positive();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const filterQuery = z.object({ from: date.optional(), to: date.optional(), location_id: id.optional(), category_id: id.optional(), product_id: id.optional() });

export const reportsRouter = Router();
reportsRouter.use('/reports', requirePermission('reports.read'));
const q = validate({ query: filterQuery });

reportsRouter.get('/reports/dashboard', q, wrap(async (req, res) => res.json(await svc.dashboard(req.user!, req.query as any))));
reportsRouter.get('/reports/inventory-levels', q, wrap(async (req, res) => res.json({ data: await svc.inventoryLevels(req.user!, req.query as any) })));
reportsRouter.get('/reports/fulfillment', q, wrap(async (req, res) => res.json(await svc.fulfillment(req.user!, req.query as any))));
reportsRouter.get('/reports/sales-trend', q, wrap(async (req, res) => res.json(await svc.salesTrend(req.user!, req.query as any))));
reportsRouter.get('/reports/suppliers', q, wrap(async (req, res) => {
  const f = req.query as any;
  res.json({ data: await supplierMetrics({ from: f.from, to: f.to }) });
}));
reportsRouter.get('/reports/reconciliation', q, wrap(async (req, res) => res.json(await svc.reconciliation(req.user!, req.query as any))));
