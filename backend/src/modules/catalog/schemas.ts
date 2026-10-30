import { z } from 'zod';

const id = z.coerce.number().int().positive();

export const productBody = z.object({
  sku: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/, 'SKU may contain letters, digits, ".", "_" and "-"'),
  name: z.string().trim().min(1).max(255),
  description: z.string().max(5000).nullable().optional(),
  price: z.coerce.number().min(0).max(9_999_999),
  cost: z.coerce.number().min(0).max(9_999_999).default(0),
  category_id: id.nullable().optional(),
  reorder_point: z.coerce.number().int().min(0).max(1_000_000).default(0),
  image_urls: z.array(z.string().url().max(1000)).max(10).default([]),
});
export const productUpdateBody = productBody.partial().extend({ image_urls: z.array(z.string().url().max(1000)).max(10).optional() });

export const productQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category_id: id.optional(),
  active: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['name', 'sku', 'price', 'created_at']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
});

export const categoryBody = z.object({ name: z.string().trim().min(1).max(128), parent_id: id.nullable().optional() });
export const idParam = z.object({ id });
export const identifierBody = z.object({
  id_type: z.enum(['barcode', 'rfid']),
  value: z.string().trim().min(1).max(128),
});
export const identifierParams = z.object({ id, identifierId: id });
