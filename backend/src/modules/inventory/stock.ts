import type { PoolConnection } from 'mysql2/promise';
import { conflict, notFound } from '../../errors';

export type MovementType = 'receipt' | 'adjustment' | 'transfer_in' | 'transfer_out' | 'sale' | 'count' | 'reserve' | 'release';

export interface StockChange {
  productId: number;
  locationId: number;
  onHandDelta?: number;
  reservedDelta?: number;
  type: MovementType;
  refType?: string;
  refId?: string | number;
  reason?: string;
  userId?: number | null;
}

/**
 * Locks (and lazily creates) the balance row. Locks FIRST and only inserts when the row is missing:
 * INSERT IGNORE on an existing row takes a shared lock, and two writers upgrading it to exclusive deadlock.
 */
export async function lockBalance(c: PoolConnection, productId: number, locationId: number): Promise<{ on_hand: number; reserved: number } | undefined> {
  const sel = 'SELECT on_hand, reserved FROM inventory_balances WHERE product_id = ? AND location_id = ? FOR UPDATE';
  let [rows]: any = await c.query(sel, [productId, locationId]);
  if (!rows[0]) {
    await c.query('INSERT IGNORE INTO inventory_balances (product_id, location_id) VALUES (?, ?)', [productId, locationId]);
    [rows] = await c.query(sel, [productId, locationId]);
  }
  return rows[0];
}

/**
 * THE single entry point for changing stock. Must be called inside a transaction.
 * Locks the balance row (SELECT ... FOR UPDATE), enforces on_hand >= 0 and reserved <= on_hand
 * (the available-stock rule that prevents overselling), updates the balance and appends
 * exactly one row to the inventory_movements ledger.
 */
export async function applyStockChange(c: PoolConnection, ch: StockChange) {
  const od = ch.onHandDelta ?? 0;
  const rd = ch.reservedDelta ?? 0;
  const b = await lockBalance(c, ch.productId, ch.locationId);
  if (!b) throw notFound('Product or location');
  const onHand = b.on_hand + od;
  const reserved = b.reserved + rd;
  if (onHand < 0 || reserved < 0 || reserved > onHand) {
    throw conflict('INSUFFICIENT_STOCK', 'Insufficient available stock for this operation', {
      product_id: ch.productId,
      location_id: ch.locationId,
      on_hand: b.on_hand,
      reserved: b.reserved,
      available: b.on_hand - b.reserved,
      requested_on_hand_delta: od,
      requested_reserved_delta: rd,
    });
  }
  await c.query('UPDATE inventory_balances SET on_hand = ?, reserved = ? WHERE product_id = ? AND location_id = ?', [
    onHand,
    reserved,
    ch.productId,
    ch.locationId,
  ]);
  await c.query(
    `INSERT INTO inventory_movements
       (product_id, location_id, movement_type, on_hand_delta, reserved_delta, on_hand_after, reserved_after, reference_type, reference_id, reason, user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [ch.productId, ch.locationId, ch.type, od, rd, onHand, reserved, ch.refType ?? null, ch.refId === undefined ? null : String(ch.refId), ch.reason ?? null, ch.userId ?? null],
  );
  return { onHand, reserved, available: onHand - reserved };
}
