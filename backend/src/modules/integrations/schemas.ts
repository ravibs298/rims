import { z } from 'zod';

const id = z.coerce.number().int().positive();
const isProd = process.env.NODE_ENV === 'production';

const configShape = {
  name: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/, 'lowercase letters, digits, "_" or "-"'),
  adapter_type: z.enum(['erp', 'accounting', 'webhook']),
  direction: z.enum(['inbound', 'outbound', 'both']),
  base_url: z.string().url().max(500).refine((u) => !isProd || u.startsWith('https://'), 'HTTPS is required in production').nullable().optional(),
  secret_ref: z.string().regex(/^INTEGRATION_[A-Z0-9_]{1,50}$/, 'Must be an environment variable name starting with INTEGRATION_').nullable().optional(),
  config_json: z
    .object({
      events: z.array(z.string().max(64)).max(50).optional(),
      path: z.string().startsWith('/').max(200).optional(),
      health_path: z.string().startsWith('/').max(200).optional(),
    })
    .strict()
    .nullable()
    .optional(),
  enabled: z.boolean().default(false),
  max_attempts: z.coerce.number().int().min(1).max(20).default(5),
};
export const configBody = z.object(configShape);
export const configUpdateBody = z.object(configShape).partial();

export const inboundEnvelope = z.object({ event_type: z.string().trim().min(1).max(64), payload: z.record(z.unknown()) });

export const eventQuery = z.object({
  config_id: id.optional(),
  status: z.enum(['pending', 'processing', 'succeeded', 'failed', 'dead']).optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export const idParam = z.object({ id });

// Payload contracts for supported inbound events
export const inboundPayloads = {
  'product.upsert': z.object({
    sku: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/),
    name: z.string().trim().min(1).max(255),
    description: z.string().max(5000).nullable().optional(),
    price: z.number().min(0).max(9_999_999),
    cost: z.number().min(0).max(9_999_999).optional(),
    category: z.string().trim().min(1).max(128).optional(),
    reorder_point: z.number().int().min(0).max(1_000_000).optional(),
  }),
  'inventory.adjust': z.object({
    sku: z.string().trim().min(1).max(64),
    location_code: z.string().trim().min(1).max(32),
    delta: z.number().int().refine((n) => n !== 0, 'delta must not be zero'),
    reason: z.string().trim().max(200).optional(),
  }),
} as const;
export type InboundEventType = keyof typeof inboundPayloads;
