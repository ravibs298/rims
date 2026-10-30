import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool, exec, one } from '../../src/db';
import { migrate } from '../../src/migrate';

export const app = createApp();
export const PASSWORD = 'Test-Password-123';
const KEEP = ['permissions', 'roles', 'role_permissions', 'schema_migrations'];

export async function setupDb() {
  await migrate();
  await resetData();
}

export async function resetData() {
  const c = await pool.getConnection();
  try {
    await c.query('SET FOREIGN_KEY_CHECKS = 0');
    const [tables]: any = await c.query('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = "BASE TABLE"');
    for (const { t } of tables) if (!KEEP.includes(t)) await c.query(`TRUNCATE TABLE \`${t}\``);
    await c.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    c.release();
  }
}

let seq = 0;
export async function makeUser(role: string, locationIds: number[] = []) {
  const email = `${role.toLowerCase().replace(/\s+/g, '-')}-${++seq}@test.local`;
  const r = await exec('INSERT INTO users (email, password_hash, full_name) VALUES (?,?,?)', [email, await bcrypt.hash(PASSWORD, 4), role]);
  const rid = (await one<{ id: number }>('SELECT id FROM roles WHERE name = ?', [role]))!.id;
  await exec('INSERT INTO user_roles (user_id, role_id) VALUES (?,?)', [r.insertId, rid]);
  for (const l of locationIds) await exec('INSERT INTO user_locations (user_id, location_id) VALUES (?,?)', [r.insertId, l]);
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error('login failed in test helper: ' + JSON.stringify(res.body));
  return { id: r.insertId, email, token: res.body.token as string };
}

export const as = (token: string) => ({
  get: (u: string) => request(app).get('/api/v1' + u).set('Authorization', `Bearer ${token}`),
  post: (u: string, b?: any) => request(app).post('/api/v1' + u).set('Authorization', `Bearer ${token}`).send(b ?? {}),
  patch: (u: string, b?: any) => request(app).patch('/api/v1' + u).set('Authorization', `Bearer ${token}`).send(b ?? {}),
});

export async function makeLocation(admin: ReturnType<typeof as>, code: string, type: 'store' | 'warehouse' = 'warehouse') {
  const r = await admin.post('/locations', { code, name: `Location ${code}`, type });
  if (r.status !== 201) throw new Error('location create failed ' + JSON.stringify(r.body));
  return r.body.id as number;
}
export async function makeProduct(admin: ReturnType<typeof as>, sku: string, extra: any = {}) {
  const r = await admin.post('/products', { sku, name: `Product ${sku}`, price: 10, cost: 4, reorder_point: 2, ...extra });
  if (r.status !== 201) throw new Error('product create failed ' + JSON.stringify(r.body));
  return r.body.id as number;
}
export const closeAll = () => pool.end();
