import { z } from 'zod';

const id = z.coerce.number().int().positive();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const supplierBody = z.object({
  name: z.string().trim().min(1).max(255),
  contact_name: z.string().trim().max(255).nullable().optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  phone: z.string().trim().max(64).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  lead_time_days: z.coerce.number().int().min(0).max(365).default(7),
});
export const supplierUpdateBody = supplierBody.partial().extend({ is_active: z.boolean().optional() });
export const poBody = z.object({
  supplier_id: id,
  location_id: id,
  expected_date: date.nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  items: z.array(z.object({ product_id: id, quantity: z.coerce.number().int().min(1).max(1_000_000), unit_cost: z.coerce.number().min(0).max(9_999_999).optional() })).min(1).max(200),
});
export const poQuery = z.object({
  status: z.enum(['draft', 'approved', 'partially_received', 'received', 'cancelled']).optional(),
  supplier_id: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const receiveBody = z.object({
  note: z.string().trim().max(255).optional(),
  items: z.array(z.object({ po_item_id: id, quantity: z.coerce.number().int().min(1).max(1_000_000) })).min(1).max(200),
});
export const idParam = z.object({ id });
