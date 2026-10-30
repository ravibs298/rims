import type { PoolConnection } from 'mysql2/promise';
import { exec, one, query, withTx } from '../../db';
import { audit } from '../../audit';
import { notFound, unprocessable } from '../../errors';
import type { AuthUser } from '../../middleware/auth';
import { Where, pageParams } from '../../utils';
import { assertLocation, scopeLocations } from '../auth/access';
import { applyStockChange } from './stock';

async function assertActiveProductAndLocation(c: PoolConnection, productId: number, locationId: number) {
  const p = await one('SELECT id FROM products WHERE id = ? AND is_active = 1', [productId], c);
  if (!p) throw unprocessable('INVALID_PRODUCT', 'Product does not exist or is inactive');
  const l = await one('SELECT id FROM locations WHERE id = ? AND is_active = 1', [locationId], c);
  if (!l) throw unprocessable('INVALID_LOCATION', 'Location does not exist or is inactive');
}

export async function adjust(user: AuthUser, i: { product_id: number; location_id: number; delta: number; reason: string }, ip: string | null) {
  assertLocation(user, i.location_id);
  return withTx(async (c) => {
    await assertActiveProductAndLocation(c, i.product_id, i.location_id);
    const r = await applyStockChange(c, {
      productId: i.product_id, locationId: i.location_id, onHandDelta: i.delta, type: 'adjustment',
      refType: 'adjustment', reason: i.reason, userId: user.id,
    });
    await audit(user.id, 'inventory.adjusted', 'product', i.product_id, i, ip, c);
    return { product_id: i.product_id, location_id: i.location_id, on_hand: r.onHand, reserved: r.reserved, available: r.available };
  });
}

export async function receive(user: AuthUser, i: { product_id: number; location_id: number; quantity: number; reason: string }, ip: string | null) {
  assertLocation(user, i.location_id);
  return withTx(async (c) => {
    await assertActiveProductAndLocation(c, i.product_id, i.location_id);
    const r = await applyStockChange(c, {
      productId: i.product_id, locationId: i.location_id, onHandDelta: i.quantity, type: 'receipt',
      refType: 'manual_receipt', reason: i.reason, userId: user.id,
    });
    await audit(user.id, 'inventory.received', 'product', i.product_id, i, ip, c);
    return { product_id: i.product_id, location_id: i.location_id, on_hand: r.onHand, reserved: r.reserved, available: r.available };
  });
}

/** Runs inside the caller's transaction (also used by the scan workflow). */
export async function transferInTx(
  c: PoolConnection,
  user: AuthUser,
  i: { product_id: number; from_location_id: number; to_location_id: number; quantity: number; note?: string },
  ip: string | null,
) {
  assertLocation(user, i.from_location_id);
  if (i.from_location_id === i.to_location_id) throw unprocessable('SAME_LOCATION', 'Source and destination must differ');
  await assertActiveProductAndLocation(c, i.product_id, i.from_location_id);
  await assertActiveProductAndLocation(c, i.product_id, i.to_location_id);
  const t = await exec(
    'INSERT INTO stock_transfers (product_id, from_location_id, to_location_id, quantity, note, created_by) VALUES (?,?,?,?,?,?)',
    [i.product_id, i.from_location_id, i.to_location_id, i.quantity, i.note ?? null, user.id],
    c,
  );
  // Lock balances in a stable (location id) order so opposing transfers cannot deadlock.
  const ops = [
    { loc: i.from_location_id, delta: -i.quantity, type: 'transfer_out' as const },
    { loc: i.to_location_id, delta: i.quantity, type: 'transfer_in' as const },
  ].sort((a, b) => a.loc - b.loc);
  for (const op of ops) {
    await applyStockChange(c, {
      productId: i.product_id, locationId: op.loc, onHandDelta: op.delta, type: op.type,
      refType: 'transfer', refId: t.insertId, reason: i.note ?? 'Stock transfer', userId: user.id,
    });
  }
  await audit(user.id, 'inventory.transferred', 'transfer', t.insertId, i, ip, c);
  return { id: t.insertId, ...i, status: 'completed' };
}

export const transfer = (user: AuthUser, i: any, ip: string | null) => withTx((c) => transferInTx(c, user, i, ip));

export async function balances(user: AuthUser, f: any) {
  const w = new Where().addIn('b.location_id', scopeLocations(user, f.location_id));
  if (f.product_id) w.add('b.product_id = ?', f.product_id);
  if (f.category_id) w.add('p.category_id = ?', f.category_id);
  if (f.low_stock === 'true') w.add('p.is_active = 1 AND (b.on_hand - b.reserved) <= p.reorder_point');
  const { limit, offset } = pageParams(f.page, f.pageSize);
  const from = `FROM inventory_balances b JOIN products p ON p.id = b.product_id
                JOIN locations l ON l.id = b.location_id LEFT JOIN categories c ON c.id = p.category_id ${w.sql}`;
  const rows = await query(
    `SELECT b.product_id, p.sku, p.name, c.name AS category_name, b.location_id, l.code AS location_code, l.name AS location_name,
            b.on_hand, b.reserved, (b.on_hand - b.reserved) AS available, p.reorder_point, p.cost, (b.on_hand * p.cost) AS value
     ${from} ORDER BY p.name, l.code LIMIT ? OFFSET ?`,
    [...w.params, limit, offset],
  );
  const t = await one<{ n: number }>(`SELECT COUNT(*) AS n ${from}`, w.params);
  return { data: rows, page: f.page, pageSize: f.pageSize, total: t?.n ?? 0 };
}

export async function lowStock(user: AuthUser, locationId?: number) {
  const w = new Where().addIn('b.location_id', scopeLocations(user, locationId));
  w.add('p.is_active = 1 AND (b.on_hand - b.reserved) <= p.reorder_point');
  return query(
    `SELECT b.product_id, p.sku, p.name, b.location_id, l.code AS location_code, b.on_hand, b.reserved,
            (b.on_hand - b.reserved) AS available, p.reorder_point,
            CASE WHEN (b.on_hand - b.reserved) <= 0 THEN 'stockout' ELSE 'low' END AS level
       FROM inventory_balances b JOIN products p ON p.id = b.product_id JOIN locations l ON l.id = b.location_id
       ${w.sql} ORDER BY available, p.name`,
    w.params,
  );
}

export async function valuation(user: AuthUser, f: { location_id?: number; category_id?: number }) {
  const w = new Where().addIn('b.location_id', scopeLocations(user, f.location_id));
  if (f.category_id) w.add('p.category_id = ?', f.category_id);
  const rows = await query(
    `SELECT l.id AS location_id, l.code, l.name, COALESCE(SUM(b.on_hand), 0) AS units, COALESCE(SUM(b.on_hand * p.cost), 0) AS value
       FROM inventory_balances b JOIN products p ON p.id = b.product_id JOIN locations l ON l.id = b.location_id
       ${w.sql} GROUP BY l.id, l.code, l.name ORDER BY l.code`,
    w.params,
  );
  // MySQL returns SUM() results as DECIMAL (strings in mysql2), so convert to numbers before adding.
  const byLocation = (rows as any[]).map((r) => ({ ...r, units: Number(r.units), value: Number(r.value) }));
  const total = byLocation.reduce(
    (s: { units: number; value: number }, r) => ({ units: s.units + r.units, value: s.value + r.value }),
    { units: 0, value: 0 },
  );
  return { method: 'on_hand x current unit cost', total: { units: total.units, value: Math.round(total.value * 100) / 100 }, by_location: byLocation };
}

export async function movements(user: AuthUser, f: any) {
  const w = new Where().addIn('m.location_id', scopeLocations(user, f.location_id));
  if (f.product_id) w.add('m.product_id = ?', f.product_id);
  if (f.type) w.add('m.movement_type = ?', f.type);
  if (f.from) w.add('m.created_at >= ?', f.from);
  if (f.to) w.add('m.created_at < DATE_ADD(?, INTERVAL 1 DAY)', f.to);
  const { limit, offset } = pageParams(f.page, f.pageSize);
  const from = `FROM inventory_movements m JOIN products p ON p.id = m.product_id JOIN locations l ON l.id = m.location_id
                LEFT JOIN users u ON u.id = m.user_id ${w.sql}`;
  const rows = await query(
    `SELECT m.id, m.product_id, p.sku, p.name, m.location_id, l.code AS location_code, m.movement_type, m.on_hand_delta, m.reserved_delta,
            m.on_hand_after, m.reserved_after, m.reference_type, m.reference_id, m.reason, u.email AS user_email, m.created_at
     ${from} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
    [...w.params, limit, offset],
  );
  const t = await one<{ n: number }>(`SELECT COUNT(*) AS n ${from}`, w.params);
  return { data: rows, page: f.page, pageSize: f.pageSize, total: t?.n ?? 0 };
}

export async function listTransfers(user: AuthUser) {
  const scope = user.locationIds;
  const w = new Where();
  if (scope !== null) {
    if (!scope.length) w.add('1=0');
    else w.add('(t.from_location_id IN (?) OR t.to_location_id IN (?))', scope, scope);
  }
  return query(
    `SELECT t.id, t.product_id, p.sku, p.name, lf.code AS from_code, lt.code AS to_code, t.quantity, t.note, t.status, t.created_at
       FROM stock_transfers t JOIN products p ON p.id = t.product_id JOIN locations lf ON lf.id = t.from_location_id
       JOIN locations lt ON lt.id = t.to_location_id ${w.sql} ORDER BY t.id DESC LIMIT 200`,
    w.params,
  );
}

export async function listLocations(user: AuthUser) {
  const w = new Where().addIn('id', user.locationIds);
  return query(`SELECT id, code, name, type, address, is_active FROM locations ${w.sql} ORDER BY code`, w.params);
}

export async function createLocation(user: AuthUser, i: any, ip: string | null) {
  return withTx(async (c) => {
    const r = await exec('INSERT INTO locations (code, name, type, address) VALUES (?,?,?,?)', [i.code, i.name, i.type, i.address ?? null], c);
    await audit(user.id, 'location.created', 'location', r.insertId, i, ip, c);
    return one(`SELECT id, code, name, type, address, is_active FROM locations WHERE id = ?`, [r.insertId], c);
  });
}

export async function updateLocation(user: AuthUser, id: number, i: any, ip: string | null) {
  return withTx(async (c) => {
    if (!(await one('SELECT id FROM locations WHERE id = ? FOR UPDATE', [id], c))) throw notFound('Location');
    for (const col of ['code', 'name', 'type', 'address'] as const) {
      if (i[col] !== undefined) await exec(`UPDATE locations SET ${col} = ? WHERE id = ?`, [i[col], id], c);
    }
    if (i.is_active !== undefined) {
      if (i.is_active === false) {
        const stock = await one<{ n: number }>('SELECT COALESCE(SUM(on_hand), 0) AS n FROM inventory_balances WHERE location_id = ?', [id], c);
        if (stock && stock.n > 0) throw unprocessable('LOCATION_HAS_STOCK', 'Transfer all stock out before deactivating this location');
      }
      await exec('UPDATE locations SET is_active = ? WHERE id = ?', [i.is_active ? 1 : 0, id], c);
    }
    await audit(user.id, 'location.updated', 'location', id, i, ip, c);
    return one('SELECT id, code, name, type, address, is_active FROM locations WHERE id = ?', [id], c);
  });
}