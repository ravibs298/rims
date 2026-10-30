import { z } from 'zod';

export const ROLE_NAMES = ['Admin', 'Catalog Manager', 'Inventory Manager', 'Store Manager', 'Order Manager', 'Supplier Manager', 'Analyst', 'Viewer'] as const;

export const password = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a digit');

export const loginBody = z.object({ email: z.string().trim().toLowerCase().email().max(255), password: z.string().min(1).max(128) });

export const createUserBody = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  full_name: z.string().trim().min(1).max(255),
  password,
  role: z.enum(ROLE_NAMES),
  location_ids: z.array(z.coerce.number().int().positive()).max(200).default([]),
});

export const updateUserBody = z
  .object({
    full_name: z.string().trim().min(1).max(255),
    role: z.enum(ROLE_NAMES),
    is_active: z.boolean(),
    password,
    location_ids: z.array(z.coerce.number().int().positive()).max(200),
  })
  .partial();

export const idParam = z.object({ id: z.coerce.number().int().positive() });

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const auditQuery = z.object({
  user_id: z.coerce.number().int().positive().optional(),
  action: z.string().max(64).optional(),
  from: date.optional(),
  to: date.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
