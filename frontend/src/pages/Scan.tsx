import { useState } from 'react';
import { useAuth } from '../auth';
import { api } from '../api';
import { Badge, DataTable, ErrorBox, PageHeader, useLookups, useQuery, when } from '../ui';

export default function Scan() {
  const { can } = useAuth();
  const lk = useLookups();
  const readers = useQuery<{ data: string[] }>('/scan/rfid/readers');
  const events = useQuery<any>('/scan/events');
  const [v, setV] = useState<Record<string, string>>({ id_type: 'barcode', action: 'receive', quantity: '1' });
  const [product, setProduct] = useState<any | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [err, setErr] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, val: string) => setV((x) => ({ ...x, [k]: val }));
  const base = () => ({ id_type: v.id_type, value: v.value, ...(v.reader ? { reader: v.reader } : {}) });

  const lookup = async () => {
    setBusy(true); setErr(null); setResult(null);
    try { setProduct((await api('/scan/resolve', { method: 'POST', body: base() })).product); } catch (e) { setProduct(null); setErr(e); } finally { setBusy(false); events.reload(); }
  };
  const execute = async () => {
    setBusy(true); setErr(null); setResult(null);
    const n = (k: string) => (v[k] ? Number(v[k]) : undefined);
    try {
      const r = await api('/scan/actions', { method: 'POST', body: { ...base(), action: v.action, quantity: n('quantity'), location_id: n('location_id'), to_location_id: n('to_location_id'), order_id: n('order_id'), po_id: n('po_id') } });
      setProduct(r.product); setResult(r);
    } catch (e) { setErr(e); } finally { setBusy(false); events.reload(); }
  };
  const a = v.action;
  return (
    <>
      <PageHeader title="Barcode & RFID Workflows" />
      <div className="panel">
        <p className="muted">Enter or scan a barcode (UPC/EAN/SKU) or an RFID EPC. A USB/Bluetooth scanner works as a keyboard: focus the field and scan.</p>
        <div className="filters">
          <label>Identifier type<select aria-label="Identifier type" value={v.id_type} onChange={(e) => set('id_type', e.target.value)}><option value="barcode">Barcode / SKU</option><option value="rfid">RFID (EPC)</option></select></label>
          {v.id_type === 'rfid' && <label>Reader adapter<select aria-label="Reader" value={v.reader ?? ''} onChange={(e) => set('reader', e.target.value)}><option value="">generic</option>{(readers.data?.data ?? []).map((r) => <option key={r}>{r}</option>)}</select></label>}
          <label>Scan / identifier<input aria-label="Identifier value" name="value" autoFocus value={v.value ?? ''} onChange={(e) => set('value', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && v.value && lookup()} /></label>
          <button onClick={lookup} disabled={!v.value || busy}>Look up product</button>
        </div>
        {product && <p>Resolved: <strong>{product.sku}</strong> — {product.name} <Badge tone="info">matched by {product.matched_by}</Badge> {!product.is_active && <Badge tone="bad">inactive</Badge>}</p>}
      </div>
      <div className="panel">
        <h2>Action</h2>
        <div className="filters">
          <label>Workflow<select aria-label="Workflow" value={a} onChange={(e) => set('action', e.target.value)}>
            {(can('inventory.adjust') || can('po.receive')) && <option value="receive">Receive stock</option>}{can('inventory.adjust') && <option value="count">Stock count</option>}
            {can('inventory.transfer') && <option value="transfer">Transfer</option>}{can('orders.fulfill') && <option value="fulfill">Order picking / fulfillment</option>}</select></label>
          {['receive', 'count', 'transfer'].includes(a) && <label>{a === 'transfer' ? 'From location' : 'Location'}<select aria-label="Location" value={v.location_id ?? ''} onChange={(e) => set('location_id', e.target.value)}><option value="">Select…</option>{lk.locationOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}
          {a === 'transfer' && <label>To location<select aria-label="To location" value={v.to_location_id ?? ''} onChange={(e) => set('to_location_id', e.target.value)}><option value="">Select…</option>{lk.locationOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}
          {a === 'receive' && <label>Purchase order ID (optional)<input name="po_id" type="number" value={v.po_id ?? ''} onChange={(e) => set('po_id', e.target.value)} /></label>}
          {a === 'fulfill' && <label>Order ID<input name="order_id" type="number" value={v.order_id ?? ''} onChange={(e) => set('order_id', e.target.value)} /></label>}
          <label>{a === 'count' ? 'Counted quantity' : 'Quantity'}<input name="quantity" type="number" min={a === 'count' ? 0 : 1} value={v.quantity ?? ''} onChange={(e) => set('quantity', e.target.value)} /></label>
          <button className="primary" onClick={execute} disabled={!v.value || busy}>Execute</button>
        </div>
        <ErrorBox error={err} />
        {result && <div className="panel" role="status" data-testid="scan-result"><strong>Done.</strong> <code>{JSON.stringify(result.result)}</code></div>}
      </div>
      <div className="panel">
        <h2>Recent scans</h2>
        <DataTable rowKey={(e: any) => e.id} rows={events.data?.data ?? []} empty="No scans yet." columns={[
          { header: 'When', cell: (e: any) => when(e.created_at) }, { header: 'Type', cell: (e: any) => e.id_type }, { header: 'Value', cell: (e: any) => e.value }, { header: 'SKU', cell: (e: any) => e.sku ?? '—' },
          { header: 'Action', cell: (e: any) => e.action }, { header: 'Qty', cell: (e: any) => e.quantity ?? '', align: 'right' }, { header: 'Result', cell: (e: any) => <Badge tone={e.result === 'ok' ? 'ok' : 'bad'}>{e.result}</Badge> }, { header: 'User', cell: (e: any) => e.user_email },
        ]} />
      </div>
    </>
  );
}
