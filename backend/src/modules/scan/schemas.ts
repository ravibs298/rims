import { z } from 'zod';

const id = z.coerce.number().int().positive();
const identifier = { id_type: z.enum(['barcode', 'rfid']), value: z.string().trim().min(1).max(128), reader: z.string().max(32).optional() };

export const resolveBody = z.object(identifier);
export const actionBody = z
  .object({
    ...identifier,
    action: z.enum(['receive', 'count', 'transfer', 'fulfill']),
    location_id: id.optional(),
    to_location_id: id.optional(),
    quantity: z.coerce.number().int().min(0).max(1_000_000).default(1),
    order_id: id.optional(),
    po_id: id.optional(),
  })
  .superRefine((v, ctx) => {
    const need = (ok: boolean, path: string, msg: string) => ok || ctx.addIssue({ code: 'custom', path: [path], message: msg });
    if (v.action !== 'count') need(v.quantity >= 1, 'quantity', 'quantity must be at least 1');
    if (['receive', 'count', 'transfer'].includes(v.action)) need(v.location_id !== undefined, 'location_id', 'location_id is required');
    if (v.action === 'transfer') need(v.to_location_id !== undefined, 'to_location_id', 'to_location_id is required');
    if (v.action === 'fulfill') need(v.order_id !== undefined, 'order_id', 'order_id is required');
  });
