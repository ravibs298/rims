import { useState } from 'react';
import { useAuth } from '../auth';
import { api } from '../api';
import { Badge, DataTable, ErrorBox, Form, Loading, Modal, pct, PageHeader, useAction, useQuery } from '../ui';

export default function Suppliers() {
  const { can } = useAuth();
  const act = useAction();
  const { data, loading, error, reload } = useQuery<any>('/suppliers');
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const write = can('suppliers.write');
  const fields = [
    { name: 'name', label: 'Name', required: true }, { name: 'contact_name', label: 'Contact' }, { name: 'email', label: 'Email', type: 'email' as const },
    { name: 'phone', label: 'Phone' }, { name: 'address', label: 'Address' }, { name: 'lead_time_days', label: 'Lead time (days)', type: 'number' as const },
  ];
  return (
    <>
      <PageHeader title="Suppliers">{write && <button className="primary" onClick={() => setEditing('new')}>New supplier</button>}</PageHeader>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <DataTable rowKey={(s: any) => s.id} rows={data?.data ?? []} empty="No suppliers yet." columns={[
          { header: 'Supplier', cell: (s: any) => s.name }, { header: 'Contact', cell: (s: any) => s.contact_name ?? '—' }, { header: 'Email', cell: (s: any) => s.email ?? '—' },
          { header: 'Lead (d)', cell: (s: any) => s.lead_time_days, align: 'right' }, { header: 'POs', cell: (s: any) => s.performance?.po_count ?? 0, align: 'right' },
          { header: 'Fill rate', cell: (s: any) => pct(s.performance?.fill_rate), align: 'right' }, { header: 'On-time', cell: (s: any) => pct(s.performance?.on_time_rate), align: 'right' },
          { header: 'Status', cell: (s: any) => <Badge tone={s.is_active ? 'ok' : 'bad'}>{s.is_active ? 'active' : 'inactive'}</Badge> },
          { header: '', cell: (s: any) => write && (<span className="actions"><button className="small" onClick={() => setEditing(s)}>Edit</button>
            <button className="small" onClick={() => act(() => api(`/suppliers/${s.id}`, { method: 'PATCH', body: { is_active: !s.is_active } }).then(reload), s.is_active ? 'Supplier deactivated' : 'Supplier activated')}>{s.is_active ? 'Deactivate' : 'Activate'}</button></span>) },
        ]} />
      )}
      {editing && (
        <Modal title={editing === 'new' ? 'New supplier' : `Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <Form fields={fields} initial={editing === 'new' ? { lead_time_days: 7 } : editing} onCancel={() => setEditing(null)}
            onSubmit={async (v) => { await api(editing === 'new' ? '/suppliers' : `/suppliers/${editing.id}`, { method: editing === 'new' ? 'POST' : 'PATCH', body: v }); setEditing(null); reload(); }} />
        </Modal>
      )}
    </>
  );
}
