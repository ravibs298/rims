import { useState } from 'react';
import { Badge, DataTable, ErrorBox, Loading, money, pct, PageHeader, Stat, statusTone, useLookups, useQuery } from '../ui';

export default function Dashboard() {
  const [f, setF] = useState<Record<string, string>>({});
  const lk = useLookups();
  const { data: d, loading, error } = useQuery<any>('/reports/dashboard', f);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const maxRev = Math.max(1, ...(d?.sales_trend ?? []).map((r: any) => r.revenue));
  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="filters">
        <label>From<input type="date" aria-label="From date" value={f.from ?? ''} onChange={(e) => set('from', e.target.value)} /></label>
        <label>To<input type="date" aria-label="To date" value={f.to ?? ''} onChange={(e) => set('to', e.target.value)} /></label>
        <label>Location<select aria-label="Location" value={f.location_id ?? ''} onChange={(e) => set('location_id', e.target.value)}><option value="">All</option>{lk.locationOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <label>Category<select aria-label="Category" value={f.category_id ?? ''} onChange={(e) => set('category_id', e.target.value)}><option value="">All</option>{lk.categoryOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <label>Product<select aria-label="Product" value={f.product_id ?? ''} onChange={(e) => set('product_id', e.target.value)}><option value="">All</option>{lk.productOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
      </div>
      <ErrorBox error={error} />
      {loading && !d ? <Loading /> : d && (
        <>
          <div className="grid" data-testid="kpis">
            <Stat label="Units on hand" value={d.inventory.on_hand} />
            <Stat label="Reserved" value={d.inventory.reserved} />
            <Stat label="Inventory valuation (cost)" value={money(d.inventory.valuation)} />
            <Stat label="Low-stock lines" value={d.inventory.low_stock_count} tone={d.inventory.low_stock_count ? 'warn' : ''} />
            <Stat label="Stockouts" value={d.inventory.stockout_count} tone={d.inventory.stockout_count ? 'bad' : ''} />
            <Stat label="Orders" value={d.orders.total_orders} />
            <Stat label="Fulfillment rate" value={pct(d.orders.fulfillment_rate)} />
            <Stat label="Avg fulfillment (h)" value={d.orders.avg_fulfillment_hours ?? '—'} />
            <Stat label="Revenue" value={money(d.sales.revenue)} />
            <Stat label="Open purchase orders" value={(d.purchase_orders.approved ?? 0) + (d.purchase_orders.partially_received ?? 0) + (d.purchase_orders.draft ?? 0)} />
          </div>
          <div className="panel">
            <h2>Sales trend</h2>
            {d.sales_trend.length === 0 ? <p className="muted">No sales in this period.</p> : (
              <DataTable rowKey={(r: any) => r.day} rows={d.sales_trend} columns={[
                { header: 'Day', cell: (r: any) => r.day }, { header: 'Orders', cell: (r: any) => r.orders, align: 'right' }, { header: 'Units', cell: (r: any) => r.units, align: 'right' },
                { header: 'Revenue', cell: (r: any) => money(r.revenue), align: 'right' }, { header: '', cell: (r: any) => <div className="bar" style={{ width: 160 }}><i style={{ width: `${(r.revenue / maxRev) * 100}%` }} /></div> },
              ]} />
            )}
          </div>
          <div className="panel">
            <h2>Low stock & stockout alerts</h2>
            <DataTable rowKey={(r: any) => r.sku + r.location_code} rows={d.low_stock} empty="No alerts. Stock levels are healthy." columns={[
              { header: 'SKU', cell: (r: any) => r.sku }, { header: 'Product', cell: (r: any) => r.name }, { header: 'Location', cell: (r: any) => r.location_code },
              { header: 'Available', cell: (r: any) => r.available, align: 'right' }, { header: 'Reorder point', cell: (r: any) => r.reorder_point, align: 'right' },
              { header: 'Level', cell: (r: any) => <Badge tone={r.available <= 0 ? 'bad' : 'warn'}>{r.available <= 0 ? 'stockout' : 'low'}</Badge> },
            ]} />
          </div>
          <div className="panel">
            <h2>Order status</h2>
            <p>{Object.entries(d.orders.by_status).map(([s, n]) => <span key={s} style={{ marginRight: 10 }}><Badge tone={statusTone(s)}>{s}</Badge> {n as number}</span>)}{Object.keys(d.orders.by_status).length === 0 && <span className="muted">No orders.</span>}</p>
          </div>
          <div className="panel">
            <h2>Supplier performance</h2>
            <DataTable rowKey={(r: any) => r.supplier_id} rows={d.suppliers} empty="No suppliers yet." columns={[
              { header: 'Supplier', cell: (r: any) => r.name }, { header: 'POs', cell: (r: any) => r.po_count, align: 'right' }, { header: 'Fill rate', cell: (r: any) => pct(r.fill_rate), align: 'right' },
              { header: 'On-time', cell: (r: any) => pct(r.on_time_rate), align: 'right' }, { header: 'Avg lead (days)', cell: (r: any) => r.avg_lead_days ?? '—', align: 'right' },
            ]} />
          </div>
        </>
      )}
    </>
  );
}
