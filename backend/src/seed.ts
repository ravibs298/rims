import bcrypt from 'bcryptjs';
import { config } from './config';
import { closePool, exec, one, withTx } from './db';
import { applyStockChange } from './modules/inventory/stock';

/** Development seed. Refuses to run in production. Idempotent: skips if the admin user exists. */
async function main() {
  if (config.isProd) throw new Error('Refusing to seed demo data in production');
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12) throw new Error('Set SEED_PASSWORD (min 12 chars) to seed development users');
  if (await one("SELECT id FROM users WHERE email = 'admin@xyz-retail.test'")) {
    console.log('Seed data already present; nothing to do.');
    return;
  }
  const hash = await bcrypt.hash(password, config.bcryptRounds);

  await withTx(async (c) => {
    const loc = async (code: string, name: string, type: string) => (await exec('INSERT INTO locations (code, name, type, address) VALUES (?,?,?,?)', [code, name, type, `${name}, XYZ Retail Corporation`], c)).insertId;
    const wh = await loc('WH-MAIN', 'Main Warehouse', 'warehouse');
    const s1 = await loc('ST-001', 'Downtown Store', 'store');
    const s2 = await loc('ST-002', 'Riverside Store', 'store');

    const users: [string, string, string, number[]][] = [
      ['admin@xyz-retail.test', 'Ada Admin', 'Admin', []],
      ['catalog@xyz-retail.test', 'Cathy Catalog', 'Catalog Manager', []],
      ['inventory@xyz-retail.test', 'Ivan Inventory', 'Inventory Manager', []],
      ['store1@xyz-retail.test', 'Sam Store (ST-001 only)', 'Store Manager', [s1]],
      ['orders@xyz-retail.test', 'Olive Orders', 'Order Manager', []],
      ['suppliers@xyz-retail.test', 'Sid Suppliers', 'Supplier Manager', []],
      ['analyst@xyz-retail.test', 'Anna Analyst', 'Analyst', []],
      ['viewer@xyz-retail.test', 'Vic Viewer', 'Viewer', []],
    ];
    for (const [email, name, role, locs] of users) {
      const r = await exec('INSERT INTO users (email, password_hash, full_name) VALUES (?,?,?)', [email, hash, name], c);
      const rid = (await one<{ id: number }>('SELECT id FROM roles WHERE name = ?', [role], c))!.id;
      await exec('INSERT INTO user_roles (user_id, role_id) VALUES (?,?)', [r.insertId, rid], c);
      for (const l of locs) await exec('INSERT INTO user_locations (user_id, location_id) VALUES (?,?)', [r.insertId, l], c);
    }
    const admin = (await one<{ id: number }>("SELECT id FROM users WHERE email = 'admin@xyz-retail.test'", [], c))!.id;

    const cats: Record<string, number> = {};
    for (const n of ['Apparel', 'Home & Kitchen', 'Electronics', 'Grocery']) cats[n] = (await exec('INSERT INTO categories (name) VALUES (?)', [n], c)).insertId;

    const products: [string, string, string, number, number, number, number][] = [
      ['TSH-BLK-M', 'Classic T-Shirt Black M', 'Apparel', 19.99, 7.5, 20, 50],
      ['TSH-BLK-L', 'Classic T-Shirt Black L', 'Apparel', 19.99, 7.5, 20, 40],
      ['JEA-IND-32', 'Indigo Jeans 32', 'Apparel', 59.0, 24.0, 10, 30],
      ['MUG-CER-01', 'Ceramic Mug 350ml', 'Home & Kitchen', 8.5, 2.8, 25, 120],
      ['PAN-NS-28', 'Non-stick Pan 28cm', 'Home & Kitchen', 34.0, 14.0, 8, 25],
      ['BLT-SPK-01', 'Bluetooth Speaker', 'Electronics', 49.9, 22.0, 10, 18],
      ['CHG-USB-65', 'USB-C Charger 65W', 'Electronics', 29.9, 11.0, 15, 60],
      ['EAR-WLS-02', 'Wireless Earbuds', 'Electronics', 79.0, 35.0, 10, 9],
      ['COF-BEAN-1K', 'Coffee Beans 1kg', 'Grocery', 18.5, 9.0, 20, 70],
      ['TEA-GRN-50', 'Green Tea 50 bags', 'Grocery', 5.5, 2.1, 30, 150],
      ['PST-SPG-500', 'Spaghetti 500g', 'Grocery', 1.8, 0.7, 50, 400],
      ['OIL-OLV-1L', 'Olive Oil 1L', 'Grocery', 11.9, 6.2, 20, 5],
    ];
    let n = 0;
    for (const [sku, name, cat, price, cost, rp, qty] of products) {
      n++;
      const p = await exec('INSERT INTO products (sku, name, price, cost, category_id, reorder_point) VALUES (?,?,?,?,?,?)', [sku, name, price, cost, cats[cat], rp], c);
      await exec('INSERT INTO product_identifiers (product_id, id_type, value) VALUES (?,?,?)', [p.insertId, 'barcode', String(5901234000000 + n)], c);
      await exec('INSERT INTO product_identifiers (product_id, id_type, value) VALUES (?,?,?)', [p.insertId, 'rfid', `E2801160${String(n).padStart(8, '0')}`], c);
      await applyStockChange(c, { productId: p.insertId, locationId: wh, onHandDelta: qty, type: 'receipt', refType: 'seed', reason: 'Initial stock', userId: admin });
      await applyStockChange(c, { productId: p.insertId, locationId: s1, onHandDelta: Math.floor(qty / 5), type: 'receipt', refType: 'seed', reason: 'Initial stock', userId: admin });
      await applyStockChange(c, { productId: p.insertId, locationId: s2, onHandDelta: Math.floor(qty / 8), type: 'receipt', refType: 'seed', reason: 'Initial stock', userId: admin });
    }
    await exec('INSERT INTO suppliers (name, contact_name, email, phone, lead_time_days) VALUES (?,?,?,?,?), (?,?,?,?,?)',
      ['Northwind Textiles', 'Priya Rao', 'orders@northwind.example', '+1-555-0100', 10, 'Globex Electronics', 'Lee Chen', 'sales@globex.example', '+1-555-0111', 14], c);
    // Example integration: disabled, with NO credential configured. It reports not_configured until an operator sets the env var.
    await exec("INSERT INTO integration_configs (name, adapter_type, direction, base_url, secret_ref, enabled, created_by) VALUES ('erp-primary', 'erp', 'both', NULL, 'INTEGRATION_ERP_TOKEN', 0, ?)", [admin], c);
  });
  console.log(`Seeded. Login as admin@xyz-retail.test (and 7 other role users) with the SEED_PASSWORD you provided.`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => closePool());
