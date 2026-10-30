import { useState } from 'react';
import { Badge, DataTable, ErrorBox, Loading, money, pct, PageHeader, Stat, statusTone, Tabs, useLookups, useQuery } from '../ui';

export default function Reports() {
  const lk = useLookups();
  const [tab, setTab] = useState('levels');
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string, val: string) => setF((x) => ({ ...x, [k]: val }));
  const path = { levels: '/reports/inventory-levels', sales: '/reports/sales-trend', fulfillment: '/reports/fulfillment', suppliers: '/reports/suppliers', reconciliation: '/reports/reconciliation' }[tab]!;
  const { data, loading, error } = useQuery<any>(path, f);
  return (
    <>
      <PageHeader title="Reports & Analytics" />
      <Tabs value={tab} onChange={setTab} tabs={[['levels', 'Inventory levels'], ['sales', 'Sales trend'], ['fulfillment', 'Order fulfillment'], ['suppliers', 'Supplier performance'], ['reconciliation', 'Reconciliation']]} />
      <div className="filters">
        <label>From<input type="date" aria-label="From date" value={f.from ?? ''} onChange={(e) => set('from', e.target.value)} /></label>
        <label>To<input type="date" aria-label="To date" value={f.to ?? ''} onChange={(e) => set('to', e.target.value)} /></label>
        <label>Location<select aria-label="Location" value={f.location_id ?? ''} onChange={(e) => set('location_id', e.target.value)}><option value="">All</option>{lk.locationOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <label>Category<select aria-label="Category" value={f.category_id ?? ''} onChange={(e) => set('category_id', e.target.value)}><option value="">All</option>{lk.categoryOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <label>Product<select aria-label="Product" value={f.product_id ?? ''} onChange={(e) => set('product_id', e.target.value)}><option value="">All</option>{lk.productOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : data && (<>
        {tab === 'levels' && <DataTable rowKey={(r: any) => r.product_id} rows={data.data} empty="No stock for these filters." columns={[
          { header: 'SKU', cell: (r: any) => r.sku }, { header: 'Product', cell: (r: any) => r.name }, { header: 'Category', cell: (r: any) => r.category_name ?? '—' }, { header: 'On hand', cell: (r: any) => r.on_hand, align: 'right' },
          { header: 'Reserved', cell: (r: any) => r.reserved, align: 'right' }, { header: 'Available', cell: (r: any) => r.available, align: 'right' }, { header: 'Value', cell: (r: any) => money(r.value), align: 'right' }, { header: 'Status', cell: (r: any) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> }]} />}
        {tab === 'sales' && <><div className="grid"><Stat label="Orders" value={data.totals.orders} /><Stat label="Units" value={data.totals.units} /><Stat label="Revenue" value={money(data.totals.revenue)} /></div>
          <DataTable rowKey={(r: any) => r.day} rows={data.data} empty="No sales for these filters." columns={[{ header: 'Day', cell: (r: any) => r.day }, { header: 'Orders', cell: (r: any) => r.orders, align: 'right' }, { header: 'Units', cell: (r: any) => r.units, align: 'right' }, { header: 'Revenue', cell: (r: any) => money(r.revenue), align: 'right' }]} /></>}
        {tab === 'fulfillment' && <div className="grid"><Stat label="Total orders" value={data.total_orders} /><Stat label="Fulfilled" value={data.fulfilled_orders} /><Stat label="Open (reserved)" value={data.open_orders} /><Stat label="Cancelled" value={data.cancelled_orders} /><Stat label="Fulfillment rate" value={pct(data.fulfillment_rate)} /><Stat label="Avg hours to fulfil" value={data.avg_fulfillment_hours ?? '—'} /></div>}
        {tab === 'suppliers' && <DataTable rowKey={(r: any) => r.supplier_id} rows={data.data} empty="No suppliers." columns={[
          { header: 'Supplier', cell: (r: any) => r.name }, { header: 'POs', cell: (r: any) => r.po_count, align: 'right' }, { header: 'Completed', cell: (r: any) => r.completed_count, align: 'right' }, { header: 'Units ordered', cell: (r: any) => r.units_ordered, align: 'right' },
          { header: 'Units received', cell: (r: any) => r.units_received, align: 'right' }, { header: 'Fill rate', cell: (r: any) => pct(r.fill_rate), align: 'right' }, { header: 'On-time', cell: (r: any) => pct(r.on_time_rate), align: 'right' }, { header: 'Avg lead (d)', cell: (r: any) => r.avg_lead_days ?? '—', align: 'right' }]} />}
        {tab === 'reconciliation' && <div className="panel"><h2>{data.ok ? <Badge tone="ok">All checks passed</Badge> : <Badge tone="bad">Discrepancies found</Badge>}</h2>
          {Object.entries<any>(data.checks).map(([k, c]) => <div key={k}><h3>{k.replace(/_/g, ' ')}</h3><p className="muted">{c.description}</p><p>{c.discrepancies.length === 0 ? 'No discrepancies.' : `${c.discrepancies.length} discrepancies`}</p>{c.discrepancies.length > 0 && <pre>{JSON.stringify(c.discrepancies.slice(0, 20), null, 2)}</pre>}</div>)}</div>}
      </>)}
    </>
  );
}
