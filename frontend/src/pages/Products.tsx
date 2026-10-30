import { useState } from 'react';
import { useAuth } from '../auth';
import { api } from '../api';
import { Badge, DataTable, ErrorBox, Form, Loading, Modal, money, PageHeader, Pager, useAction, useLookups, useQuery } from '../ui';

export default function Products() {
  const { can } = useAuth();
  const act = useAction();
  const lk = useLookups();
  const [f, setF] = useState<Record<string, any>>({ page: 1, pageSize: 20 });
  const { data, loading, error, reload } = useQuery<any>('/products', f);
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const [ids, setIds] = useState<any | null>(null);
  const write = can('products.write');

  const open = async (id: number) => setEditing(await api(`/products/${id}`));
  const fields = [
    { name: 'sku', label: 'SKU', required: true }, { name: 'name', label: 'Name', required: true },
    { name: 'description', label: 'Description', type: 'textarea' as const },
    { name: 'price', label: 'Price', type: 'number' as const, step: '0.01', required: true }, { name: 'cost', label: 'Unit cost', type: 'number' as const, step: '0.01' },
    { name: 'category_id', label: 'Category', type: 'select' as const, numeric: true, options: lk.categoryOptions },
    { name: 'reorder_point', label: 'Reorder point', type: 'number' as const },
    { name: 'image_urls', label: 'Image URLs (comma separated)', type: 'textarea' as const },
  ];
  const save = async (v: any) => {
    const body = { ...v, image_urls: v.image_urls ? String(v.image_urls).split(',').map((s: string) => s.trim()).filter(Boolean) : [] };
    if (editing === 'new') await api('/products', { method: 'POST', body });
    else await api(`/products/${editing.id}`, { method: 'PUT', body });
    setEditing(null); reload(); lk.reload();
  };
  const addCategory = async () => {
    const name = window.prompt('New category name');
    if (name) await act(() => api('/categories', { method: 'POST', body: { name } }).then(lk.reload), 'Category created');
  };
  const addId = async (v: any) => { await api(`/products/${ids.id}/identifiers`, { method: 'POST', body: v }); setIds(await api(`/products/${ids.id}`)); };

  return (
    <>
      <PageHeader title="Product Catalog">
        {write && <button onClick={addCategory}>New category</button>}
        {write && <button className="primary" onClick={() => setEditing('new')}>New product</button>}
      </PageHeader>
      <div className="filters">
        <label>Search<input aria-label="Search products" placeholder="SKU or name" value={f.q ?? ''} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} /></label>
        <label>Category<select aria-label="Filter category" value={f.category_id ?? ''} onChange={(e) => setF({ ...f, category_id: e.target.value, page: 1 })}><option value="">All</option>{lk.categoryOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <label>Status<select aria-label="Filter status" value={f.active ?? ''} onChange={(e) => setF({ ...f, active: e.target.value, page: 1 })}><option value="">All</option><option value="true">Active</option><option value="false">Inactive</option></select></label>
        <label>Sort<select aria-label="Sort" value={f.sort ?? 'name'} onChange={(e) => setF({ ...f, sort: e.target.value })}><option value="name">Name</option><option value="sku">SKU</option><option value="price">Price</option><option value="created_at">Newest</option></select></label>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <>
          <DataTable rowKey={(p: any) => p.id} rows={data?.data ?? []} empty="No products match your filters." columns={[
            { header: 'SKU', cell: (p: any) => p.sku }, { header: 'Name', cell: (p: any) => p.name }, { header: 'Category', cell: (p: any) => p.category_name ?? '—' },
            { header: 'Price', cell: (p: any) => money(p.price), align: 'right' }, { header: 'On hand', cell: (p: any) => p.on_hand, align: 'right' },
            { header: 'Status', cell: (p: any) => <Badge tone={p.is_active ? 'ok' : 'bad'}>{p.is_active ? 'active' : 'inactive'}</Badge> },
            { header: '', cell: (p: any) => (
              <span className="actions">
                <button className="small" onClick={async () => setIds(await api(`/products/${p.id}`))}>Barcodes/RFID</button>
                {write && <button className="small" onClick={() => open(p.id)}>Edit</button>}
                {write && (p.is_active
                  ? <button className="small danger" onClick={() => act(() => api(`/products/${p.id}/deactivate`, { method: 'POST' }).then(reload), 'Product deactivated')}>Deactivate</button>
                  : <button className="small" onClick={() => act(() => api(`/products/${p.id}/activate`, { method: 'POST' }).then(reload), 'Product activated')}>Activate</button>)}
              </span>) },
          ]} />
          <Pager page={f.page} pageSize={f.pageSize} total={data?.total ?? 0} onPage={(page) => setF({ ...f, page })} />
        </>
      )}
      {editing && (
        <Modal title={editing === 'new' ? 'New product' : `Edit ${editing.sku}`} onClose={() => setEditing(null)}>
          <Form fields={fields} initial={editing === 'new' ? { cost: 0, reorder_point: 0 } : { ...editing, image_urls: (editing.images ?? []).map((i: any) => i.url).join(', ') }} onSubmit={save} onCancel={() => setEditing(null)} />
        </Modal>
      )}
      {ids && (
        <Modal title={`Identifiers · ${ids.sku}`} onClose={() => setIds(null)}>
          <DataTable rowKey={(i: any) => i.id} rows={ids.identifiers} empty="No barcodes or RFID tags registered." columns={[
            { header: 'Type', cell: (i: any) => i.id_type }, { header: 'Value', cell: (i: any) => i.value },
            { header: '', cell: (i: any) => write && <button className="small danger" onClick={() => act(() => api(`/products/${ids.id}/identifiers/${i.id}`, { method: 'DELETE' }).then(async () => setIds(await api(`/products/${ids.id}`))), 'Identifier removed')}>Remove</button> },
          ]} />
          {write && <><h3>Add identifier</h3><Form submitLabel="Add" fields={[{ name: 'id_type', label: 'Type', type: 'select', required: true, options: [{ value: 'barcode', label: 'Barcode' }, { value: 'rfid', label: 'RFID (EPC hex)' }] }, { name: 'value', label: 'Value', required: true }]} onSubmit={addId} /></>}
        </Modal>
      )}
    </>
  );
}
