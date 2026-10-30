import { useState } from 'react';
import { useAuth } from '../auth';
import { api } from '../api';
import { Badge, cleanLines, DataTable, ErrorBox, Form, Line, LineItems, Loading, Modal, money, PageHeader, Pager, statusTone, useAction, useLookups, useQuery, when } from '../ui';

export default function Orders() {
  const { can } = useAuth();
  const act = useAction();
  const lk = useLookups();
  const [f, setF] = useState<Record<string, any>>({ page: 1, pageSize: 20 });
  const { data, loading, error, reload } = useQuery<any>('/orders', f);
  const [creating, setCreating] = useState(false);
  const [lines, setLines] = useState<Line[]>([{ product_id: '', quantity: '' }]);
  const [detail, setDetail] = useState<any | null>(null);
  const [shipping, setShipping] = useState(false);

  const show = async (id: number) => setDetail(await api(`/orders/${id}`));
  const transition = (path: string, body: any, ok: string) => act(async () => { setDetail(await api(path, { method: 'POST', body })); reload(); }, ok);

  return (
    <>
      <PageHeader title="Orders">{can('orders.write') && <button className="primary" onClick={() => setCreating(true)}>New order</button>}</PageHeader>
      <div className="filters">
        <label>Search<input aria-label="Search orders" placeholder="Order # or customer" value={f.q ?? ''} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} /></label>
        <label>Status<select aria-label="Filter status" value={f.status ?? ''} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}><option value="">All</option>{['reserved', 'fulfilled', 'shipped', 'delivered', 'cancelled'].map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Location<select aria-label="Filter location" value={f.location_id ?? ''} onChange={(e) => setF({ ...f, location_id: e.target.value, page: 1 })}><option value="">All</option>{lk.locationOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <label>From<input type="date" value={f.from ?? ''} onChange={(e) => setF({ ...f, from: e.target.value, page: 1 })} /></label>
        <label>To<input type="date" value={f.to ?? ''} onChange={(e) => setF({ ...f, to: e.target.value, page: 1 })} /></label>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : <>
        <DataTable rowKey={(o: any) => o.id} rows={data?.data ?? []} empty="No orders found." columns={[
          { header: 'Order', cell: (o: any) => <button className="small" onClick={() => show(o.id)}>{o.order_number}</button> }, { header: 'Customer', cell: (o: any) => o.customer_name }, { header: 'Location', cell: (o: any) => o.location_code },
          { header: 'Total', cell: (o: any) => money(o.total_amount), align: 'right' }, { header: 'Status', cell: (o: any) => <Badge tone={statusTone(o.status)}>{o.status}</Badge> }, { header: 'Created', cell: (o: any) => when(o.created_at) },
        ]} />
        <Pager page={f.page} pageSize={f.pageSize} total={data?.total ?? 0} onPage={(page) => setF({ ...f, page })} /></>}

      {creating && (
        <Modal title="New order" wide onClose={() => setCreating(false)}>
          <Form submitLabel="Reserve stock & create order" onCancel={() => setCreating(false)} fields={[
            { name: 'customer_name', label: 'Customer', required: true }, { name: 'customer_email', label: 'Email', type: 'email' },
            { name: 'location_id', label: 'Fulfil from location', type: 'select', numeric: true, required: true, options: lk.locationOptions }, { name: 'shipping_address', label: 'Shipping address' }]}
            onSubmit={async (v) => { await api('/orders', { method: 'POST', body: { ...v, items: cleanLines(lines) } }); setCreating(false); setLines([{ product_id: '', quantity: '' }]); reload(); lk.reload(); }}>
            <h3>Items</h3>
            <LineItems products={lk.products} value={lines} onChange={setLines} />
            <p className="muted">Stock is validated and reserved atomically. If any item is unavailable the order is rejected.</p>
          </Form>
        </Modal>
      )}
      {detail && (
        <Modal title={`Order ${detail.order_number}`} wide onClose={() => setDetail(null)}>
          <dl className="kv"><dt>Status</dt><dd><Badge tone={statusTone(detail.status)}>{detail.status}</Badge></dd><dt>Customer</dt><dd>{detail.customer_name}</dd><dt>Location</dt><dd>{detail.location_code}</dd><dt>Total</dt><dd>{money(detail.total_amount)}</dd>
            {detail.tracking_number && <><dt>Tracking</dt><dd>{detail.carrier} {detail.tracking_number}</dd></>}</dl>
          <DataTable rowKey={(i: any) => i.id} rows={detail.items} columns={[{ header: 'SKU', cell: (i: any) => i.sku }, { header: 'Product', cell: (i: any) => i.name }, { header: 'Qty', cell: (i: any) => i.quantity, align: 'right' }, { header: 'Picked', cell: (i: any) => i.picked_quantity, align: 'right' }, { header: 'Unit price', cell: (i: any) => money(i.unit_price), align: 'right' }]} />
          <h3>Status history</h3>
          <DataTable rowKey={(h: any) => h.created_at + h.to_status} rows={detail.history} columns={[{ header: 'When', cell: (h: any) => when(h.created_at) }, { header: 'From', cell: (h: any) => h.from_status ?? '—' }, { header: 'To', cell: (h: any) => h.to_status }, { header: 'Note', cell: (h: any) => h.note ?? '' }, { header: 'By', cell: (h: any) => h.user_email ?? '' }]} />
          <div className="form-actions">
            {detail.status === 'reserved' && can('orders.fulfill') && <button className="primary" onClick={() => transition(`/orders/${detail.id}/fulfill`, undefined, 'Order fulfilled')}>Confirm fulfillment</button>}
            {detail.status === 'reserved' && can('orders.write') && <button className="danger" onClick={() => { const reason = window.prompt('Cancellation reason', 'Customer request'); if (reason) transition(`/orders/${detail.id}/cancel`, { reason }, 'Order cancelled; reservation released'); }}>Cancel order</button>}
            {detail.status === 'fulfilled' && can('orders.fulfill') && <button className="primary" onClick={() => setShipping(true)}>Ship</button>}
            {detail.status === 'shipped' && can('orders.fulfill') && <button className="primary" onClick={() => transition(`/orders/${detail.id}/deliver`, undefined, 'Marked delivered')}>Mark delivered</button>}
          </div>
          {shipping && <Modal title="Ship order" onClose={() => setShipping(false)}><Form submitLabel="Ship" fields={[{ name: 'carrier', label: 'Carrier', required: true }, { name: 'tracking_number', label: 'Tracking number', required: true }]} onCancel={() => setShipping(false)} onSubmit={async (v) => { setDetail(await api(`/orders/${detail.id}/ship`, { method: 'POST', body: v })); setShipping(false); reload(); }} /></Modal>}
        </Modal>
      )}
    </>
  );
}
