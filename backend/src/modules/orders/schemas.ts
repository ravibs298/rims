import { z } from 'zod';

const id = z.coerce.number().int().positive();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createOrderBody = z.object({
  customer_name: z.string().trim().min(1).max(255),
  customer_email: z.string().trim().email().max(255).nullable().optional(),
  location_id: id,
  shipping_address: z.string().trim().max(500).nullable().optional(),
  items: z.array(z.object({ product_id: id, quantity: z.coerce.number().int().min(1).max(100000) })).min(1).max(100),
});
export const orderQuery = z.object({
  status: z.enum(['reserved', 'fulfilled', 'shipped', 'delivered', 'cancelled']).optional(),
  location_id: id.optional(),
  q: z.string().trim().max(100).optional(),
  from: date.optional(),
  to: date.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const cancelBody = z.object({ reason: z.string().trim().min(1).max(255).default('Cancelled') });
export const shipBody = z.object({ carrier: z.string().trim().min(1).max(64), tracking_number: z.string().trim().min(1).max(128) });
export const idParam = z.object({ id });
