import { z } from 'zod';

const id = z.coerce.number().int().positive();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bool = z.enum(['true', 'false']);

export const adjustBody = z.object({
  product_id: id,
  location_id: id,
  delta: z.coerce.number().int().refine((n) => n !== 0, 'delta must not be zero').refine((n) => Math.abs(n) <= 1_000_000),
  reason: z.string().trim().min(3).max(255),
});
export const receiveBody = z.object({
  product_id: id,
  location_id: id,
  quantity: z.coerce.number().int().min(1).max(1_000_000),
  reason: z.string().trim().max(255).default('Stock receipt'),
});
export const transferBody = z.object({
  product_id: id,
  from_location_id: id,
  to_location_id: id,
  quantity: z.coerce.number().int().min(1).max(1_000_000),
  note: z.string().trim().max(255).optional(),
});
export const balanceQuery = z.object({
  product_id: id.optional(),
  location_id: id.optional(),
  category_id: id.optional(),
  low_stock: bool.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export const movementQuery = z.object({
  product_id: id.optional(),
  location_id: id.optional(),
  type: z.enum(['receipt', 'adjustment', 'transfer_in', 'transfer_out', 'sale', 'count', 'reserve', 'release']).optional(),
  from: date.optional(),
  to: date.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export const valuationQuery = z.object({ location_id: id.optional(), category_id: id.optional() });
export const locationBody = z.object({
  code: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1).max(255),
  type: z.enum(['store', 'warehouse']),
  address: z.string().trim().max(500).nullable().optional(),
});
export const locationUpdateBody = locationBody.partial().extend({ is_active: z.boolean().optional() });
export const idParam = z.object({ id });
