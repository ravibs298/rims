import { withTx } from '../../db';
import { audit } from '../../audit';
import { conflict, notFound } from '../../errors';
import * as repo from './repository';

export const searchProducts = (f: any) => repo.search(f).then((r) => ({ data: r.rows, page: f.page, pageSize: f.pageSize, total: r.total }));

export async function getProduct(id: number) {
  const p = await repo.findById(id);
  if (!p) throw notFound('Product');
  return { ...p, images: await repo.images(id), identifiers: await repo.identifiers(id) };
}

export async function createProduct(userId: number, input: any, ip: string | null) {
  const id = await withTx(async (c) => {
    const pid = await repo.insert(input, c);
    await repo.replaceImages(pid, input.image_urls, c);
    await audit(userId, 'product.created', 'product', pid, { sku: input.sku }, ip, c);
    return pid;
  });
  return getProduct(id);
}

export async function updateProduct(userId: number, id: number, input: any, ip: string | null) {
  await withTx(async (c) => {
    if (!(await repo.findById(id, c, true))) throw notFound('Product');
    await repo.update(id, input, c);
    if (input.image_urls) await repo.replaceImages(id, input.image_urls, c);
    await audit(userId, 'product.updated', 'product', id, input, ip, c);
  });
  return getProduct(id);
}

export async function setActive(userId: number, id: number, active: boolean, ip: string | null) {
  await withTx(async (c) => {
    if (!(await repo.findById(id, c, true))) throw notFound('Product');
    if (!active && (await repo.reservedUnits(id, c)) > 0) {
      throw conflict('HAS_RESERVATIONS', 'Cannot deactivate a product that has reserved stock; fulfill or cancel the orders first');
    }
    await repo.setActive(id, active, c);
    await audit(userId, active ? 'product.activated' : 'product.deactivated', 'product', id, undefined, ip, c);
  });
  return getProduct(id);
}

export const listCategories = repo.listCategories;
export async function createCategory(userId: number, name: string, parentId: number | null | undefined, ip: string | null) {
  return withTx(async (c) => {
    const r = await repo.insertCategory(name, parentId, c);
    await audit(userId, 'category.created', 'category', r.insertId, { name }, ip, c);
    return { id: r.insertId, name, parent_id: parentId ?? null };
  });
}
