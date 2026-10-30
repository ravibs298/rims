import type { PoolConnection } from 'mysql2/promise';
import { exec, one, query, withTx } from '../../db';
import { audit } from '../../audit';
import { conflict, notFound, unprocessable } from '../../errors';
import type { AuthUser } from '../../middleware/auth';
import { Where, pageParams, ref, round2 } from '../../utils';
import { assertLocation } from '../auth/access';
import { applyStockChange } from '../inventory/stock';
import { enqueueOutbound } from '../integrations/outbox';

// ---------- suppliers ----------
/**
 * Supplier performance, computed from purchase orders (excludes draft/cancelled):
 *  fill_rate = units received / units ordered; on_time_rate = POs fully received by expected_date / completed POs;
 *  avg_lead_days = approval -> completion.
 */
export async function supplierMetrics(opts: { supplierId?: number; from?: string; to?: string } = {}) {
  const joinConds = ["po.status NOT IN ('draft','cancelled')"];
  const params: any[] = [];
  if (opts.from) { joinConds.push('po.created_at >= ?'); params.push(opts.from); }
  if (opts.to) { joinConds.push('po.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(opts.to); }
  const where = opts.supplierId ? 'WHERE s.id = ?' : '';
  if (opts.supplierId) params.push(opts.supplierId);
  const rows = await query<any>(
    `SELECT s.id AS supplier_id, s.name,
            COUNT(po.id) AS po_count,
            COALESCE(SUM(po.status = 'received'), 0) AS completed_count,
            COALESCE(SUM(po.status = 'received' AND po.completed_at <= TIMESTAMP(po.expected_date, '23:59:59')), 0) AS on_time_count,
            COALESCE(SUM(t.ordered), 0) AS units_ordered,
            COALESCE(SUM(t.received), 0) AS units_received,
            AVG(CASE WHEN po.status = 'received' THEN TIMESTAMPDIFF(HOUR, po.approved_at, po.completed_at) / 24 END) AS avg_lead_days
       FROM suppliers s
       LEFT JOIN purchase_orders po ON po.supplier_id = s.id AND ${joinConds.join(' AND ')}
       LEFT JOIN (SELECT po_id, SUM(quantity_ordered) AS ordered, SUM(quantity_received) AS received FROM purchase_order_items GROUP BY po_id) t ON t.po_id = po.id
       ${where} GROUP BY s.id, s.name ORDER BY s.name`,
    params,
  );
  return rows.map((r) => ({
    ...r,
    fill_rate: r.units_ordered > 0 ? round2(r.units_received / r.units_ordered) : null,
    on_time_rate: r.completed_count > 0 ? round2(r.on_time_count / r.completed_count) : null,
    avg_lead_days: r.avg_lead_days === null ? null : round2(Number(r.avg_lead_days)),
  }));
}

export async function listSuppliers(active?: string) {
  const w = new Where();
  if (active) w.add('s.is_active = ?', active === 'true' ? 1 : 0);
  const rows = await query<any>(`SELECT s.* FROM suppliers s ${w.sql} ORDER BY s.name`, w.params);
  const metrics = new Map((await supplierMetrics()).map((m) => [m.supplier_id, m]));
  return rows.map((s) => ({ ...s, performance: metrics.get(s.id) ?? null }));
}

export async function getSupplier(id: number) {
  const s = await one<any>('SELECT * FROM suppliers WHERE id = ?', [id]);
  if (!s) throw notFound('Supplier');
  return { ...s, performance: (await supplierMetrics({ supplierId: id }))[0] ?? null };
}

export async function createSupplier(user: AuthUser, i: any, ip: string | null) {
  const id = await withTx(async (c) => {
    const r = await exec('INSERT INTO suppliers (name, contact_name, email, phone, address, lead_time_days) VALUES (?,?,?,?,?,?)',
      [i.name, i.contact_name ?? null, i.email ?? null, i.phone ?? null, i.address ?? null, i.lead_time_days], c);
    await audit(user.id, 'supplier.created', 'supplier', r.insertId, { name: i.name }, ip, c);
    return r.insertId;
  });
  return getSupplier(id);
}

export async function updateSupplier(user: AuthUser, id: number, i: any, ip: string | null) {
  await withTx(async (c) => {
    if (!(await one('SELECT id FROM suppliers WHERE id = ? FOR UPDATE', [id], c))) throw notFound('Supplier');
    for (const col of ['name', 'contact_name', 'email', 'phone', 'address', 'lead_time_days'] as const) {
      if (i[col] !== undefined) await exec(`UPDATE suppliers SET ${col} = ? WHERE id = ?`, [i[col], id], c);
    }
    if (i.is_active !== undefined) await exec('UPDATE suppliers SET is_active = ? WHERE id = ?', [i.is_active ? 1 : 0, id], c);
    await audit(user.id, 'supplier.updated', 'supplier', id, i, ip, c);
  });
  return getSupplier(id);
}

// ---------- purchase orders ----------
export async function createPO(user: AuthUser, i: any, ip: string | null) {
  assertLocation(user, i.location_id);
  const merged = new Map<number, { quantity: number; unit_cost?: number }>();
  for (const it of i.items) {
    const cur = merged.get(it.product_id);
    merged.set(it.product_id, { quantity: (cur?.quantity ?? 0) + it.quantity, unit_cost: it.unit_cost ?? cur?.unit_cost });
  }
  const ids = [...merged.keys()].sort((a, b) => a - b);
  const id = await withTx(async (c) => {
    if (!(await one('SELECT id FROM suppliers WHERE id = ? AND is_active = 1', [i.supplier_id], c))) throw unprocessable('INVALID_SUPPLIER', 'Supplier does not exist or is inactive');
    if (!(await one('SELECT id FROM locations WHERE id = ? AND is_active = 1', [i.location_id], c))) throw unprocessable('INVALID_LOCATION', 'Location does not exist or is inactive');
    const prods = await query<{ id: number; cost: number }>('SELECT id, cost FROM products WHERE is_active = 1 AND id IN (?)', [ids], c);
    if (prods.length !== ids.length) throw unprocessable('INVALID_PRODUCT', 'One or more products do not exist or are inactive');
    const cost = new Map(prods.map((p) => [p.id, p.cost]));
    const lines = ids.map((pid) => ({ pid, q: merged.get(pid)!.quantity, uc: merged.get(pid)!.unit_cost ?? cost.get(pid)! }));
    const total = round2(lines.reduce((s, l) => s + l.q * l.uc, 0));
    const po = await exec('INSERT INTO purchase_orders (po_number, supplier_id, location_id, expected_date, total_amount, notes, created_by) VALUES (?,?,?,?,?,?,?)',
      [ref('PO'), i.supplier_id, i.location_id, i.expected_date ?? null, total, i.notes ?? null, user.id], c);
    for (const l of lines) await exec('INSERT INTO purchase_order_items (po_id, product_id, quantity_ordered, unit_cost) VALUES (?,?,?,?)', [po.insertId, l.pid, l.q, l.uc], c);
    await audit(user.id, 'po.created', 'purchase_order', po.insertId, { supplier_id: i.supplier_id, total }, ip, c);
    return po.insertId;
  });
  return getPO(user, id);
}

export async function getPO(user: AuthUser, id: number) {
  const po = await one<any>(
    `SELECT po.*, s.name AS supplier_name, l.code AS location_code FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id JOIN locations l ON l.id = po.location_id WHERE po.id = ?`,
    [id],
  );
  if (!po) throw notFound('Purchase order');
  assertLocation(user, po.location_id);
  const items = await query(
    `SELECT i.id, i.product_id, p.sku, p.name, i.quantity_ordered, i.quantity_received, i.unit_cost
       FROM purchase_order_items i JOIN products p ON p.id = i.product_id WHERE i.po_id = ? ORDER BY i.id`,
    [id],
  );
  const receipts = await query('SELECT id, received_at, note FROM goods_receipts WHERE po_id = ? ORDER BY id', [id]);
  return { ...po, items, receipts };
}

export async function listPOs(user: AuthUser, f: any) {
  const w = new Where().addIn('po.location_id', user.locationIds);
  if (f.status) w.add('po.status = ?', f.status);
  if (f.supplier_id) w.add('po.supplier_id = ?', f.supplier_id);
  const { limit, offset } = pageParams(f.page, f.pageSize);
  const rows = await query(
    `SELECT po.id, po.po_number, po.status, po.total_amount, po.expected_date, po.created_at, s.name AS supplier_name, l.code AS location_code
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN locations l ON l.id = po.location_id
       ${w.sql} ORDER BY po.id DESC LIMIT ? OFFSET ?`,
    [...w.params, limit, offset],
  );
  const t = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM purchase_orders po ${w.sql}`, w.params);
  return { data: rows, page: f.page, pageSize: f.pageSize, total: t?.n ?? 0 };
}

async function lockPO(c: PoolConnection, user: AuthUser, id: number) {
  const po = await one<any>('SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE', [id], c);
  if (!po) throw notFound('Purchase order');
  assertLocation(user, po.location_id);
  return po;
}

export async function approvePO(user: AuthUser, id: number, ip: string | null) {
  await withTx(async (c) => {
    const po = await lockPO(c, user, id);
    if (po.status !== 'draft') throw conflict('INVALID_STATUS_TRANSITION', `Only draft purchase orders can be approved (current: ${po.status})`);
    await exec("UPDATE purchase_orders SET status = 'approved', approved_by = ?, approved_at = NOW(3) WHERE id = ?", [user.id, id], c);
    await audit(user.id, 'po.approved', 'purchase_order', id, undefined, ip, c);
  });
  return getPO(user, id);
}

export async function cancelPO(user: AuthUser, id: number, ip: string | null) {
  await withTx(async (c) => {
    const po = await lockPO(c, user, id);
    if (!['draft', 'approved'].includes(po.status)) throw conflict('INVALID_STATUS_TRANSITION', `Purchase order cannot be cancelled once ${po.status}`);
    await exec("UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?", [id], c);
    await audit(user.id, 'po.cancelled', 'purchase_order', id, undefined, ip, c);
  });
  return getPO(user, id);
}

/** Records goods received against PO lines, updating stock + ledger. Runs in the caller's transaction. */
export async function receiveInTx(c: PoolConnection, user: AuthUser, poId: number, lines: { po_item_id: number; quantity: number }[], note: string | undefined, ip: string | null) {
  const po = await lockPO(c, user, poId);
  if (!['approved', 'partially_received'].includes(po.status)) throw conflict('INVALID_STATUS', `Cannot receive goods for a ${po.status} purchase order`);
  const merged = new Map<number, number>();
  for (const l of lines) merged.set(l.po_item_id, (merged.get(l.po_item_id) ?? 0) + l.quantity);
  const items = await query<any>('SELECT id, product_id, quantity_ordered, quantity_received FROM purchase_order_items WHERE po_id = ? ORDER BY product_id FOR UPDATE', [poId], c);
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const [itemId, q] of merged) {
    const it = byId.get(itemId);
    if (!it) throw unprocessable('INVALID_PO_ITEM', `Item ${itemId} does not belong to this purchase order`);
    if (it.quantity_received + q > it.quantity_ordered) {
      throw conflict('OVER_RECEIPT', 'Received quantity exceeds the ordered quantity', { po_item_id: itemId, ordered: it.quantity_ordered, already_received: it.quantity_received, attempted: q });
    }
  }
  const gr = await exec('INSERT INTO goods_receipts (po_id, location_id, received_by, note) VALUES (?,?,?,?)', [poId, po.location_id, user.id, note ?? null], c);
  for (const it of items) {
    const q = merged.get(it.id);
    if (!q) continue;
    await exec('INSERT INTO goods_receipt_items (receipt_id, po_item_id, product_id, quantity) VALUES (?,?,?,?)', [gr.insertId, it.id, it.product_id, q], c);
    await exec('UPDATE purchase_order_items SET quantity_received = quantity_received + ? WHERE id = ?', [q, it.id], c);
    await applyStockChange(c, { productId: it.product_id, locationId: po.location_id, onHandDelta: q, type: 'receipt', refType: 'goods_receipt', refId: gr.insertId, reason: `Received against ${po.po_number}`, userId: user.id });
  }
  const open = await one<{ n: number }>('SELECT COUNT(*) AS n FROM purchase_order_items WHERE po_id = ? AND quantity_received < quantity_ordered', [poId], c);
  const done = (open?.n ?? 0) === 0;
  await exec('UPDATE purchase_orders SET status = ?, completed_at = ? WHERE id = ?', [done ? 'received' : 'partially_received', done ? new Date() : null, poId], c);
  await audit(user.id, 'po.received', 'purchase_order', poId, { receipt_id: gr.insertId, lines: [...merged] }, ip, c);
  await enqueueOutbound(c, 'goods.received', { po_id: poId, po_number: po.po_number, receipt_id: gr.insertId, location_id: po.location_id, lines: [...merged].map(([po_item_id, quantity]) => ({ po_item_id, quantity })) }, `goods.received:${gr.insertId}`);
  return gr.insertId;
}

export async function receivePO(user: AuthUser, id: number, body: { items: { po_item_id: number; quantity: number }[]; note?: string }, ip: string | null) {
  await withTx((c) => receiveInTx(c, user, id, body.items, body.note, ip));
  return getPO(user, id);
}
