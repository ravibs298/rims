import { exec, Db, pool } from './db';

export async function audit(
  userId: number | null,
  action: string,
  entityType: string,
  entityId: string | number | null,
  details?: unknown,
  ip?: string | null,
  db: Db = pool,
) {
  await exec(
    'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip) VALUES (?,?,?,?,?,?)',
    [userId, action, entityType, entityId === null ? null : String(entityId), details ? JSON.stringify(details) : null, ip ?? null],
    db,
  );
}
