import type { PoolConnection } from 'mysql2/promise';
import { ZodError } from 'zod';
import { config } from '../../config';
import { exec, one, query, withTx } from '../../db';
import { audit } from '../../audit';
import { AppError, badRequest, conflict, notFound, unauthorized, unprocessable } from '../../errors';
import { logger } from '../../logger';
import type { AuthUser } from '../../middleware/auth';
import { Where, pageParams } from '../../utils';
import { applyStockChange } from '../inventory/stock';
import { reconciliation } from '../reports/service';
import { adapters, credential, verifySignature } from './adapters';
import { computeBackoff, DeliveryError, isRetryableStatus } from './retry';
import { inboundPayloads, InboundEventType } from './schemas';

const publicConfig = (c: any) => ({
  ...c,
  enabled: Boolean(c.enabled),
  // Whether the credential env var is actually present. The secret itself is never returned.
  credential_present: Boolean(credential(c.secret_ref)),
});

async function log(configId: number | null, eventId: number | null, level: 'info' | 'warn' | 'error', message: string) {
  await exec('INSERT INTO integration_logs (config_id, event_id, level, message) VALUES (?,?,?,?)', [configId, eventId, level, message.slice(0, 1000)]);
}

// ---------------- configuration ----------------
function assertEnableable(c: any) {
  if (!c.enabled) return;
  if (['inbound', 'both'].includes(c.direction) && !c.secret_ref) throw unprocessable('INVALID_CONFIGURATION', 'Inbound integrations require secret_ref (used to verify HMAC signatures)');
  if (['outbound', 'both'].includes(c.direction) && (!c.base_url || !c.secret_ref)) throw unprocessable('INVALID_CONFIGURATION', 'Outbound integrations require base_url and secret_ref');
}

export async function listConfigs() {
  return (await query<any>('SELECT * FROM integration_configs ORDER BY name')).map(publicConfig);
}

export async function createConfig(user: AuthUser, i: any, ip: string | null) {
  assertEnableable(i);
  const id = await withTx(async (c) => {
    const r = await exec(
      'INSERT INTO integration_configs (name, adapter_type, direction, base_url, secret_ref, config_json, enabled, max_attempts, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
      [i.name, i.adapter_type, i.direction, i.base_url ?? null, i.secret_ref ?? null, i.config_json ? JSON.stringify(i.config_json) : null, i.enabled ? 1 : 0, i.max_attempts, user.id],
      c,
    );
    await audit(user.id, 'integration.config_created', 'integration', r.insertId, { name: i.name, enabled: i.enabled }, ip, c);
    return r.insertId;
  });
  return publicConfig(await one('SELECT * FROM integration_configs WHERE id = ?', [id]));
}

export async function updateConfig(user: AuthUser, id: number, i: any, ip: string | null) {
  await withTx(async (c) => {
    const cur = await one<any>('SELECT * FROM integration_configs WHERE id = ? FOR UPDATE', [id], c);
    if (!cur) throw notFound('Integration');
    const merged = { ...cur, ...i };
    assertEnableable(merged);
    for (const col of ['name', 'adapter_type', 'direction', 'base_url', 'secret_ref', 'max_attempts'] as const) {
      if (i[col] !== undefined) await exec(`UPDATE integration_configs SET ${col} = ? WHERE id = ?`, [i[col], id], c);
    }
    if (i.config_json !== undefined) await exec('UPDATE integration_configs SET config_json = ? WHERE id = ?', [i.config_json ? JSON.stringify(i.config_json) : null, id], c);
    if (i.enabled !== undefined) await exec('UPDATE integration_configs SET enabled = ? WHERE id = ?', [i.enabled ? 1 : 0, id], c);
    await audit(user.id, 'integration.config_updated', 'integration', id, i, ip, c);
  });
  return publicConfig(await one('SELECT * FROM integration_configs WHERE id = ?', [id]));
}

/** Performs a REAL request to the configured system. Never reports success without a 2xx response. */
export async function testConnection(user: AuthUser, id: number, ip: string | null) {
  const cfg = await one<any>('SELECT * FROM integration_configs WHERE id = ?', [id]);
  if (!cfg) throw notFound('Integration');
  const secret = credential(cfg.secret_ref);
  if (!cfg.base_url || !secret) {
    throw new AppError(503, 'INTEGRATION_NOT_CONFIGURED', 'base_url and the credential environment variable (secret_ref) must be configured before testing');
  }
  const adapter = adapters[cfg.adapter_type as keyof typeof adapters];
  const url = cfg.base_url.replace(/\/$/, '') + (cfg.config_json?.health_path ?? adapter.defaultHealthPath);
  let ok = false;
  let status: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(config.integrations.httpTimeoutMs) });
    status = res.status;
    ok = res.ok;
    if (!ok) error = `HTTP ${res.status}`;
  } catch (e: any) {
    error = e?.name === 'TimeoutError' ? 'Request timed out' : `Connection failed: ${e?.cause?.code ?? e?.message ?? 'unknown error'}`;
  }
  await log(id, null, ok ? 'info' : 'error', `Connection test ${ok ? 'succeeded' : 'failed'}: ${error ?? `HTTP ${status}`}`);
  await audit(user.id, 'integration.tested', 'integration', id, { ok, status }, ip);
  return { ok, status, error };
}

// ---------------- inbound handlers ----------------
type Handler = (c: PoolConnection, payload: any, eventId: number, cfgName: string) => Promise<void>;
const handlers: Record<InboundEventType, Handler> = {
  async 'product.upsert'(c, p, eventId) {
    let categoryId: number | null = null;
    if (p.category) {
      const cat = await one<{ id: number }>('SELECT id FROM categories WHERE name = ?', [p.category], c);
      categoryId = cat ? cat.id : (await exec('INSERT INTO categories (name) VALUES (?)', [p.category], c)).insertId;
    }
    // Full replacement of the listed fields; omitted optionals reset to defaults.
    await exec(
      `INSERT INTO products (sku, name, description, price, cost, category_id, reorder_point) VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), price = VALUES(price),
         cost = VALUES(cost), category_id = VALUES(category_id), reorder_point = VALUES(reorder_point)`,
      [p.sku, p.name, p.description ?? null, p.price, p.cost ?? 0, categoryId, p.reorder_point ?? 0],
      c,
    );
    await audit(null, 'integration.product_upserted', 'product', p.sku, { event_id: eventId }, null, c);
  },
  async 'inventory.adjust'(c, p, eventId, cfgName) {
    const prod = await one<{ id: number }>('SELECT id FROM products WHERE sku = ? AND is_active = 1', [p.sku], c);
    if (!prod) throw unprocessable('UNKNOWN_SKU', `No active product with SKU ${p.sku}`);
    const loc = await one<{ id: number }>('SELECT id FROM locations WHERE code = ? AND is_active = 1', [p.location_code], c);
    if (!loc) throw unprocessable('UNKNOWN_LOCATION', `No active location with code ${p.location_code}`);
    await applyStockChange(c, { productId: prod.id, locationId: loc.id, onHandDelta: p.delta, type: 'adjustment', refType: 'integration', refId: eventId, reason: p.reason ?? `Integration ${cfgName}`, userId: null });
    await audit(null, 'integration.inventory_adjusted', 'product', prod.id, { event_id: eventId, delta: p.delta }, null, c);
  },
};

// ---------------- event processing (shared by inbound + outbound) ----------------
async function sendOutbound(cfg: any, ev: any): Promise<number> {
  const secret = credential(cfg.secret_ref);
  if (!cfg.base_url || !secret) throw new DeliveryError('INTEGRATION_NOT_CONFIGURED: base_url or credential environment variable is missing', true);
  const adapter = adapters[cfg.adapter_type as keyof typeof adapters];
  const url = cfg.base_url.replace(/\/$/, '') + (cfg.config_json?.path ?? adapter.defaultPath);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, 'Idempotency-Key': ev.idempotency_key },
      body: JSON.stringify({ event_type: ev.event_type, idempotency_key: ev.idempotency_key, payload: ev.payload }),
      signal: AbortSignal.timeout(config.integrations.httpTimeoutMs),
    });
  } catch (e: any) {
    throw new DeliveryError(e?.name === 'TimeoutError' ? 'Request timed out' : `Network error: ${e?.cause?.code ?? e?.message}`, true);
  }
  if (!res.ok) throw new DeliveryError(`Remote system responded HTTP ${res.status}`, isRetryableStatus(res.status), res.status);
  return res.status;
}

function classify(err: any): { retryable: boolean; message: string; status?: number } {
  if (err instanceof DeliveryError) return { retryable: err.retryable, message: err.message, status: err.status };
  if (err instanceof ZodError) return { retryable: false, message: 'Invalid payload: ' + err.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ') };
  if (err instanceof AppError) return { retryable: err.status >= 500, message: `${err.code}: ${err.message}` };
  if (['ER_DUP_ENTRY', 'ER_CHECK_CONSTRAINT_VIOLATED'].includes(err?.code)) return { retryable: false, message: `Data constraint violated (${err.code})` };
  return { retryable: true, message: String(err?.message ?? err) };
}

/** Claims the event (guards against concurrent workers), executes it, and records the outcome. */
export async function processEvent(eventId: number) {
  const claim = await exec("UPDATE integration_events SET status = 'processing', attempts = attempts + 1 WHERE id = ? AND status IN ('pending','failed')", [eventId]);
  if (!claim.affectedRows) return getEvent(eventId);
  const ev = await one<any>('SELECT e.*, c.max_attempts FROM integration_events e JOIN integration_configs c ON c.id = e.config_id WHERE e.id = ?', [eventId]);
  const cfg = await one<any>('SELECT * FROM integration_configs WHERE id = ?', [ev.config_id]);
  try {
    if (ev.direction === 'inbound') {
      const schema = inboundPayloads[ev.event_type as InboundEventType];
      if (!schema) throw new DeliveryError(`Unsupported event type ${ev.event_type}`, false);
      const payload = schema.parse(ev.payload);
      // Business change and event status commit atomically => exactly-once effect per idempotency key.
      await withTx(async (c) => {
        await handlers[ev.event_type as InboundEventType](c, payload, ev.id, cfg.name);
        await exec("UPDATE integration_events SET status = 'succeeded', processed_at = NOW(3), last_error = NULL WHERE id = ?", [ev.id], c);
      });
    } else {
      const status = await sendOutbound(cfg, ev);
      await exec("UPDATE integration_events SET status = 'succeeded', response_status = ?, processed_at = NOW(3), last_error = NULL WHERE id = ?", [status, ev.id]);
    }
    await log(cfg.id, ev.id, 'info', `${ev.direction} ${ev.event_type} succeeded (attempt ${ev.attempts})`);
  } catch (err: any) {
    const k = classify(err);
    const dead = !k.retryable || ev.attempts >= ev.max_attempts;
    const delay = computeBackoff(ev.attempts, config.integrations.backoffBaseMs, config.integrations.backoffMaxMs, 0.1);
    await exec(
      'UPDATE integration_events SET status = ?, last_error = ?, response_status = ?, next_attempt_at = ? WHERE id = ?',
      [dead ? 'dead' : 'failed', k.message.slice(0, 1000), k.status ?? null, dead ? null : new Date(Date.now() + delay), ev.id],
    );
    await log(cfg.id, ev.id, 'error', `${ev.direction} ${ev.event_type} ${dead ? 'DEAD' : 'failed, will retry'} (attempt ${ev.attempts}/${ev.max_attempts}): ${k.message}`);
    logger.warn('integration_event_failed', { eventId: ev.id, dead, message: k.message });
  }
  return getEvent(eventId);
}

/** Worker tick: recover stuck events, then process due pending/failed events. */
export async function processDue(limit = 20) {
  await exec("UPDATE integration_events SET status = 'failed', next_attempt_at = NOW(3), last_error = 'Recovered after interrupted processing' WHERE status = 'processing' AND updated_at < (NOW(3) - INTERVAL 5 MINUTE)");
  const due = await query<{ id: number }>(
    `SELECT e.id FROM integration_events e JOIN integration_configs c ON c.id = e.config_id
      WHERE e.status IN ('pending','failed') AND e.next_attempt_at IS NOT NULL AND e.next_attempt_at <= NOW(3) AND c.enabled = 1
      ORDER BY e.id LIMIT ?`,
    [limit],
  );
  const results = [];
  for (const d of due) results.push(await processEvent(d.id));
  return { processed: results.length, succeeded: results.filter((r: any) => r?.status === 'succeeded').length, results };
}

export async function retryEvent(user: AuthUser, id: number, ip: string | null) {
  const ev = await one<any>('SELECT status FROM integration_events WHERE id = ?', [id]);
  if (!ev) throw notFound('Event');
  if (!['failed', 'dead'].includes(ev.status)) throw conflict('INVALID_STATUS', `Only failed or dead events can be retried (current: ${ev.status})`);
  await exec("UPDATE integration_events SET status = 'failed', attempts = 0, next_attempt_at = NOW(3) WHERE id = ?", [id]);
  await audit(user.id, 'integration.event_retried', 'integration_event', id, undefined, ip);
  return processEvent(id);
}

// ---------------- inbound receive ----------------
export async function receiveInbound(name: string, raw: Buffer | undefined, signature: string | undefined, idemKey: string | undefined, envelope: { event_type: string; payload: any }) {
  const cfg = await one<any>('SELECT * FROM integration_configs WHERE name = ?', [name]);
  if (!cfg || !cfg.enabled || cfg.direction === 'outbound') throw notFound('Integration');
  const secret = credential(cfg.secret_ref);
  if (!secret) throw new AppError(503, 'INTEGRATION_NOT_CONFIGURED', 'The credential for this integration is not configured on the server');
  if (!verifySignature(secret, raw, signature)) {
    await log(cfg.id, null, 'warn', 'Rejected inbound request: invalid signature');
    throw unauthorized('INVALID_SIGNATURE', 'Invalid or missing X-Signature');
  }
  if (!idemKey || idemKey.length > 128) throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header (max 128 chars) is required');
  if (!(envelope.event_type in inboundPayloads)) throw unprocessable('UNSUPPORTED_EVENT', `Supported event types: ${Object.keys(inboundPayloads).join(', ')}`);

  // Validate before persisting so malformed messages are rejected with 422 and never become retryable work.
  const parsed = inboundPayloads[envelope.event_type as InboundEventType].safeParse(envelope.payload);
  if (!parsed.success) throw unprocessable('INVALID_PAYLOAD', 'Payload failed validation', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));

  const ins = await exec(
    "INSERT IGNORE INTO integration_events (config_id, direction, event_type, idempotency_key, payload, status, attempts) VALUES (?, 'inbound', ?, ?, ?, 'pending', 0)",
    [cfg.id, envelope.event_type, idemKey, JSON.stringify(envelope.payload)],
  );
  if (!ins.affectedRows) {
    const existing = await one<any>("SELECT id FROM integration_events WHERE config_id = ? AND direction = 'inbound' AND idempotency_key = ?", [cfg.id, idemKey]);
    await log(cfg.id, existing.id, 'info', `Duplicate inbound event ignored (Idempotency-Key ${idemKey})`);
    return { duplicate: true, event: await getEvent(existing.id) };
  }
  return { duplicate: false, event: await processEvent(ins.insertId) };
}

// ---------------- visibility ----------------
export async function getEvent(id: number) {
  return one('SELECT e.*, c.name AS config_name FROM integration_events e JOIN integration_configs c ON c.id = e.config_id WHERE e.id = ?', [id]);
}

export async function listEvents(f: any) {
  const w = new Where();
  if (f.config_id) w.add('e.config_id = ?', f.config_id);
  if (f.status) w.add('e.status = ?', f.status);
  if (f.direction) w.add('e.direction = ?', f.direction);
  const { limit, offset } = pageParams(f.page, f.pageSize);
  const rows = await query(
    `SELECT e.id, e.config_id, c.name AS config_name, e.direction, e.event_type, e.idempotency_key, e.status, e.attempts,
            e.next_attempt_at, e.last_error, e.response_status, e.created_at, e.processed_at
       FROM integration_events e JOIN integration_configs c ON c.id = e.config_id ${w.sql} ORDER BY e.id DESC LIMIT ? OFFSET ?`,
    [...w.params, limit, offset],
  );
  const t = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM integration_events e ${w.sql}`, w.params);
  return { data: rows, page: f.page, pageSize: f.pageSize, total: t?.n ?? 0 };
}

export const listLogs = (configId?: number) =>
  query(`SELECT id, config_id, event_id, level, message, created_at FROM integration_logs ${configId ? 'WHERE config_id = ?' : ''} ORDER BY id DESC LIMIT 200`, configId ? [configId] : []);

export async function status() {
  const configs = await query<any>('SELECT * FROM integration_configs ORDER BY name');
  const counts = await query<any>('SELECT config_id, status, COUNT(*) AS n FROM integration_events GROUP BY config_id, status');
  const last = await query<any>("SELECT config_id, MAX(processed_at) AS last_success_at FROM integration_events WHERE status = 'succeeded' GROUP BY config_id");
  const lastErr = await query<any>(
    "SELECT e.config_id, e.last_error, e.updated_at FROM integration_events e JOIN (SELECT config_id, MAX(id) AS id FROM integration_events WHERE last_error IS NOT NULL AND status IN ('failed','dead') GROUP BY config_id) m ON m.id = e.id",
  );
  return configs.map((c) => {
    const pc = publicConfig(c);
    const mine = counts.filter((x) => x.config_id === c.id);
    const needsBaseUrl = ['outbound', 'both'].includes(c.direction);
    const configured = pc.credential_present && (!needsBaseUrl || Boolean(c.base_url));
    return {
      id: c.id, name: c.name, adapter_type: c.adapter_type, direction: c.direction, enabled: pc.enabled,
      state: !pc.enabled ? 'disabled' : configured ? 'ready' : 'not_configured',
      credential_present: pc.credential_present,
      events: Object.fromEntries(mine.map((m) => [m.status, m.n])),
      last_success_at: last.find((l) => l.config_id === c.id)?.last_success_at ?? null,
      last_error: lastErr.find((l) => l.config_id === c.id)?.last_error ?? null,
    };
  });
}

/** Operational reconciliation: events vs. business records, plus ledger/balance integrity. */
export async function reconcile(user: AuthUser) {
  const stats = await query('SELECT direction, status, COUNT(*) AS n FROM integration_events GROUP BY direction, status');
  const inventoryWithoutMovement = await query(
    `SELECT e.id, e.config_id, e.idempotency_key FROM integration_events e
      WHERE e.direction = 'inbound' AND e.event_type = 'inventory.adjust' AND e.status = 'succeeded'
        AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.reference_type = 'integration' AND CAST(m.reference_id AS UNSIGNED) = e.id)`,
  );
  const movementsWithoutEvent = await query(
    `SELECT m.id, m.reference_id FROM inventory_movements m
      WHERE m.reference_type = 'integration'
        AND NOT EXISTS (SELECT 1 FROM integration_events e WHERE e.id = CAST(m.reference_id AS UNSIGNED) AND e.status = 'succeeded')`,
  );
  const stuck = await query("SELECT id, status, attempts, last_error FROM integration_events WHERE status IN ('failed','dead') ORDER BY id DESC LIMIT 50");
  const internal = await reconciliation(user);
  return {
    ok: inventoryWithoutMovement.length === 0 && movementsWithoutEvent.length === 0 && stuck.length === 0 && internal.ok,
    event_stats: stats,
    inbound_inventory_events_without_ledger_entry: inventoryWithoutMovement,
    integration_ledger_entries_without_succeeded_event: movementsWithoutEvent,
    failed_or_dead_events: stuck,
    internal_consistency: { ok: internal.ok },
  };
}

let running = false;
export function startWorker() {
  const t = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await processDue();
    } catch (e: any) {
      logger.error('integration_worker_error', { message: e?.message });
    } finally {
      running = false;
    }
  }, config.integrations.workerIntervalMs);
  t.unref();
  return () => clearInterval(t);
}
