import type { PoolConnection } from 'mysql2/promise';
import { query, exec } from '../../db';

/**
 * Transactional outbox: called inside the business transaction so an outbound event exists
 * if and only if the business change committed. Delivery happens later in the worker.
 * Only enabled outbound configs receive events; no config => nothing is queued.
 */
export async function enqueueOutbound(c: PoolConnection, eventType: string, payload: unknown, idempotencyKey: string) {
  const configs = await query<any>(
    "SELECT id, config_json FROM integration_configs WHERE enabled = 1 AND direction IN ('outbound','both')",
    [],
    c,
  );
  for (const cfg of configs) {
    const subscribed: string[] | undefined = cfg.config_json?.events;
    if (Array.isArray(subscribed) && !subscribed.includes(eventType)) continue;
    await exec(
      `INSERT IGNORE INTO integration_events (config_id, direction, event_type, idempotency_key, payload, status, next_attempt_at)
       VALUES (?, 'outbound', ?, ?, ?, 'pending', NOW(3))`,
      [cfg.id, eventType, idempotencyKey, JSON.stringify(payload)],
      c,
    );
  }
}
