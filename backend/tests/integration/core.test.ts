import request from 'supertest';
import { app, as, closeAll, makeLocation, makeProduct, makeUser, setupDb, PASSWORD } from './helpers';
import { exec, query } from '../../src/db';

let admin: ReturnType<typeof as>;
let adminUser: { id: number; email: string; token: string };

beforeAll(async () => {
  await setupDb();
  adminUser = await makeUser('Admin');
  admin = as(adminUser.token);
});
afterAll(closeAll);

describe('authentication & authorization', () => {
  it('logs in without exposing the password hash and validates input', async () => {
    const ok = await request(app).post('/api/v1/auth/login').send({ email: adminUser.email, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(JSON.stringify(ok.body)).not.toMatch(/password/i);
    expect((await request(app).post('/api/v1/auth/login').send({ email: adminUser.email, password: 'wrong' })).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email' })).status).toBe(400);
  });
  it('rejects missing/invalid tokens', async () => {
    expect((await request(app).get('/api/v1/products')).status).toBe(401);
    expect((await request(app).get('/api/v1/products').set('Authorization', 'Bearer garbage')).status).toBe(401);
  });
  it('enforces RBAC per endpoint and hides stack traces', async () => {
    const viewer = as((await makeUser('Viewer')).token);
    expect((await viewer.get('/products')).status).toBe(200);
    expect((await viewer.post('/products', { sku: 'X1', name: 'x', price: 1 })).status).toBe(403);
    expect((await viewer.get('/users')).status).toBe(403);
    expect((await viewer.get('/integrations/configs')).status).toBe(403);
    const r = await viewer.post('/inventory/adjustments', { product_id: 1, location_id: 1, delta: 1, reason: 'nope' });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toMatch(/stack|at .*\.ts/);
  });
  it('deactivated users lose access immediately', async () => {
    const u = await makeUser('Viewer');
    expect((await as(u.token).get('/products')).status).toBe(200);
    await admin.patch(`/users/${u.id}`, { is_active: false });
    expect((await as(u.token).get('/products')).status).toBe(401);
  });
  it('protects the last admin and audits admin changes; audit log is append-only', async () => {
    const r = await admin.patch(`/users/${adminUser.id}`, { role: 'Viewer' });
    expect(r.status).toBe(409);
    const second = await admin.post('/users', { email: 'second-admin@test.local', full_name: 'Second', password: PASSWORD, role: 'Admin' });
    expect(second.status).toBe(201);
    const audit = await admin.get('/audit-logs?action=admin.role_granted');
    expect(audit.body.data.length).toBeGreaterThan(0);
    await expect(exec('UPDATE audit_logs SET action = "tampered"')).rejects.toThrow(/append-only/);
    await expect(exec('DELETE FROM audit_logs')).rejects.toThrow(/append-only/);
  });
});

describe('Epic 1: catalog CRUD', () => {
  it('creates, reads, updates, searches, filters, and deactivates products', async () => {
    const cat = await admin.post('/categories', { name: 'Gadgets' });
    expect(cat.status).toBe(201);
    const create = await admin.post('/products', { sku: 'GAD-1', name: 'Gadget One', price: 12.5, cost: 5, category_id: cat.body.id, image_urls: ['https://example.com/a.png'] });
    expect(create.status).toBe(201);
    expect(create.body.images).toHaveLength(1);
    const id = create.body.id;
    expect((await admin.post('/products', { sku: 'GAD-1', name: 'dup', price: 1 })).status).toBe(409);
    expect((await admin.post('/products', { sku: 'bad sku', name: 'x', price: 1 })).status).toBe(400);
    expect((await admin.get('/products?q=Gadget&category_id=' + cat.body.id)).body.total).toBe(1);
    const upd = await request(app).put(`/api/v1/products/${id}`).set('Authorization', `Bearer ${adminUser.token}`).send({ price: 15 });
    expect(upd.body.price).toBe(15);
    expect((await admin.post(`/products/${id}/deactivate`)).body.is_active).toBe(0);
    expect((await admin.get('/products?active=true&q=GAD-1')).body.total).toBe(0);
    expect((await admin.get('/products/999999')).status).toBe(404);
    expect((await admin.get('/products?sort=price;DROP')).status).toBe(400);
  });
});

describe('Workflow A + inventory: product -> location -> stock -> ledger -> dashboard', () => {
  it('records receipts/adjustments in the ledger and reflects them in the dashboard', async () => {
    const wh = await makeLocation(admin, 'WH-A');
    const st = await makeLocation(admin, 'ST-A', 'store');
    const p = await makeProduct(admin, 'WFA-1', { price: 20, cost: 8, reorder_point: 5 });
    expect((await admin.post('/inventory/receipts', { product_id: p, location_id: wh, quantity: 50 })).status).toBe(201);
    expect((await admin.post('/inventory/adjustments', { product_id: p, location_id: wh, delta: -3, reason: 'damaged' })).body.on_hand).toBe(47);
    expect((await admin.post('/inventory/adjustments', { product_id: p, location_id: wh, delta: -500, reason: 'too much' })).status).toBe(409);
    expect((await admin.post('/inventory/adjustments', { product_id: p, location_id: wh, delta: 0, reason: 'zero' })).status).toBe(400);
    const t = await admin.post('/inventory/transfers', { product_id: p, from_location_id: wh, to_location_id: st, quantity: 10 });
    expect(t.status).toBe(201);
    expect((await admin.post('/inventory/transfers', { product_id: p, from_location_id: wh, to_location_id: wh, quantity: 1 })).status).toBeGreaterThanOrEqual(400);

    const mv = await admin.get(`/inventory/movements?product_id=${p}`);
    expect(mv.body.data.map((m: any) => m.movement_type).sort()).toEqual(['adjustment', 'receipt', 'transfer_in', 'transfer_out']);
    const bal = await admin.get(`/inventory/balances?product_id=${p}`);
    const total = bal.body.data.reduce((s: number, b: any) => s + b.on_hand, 0);
    expect(total).toBe(47);
    expect((await admin.get(`/inventory/valuation?location_id=${wh}`)).body.total.value).toBe(37 * 8);

    const dash = await admin.get(`/reports/dashboard?product_id=${p}`);
    expect(dash.body.inventory.on_hand).toBe(47);
    expect(dash.body.inventory.valuation).toBe(47 * 8);
    expect((await admin.get('/reports/reconciliation')).body.ok).toBe(true);
  });
  it('restricts store managers to their assigned locations', async () => {
    const a = await makeLocation(admin, 'WH-R1');
    const b = await makeLocation(admin, 'WH-R2');
    const p = await makeProduct(admin, 'RESTR-1');
    await admin.post('/inventory/receipts', { product_id: p, location_id: a, quantity: 5 });
    await admin.post('/inventory/receipts', { product_id: p, location_id: b, quantity: 5 });
    const sm = as((await makeUser('Store Manager', [a])).token);
    expect((await sm.post('/inventory/adjustments', { product_id: p, location_id: b, delta: 1, reason: 'not mine' })).status).toBe(403);
    expect((await sm.post('/inventory/adjustments', { product_id: p, location_id: a, delta: 1, reason: 'mine ok' })).status).toBe(201);
    const bal = await sm.get(`/inventory/balances?product_id=${p}`);
    expect(bal.body.data.every((x: any) => x.location_id === a)).toBe(true);
    expect((await sm.get(`/inventory/balances?location_id=${b}`)).status).toBe(403);
    const unassigned = as((await makeUser('Store Manager')).token);
    expect((await unassigned.get('/inventory/balances')).body.total).toBe(0);
  });
});

describe('Workflow B: order fulfillment, reservations, concurrency', () => {
  it('reserves, fulfills, ships, delivers; cancels release reservations; blocks invalid transitions', async () => {
    const wh = await makeLocation(admin, 'WH-B');
    const p = await makeProduct(admin, 'WFB-1', { price: 10 });
    await admin.post('/inventory/receipts', { product_id: p, location_id: wh, quantity: 10 });
    const o1 = await admin.post('/orders', { customer_name: 'Zed', location_id: wh, items: [{ product_id: p, quantity: 4 }] });
    expect(o1.status).toBe(201);
    expect(o1.body.status).toBe('reserved');
    expect(o1.body.total_amount).toBe(40);
    let bal = (await admin.get(`/inventory/balances?product_id=${p}`)).body.data[0];
    expect([bal.on_hand, bal.reserved, bal.available]).toEqual([10, 4, 6]);
    const tooMuch = await admin.post('/orders', { customer_name: 'Y', location_id: wh, items: [{ product_id: p, quantity: 7 }] });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe('INSUFFICIENT_STOCK');

    const f = await admin.post(`/orders/${o1.body.id}/fulfill`);
    expect(f.body.status).toBe('fulfilled');
    bal = (await admin.get(`/inventory/balances?product_id=${p}`)).body.data[0];
    expect([bal.on_hand, bal.reserved]).toEqual([6, 0]);
    expect((await admin.post(`/orders/${o1.body.id}/fulfill`)).status).toBe(409);
    expect((await admin.post(`/orders/${o1.body.id}/cancel`, { reason: 'late' })).status).toBe(409);
    expect((await admin.post(`/orders/${o1.body.id}/ship`, { carrier: 'DHL', tracking_number: 'TRK1' })).body.tracking_number).toBe('TRK1');
    expect((await admin.post(`/orders/${o1.body.id}/deliver`)).body.status).toBe('delivered');

    const o2 = await admin.post('/orders', { customer_name: 'Q', location_id: wh, items: [{ product_id: p, quantity: 5 }] });
    bal = (await admin.get(`/inventory/balances?product_id=${p}`)).body.data[0];
    expect(bal.reserved).toBe(5);
    const c = await admin.post(`/orders/${o2.body.id}/cancel`, { reason: 'customer request' });
    expect(c.body.status).toBe('cancelled');
    expect(c.body.reservations.every((r: any) => r.status === 'released')).toBe(true);
    bal = (await admin.get(`/inventory/balances?product_id=${p}`)).body.data[0];
    expect([bal.on_hand, bal.reserved]).toEqual([6, 0]);

    const ful = await admin.get('/reports/fulfillment');
    expect(ful.body.fulfilled_orders).toBeGreaterThanOrEqual(1);
    expect(ful.body.fulfillment_rate).toBeGreaterThan(0);
    expect((await admin.get('/reports/reconciliation')).body.ok).toBe(true);
  });

  it('never oversells under concurrent requests for the last units', async () => {
    const wh = await makeLocation(admin, 'WH-C');
    const p = await makeProduct(admin, 'RACE-1');
    await admin.post('/inventory/receipts', { product_id: p, location_id: wh, quantity: 3 });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => admin.post('/orders', { customer_name: `C${i}`, location_id: wh, items: [{ product_id: p, quantity: 1 }] })),
    );
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(3);
    expect(results.filter((r) => r.status === 409).length).toBe(7);
    const bal = (await admin.get(`/inventory/balances?product_id=${p}`)).body.data[0];
    expect([bal.on_hand, bal.reserved]).toEqual([3, 3]);
    const fulfilled = await Promise.all(results.filter((r) => r.status === 201).map((r) => admin.post(`/orders/${r.body.id}/fulfill`)));
    expect(fulfilled.every((r) => r.status === 200)).toBe(true);
    const after = (await admin.get(`/inventory/balances?product_id=${p}`)).body.data[0];
    expect([after.on_hand, after.reserved]).toEqual([0, 0]);
    expect((await admin.get('/reports/reconciliation')).body.ok).toBe(true);
  });

  it('does not double-fulfill an order under concurrent fulfill calls', async () => {
    const wh = await makeLocation(admin, 'WH-D');
    const p = await makeProduct(admin, 'DBL-1');
    await admin.post('/inventory/receipts', { product_id: p, location_id: wh, quantity: 5 });
    const o = await admin.post('/orders', { customer_name: 'D', location_id: wh, items: [{ product_id: p, quantity: 2 }] });
    const rs = await Promise.all([1, 2, 3].map(() => admin.post(`/orders/${o.body.id}/fulfill`)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    const bal = (await admin.get(`/inventory/balances?product_id=${p}`)).body.data[0];
    expect(bal.on_hand).toBe(3);
  });

  it('database CHECK constraints independently block negative or over-reserved stock', async () => {
    const wh = await makeLocation(admin, 'WH-E');
    const p = await makeProduct(admin, 'CHK-1');
    await admin.post('/inventory/receipts', { product_id: p, location_id: wh, quantity: 1 });
    await expect(exec('UPDATE inventory_balances SET reserved = 5 WHERE product_id = ?', [p])).rejects.toThrow();
    await expect(exec('UPDATE inventory_balances SET on_hand = -1 WHERE product_id = ?', [p])).rejects.toThrow();
  });
});

describe('Workflow C: procurement', () => {
  it('creates supplier + PO, approves, receives partially then fully, and updates stock and metrics', async () => {
    const sup = as((await makeUser('Supplier Manager')).token);
    const inv = as((await makeUser('Inventory Manager')).token);
    const wh = await makeLocation(admin, 'WH-P');
    const p = await makeProduct(admin, 'PO-1');
    const s = await sup.post('/suppliers', { name: 'Acme Supply', lead_time_days: 5 });
    expect(s.status).toBe(201);
    const po = await sup.post('/purchase-orders', { supplier_id: s.body.id, location_id: wh, expected_date: '2099-01-01', items: [{ product_id: p, quantity: 10, unit_cost: 3 }] });
    expect(po.status).toBe(201);
    expect(po.body.status).toBe('draft');
    expect(po.body.total_amount).toBe(30);
    expect((await inv.post(`/purchase-orders/${po.body.id}/receive`, { items: [{ po_item_id: po.body.items[0].id, quantity: 1 }] })).status).toBe(409);
    expect((await inv.post(`/purchase-orders/${po.body.id}/approve`)).status).toBe(403);
    expect((await sup.post(`/purchase-orders/${po.body.id}/approve`)).body.status).toBe('approved');
    expect((await sup.post(`/purchase-orders/${po.body.id}/receive`, { items: [{ po_item_id: po.body.items[0].id, quantity: 1 }] })).status).toBe(403);

    const itemId = po.body.items[0].id;
    const r1 = await inv.post(`/purchase-orders/${po.body.id}/receive`, { items: [{ po_item_id: itemId, quantity: 4 }] });
    expect(r1.body.status).toBe('partially_received');
    expect((await inv.post(`/purchase-orders/${po.body.id}/receive`, { items: [{ po_item_id: itemId, quantity: 7 }] })).status).toBe(409);
    const r2 = await inv.post(`/purchase-orders/${po.body.id}/receive`, { items: [{ po_item_id: itemId, quantity: 6 }] });
    expect(r2.body.status).toBe('received');
    expect((await admin.get(`/inventory/balances?product_id=${p}`)).body.data[0].on_hand).toBe(10);
    const mv = (await admin.get(`/inventory/movements?product_id=${p}&type=receipt`)).body.data;
    expect(mv).toHaveLength(2);
    expect(mv.every((m: any) => m.reference_type === 'goods_receipt')).toBe(true);
    const perf = (await sup.get(`/suppliers/${s.body.id}`)).body.performance;
    expect(perf.po_count).toBe(1);
    expect(perf.fill_rate).toBe(1);
    expect(perf.on_time_rate).toBe(1);
    expect((await admin.get('/reports/suppliers')).body.data.find((x: any) => x.supplier_id === s.body.id).fill_rate).toBe(1);
  });
  it('cancels a draft PO but not a received one', async () => {
    const sup = as((await makeUser('Supplier Manager')).token);
    const wh = await makeLocation(admin, 'WH-P2');
    const p = await makeProduct(admin, 'PO-2');
    const s = await sup.post('/suppliers', { name: 'Beta Supply' });
    const po = await sup.post('/purchase-orders', { supplier_id: s.body.id, location_id: wh, items: [{ product_id: p, quantity: 2 }] });
    expect((await sup.post(`/purchase-orders/${po.body.id}/cancel`)).body.status).toBe('cancelled');
    expect((await sup.post(`/purchase-orders/${po.body.id}/approve`)).status).toBe(409);
  });
});

describe('Workflow D: barcode and RFID', () => {
  it('resolves identifiers and drives receive, count, transfer, and fulfill', async () => {
    const wh = await makeLocation(admin, 'WH-S');
    const st = await makeLocation(admin, 'ST-S', 'store');
    const p = await makeProduct(admin, 'SCAN-1', { price: 5 });
    expect((await admin.post(`/products/${p}/identifiers`, { id_type: 'barcode', value: '4006381333931' })).status).toBe(201);
    expect((await admin.post(`/products/${p}/identifiers`, { id_type: 'rfid', value: 'e2 80 11 60 00 00 12 34' })).status).toBe(201);
    expect((await admin.post(`/products/${p}/identifiers`, { id_type: 'barcode', value: '4006381333931' })).status).toBe(409);

    expect((await admin.post('/scan/resolve', { id_type: 'barcode', value: '4006381333931' })).body.product.sku).toBe('SCAN-1');
    expect((await admin.post('/scan/resolve', { id_type: 'barcode', value: 'SCAN-1' })).body.product.matched_by).toBe('sku');
    expect((await admin.post('/scan/resolve', { id_type: 'rfid', value: 'E280116000001234' })).body.product.id).toBe(p);
    expect((await admin.post('/scan/resolve', { id_type: 'barcode', value: '0000000' })).status).toBe(404);

    const bc = { id_type: 'barcode', value: '4006381333931' };
    expect((await admin.post('/scan/actions', { ...bc, action: 'receive', location_id: wh, quantity: 20 })).body.result.on_hand).toBe(20);
    const cnt = await admin.post('/scan/actions', { ...bc, action: 'count', location_id: wh, quantity: 18 });
    expect(cnt.body.result.variance).toBe(-2);
    expect((await admin.post('/scan/actions', { ...bc, action: 'transfer', location_id: wh, to_location_id: st, quantity: 5 })).status).toBe(201);

    const order = await admin.post('/orders', { customer_name: 'Scan', location_id: wh, items: [{ product_id: p, quantity: 2 }] });
    const p1 = await admin.post('/scan/actions', { id_type: 'rfid', value: 'E280116000001234', action: 'fulfill', order_id: order.body.id, quantity: 1 });
    expect(p1.body.result.order_fulfilled).toBe(false);
    const p2 = await admin.post('/scan/actions', { ...bc, action: 'fulfill', order_id: order.body.id, quantity: 1 });
    expect(p2.body.result.order_fulfilled).toBe(true);
    expect((await admin.get(`/orders/${order.body.id}`)).body.status).toBe('fulfilled');
    expect((await admin.post('/scan/actions', { ...bc, action: 'fulfill', order_id: order.body.id, quantity: 1 })).status).toBe(409);

    const types = (await admin.get(`/inventory/movements?product_id=${p}`)).body.data.map((m: any) => m.movement_type);
    expect(types).toEqual(expect.arrayContaining(['receipt', 'count', 'transfer_out', 'transfer_in', 'reserve', 'sale']));
    expect((await admin.get('/scan/events')).body.data.length).toBeGreaterThan(5);

    const viewer = as((await makeUser('Viewer')).token);
    expect((await viewer.post('/scan/resolve', bc)).status).toBe(403);
    const orderMgr = as((await makeUser('Order Manager')).token);
    expect((await orderMgr.post('/scan/actions', { ...bc, action: 'count', location_id: wh, quantity: 1 })).status).toBe(403);
    expect((await admin.post('/scan/actions', { id_type: 'rfid', value: 'xyz', action: 'receive', location_id: wh })).status).toBe(422);
  });
});

describe('Workflow E: reporting reconciles with underlying records', () => {
  it('sales trend and dashboard agree with orders and respect filters', async () => {
    const wh = await makeLocation(admin, 'WH-RP');
    const cat = await admin.post('/categories', { name: 'RptCat' });
    const p1 = await makeProduct(admin, 'RPT-1', { price: 10, category_id: cat.body.id });
    const p2 = await makeProduct(admin, 'RPT-2', { price: 7 });
    await admin.post('/inventory/receipts', { product_id: p1, location_id: wh, quantity: 20 });
    await admin.post('/inventory/receipts', { product_id: p2, location_id: wh, quantity: 20 });
    await admin.post('/orders', { customer_name: 'R', location_id: wh, items: [{ product_id: p1, quantity: 3 }, { product_id: p2, quantity: 2 }] });
    const today = new Date().toISOString().slice(0, 10);
    const all = (await admin.get(`/reports/sales-trend?location_id=${wh}&from=${today}&to=${today}`)).body;
    expect(all.totals.revenue).toBe(3 * 10 + 2 * 7);
    expect(all.totals.units).toBe(5);
    expect((await admin.get(`/reports/sales-trend?location_id=${wh}&product_id=${p2}`)).body.totals.revenue).toBe(14);
    expect((await admin.get(`/reports/sales-trend?location_id=${wh}&category_id=${cat.body.id}`)).body.totals.revenue).toBe(30);
    const [row] = await query<any>('SELECT SUM(quantity * unit_price) AS r FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.location_id = ?', [wh]);
    expect(all.totals.revenue).toBe(row.r);
    const lvl = (await admin.get(`/reports/inventory-levels?location_id=${wh}&product_id=${p1}`)).body.data[0];
    expect([lvl.on_hand, lvl.reserved, lvl.available]).toEqual([20, 3, 17]);
    const dash = (await admin.get(`/reports/dashboard?location_id=${wh}`)).body;
    expect(dash.inventory.reserved).toBe(5);
    expect((await admin.get('/reports/dashboard?from=bad')).status).toBe(400);
  });
  it('flags low stock and stockouts', async () => {
    const wh = await makeLocation(admin, 'WH-LS');
    const low = await makeProduct(admin, 'LOW-1', { reorder_point: 5 });
    const out = await makeProduct(admin, 'OUT-1', { reorder_point: 5 });
    await admin.post('/inventory/receipts', { product_id: low, location_id: wh, quantity: 3 });
    await admin.post('/inventory/receipts', { product_id: out, location_id: wh, quantity: 1 });
    await admin.post('/inventory/adjustments', { product_id: out, location_id: wh, delta: -1, reason: 'sold out' });
    const ls = (await admin.get(`/inventory/low-stock?location_id=${wh}`)).body.data;
    expect(ls.find((r: any) => r.sku === 'LOW-1').level).toBe('low');
    expect(ls.find((r: any) => r.sku === 'OUT-1').level).toBe('stockout');
    const d = (await admin.get(`/reports/dashboard?location_id=${wh}`)).body.inventory;
    expect([d.low_stock_count, d.stockout_count]).toEqual([1, 1]);
  });
});

describe('error handling', () => {
  it('returns 404 for unknown routes and 400 for malformed JSON without leaking internals', async () => {
    expect((await admin.get('/nope')).status).toBe(404);
    expect((await request(app).get('/api/v1/nope')).status).toBe(401);
    const r = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{bad json');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_JSON');
    expect((await request(app).get('/health')).body.status).toBe('ok');
    expect((await request(app).get('/ready')).status).toBe(200);
  });
});
