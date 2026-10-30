import { one, query } from '../../db';
import type { AuthUser } from '../../middleware/auth';
import { Where, round2 } from '../../utils';
import { scopeLocations } from '../auth/access';
import { supplierMetrics } from '../suppliers/service';

export interface ReportFilter { from?: string; to?: string; location_id?: number; category_id?: number; product_id?: number }

function orderWhere(user: AuthUser, f: ReportFilter) {
  const w = new Where().addIn('o.location_id', scopeLocations(user, f.location_id));
  if (f.from) w.add('o.created_at >= ?', f.from);
  if (f.to) w.add('o.created_at < DATE_ADD(?, INTERVAL 1 DAY)', f.to);
  if (f.product_id || f.category_id) {
    const conds: string[] = [];
    const params: any[] = [];
    if (f.product_id) { conds.push('oi.product_id = ?'); params.push(f.product_id); }
    if (f.category_id) { conds.push('p.category_id = ?'); params.push(f.category_id); }
    w.add(`EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id AND ${conds.join(' AND ')})`, ...params);
  }
  return w;
}

function balanceWhere(user: AuthUser, f: ReportFilter) {
  const w = new Where().addIn('b.location_id', scopeLocations(user, f.location_id));
  if (f.product_id) w.add('b.product_id = ?', f.product_id);
  if (f.category_id) w.add('p.category_id = ?', f.category_id);
  return w;
}

/** Per-product stock across the filtered locations. */
export async function inventoryLevels(user: AuthUser, f: ReportFilter) {
  const w = balanceWhere(user, f);
  return query(
    `SELECT p.id AS product_id, p.sku, p.name, c.name AS category_name, p.reorder_point, p.is_active,
            SUM(b.on_hand) AS on_hand, SUM(b.reserved) AS reserved, SUM(b.on_hand - b.reserved) AS available,
            SUM(b.on_hand * p.cost) AS value,
            CASE WHEN SUM(b.on_hand - b.reserved) <= 0 THEN 'stockout'
                 WHEN SUM(b.on_hand - b.reserved) <= p.reorder_point THEN 'low' ELSE 'ok' END AS status
       FROM inventory_balances b JOIN products p ON p.id = b.product_id LEFT JOIN categories c ON c.id = p.category_id
       ${w.sql} GROUP BY p.id, p.sku, p.name, c.name, p.reorder_point, p.is_active ORDER BY p.name`,
    w.params,
  );
}

export async function inventorySummary(user: AuthUser, f: ReportFilter) {
  const w = balanceWhere(user, f);
  const r = await one<any>(
    `SELECT COALESCE(SUM(b.on_hand), 0) AS on_hand, COALESCE(SUM(b.reserved), 0) AS reserved,
            COALESCE(SUM(b.on_hand * p.cost), 0) AS valuation,
            COALESCE(SUM(p.is_active = 1 AND (b.on_hand - b.reserved) > 0 AND (b.on_hand - b.reserved) <= p.reorder_point), 0) AS low_stock_count,
            COALESCE(SUM(p.is_active = 1 AND (b.on_hand - b.reserved) <= 0), 0) AS stockout_count,
            COUNT(*) AS stocked_lines
       FROM inventory_balances b JOIN products p ON p.id = b.product_id ${w.sql}`,
    w.params,
  );
  return { ...r, available: r.on_hand - r.reserved, valuation: round2(r.valuation) };
}

export async function fulfillment(user: AuthUser, f: ReportFilter) {
  const w = orderWhere(user, f);
  const r = await one<any>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(o.status IN ('fulfilled','shipped','delivered')), 0) AS fulfilled,
            COALESCE(SUM(o.status = 'cancelled'), 0) AS cancelled, COALESCE(SUM(o.status = 'reserved'), 0) AS open_orders,
            AVG(CASE WHEN o.fulfilled_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, o.created_at, o.fulfilled_at) END) / 60 AS avg_hours
       FROM orders o ${w.sql}`,
    w.params,
  );
  const byStatus = await query<{ status: string; n: number }>(`SELECT o.status, COUNT(*) AS n FROM orders o ${w.sql} GROUP BY o.status`, w.params);
  const eligible = r.total - r.cancelled;
  return {
    total_orders: r.total, fulfilled_orders: r.fulfilled, cancelled_orders: r.cancelled, open_orders: r.open_orders,
    fulfillment_rate: eligible > 0 ? round2(r.fulfilled / eligible) : null,
    avg_fulfillment_hours: r.avg_hours === null ? null : round2(Number(r.avg_hours)),
    by_status: Object.fromEntries(byStatus.map((s) => [s.status, s.n])),
  };
}

export async function salesTrend(user: AuthUser, f: ReportFilter) {
  const w = new Where().addIn('o.location_id', scopeLocations(user, f.location_id));
  w.add("o.status <> 'cancelled'");
  if (f.from) w.add('o.created_at >= ?', f.from);
  if (f.to) w.add('o.created_at < DATE_ADD(?, INTERVAL 1 DAY)', f.to);
  if (f.product_id) w.add('oi.product_id = ?', f.product_id);
  if (f.category_id) w.add('p.category_id = ?', f.category_id);
  const rows = await query<any>(
    `SELECT DATE_FORMAT(o.created_at, '%Y-%m-%d') AS day, COUNT(DISTINCT o.id) AS orders, SUM(oi.quantity) AS units, SUM(oi.quantity * oi.unit_price) AS revenue
       FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
       ${w.sql} GROUP BY day ORDER BY day`,
    w.params,
  );
  const data = rows.map((r) => ({ ...r, revenue: round2(r.revenue) }));
  return { data, totals: { orders: data.reduce((s, r) => s + r.orders, 0), units: data.reduce((s, r) => s + r.units, 0), revenue: round2(data.reduce((s, r) => s + r.revenue, 0)) } };
}

export async function reconciliation(user: AuthUser, f: ReportFilter = {}) {
  const w = balanceWhere(user, f);
  const ledger = await query<any>(
    `SELECT * FROM (
       SELECT b.product_id, b.location_id, b.on_hand, b.reserved,
              COALESCE(m.on_hand_sum, 0) AS ledger_on_hand, COALESCE(m.reserved_sum, 0) AS ledger_reserved,
              COALESCE(r.active_qty, 0) AS active_reservations
         FROM inventory_balances b JOIN products p ON p.id = b.product_id
         LEFT JOIN (SELECT product_id, location_id, SUM(on_hand_delta) AS on_hand_sum, SUM(reserved_delta) AS reserved_sum
                      FROM inventory_movements GROUP BY product_id, location_id) m ON m.product_id = b.product_id AND m.location_id = b.location_id
         LEFT JOIN (SELECT product_id, location_id, SUM(quantity) AS active_qty FROM stock_reservations WHERE status = 'active'
                      GROUP BY product_id, location_id) r ON r.product_id = b.product_id AND r.location_id = b.location_id
         ${w.sql}) x
      WHERE on_hand <> ledger_on_hand OR reserved <> ledger_reserved OR reserved <> active_reservations`,
    w.params,
  );
  const ow = new Where().addIn('o.location_id', scopeLocations(user, f.location_id));
  const orders = await query<any>(
    `SELECT o.id, o.order_number, o.total_amount, t.items_total FROM orders o
       JOIN (SELECT order_id, SUM(quantity * unit_price) AS items_total FROM order_items GROUP BY order_id) t ON t.order_id = o.id
       ${ow.sql ? ow.sql + ' AND' : 'WHERE'} ABS(o.total_amount - t.items_total) > 0.005`,
    ow.params,
  );
  return {
    ok: ledger.length === 0 && orders.length === 0,
    checks: {
      ledger_vs_balances: { description: 'inventory_balances.on_hand/reserved must equal the sum of inventory_movements and active reservations', discrepancies: ledger },
      order_totals_vs_items: { description: 'orders.total_amount must equal the sum of its items', discrepancies: orders },
    },
  };
}

export async function dashboard(user: AuthUser, f: ReportFilter) {
  const [inventory, ful, sales, suppliers, lowStock, po] = await Promise.all([
    inventorySummary(user, f),
    fulfillment(user, f),
    salesTrend(user, f),
    supplierMetrics({ from: f.from, to: f.to }),
    (async () => {
      const w = balanceWhere(user, f);
      w.add('p.is_active = 1 AND (b.on_hand - b.reserved) <= p.reorder_point');
      return query(
        `SELECT p.sku, p.name, l.code AS location_code, b.on_hand, b.reserved, (b.on_hand - b.reserved) AS available, p.reorder_point
           FROM inventory_balances b JOIN products p ON p.id = b.product_id JOIN locations l ON l.id = b.location_id
           ${w.sql} ORDER BY available, p.name LIMIT 10`,
        w.params,
      );
    })(),
    query<{ status: string; n: number }>(
      `SELECT po.status, COUNT(*) AS n FROM purchase_orders po ${new Where().addIn('po.location_id', scopeLocations(user, f.location_id)).sql} GROUP BY po.status`,
      new Where().addIn('po.location_id', scopeLocations(user, f.location_id)).params,
    ),
  ]);
  return {
    filters: f,
    inventory,
    orders: ful,
    sales: sales.totals,
    sales_trend: sales.data,
    purchase_orders: Object.fromEntries(po.map((p) => [p.status, p.n])),
    suppliers,
    low_stock: lowStock,
  };
}
