import { Db, exec, one, pool, query } from '../../db';
import { Where, pageParams } from '../../utils';

const SORT: Record<string, string> = { name: 'p.name', sku: 'p.sku', price: 'p.price', created_at: 'p.created_at' };

export async function search(f: any, db: Db = pool) {
  const w = new Where();
  if (f.q) w.add('(p.sku LIKE ? OR p.name LIKE ?)', `%${f.q}%`, `%${f.q}%`);
  if (f.category_id) w.add('p.category_id = ?', f.category_id);
  if (f.active) w.add('p.is_active = ?', f.active === 'true' ? 1 : 0);
  const { limit, offset } = pageParams(f.page, f.pageSize);
  const rows = await query(
    `SELECT p.id, p.sku, p.name, p.description, p.price, p.cost, p.category_id, c.name AS category_name,
            p.reorder_point, p.is_active, p.created_at, p.updated_at,
            (SELECT COALESCE(SUM(b.on_hand), 0) FROM inventory_balances b WHERE b.product_id = p.id) AS on_hand
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       ${w.sql} ORDER BY ${SORT[f.sort]} ${f.dir === 'desc' ? 'DESC' : 'ASC'}, p.id LIMIT ? OFFSET ?`,
    [...w.params, limit, offset],
    db,
  );
  const t = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM products p ${w.sql}`, w.params, db);
  return { rows, total: t?.n ?? 0 };
}

export const findById = (id: number, db: Db = pool, lock = false) =>
  one<any>(
    `SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?${lock ? ' FOR UPDATE' : ''}`,
    [id],
    db,
  );

export const images = (productId: number, db: Db = pool) =>
  query('SELECT id, url, sort_order FROM product_images WHERE product_id = ? ORDER BY sort_order, id', [productId], db);

export const identifiers = (productId: number, db: Db = pool) =>
  query('SELECT id, id_type, value, created_at FROM product_identifiers WHERE product_id = ? ORDER BY id', [productId], db);

export async function insert(p: any, db: Db) {
  const r = await exec(
    'INSERT INTO products (sku, name, description, price, cost, category_id, reorder_point) VALUES (?,?,?,?,?,?,?)',
    [p.sku, p.name, p.description ?? null, p.price, p.cost, p.category_id ?? null, p.reorder_point],
    db,
  );
  return r.insertId;
}

export async function update(id: number, p: any, db: Db) {
  const cols = ['sku', 'name', 'description', 'price', 'cost', 'category_id', 'reorder_point'] as const;
  const sets: string[] = [];
  const params: any[] = [];
  for (const c of cols) {
    if (p[c] !== undefined) {
      sets.push(`${c} = ?`);
      params.push(p[c]);
    }
  }
  if (sets.length) await exec(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, [...params, id], db);
}

export const setActive = (id: number, active: boolean, db: Db) => exec('UPDATE products SET is_active = ? WHERE id = ?', [active ? 1 : 0, id], db);

export async function replaceImages(productId: number, urls: string[], db: Db) {
  await exec('DELETE FROM product_images WHERE product_id = ?', [productId], db);
  for (let i = 0; i < urls.length; i++) await exec('INSERT INTO product_images (product_id, url, sort_order) VALUES (?,?,?)', [productId, urls[i], i], db);
}

export const reservedUnits = async (productId: number, db: Db) =>
  (await one<{ n: number }>('SELECT COALESCE(SUM(reserved), 0) AS n FROM inventory_balances WHERE product_id = ?', [productId], db))?.n ?? 0;

export const listCategories = () =>
  query('SELECT c.id, c.name, c.parent_id, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count FROM categories c ORDER BY c.name');
export const insertCategory = (name: string, parentId: number | null | undefined, db: Db) =>
  exec('INSERT INTO categories (name, parent_id) VALUES (?,?)', [name, parentId ?? null], db);
