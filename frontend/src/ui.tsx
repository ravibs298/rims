import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from './api';

// ---------- data fetching ----------
export function useQuery<T = any>(path: string | null, query?: Record<string, unknown>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const key = path ? path + JSON.stringify(query ?? {}) : '';
  const seq = useRef(0);
  const run = useCallback(() => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    api<T>(path, { query })
      .then((d) => id === seq.current && (setData(d), setError(null)))
      .catch((e) => id === seq.current && setError(e))
      .finally(() => id === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(run, [run]);
  return { data, error, loading, reload: run };
}

// ---------- notifications ----------
type Kind = 'success' | 'error';
const ToastCtx = createContext<(msg: string, kind?: Kind) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: Kind }[]>([]);
  const notify = useCallback((msg: string, kind: Kind = 'success') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={notify}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((i) => <div key={i.id} className={`toast ${i.kind}`}>{i.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/** Runs an async action with toast feedback; returns true on success. */
export function useAction() {
  const notify = useToast();
  return useCallback(async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); notify(ok); return true; } catch (e: any) { notify(e?.message ?? 'Something went wrong', 'error'); return false; }
  }, [notify]);
}

// ---------- layout primitives ----------
export const Loading = () => <p className="muted pad" aria-busy="true">Loading…</p>;
export const ErrorBox = ({ error }: { error: ApiError | null }) => (error ? <div className="alert" role="alert">{error.message}</div> : null);
export const Badge = ({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'neutral' | 'info' }) => <span className={`badge ${tone}`}>{children}</span>;
export const statusTone = (s: string) => (['succeeded', 'received', 'delivered', 'fulfilled', 'ok', 'ready', 'approved'].includes(s) ? 'ok' : ['failed', 'partially_received', 'low', 'reserved', 'draft', 'pending', 'not_configured', 'shipped'].includes(s) ? 'warn' : ['dead', 'cancelled', 'stockout', 'disabled'].includes(s) ? 'bad' : 'neutral') as any;

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="page-header"><h1>{title}</h1><div className="actions">{children}</div></div>;
}
export const Stat = ({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) => (
  <div className={`stat ${tone ?? ''}`}><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div>
);
export function Tabs({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (v: string) => void }) {
  return <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'active' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="icon" aria-label="Close" onClick={onClose}>×</button></div>
        {children}
      </div>
    </div>
  );
}

export interface Column<T> { header: string; cell: (row: T) => ReactNode; align?: 'right' }
export function DataTable<T>({ columns, rows, empty = 'Nothing to show.', rowKey }: { columns: Column<T>[]; rows: T[]; empty?: string; rowKey: (r: T) => string | number }) {
  if (!rows.length) return <p className="muted pad">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{columns.map((c) => <th key={c.header} className={c.align}>{c.header}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={rowKey(r)}>{columns.map((c) => <td key={c.header} className={c.align}>{c.cell(r)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager">
      <span className="muted">{total} result{total === 1 ? '' : 's'}</span>
      <button disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span>Page {page} of {pages}</span>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

export const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(n)));
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(Number(n) * 100)}%`);
export const when = (s?: string | null) => (s ? new Date(s).toLocaleString() : '—');

// ---------- forms ----------
export interface FieldDef {
  name: string; label: string; type?: 'text' | 'number' | 'email' | 'password' | 'select' | 'textarea' | 'date' | 'checkbox';
  options?: { value: string | number; label: string }[]; required?: boolean; step?: string; hint?: string; numeric?: boolean; placeholder?: string;
}

export function toPayload(fields: FieldDef[], values: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const f of fields) {
    const v = values[f.name];
    if (f.type === 'checkbox') { out[f.name] = Boolean(v); continue; }
    if (v === undefined || v === null || v === '') continue;
    out[f.name] = f.type === 'number' || (f.type === 'select' && f.numeric) ? Number(v) : v;
  }
  return out;
}

export function Form({ fields, initial = {}, submitLabel = 'Save', onSubmit, onCancel, children }: {
  fields: FieldDef[]; initial?: Record<string, any>; submitLabel?: string; onSubmit: (v: Record<string, any>) => Promise<void>; onCancel?: () => void; children?: ReactNode;
}) {
  const [values, setValues] = useState<Record<string, any>>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const set = (n: string, v: any) => setValues((x) => ({ ...x, [n]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await onSubmit(toPayload(fields, values)); } catch (err: any) { setError(err); } finally { setBusy(false); }
  };
  const detailLines = useMemo(() => (Array.isArray(error?.details) ? error!.details.filter((d: any) => d?.path).map((d: any) => `${d.path}: ${d.message}`) : []), [error]);
  return (
    <form onSubmit={submit} className="form">
      {fields.map((f) => (
        <label key={f.name} className={f.type === 'checkbox' ? 'check' : ''}>
          <span>{f.label}{f.required ? ' *' : ''}</span>
          {f.type === 'select' ? (
            <select name={f.name} required={f.required} value={values[f.name] ?? ''} onChange={(e) => set(f.name, e.target.value)}>
              <option value="">{f.required ? 'Select…' : '—'}</option>
              {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : f.type === 'textarea' ? (
            <textarea name={f.name} required={f.required} rows={3} value={values[f.name] ?? ''} onChange={(e) => set(f.name, e.target.value)} />
          ) : f.type === 'checkbox' ? (
            <input name={f.name} type="checkbox" checked={Boolean(values[f.name])} onChange={(e) => set(f.name, e.target.checked)} />
          ) : (
            <input name={f.name} type={f.type ?? 'text'} step={f.step} required={f.required} placeholder={f.placeholder} value={values[f.name] ?? ''} onChange={(e) => set(f.name, e.target.value)} />
          )}
          {f.hint && <small className="muted">{f.hint}</small>}
        </label>
      ))}
      {children}
      {error && <div className="alert" role="alert">{error.message}{detailLines.length > 0 && <ul>{detailLines.map((l) => <li key={l}>{l}</li>)}</ul>}</div>}
      <div className="form-actions">
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Working…' : submitLabel}</button>
      </div>
    </form>
  );
}

export interface Line { product_id: string; quantity: string; unit_cost?: string }
export function LineItems({ products, value, onChange, showCost }: { products: { id: number; sku: string; name: string }[]; value: Line[]; onChange: (l: Line[]) => void; showCost?: boolean }) {
  const upd = (i: number, patch: Partial<Line>) => onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="lines">
      {value.map((l, i) => (
        <div className="line" key={i}>
          <select aria-label={`Product ${i + 1}`} name={`product_${i}`} value={l.product_id} onChange={(e) => upd(i, { product_id: e.target.value })}>
            <option value="">Select product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
          </select>
          <input aria-label={`Quantity ${i + 1}`} name={`qty_${i}`} type="number" min={1} placeholder="Qty" value={l.quantity} onChange={(e) => upd(i, { quantity: e.target.value })} />
          {showCost && <input aria-label={`Unit cost ${i + 1}`} name={`cost_${i}`} type="number" min={0} step="0.01" placeholder="Unit cost" value={l.unit_cost ?? ''} onChange={(e) => upd(i, { unit_cost: e.target.value })} />}
          <button type="button" className="icon" aria-label={`Remove line ${i + 1}`} disabled={value.length === 1} onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="ghost" onClick={() => onChange([...value, { product_id: '', quantity: '' }])}>+ Add line</button>
    </div>
  );
}
export const cleanLines = (ls: Line[], showCost?: boolean) =>
  ls.filter((l) => l.product_id && l.quantity).map((l) => ({ product_id: Number(l.product_id), quantity: Number(l.quantity), ...(showCost && l.unit_cost ? { unit_cost: Number(l.unit_cost) } : {}) }));

// ---------- shared lookups ----------
export function useLookups() {
  const locations = useQuery<{ data: any[] }>('/locations');
  const products = useQuery<{ data: any[] }>('/products', { active: 'true', pageSize: 100 });
  const categories = useQuery<{ data: any[] }>('/categories');
  return {
    locations: locations.data?.data ?? [],
    products: products.data?.data ?? [],
    categories: categories.data?.data ?? [],
    locationOptions: (locations.data?.data ?? []).map((l) => ({ value: l.id, label: `${l.code} — ${l.name}` })),
    productOptions: (products.data?.data ?? []).map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` })),
    categoryOptions: (categories.data?.data ?? []).map((c) => ({ value: c.id, label: c.name })),
    reload: () => { locations.reload(); products.reload(); categories.reload(); },
  };
}
