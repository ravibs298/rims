import mysql from 'mysql2/promise';
import type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { config } from './config';

export type Db = Pool | PoolConnection;

export const pool: Pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  decimalNumbers: true,
  charset: 'utf8mb4',
  timezone: 'Z',
});

// Make every pooled connection use UTC so NOW(), DATE() and comparisons are consistent.
(pool as any).pool.on('connection', (conn: any) => conn.query("SET time_zone = '+00:00'"));

/** All SQL goes through parameterized placeholders (?). Never concatenate user input. */
export async function query<T = any>(sql: string, params: any[] = [], db: Db = pool): Promise<T[]> {
  const [rows] = await db.query(sql, params);
  return rows as T[];
}

export async function one<T = any>(sql: string, params: any[] = [], db: Db = pool): Promise<T | undefined> {
  return (await query<T>(sql, params, db))[0];
}

export async function exec(sql: string, params: any[] = [], db: Db = pool): Promise<ResultSetHeader> {
  const [res] = await db.query(sql, params);
  return res as ResultSetHeader;
}

/** Runs fn in a transaction; retries on deadlock (up to 3 attempts). */
export async function withTx<T>(fn: (c: PoolConnection) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const result = await fn(c);
      await c.commit();
      return result;
    } catch (err: any) {
      await c.rollback().catch(() => undefined);
      if (err?.code === 'ER_LOCK_DEADLOCK' && attempt < 3) continue;
      throw err;
    } finally {
      c.release();
    }
  }
}

export async function closePool() {
  await pool.end();
}
