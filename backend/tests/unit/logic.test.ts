import { computeLocationScope, canAccessLocation, scopeLocations } from '../../src/modules/auth/access';
import { canTransition } from '../../src/modules/orders/status';
import { computeBackoff, isRetryableStatus } from '../../src/modules/integrations/retry';
import { sign, verifySignature } from '../../src/modules/integrations/adapters';
import { genericEpcAdapter, getRfidAdapter, registerRfidAdapter } from '../../src/modules/scan/rfid';
import { productBody, productQuery } from '../../src/modules/catalog/schemas';
import { createUserBody } from '../../src/modules/users/schemas';
import { actionBody } from '../../src/modules/scan/schemas';
import { configBody } from '../../src/modules/integrations/schemas';
import { Where } from '../../src/utils';

describe('location scope (RBAC)', () => {
  it('admin is unrestricted; store manager without assignment has no access', () => {
    expect(computeLocationScope('Admin', [1])).toBeNull();
    expect(computeLocationScope('Store Manager', [])).toEqual([]);
    expect(computeLocationScope('Store Manager', [2])).toEqual([2]);
    expect(computeLocationScope('Analyst', [])).toBeNull();
  });
  it('enforces assigned locations', () => {
    expect(canAccessLocation({ locationIds: [1] }, 1)).toBe(true);
    expect(canAccessLocation({ locationIds: [1] }, 2)).toBe(false);
    expect(() => scopeLocations({ locationIds: [1] }, 2)).toThrow();
    expect(scopeLocations({ locationIds: null }, 5)).toEqual([5]);
  });
});

describe('order status machine', () => {
  it('allows only valid transitions', () => {
    expect(canTransition('reserved', 'fulfilled')).toBe(true);
    expect(canTransition('reserved', 'cancelled')).toBe(true);
    expect(canTransition('fulfilled', 'cancelled')).toBe(false);
    expect(canTransition('cancelled', 'fulfilled')).toBe(false);
    expect(canTransition('shipped', 'delivered')).toBe(true);
  });
});

describe('integration retry + signatures', () => {
  it('backs off exponentially with a cap', () => {
    expect(computeBackoff(1, 1000, 60000)).toBe(1000);
    expect(computeBackoff(3, 1000, 60000)).toBe(4000);
    expect(computeBackoff(20, 1000, 60000)).toBe(60000);
  });
  it('classifies retryable HTTP statuses', () => {
    expect([500, 503, 429, 408].every(isRetryableStatus)).toBe(true);
    expect([400, 401, 404, 422].some(isRetryableStatus)).toBe(false);
  });
  it('verifies HMAC signatures and rejects tampering', () => {
    const body = Buffer.from('{"a":1}');
    const sig = sign('secret', body);
    expect(verifySignature('secret', body, sig)).toBe(true);
    expect(verifySignature('secret', body, `sha256=${sig}`)).toBe(true);
    expect(verifySignature('other', body, sig)).toBe(false);
    expect(verifySignature('secret', Buffer.from('{"a":2}'), sig)).toBe(false);
    expect(verifySignature('secret', body, undefined)).toBe(false);
    expect(verifySignature('secret', body, 'zz')).toBe(false);
  });
});

describe('RFID adapters', () => {
  it('normalizes EPCs and rejects garbage', () => {
    expect(genericEpcAdapter.normalize(' e2:80 11-60 0000 0001 ')).toBe('E280116000000001');
    expect(() => genericEpcAdapter.normalize('not hex!')).toThrow();
  });
  it('supports registering vendor adapters', () => {
    registerRfidAdapter({ name: 'vendorx', normalize: (r) => r.replace('VX:', '').toUpperCase() });
    expect(getRfidAdapter('vendorx').normalize('VX:abcdef12')).toBe('ABCDEF12');
    expect(() => getRfidAdapter('nope')).toThrow();
  });
});

describe('validation schemas', () => {
  it('rejects bad products', () => {
    expect(productBody.safeParse({ sku: 'bad sku!', name: 'x', price: 1 }).success).toBe(false);
    expect(productBody.safeParse({ sku: 'OK-1', name: 'x', price: -1 }).success).toBe(false);
    expect(productBody.safeParse({ sku: 'OK-1', name: 'x', price: '9.5' }).success).toBe(true);
  });
  it('whitelists sort columns', () => {
    expect(productQuery.safeParse({ sort: 'price; DROP TABLE products' }).success).toBe(false);
  });
  it('enforces password policy and role names', () => {
    const base = { email: 'A@B.com', full_name: 'A', role: 'Viewer' };
    expect(createUserBody.safeParse({ ...base, password: 'short1' }).success).toBe(false);
    expect(createUserBody.safeParse({ ...base, password: 'longenoughbutnodigits' }).success).toBe(false);
    expect(createUserBody.safeParse({ ...base, password: 'longenough-pass-1', role: 'Root' }).success).toBe(false);
    expect(createUserBody.parse({ ...base, password: 'longenough-pass-1' }).email).toBe('a@b.com');
  });
  it('requires action-specific scan fields', () => {
    const base = { id_type: 'barcode', value: '123' };
    expect(actionBody.safeParse({ ...base, action: 'transfer', location_id: 1 }).success).toBe(false);
    expect(actionBody.safeParse({ ...base, action: 'fulfill' }).success).toBe(false);
    expect(actionBody.safeParse({ ...base, action: 'count', location_id: 1, quantity: 0 }).success).toBe(true);
    expect(actionBody.safeParse({ ...base, action: 'receive', location_id: 1, quantity: 0 }).success).toBe(false);
  });
  it('only accepts INTEGRATION_ prefixed secret references', () => {
    const base = { name: 'x', adapter_type: 'erp', direction: 'both' };
    expect(configBody.safeParse({ ...base, secret_ref: 'JWT_SECRET' }).success).toBe(false);
    expect(configBody.safeParse({ ...base, secret_ref: 'INTEGRATION_ERP_TOKEN' }).success).toBe(true);
  });
});

describe('Where builder', () => {
  it('binds values as parameters and handles empty scope', () => {
    const w = new Where().add('a = ?', "x'; DROP").addIn('l', [1, 2]);
    expect(w.sql).toBe('WHERE a = ? AND l IN (?)');
    expect(w.params).toEqual(["x'; DROP", [1, 2]]);
    expect(new Where().addIn('l', []).sql).toContain('1=0');
    expect(new Where().addIn('l', null).sql).toBe('');
  });
});
