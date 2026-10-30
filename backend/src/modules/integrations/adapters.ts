import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';

export type AdapterType = 'erp' | 'accounting' | 'webhook';

/**
 * Adapter = how RIMS talks to a class of external system. Each adapter only knows the default
 * endpoint path; real vendor mappings are set per-config via config_json.path / config_json.events.
 * No adapter ever reports success without an actual HTTP 2xx from the remote system.
 */
export interface Adapter {
  type: AdapterType;
  defaultPath: string;
  defaultHealthPath: string;
}

export const adapters: Record<AdapterType, Adapter> = {
  erp: { type: 'erp', defaultPath: '/rims/events', defaultHealthPath: '/health' },
  accounting: { type: 'accounting', defaultPath: '/rims/ledger-events', defaultHealthPath: '/health' },
  webhook: { type: 'webhook', defaultPath: '', defaultHealthPath: '' },
};

/** Credentials are only ever read from the environment, by the NAME stored in secret_ref. */
export const credential = (secretRef?: string | null): string | undefined => (secretRef ? process.env[secretRef] || undefined : undefined);

export function sign(secret: string, body: Buffer | string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function verifySignature(secret: string, body: Buffer | undefined, header: string | undefined): boolean {
  if (!body || !header) return false;
  const expected = Buffer.from(sign(secret, body), 'hex');
  let given: Buffer;
  try {
    given = Buffer.from(header.replace(/^sha256=/, ''), 'hex');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const rawBody = (req: Request): Buffer | undefined => (req as any).rawBody;
