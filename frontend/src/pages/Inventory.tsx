import { useState } from 'react';
import { useAuth } from '../auth';
import { api } from '../api';
import { Badge, DataTable, ErrorBox, Form, Loading, Modal, money, PageHeader, Pager, Stat, Tabs, useLookups, useQuery, useToast, when } from '../ui';

export default function Inventory() {
  const { can } = useAuth();
  const notify = useToast();
  const lk = useLookups();
  const [tab, setTab] = useState('balances');
  const [f, setF] = useState<Record<string, any>>({ page: 1, pageSize: 50 });
  const [dialog, setDialog] = useState<'receive' | 'adjust' | 'transfer' | null>(null);
  const balances = useQuery<any>(tab === 'balances' ? '/inventory/balances' : null, f);
  const movements = useQuery<any>(tab === 'movements' ? '/inventory/movements' : null, { ...f, pageSize: 50 });
  const transfers = useQuery<any>(tab === 'transfers' ? '/inventory/transfers' : null);
  const valuation = useQuery<any>(tab === 'valuation' ? '/inventory/valuation' : null, { location_id: f.location_id });
  const refresh = () => { balances.reload(); movements.reload(); transfers.reload(); valuation.reload(); };
  const loc = { name: 'location_id', label: 'Location', type: 'select' as const, numeric: true, required: true, options: lk.locationOptions };
  const prod = { name: 'product_id', label: 'Product', type: 'select' as const, numeric: true, required: true, options: lk.productOptions };
  const run = (path: string, ok: string) => async (v: any) => { await api(path, { method: 'POST', body: v }); notify(ok); setDialog(null); refresh(); };

  return (
    <>
      <PageHeader title="Inventory">
        {can('inventory.adjust') && <button onClick={() => setDialog('receive')}>Receive stock</button>}
        {can('inventory.adjust') && <button onClick={() => setDialog('adjust')}>Adjust stock</button>}
        {can('inventory.transfer') && <button className="primary" onClick={() => setDialog('transfer')}>Transfer stock</button>}
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[['balances', 'Balances'], ['movements', 'Movement ledger'], ['transfers', 'Transfers'], ['valuation', 'Valuation']]} />
      <div className="filters">
        <label>Location<select aria-label="Filter location" value={f.location_id ?? ''} onChange={(e) => setF({ ...f, location_id: e.target.value, page: 1 })}><option value="">All</option>{lk.locationOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        {tab !== 'transfers' && tab !== 'valuation' && <label>Product<select aria-label="Filter product" value={f.product_id ?? ''} onChange={(e) => setF({ ...f, product_id: e.target.value, page: 1 })}><option value="">All</option>{lk.productOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}
        {tab === 'balances' && <label className="check" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={f.low_stock === 'true'} onChange={(e) => setF({ ...f, low_stock: e.target.checked ? 'true' : '', page: 1 })} />Low stock only</label>}
      </div>
      {tab === 'balances' && (balances.loading && !balances.data ? <Loading /> : <><ErrorBox error={balances.error} />
        <DataTable rowKey={(b: any) => `${b.product_id}-${b.location_id}`} rows={balances.data?.data ?? []} empty="No stock records yet." columns={[
          { header: 'SKU', cell: (b: any) => b.sku }, { header: 'Product', cell: (b: any) => b.name }, { header: 'Location', cell: (b: any) => b.location_code },
          { header: 'On hand', cell: (b: any) => b.on_hand, align: 'right' }, { header: 'Reserved', cell: (b: any) => b.reserved, align: 'right' }, { header: 'Available', cell: (b: any) => b.available, align: 'right' },
          { header: 'Value', cell: (b: any) => money(b.value), align: 'right' },
          { header: 'Alert', cell: (b: any) => (b.available <= 0 ? <Badge tone="bad">stockout</Badge> : b.available <= b.reorder_point ? <Badge tone="warn">low</Badge> : null) },
        ]} />
        <Pager page={f.page} pageSize={f.pageSize} total={balances.data?.total ?? 0} onPage={(page) => setF({ ...f, page })} /></>)}
      {tab === 'movements' && <><ErrorBox error={movements.error} /><DataTable rowKey={(m: any) => m.id} rows={movements.data?.data ?? []} empty="No movements." columns={[
        { header: 'When', cell: (m: any) => when(m.created_at) }, { header: 'Type', cell: (m: any) => <Badge tone="info">{m.movement_type}</Badge> }, { header: 'SKU', cell: (m: any) => m.sku }, { header: 'Location', cell: (m: any) => m.location_code },
        { header: 'Δ On hand', cell: (m: any) => m.on_hand_delta, align: 'right' }, { header: 'Δ Reserved', cell: (m: any) => m.reserved_delta, align: 'right' }, { header: 'On hand after', cell: (m: any) => m.on_hand_after, align: 'right' },
        { header: 'Reference', cell: (m: any) => (m.reference_type ? `${m.reference_type} #${m.reference_id}` : '—') }, { header: 'Reason', cell: (m: any) => m.reason ?? '' }, { header: 'User', cell: (m: any) => m.user_email ?? 'system' },
      ]} /></>}
      {tab === 'transfers' && <DataTable rowKey={(t: any) => t.id} rows={transfers.data?.data ?? []} empty="No transfers yet." columns={[
        { header: 'When', cell: (t: any) => when(t.created_at) }, { header: 'SKU', cell: (t: any) => t.sku }, { header: 'From', cell: (t: any) => t.from_code }, { header: 'To', cell: (t: any) => t.to_code }, { header: 'Qty', cell: (t: any) => t.quantity, align: 'right' }, { header: 'Note', cell: (t: any) => t.note ?? '' },
      ]} />}
      {tab === 'valuation' && (valuation.data ? <>
        <div className="grid"><Stat label="Total units" value={valuation.data.total.units} /><Stat label="Total value (on hand × cost)" value={money(valuation.data.total.value)} /></div>
        <DataTable rowKey={(r: any) => r.location_id} rows={valuation.data.by_location} columns={[{ header: 'Location', cell: (r: any) => `${r.code} — ${r.name}` }, { header: 'Units', cell: (r: any) => r.units, align: 'right' }, { header: 'Value', cell: (r: any) => money(r.value), align: 'right' }]} /></> : <Loading />)}

      {dialog === 'receive' && <Modal title="Receive stock" onClose={() => setDialog(null)}><Form fields={[prod, loc, { name: 'quantity', label: 'Quantity', type: 'number', required: true }, { name: 'reason', label: 'Reason / reference' }]} submitLabel="Receive" onSubmit={run('/inventory/receipts', 'Stock received')} onCancel={() => setDialog(null)} /></Modal>}
      {dialog === 'adjust' && <Modal title="Adjust stock" onClose={() => setDialog(null)}><Form fields={[prod, loc, { name: 'delta', label: 'Change (+/−)', type: 'number', required: true, hint: 'Negative to remove stock' }, { name: 'reason', label: 'Reason', required: true }]} submitLabel="Apply adjustment" onSubmit={run('/inventory/adjustments', 'Adjustment recorded')} onCancel={() => setDialog(null)} /></Modal>}
      {dialog === 'transfer' && <Modal title="Transfer stock" onClose={() => setDialog(null)}><Form fields={[prod, { ...loc, name: 'from_location_id', label: 'From' }, { ...loc, name: 'to_location_id', label: 'To' }, { name: 'quantity', label: 'Quantity', type: 'number', required: true }, { name: 'note', label: 'Note' }]} submitLabel="Transfer" onSubmit={run('/inventory/transfers', 'Transfer completed')} onCancel={() => setDialog(null)} /></Modal>}
    </>
  );
}
