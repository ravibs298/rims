import { useState } from 'react';
import { useAuth } from '../auth';
import { api } from '../api';
import { Badge, cleanLines, DataTable, ErrorBox, Form, Line, LineItems, Loading, Modal, money, PageHeader, Pager, statusTone, useAction, useLookups, useQuery, when } from '../ui';

export default function PurchaseOrders() {
  const { can } = useAuth();
  const act = useAction();
  const lk = useLookups();
  const suppliers = useQuery<any>('/suppliers', { active: 'true' });
  const [f, setF] = useState<Record<string, any>>({ page: 1, pageSize: 20 });
  const { data, loading, error, reload } = useQuery<any>('/purchase-orders', f);
  const [creating, setCreating] = useState(false);
  const [lines, setLines] = useState<Line[]>([{ product_id: '', quantity: '', unit_cost: '' }]);
  const [detail, setDetail] = useState<any | null>(null);
  const [recv, setRecv] = useState<Record<number, string>>({});

  const show = async (id: number) => { setDetail(await api(`/purchase-orders/${id}`)); setRecv({}); };
  const post = (path: string, body: any, ok: string) => act(async () => { setDetail(await api(path, { method: 'POST', body })); setRecv({}); reload(); }, ok);
  const receiveLines = Object.entries(recv).filter(([, q]) => Number(q) > 0).map(([id, q]) => ({ po_item_id: Number(id), quantity: Number(q) }));

  return (
    <>
      <PageHeader title="Purchase Orders & Receiving">{can('po.write') && <button className="primary" onClick={() => setCreating(true)}>New purchase order</button>}</PageHeader>
      <div className="filters">
        <label>Status<select aria-label="Filter status" value={f.status ?? ''} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}><option value="">All</option>{['draft', 'approved', 'partially_received', 'received', 'cancelled'].map((s) => <option key={s}>{s}</option>)}</select></label>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : <>
        <DataTable rowKey={(p: any) => p.id} rows={data?.data ?? []} empty="No purchase orders yet." columns={[
          { header: 'PO', cell: (p: any) => <button className="small" onClick={() => show(p.id)}>{p.po_number}</button> }, { header: 'Supplier', cell: (p: any) => p.supplier_name }, { header: 'Deliver to', cell: (p: any) => p.location_code },
          { header: 'Expected', cell: (p: any) => (p.expected_date ? String(p.expected_date).slice(0, 10) : '—') }, { header: 'Total', cell: (p: any) => money(p.total_amount), align: 'right' },
          { header: 'Status', cell: (p: any) => <Badge tone={statusTone(p.status)}>{p.status}</Badge> },
        ]} />
        <Pager page={f.page} pageSize={f.pageSize} total={data?.total ?? 0} onPage={(page) => setF({ ...f, page })} /></>}

      {creating && (
        <Modal title="New purchase order" wide onClose={() => setCreating(false)}>
          <Form submitLabel="Create draft PO" onCancel={() => setCreating(false)} fields={[
            { name: 'supplier_id', label: 'Supplier', type: 'select', numeric: true, required: true, options: (suppliers.data?.data ?? []).map((s: any) => ({ value: s.id, label: s.name })) },
            { name: 'location_id', label: 'Deliver to', type: 'select', numeric: true, required: true, options: lk.locationOptions }, { name: 'expected_date', label: 'Expected date', type: 'date' }, { name: 'notes', label: 'Notes' }]}
            onSubmit={async (v) => { await api('/purchase-orders', { method: 'POST', body: { ...v, items: cleanLines(lines, true) } }); setCreating(false); setLines([{ product_id: '', quantity: '', unit_cost: '' }]); reload(); }}>
            <h3>Items</h3>
            <LineItems products={lk.products} value={lines} onChange={setLines} showCost />
            <p className="muted">Leave unit cost blank to use the catalog cost.</p>
          </Form>
        </Modal>
      )}
      {detail && (
        <Modal title={`Purchase order ${detail.po_number}`} wide onClose={() => setDetail(null)}>
          <dl className="kv"><dt>Status</dt><dd><Badge tone={statusTone(detail.status)}>{detail.status}</Badge></dd><dt>Supplier</dt><dd>{detail.supplier_name}</dd><dt>Deliver to</dt><dd>{detail.location_code}</dd><dt>Total</dt><dd>{money(detail.total_amount)}</dd></dl>
          <DataTable rowKey={(i: any) => i.id} rows={detail.items} columns={[
            { header: 'SKU', cell: (i: any) => i.sku }, { header: 'Product', cell: (i: any) => i.name }, { header: 'Ordered', cell: (i: any) => i.quantity_ordered, align: 'right' }, { header: 'Received', cell: (i: any) => i.quantity_received, align: 'right' }, { header: 'Unit cost', cell: (i: any) => money(i.unit_cost), align: 'right' },
            { header: 'Receive now', cell: (i: any) => ['approved', 'partially_received'].includes(detail.status) && can('po.receive') && i.quantity_received < i.quantity_ordered
              ? <input aria-label={`Receive ${i.sku}`} name={`recv_${i.id}`} type="number" min={0} max={i.quantity_ordered - i.quantity_received} style={{ width: 80 }} value={recv[i.id] ?? ''} onChange={(e) => setRecv({ ...recv, [i.id]: e.target.value })} /> : null },
          ]} />
          {detail.receipts.length > 0 && <p className="muted">Receipts: {detail.receipts.map((r: any) => when(r.received_at)).join(' · ')}</p>}
          <div className="form-actions">
            {detail.status === 'draft' && can('po.approve') && <button className="primary" onClick={() => post(`/purchase-orders/${detail.id}/approve`, undefined, 'Purchase order approved')}>Approve</button>}
            {['draft', 'approved'].includes(detail.status) && can('po.write') && <button className="danger" onClick={() => post(`/purchase-orders/${detail.id}/cancel`, undefined, 'Purchase order cancelled')}>Cancel PO</button>}
            {['approved', 'partially_received'].includes(detail.status) && can('po.receive') && <button className="primary" disabled={!receiveLines.length} onClick={() => post(`/purchase-orders/${detail.id}/receive`, { items: receiveLines }, 'Goods received; stock updated')}>Record goods received</button>}
          </div>
        </Modal>
      )}
    </>
  );
}
