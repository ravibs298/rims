import type { PoolConnection } from 'mysql2/promise';
import { exec, one, query, withTx } from '../../db';
import { audit } from '../../audit';
import { conflict, notFound, unprocessable } from '../../errors';
import type { AuthUser } from '../../middleware/auth';
import { Where, pageParams, ref, round2 } from '../../utils';
import { assertLocation, scopeLocations } from '../auth/access';
import { applyStockChange } from '../inventory/stock';
import { enqueueOutbound } from '../integrations/outbox';
import { canTransition, OrderStatus } from './status';

async function history(c: PoolConnection, orderId: number, from: string | null, to: string, userId: number | null, note?: string) {
  await exec('INSERT INTO order_status_history (order_id, from_status, to_status, note, user_id) VALUES (?,?,?,?,?)', [orderId, from, to, note ?? null, userId], c);
}

export async function createOrder(user: AuthUser, input: any, ip: string | null) {
  assertLocation(user, input.location_id);
  const qty = new Map<number, number>();
  for (const it of input.items) qty.set(it.product_id, (qty.get(it.product_id) ?? 0) + it.quantity);
  const productIds = [...qty.keys()].sort((a, b) => a - b); // stable lock order => no deadlocks
  const orderId = await withTx(async (c) => {
    if (!(await one('SELECT id FROM locations WHERE id = ? AND is_active = 1', [input.location_id], c))) {
      throw unprocessable('INVALID_LOCATION', 'Location does not exist or is inactive');
    }
    const prods = await query<{ id: number; price: number }>('SELECT id, price FROM products WHERE is_active = 1 AND id IN (?)', [productIds], c);
    if (prods.length !== productIds.length) throw unprocessable('INVALID_PRODUCT', 'One or more products do not exist or are inactive');
    const price = new Map(prods.map((p) => [p.id, p.price]));
    const total = round2(productIds.reduce((s, pid) => s + price.get(pid)! * qty.get(pid)!, 0));
    const o = await exec(
      `INSERT INTO orders (order_number, customer_name, customer_email, location_id, status, shipping_address, total_amount, created_by)
       VALUES (?,?,?,?, 'reserved', ?,?,?)`,
      [ref('ORD'), input.customer_name, input.customer_email ?? null, input.location_id, input.shipping_address ?? null, total, user.id],
      c,
    );
    for (const pid of productIds) {
      const q = qty.get(pid)!;
      await exec('INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?,?,?,?)', [o.insertId, pid, q, price.get(pid)], c);
      // Reserves available stock or throws INSUFFICIENT_STOCK; the whole transaction then rolls back.
      await applyStockChange(c, { productId: pid, locationId: input.location_id, reservedDelta: q, type: 'reserve', refType: 'order', refId: o.insertId, reason: 'Order reservation', userId: user.id });
      await exec('INSERT INTO stock_reservations (order_id, product_id, location_id, quantity) VALUES (?,?,?,?)', [o.insertId, pid, input.location_id, q], c);
    }
    await history(c, o.insertId, null, 'reserved', user.id, 'Order created and stock reserved');
    await audit(user.id, 'order.created', 'order', o.insertId, { items: input.items, location_id: input.location_id }, ip, c);
    return o.insertId;
  });
  return getOrder(user, orderId);
}

export async function getOrder(user: AuthUser, id: number) {
  const o = await one<any>(
    `SELECT o.*, l.code AS location_code, l.name AS location_name FROM orders o JOIN locations l ON l.id = o.location_id WHERE o.id = ?`,
    [id],
  );
  if (!o) throw notFound('Order');
  assertLocation(user, o.location_id);
  const items = await query(
    `SELECT oi.id, oi.product_id, p.sku, p.name, oi.quantity, oi.picked_quantity, oi.unit_price
       FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ? ORDER BY oi.id`,
    [id],
  );
  const hist = await query(
    `SELECT h.from_status, h.to_status, h.note, u.email AS user_email, h.created_at
       FROM order_status_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.order_id = ? ORDER BY h.id`,
    [id],
  );
  const reservations = await query('SELECT product_id, quantity, status FROM stock_reservations WHERE order_id = ?', [id]);
  return { ...o, items, history: hist, reservations };
}

export async function listOrders(user: AuthUser, f: any) {
  const w = new Where().addIn('o.location_id', scopeLocations(user, f.location_id));
  if (f.status) w.add('o.status = ?', f.status);
  if (f.q) w.add('(o.order_number LIKE ? OR o.customer_name LIKE ?)', `%${f.q}%`, `%${f.q}%`);
  if (f.from) w.add('o.created_at >= ?', f.from);
  if (f.to) w.add('o.created_at < DATE_ADD(?, INTERVAL 1 DAY)', f.to);
  const { limit, offset } = pageParams(f.page, f.pageSize);
  const rows = await query(
    `SELECT o.id, o.order_number, o.customer_name, o.status, o.total_amount, o.location_id, l.code AS location_code,
            o.tracking_number, o.carrier, o.created_at, o.fulfilled_at, o.delivered_at
       FROM orders o JOIN locations l ON l.id = o.location_id ${w.sql} ORDER BY o.id DESC LIMIT ? OFFSET ?`,
    [...w.params, limit, offset],
  );
  const t = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM orders o ${w.sql}`, w.params);
  return { data: rows, page: f.page, pageSize: f.pageSize, total: t?.n ?? 0 };
}

async function lockOrder(c: PoolConnection, user: AuthUser, id: number) {
  const o = await one<any>('SELECT * FROM orders WHERE id = ? FOR UPDATE', [id], c);
  if (!o) throw notFound('Order');
  assertLocation(user, o.location_id);
  return o;
}

function assertTransition(from: OrderStatus, to: OrderStatus) {
  if (!canTransition(from, to)) throw conflict('INVALID_STATUS_TRANSITION', `Order cannot move from ${from} to ${to}`, { from, to });
}

/** Decrements on-hand and consumes reservations. Runs in the caller's transaction (also used by scan picking). */
export async function fulfillInTx(c: PoolConnection, user: AuthUser, orderId: number) {
  const o = await lockOrder(c, user, orderId);
  assertTransition(o.status, 'fulfilled');
  const items = await query<{ product_id: number; quantity: number }>('SELECT product_id, quantity FROM order_items WHERE order_id = ? ORDER BY product_id', [orderId], c);
  for (const it of items) {
    await applyStockChange(c, { productId: it.product_id, locationId: o.location_id, onHandDelta: -it.quantity, reservedDelta: -it.quantity, type: 'sale', refType: 'order', refId: orderId, reason: 'Order fulfillment', userId: user.id });
  }
  await exec("UPDATE stock_reservations SET status = 'fulfilled' WHERE order_id = ? AND status = 'active'", [orderId], c);
  await exec('UPDATE order_items SET picked_quantity = quantity WHERE order_id = ?', [orderId], c);
  await exec("UPDATE orders SET status = 'fulfilled', fulfilled_at = NOW(3) WHERE id = ?", [orderId], c);
  await history(c, orderId, o.status, 'fulfilled', user.id, 'Stock decremented');
  await audit(user.id, 'order.fulfilled', 'order', orderId, undefined, null, c);
  await enqueueOutbound(c, 'order.fulfilled', { order_id: orderId, order_number: o.order_number, location_id: o.location_id, items }, `order.fulfilled:${orderId}`);
}

export async function fulfill(user: AuthUser, id: number) {
  await withTx((c) => fulfillInTx(c, user, id));
  return getOrder(user, id);
}

export async function cancel(user: AuthUser, id: number, reason: string, ip: string | null) {
  await withTx(async (c) => {
    const o = await lockOrder(c, user, id);
    assertTransition(o.status, 'cancelled');
    const rs = await query<{ product_id: number; quantity: number }>(
      "SELECT product_id, quantity FROM stock_reservations WHERE order_id = ? AND status = 'active' ORDER BY product_id",
      [id],
      c,
    );
    for (const r of rs) {
      await applyStockChange(c, { productId: r.product_id, locationId: o.location_id, reservedDelta: -r.quantity, type: 'release', refType: 'order', refId: id, reason: `Order cancelled: ${reason}`, userId: user.id });
    }
    await exec("UPDATE stock_reservations SET status = 'released' WHERE order_id = ? AND status = 'active'", [id], c);
    await exec("UPDATE orders SET status = 'cancelled', cancel_reason = ? WHERE id = ?", [reason, id], c);
    await history(c, id, o.status, 'cancelled', user.id, reason);
    await audit(user.id, 'order.cancelled', 'order', id, { reason }, ip, c);
  });
  return getOrder(user, id);
}

export async function ship(user: AuthUser, id: number, carrier: string, tracking: string, ip: string | null) {
  await withTx(async (c) => {
    const o = await lockOrder(c, user, id);
    assertTransition(o.status, 'shipped');
    await exec("UPDATE orders SET status = 'shipped', carrier = ?, tracking_number = ?, shipped_at = NOW(3) WHERE id = ?", [carrier, tracking, id], c);
    await history(c, id, o.status, 'shipped', user.id, `${carrier} ${tracking}`);
    await audit(user.id, 'order.shipped', 'order', id, { carrier, tracking }, ip, c);
  });
  return getOrder(user, id);
}

export async function deliver(user: AuthUser, id: number, ip: string | null) {
  await withTx(async (c) => {
    const o = await lockOrder(c, user, id);
    assertTransition(o.status, 'delivered');
    await exec("UPDATE orders SET status = 'delivered', delivered_at = NOW(3) WHERE id = ?", [id], c);
    await history(c, id, o.status, 'delivered', user.id);
    await audit(user.id, 'order.delivered', 'order', id, undefined, ip, c);
  });
  return getOrder(user, id);
}
