import request from 'supertest';
import { app, as, closeAll, makeLocation, makeProduct, makeUser, setupDb } from './helpers';
import { sign } from '../../src/modules/integrations/adapters';
import { processDue } from '../../src/modules/integrations/service';
import { exec, one, query } from '../../src/db';

let admin: ReturnType<typeof as>;
const SECRET = 'whsec_test_value';

beforeAll(async () => {
  await setupDb();
  admin = as((await makeUser('Admin')).token);
});
afterAll(closeAll);
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.INTEGRATION_TEST_TOKEN;
});

const inbound = (name: string, body: any, key: string | null, secret = SECRET) => {
  const raw = JSON.stringify(body);
  let r = request(app).post(`/api/v1/integrations/inbound/${name}`).set('Content-Type', 'application/json').set('X-Signature', sign(secret, raw));
  if (key) r = r.set('Idempotency-Key', key);
  return r.send(raw);
};

describe('Workflow F: inbound integration (validated, idempotent, honest about configuration)', () => {
  let wh: number;
  let productId: number;
  let cfgId: number;
  beforeAll(async () => {
    wh = await makeLocation(admin, 'WH-I');
    productId = await makeProduct(admin, 'INT-1');
    const c = await admin.post('/integrations/configs', { name: 'erp-in', adapter_type: 'erp', direction: 'inbound', secret_ref: 'INTEGRATION_TEST_TOKEN', enabled: true });
    expect(c.status).toBe(201);
    cfgId = c.body.id;
    expect(c.body.credential_present).toBe(false);
    expect(JSON.stringify(c.body)).not.toContain(SECRET);
  });
  const adjust = (delta = 5) => ({ event_type: 'inventory.adjust', payload: { sku: 'INT-1', location_code: 'WH-I', delta } });

  it('reports not_configured and refuses to process when the credential is absent', async () => {
    const status = (await admin.get('/integrations/status')).body.data.find((s: any) => s.name === 'erp-in');
    expect(status.state).toBe('not_configured');
    expect((await inbound('erp-in', adjust(), 'k0')).status).toBe(503);
  });

  it('rejects bad signatures, missing idempotency keys and invalid payloads', async () => {
    process.env.INTEGRATION_TEST_TOKEN = SECRET;
    expect((await inbound('erp-in', adjust(), 'k1', 'wrong-secret')).status).toBe(401);
    expect((await inbound('erp-in', adjust(), null)).status).toBe(400);
    expect((await inbound('erp-in', { event_type: 'inventory.adjust', payload: { sku: 'INT-1', delta: 'x' } }, 'k2')).status).toBe(422);
    expect((await inbound('erp-in', { event_type: 'nope', payload: {} }, 'k3')).status).toBe(422);
    expect((await inbound('missing', adjust(), 'k4')).status).toBe(404);
    expect(await query('SELECT id FROM integration_events')).toHaveLength(0);
  });

  it('applies the event once, ignores duplicates, and writes a ledger entry', async () => {
    process.env.INTEGRATION_TEST_TOKEN = SECRET;
    const first = await inbound('erp-in', adjust(5), 'dup-1');
    expect(first.status).toBe(201);
    expect(first.body.event.status).toBe('succeeded');
    const dup = await inbound('erp-in', adjust(5), 'dup-1');
    expect(dup.status).toBe(200);
    expect(dup.body.duplicate).toBe(true);
    const bal = (await admin.get(`/inventory/balances?product_id=${productId}`)).body.data[0];
    expect(bal.on_hand).toBe(5);
    const mv = (await admin.get(`/inventory/movements?product_id=${productId}`)).body.data;
    expect(mv.filter((m: any) => m.reference_type === 'integration')).toHaveLength(1);
    const rec = (await admin.get('/integrations/reconciliation')).body;
    expect(rec.inbound_inventory_events_without_ledger_entry).toHaveLength(0);
    expect(rec.internal_consistency.ok).toBe(true);
  });

  it('dead-letters events that fail permanently and allows manual retry after the cause is fixed', async () => {
    process.env.INTEGRATION_TEST_TOKEN = SECRET;
    const r = await inbound('erp-in', { event_type: 'inventory.adjust', payload: { sku: 'UNKNOWN-SKU', location_code: 'WH-I', delta: 1 } }, 'perm-1');
    expect(r.status).toBe(202);
    expect(r.body.event.status).toBe('dead');
    await makeProduct(admin, 'UNKNOWN-SKU');
    const retried = await admin.post(`/integrations/events/${r.body.event.id}/retry`);
    expect(retried.body.status).toBe('succeeded');
  });

  it('upserts products from ERP events', async () => {
    process.env.INTEGRATION_TEST_TOKEN = SECRET;
    const r = await inbound('erp-in', { event_type: 'product.upsert', payload: { sku: 'ERP-NEW', name: 'From ERP', price: 12.5, category: 'ERP Imports' } }, 'up-1');
    expect(r.body.event.status).toBe('succeeded');
    expect((await admin.get('/products?q=ERP-NEW')).body.data[0].category_name).toBe('ERP Imports');
    await inbound('erp-in', { event_type: 'product.upsert', payload: { sku: 'ERP-NEW', name: 'Renamed', price: 13 } }, 'up-2');
    expect((await admin.get('/products?q=ERP-NEW')).body.data[0].name).toBe('Renamed');
  });

  it('permissions: only integrations.manage can configure', async () => {
    const analyst = as((await makeUser('Analyst')).token);
    expect((await analyst.get('/integrations/status')).status).toBe(200);
    expect((await analyst.post('/integrations/configs', { name: 'x', adapter_type: 'erp', direction: 'inbound', secret_ref: 'INTEGRATION_X' })).status).toBe(403);
    expect((await admin.post('/integrations/configs', { name: 'bad', adapter_type: 'erp', direction: 'inbound', secret_ref: 'JWT_SECRET' })).status).toBe(400);
    expect((await admin.post('/integrations/configs', { name: 'bad2', adapter_type: 'erp', direction: 'outbound', enabled: true })).status).toBe(422);
    expect(cfgId).toBeGreaterThan(0);
  });
});

describe('Workflow F: outbound delivery with retries', () => {
  let orderId: number;
  let eventId: number;
  beforeAll(async () => {
    const wh = await makeLocation(admin, 'WH-O');
    const p = await makeProduct(admin, 'OUT-P');
    await admin.post('/inventory/receipts', { product_id: p, location_id: wh, quantity: 10 });
    const c = await admin.post('/integrations/configs', { name: 'erp-out', adapter_type: 'erp', direction: 'outbound', base_url: 'https://erp.example.test', secret_ref: 'INTEGRATION_TEST_TOKEN', enabled: true, max_attempts: 3 });
    expect(c.status).toBe(201);
    const o = await admin.post('/orders', { customer_name: 'Out', location_id: wh, items: [{ product_id: p, quantity: 1 }] });
    orderId = o.body.id;
    await admin.post(`/orders/${orderId}/fulfill`);
    eventId = (await one<any>("SELECT id FROM integration_events WHERE direction = 'outbound'"))!.id;
  });

  it('queues the event transactionally and fails honestly when no credential is configured', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    await exec('UPDATE integration_events SET next_attempt_at = NOW(3) WHERE id = ?', [eventId]);
    await processDue();
    expect(fetchSpy).not.toHaveBeenCalled();
    const ev = await one<any>('SELECT status, attempts, last_error FROM integration_events WHERE id = ?', [eventId]);
    expect(ev.status).toBe('failed');
    expect(ev.last_error).toMatch(/NOT_CONFIGURED/);
  });

  it('retries on 5xx then succeeds; sends the idempotency key', async () => {
    process.env.INTEGRATION_TEST_TOKEN = 'outbound-token';
    const fetchSpy = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('boom', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const first = await admin.post(`/integrations/events/${eventId}/retry`);
    expect(first.body.status).toBe('failed');
    expect(first.body.response_status).toBe(503);
    const second = await admin.post(`/integrations/events/${eventId}/retry`);
    expect(second.body.status).toBe('succeeded');
    const init = fetchSpy.mock.calls[1][1] as any;
    expect(init.headers['Idempotency-Key']).toBe(`order.fulfilled:${orderId}`);
    expect(init.headers.Authorization).toBe('Bearer outbound-token');
  });

  it('does not resend succeeded events and dead-letters 4xx / exhausted retries', async () => {
    process.env.INTEGRATION_TEST_TOKEN = 'outbound-token';
    expect((await admin.post(`/integrations/events/${eventId}/retry`)).status).toBe(409);
    await exec("UPDATE integration_events SET status = 'failed', attempts = 0, next_attempt_at = NOW(3) WHERE id = ?", [eventId]);
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('bad', { status: 400 }));
    await processDue();
    expect((await one<any>('SELECT status FROM integration_events WHERE id = ?', [eventId]))!.status).toBe('dead');

    await exec("UPDATE integration_events SET status = 'failed', attempts = 2, next_attempt_at = NOW(3) WHERE id = ?", [eventId]);
    jest.restoreAllMocks();
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await processDue();
    expect((await one<any>('SELECT status FROM integration_events WHERE id = ?', [eventId]))!.status).toBe('dead');
    const rec = (await admin.get('/integrations/reconciliation')).body;
    expect(rec.ok).toBe(false);
    expect(rec.failed_or_dead_events.length).toBeGreaterThan(0);
    expect((await admin.get('/integrations/logs')).body.data.length).toBeGreaterThan(0);
  });

  it('test-connection refuses to report success without configuration', async () => {
    const c = await admin.post('/integrations/configs', { name: 'acct', adapter_type: 'accounting', direction: 'outbound', base_url: 'https://acct.example.test', secret_ref: 'INTEGRATION_ACCT_TOKEN', enabled: false });
    const r = await admin.post(`/integrations/configs/${c.body.id}/test`);
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('INTEGRATION_NOT_CONFIGURED');
  });
});
