import type { PoolConnection } from 'mysql2/promise';
import { exec, one, pool, query, withTx } from '../../db';
import { audit } from '../../audit';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../errors';
import type { AuthUser } from '../../middleware/auth';
import { assertLocation } from '../auth/access';
import { applyStockChange, lockBalance } from '../inventory/stock';
import { transferInTx } from '../inventory/service';
import { fulfillInTx } from '../orders/service';
import { receiveInTx } from '../suppliers/service';
import { getRfidAdapter } from './rfid';

interface ScanProduct { id: number; sku: string; name: string; price: number; is_active: number; matched_by: 'barcode' | 'rfid' | 'sku' }

export function normalizeIdentifier(type: 'barcode' | 'rfid', value: string, reader?: string) {
  return type === 'rfid' ? getRfidAdapter(reader).normalize(value) : value.trim();
}

async function logScan(userId: number, type: string, value: string, productId: number | null, action: string, locationId: number | null | undefined, qty: number | null, result: 'ok' | 'not_found' | 'error', message: string | null, db: any = pool) {
  await exec('INSERT INTO scan_events (id_type, value, product_id, action, location_id, quantity, result, message, user_id) VALUES (?,?,?,?,?,?,?,?,?)',
    [type, value, productId, action, locationId ?? null, qty, result, message, userId], db);
}

/** Resolves a barcode / RFID tag (or, for barcodes, a plain SKU) to a catalog product. */
export async function resolve(user: AuthUser, type: 'barcode' | 'rfid', value: string, reader?: string, record = true): Promise<ScanProduct> {
  const v = normalizeIdentifier(type, value, reader);
  let p = await one<any>(
    `SELECT p.id, p.sku, p.name, p.price, p.is_active FROM product_identifiers i JOIN products p ON p.id = i.product_id WHERE i.id_type = ? AND i.value = ?`,
    [type, v],
  );
  let matchedBy: ScanProduct['matched_by'] = type;
  if (!p && type === 'barcode') {
    p = await one<any>('SELECT id, sku, name, price, is_active FROM products WHERE sku = ?', [v]);
    matchedBy = 'sku';
  }
  if (!p) {
    if (record) await logScan(user.id, type, v, null, 'resolve', null, null, 'not_found', 'No catalog product for identifier');
    throw notFound('Product for this identifier');
  }
  if (record) await logScan(user.id, type, v, p.id, 'resolve', null, null, 'ok', null);
  return { ...p, matched_by: matchedBy };
}

function requireActionPermission(user: AuthUser, action: string, hasPo: boolean) {
  const needed = action === 'receive' ? (hasPo ? 'po.receive' : 'inventory.adjust') : action === 'count' ? 'inventory.adjust' : action === 'transfer' ? 'inventory.transfer' : 'orders.fulfill';
  if (!user.permissions.has(needed)) throw forbidden(`This action requires the ${needed} permission`);
}

async function execute(c: PoolConnection, user: AuthUser, p: ScanProduct, i: any, ip: string | null) {
  const refType = 'scan';
  switch (i.action) {
    case 'receive': {
      if (i.po_id) {
        const item = await one<any>('SELECT id FROM purchase_order_items WHERE po_id = ? AND product_id = ?', [i.po_id, p.id], c);
        if (!item) throw unprocessable('PRODUCT_NOT_ON_PO', 'Scanned product is not on this purchase order');
        const receiptId = await receiveInTx(c, user, i.po_id, [{ po_item_id: item.id, quantity: i.quantity }], 'Received via scan', ip);
        return { receipt_id: receiptId };
      }
      assertLocation(user, i.location_id);
      if (!p.is_active) throw unprocessable('INVALID_PRODUCT', 'Product is inactive');
      return applyStockChange(c, { productId: p.id, locationId: i.location_id, onHandDelta: i.quantity, type: 'receipt', refType, reason: 'Received via scan', userId: user.id });
    }
    case 'count': {
      assertLocation(user, i.location_id);
      if (!p.is_active) throw unprocessable('INVALID_PRODUCT', 'Product is inactive');
      const b = await lockBalance(c, p.id, i.location_id);
      if (!b) throw notFound('Inventory balance');
      const delta = i.quantity - b.on_hand;
      if (delta === 0) return { on_hand: b.on_hand, reserved: b.reserved, available: b.on_hand - b.reserved, variance: 0 };
      const r = await applyStockChange(c, { productId: p.id, locationId: i.location_id, onHandDelta: delta, type: 'count', refType, reason: `Stock count: counted ${i.quantity}, system ${b.on_hand}`, userId: user.id });
      return { ...r, variance: delta };
    }
    case 'transfer':
      return transferInTx(c, user, { product_id: p.id, from_location_id: i.location_id, to_location_id: i.to_location_id, quantity: i.quantity, note: 'Transferred via scan' }, ip);
    case 'fulfill': {
      const order = await one<any>('SELECT id, status, location_id FROM orders WHERE id = ? FOR UPDATE', [i.order_id], c);
      if (!order) throw notFound('Order');
      assertLocation(user, order.location_id);
      if (order.status !== 'reserved') throw conflict('INVALID_STATUS', `Order is ${order.status}; only reserved orders can be picked`);
      const item = await one<any>('SELECT id, quantity, picked_quantity FROM order_items WHERE order_id = ? AND product_id = ? FOR UPDATE', [i.order_id, p.id], c);
      if (!item) throw unprocessable('PRODUCT_NOT_ON_ORDER', 'Scanned product is not on this order');
      if (item.picked_quantity + i.quantity > item.quantity) throw conflict('OVER_PICK', 'Picked quantity would exceed ordered quantity', { ordered: item.quantity, picked: item.picked_quantity });
      await exec('UPDATE order_items SET picked_quantity = picked_quantity + ? WHERE id = ?', [i.quantity, item.id], c);
      const open = await one<{ n: number }>('SELECT COUNT(*) AS n FROM order_items WHERE order_id = ? AND picked_quantity < quantity', [i.order_id], c);
      const complete = (open?.n ?? 0) === 0;
      if (complete) await fulfillInTx(c, user, i.order_id);
      return { picked: item.picked_quantity + i.quantity, ordered: item.quantity, order_fulfilled: complete };
    }
  }
}

export async function runAction(user: AuthUser, i: any, ip: string | null) {
  requireActionPermission(user, i.action, Boolean(i.po_id));
  const p = await resolve(user, i.id_type, i.value, i.reader, false).catch(async (e) => {
    if (e instanceof AppError && e.status === 404) await logScan(user.id, i.id_type, i.value, null, i.action, i.location_id, i.quantity, 'not_found', 'No catalog product for identifier');
    throw e;
  });
  const value = normalizeIdentifier(i.id_type, i.value, i.reader);
  try {
    const result = await withTx(async (c) => {
      const r = await execute(c, user, p, i, ip);
      await logScan(user.id, i.id_type, value, p.id, i.action, i.location_id, i.quantity, 'ok', null, c);
      await audit(user.id, `scan.${i.action}`, 'product', p.id, { id_type: i.id_type, quantity: i.quantity, location_id: i.location_id, order_id: i.order_id, po_id: i.po_id }, ip, c);
      return r;
    });
    return { product: p, action: i.action, result };
  } catch (e: any) {
    await logScan(user.id, i.id_type, value, p.id, i.action, i.location_id, i.quantity, 'error', String(e?.message ?? e).slice(0, 255)).catch(() => undefined);
    throw e;
  }
}

export const recentScans = () =>
  query(`SELECT s.id, s.id_type, s.value, p.sku, s.action, s.location_id, s.quantity, s.result, s.message, u.email AS user_email, s.created_at
           FROM scan_events s LEFT JOIN products p ON p.id = s.product_id LEFT JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 50`);

// ----- identifier management -----
export async function addIdentifier(user: AuthUser, productId: number, type: 'barcode' | 'rfid', value: string, ip: string | null) {
  const v = normalizeIdentifier(type, value);
  return withTx(async (c) => {
    if (!(await one('SELECT id FROM products WHERE id = ?', [productId], c))) throw notFound('Product');
    const r = await exec('INSERT INTO product_identifiers (product_id, id_type, value) VALUES (?,?,?)', [productId, type, v], c);
    await audit(user.id, 'identifier.added', 'product', productId, { id_type: type, value: v }, ip, c);
    return { id: r.insertId, product_id: productId, id_type: type, value: v };
  });
}
export const listIdentifiers = (productId: number) => query('SELECT id, id_type, value, created_at FROM product_identifiers WHERE product_id = ? ORDER BY id', [productId]);
export async function removeIdentifier(user: AuthUser, productId: number, identifierId: number, ip: string | null) {
  await withTx(async (c) => {
    const r = await exec('DELETE FROM product_identifiers WHERE id = ? AND product_id = ?', [identifierId, productId], c);
    if (!r.affectedRows) throw notFound('Identifier');
    await audit(user.id, 'identifier.removed', 'product', productId, { identifier_id: identifierId }, ip, c);
  });
}
