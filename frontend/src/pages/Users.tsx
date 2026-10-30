import { useState } from 'react';
import { useAuth } from '../auth';
import { api } from '../api';
import { Badge, DataTable, ErrorBox, Form, Loading, Modal, PageHeader, Tabs, useAction, useLookups, useQuery, when } from '../ui';

const ROLES = ['Admin', 'Catalog Manager', 'Inventory Manager', 'Store Manager', 'Order Manager', 'Supplier Manager', 'Analyst', 'Viewer'];

export default function Users() {
  const { can } = useAuth();
  const act = useAction();
  const lk = useLookups();
  const [tab, setTab] = useState('users');
  const users = useQuery<any>('/users');
  const roles = useQuery<any>(tab === 'roles' ? '/roles' : null);
  const audit = useQuery<any>(tab === 'audit' && can('audit.read') ? '/audit-logs' : null, { pageSize: 100 });
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const write = can('users.write');
  const fields = (isNew: boolean) => [
    ...(isNew ? [{ name: 'email', label: 'Email', type: 'email' as const, required: true }] : []),
    { name: 'full_name', label: 'Full name', required: true },
    { name: 'role', label: 'Role', type: 'select' as const, required: true, options: ROLES.map((r) => ({ value: r, label: r })), hint: 'Granting Admin is recorded in the audit log.' },
    { name: 'password', label: isNew ? 'Password' : 'New password (leave blank to keep)', type: 'password' as const, required: isNew, hint: 'Min 12 characters with a letter and a digit.' },
    ...(!isNew ? [{ name: 'is_active', label: 'Active', type: 'checkbox' as const }] : []),
  ];
  return (
    <>
      <PageHeader title="Users & Roles">{write && <button className="primary" onClick={() => setEditing('new')}>New user</button>}</PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[['users', 'Users'], ['roles', 'Roles & permissions'], ...(can('audit.read') ? [['audit', 'Audit log'] as [string, string]] : [])]} />
      {tab === 'users' && (users.loading && !users.data ? <Loading /> : <><ErrorBox error={users.error} /><DataTable rowKey={(u: any) => u.id} rows={users.data?.data ?? []} columns={[
        { header: 'Name', cell: (u: any) => u.full_name }, { header: 'Email', cell: (u: any) => u.email }, { header: 'Role', cell: (u: any) => <Badge tone={u.role === 'Admin' ? 'warn' : 'info'}>{u.role}</Badge> },
        { header: 'Locations', cell: (u: any) => (u.location_ids.length ? u.location_ids.map((id: number) => lk.locations.find((l: any) => l.id === id)?.code ?? id).join(', ') : 'all/none by role') },
        { header: 'Last login', cell: (u: any) => when(u.last_login_at) }, { header: 'Status', cell: (u: any) => <Badge tone={u.is_active ? 'ok' : 'bad'}>{u.is_active ? 'active' : 'disabled'}</Badge> },
        { header: '', cell: (u: any) => write && <button className="small" onClick={() => setEditing(u)}>Edit</button> },
      ]} /></>)}
      {tab === 'roles' && <DataTable rowKey={(r: any) => r.id} rows={roles.data?.data ?? []} columns={[{ header: 'Role', cell: (r: any) => r.name }, { header: 'Description', cell: (r: any) => r.description }, { header: 'Permissions', cell: (r: any) => <span style={{ whiteSpace: 'normal' }}>{r.permissions.join(', ')}</span> }]} />}
      {tab === 'audit' && <DataTable rowKey={(a: any) => a.id} rows={audit.data?.data ?? []} empty="No audit entries." columns={[
        { header: 'When', cell: (a: any) => when(a.created_at) }, { header: 'User', cell: (a: any) => a.user_email ?? 'system' }, { header: 'Action', cell: (a: any) => <Badge tone={a.action.startsWith('admin.') ? 'warn' : 'neutral'}>{a.action}</Badge> },
        { header: 'Entity', cell: (a: any) => `${a.entity_type} ${a.entity_id ?? ''}` }, { header: 'IP', cell: (a: any) => a.ip ?? '' }]} />}
      {editing && (
        <Modal title={editing === 'new' ? 'New user' : `Edit ${editing.full_name}`} onClose={() => setEditing(null)}>
          <Form fields={fields(editing === 'new')} initial={editing === 'new' ? {} : { ...editing, password: '' }} onCancel={() => setEditing(null)}
            onSubmit={async (v) => {
              const body = { ...v };
              if (editing === 'new') await api('/users', { method: 'POST', body });
              else await api(`/users/${editing.id}`, { method: 'PATCH', body });
              setEditing(null); users.reload();
            }} />
          <LocationEditor user={editing} locations={lk.locations} onSaved={() => { users.reload(); act(async () => undefined, 'Locations updated'); }} />
        </Modal>
      )}
    </>
  );
}

function LocationEditor({ user, locations, onSaved }: { user: any; locations: any[]; onSaved: () => void }) {
  const [sel, setSel] = useState<number[]>(user === 'new' ? [] : user.location_ids ?? []);
  const [err, setErr] = useState<any>(null);
  if (user === 'new') return <p className="muted">Save the user first, then restrict their locations.</p>;
  return (
    <div>
      <h3>Location access</h3>
      <p className="muted">Store Managers can only act on assigned locations. Leave empty for the role default.</p>
      {locations.map((l) => (
        <label key={l.id} style={{ display: 'block' }}><input type="checkbox" checked={sel.includes(l.id)} onChange={(e) => setSel(e.target.checked ? [...sel, l.id] : sel.filter((x) => x !== l.id))} /> {l.code} — {l.name}</label>
      ))}
      <ErrorBox error={err} />
      <div className="form-actions"><button onClick={async () => { try { await api(`/users/${user.id}`, { method: 'PATCH', body: { location_ids: sel } }); onSaved(); } catch (e) { setErr(e); } }}>Save locations</button></div>
    </div>
  );
}
