import { useState } from 'react';
import { useAuth } from '../auth';
import { api } from '../api';
import { Badge, DataTable, ErrorBox, Form, Loading, Modal, PageHeader, statusTone, Tabs, useAction, useQuery, when } from '../ui';

export default function Integrations() {
  const { can } = useAuth();
  const act = useAction();
  const [tab, setTab] = useState('status');
  const status = useQuery<any>('/integrations/status');
  const events = useQuery<any>(tab === 'events' ? '/integrations/events' : null);
  const logs = useQuery<any>(tab === 'logs' ? '/integrations/logs' : null);
  const recon = useQuery<any>(tab === 'reconciliation' ? '/integrations/reconciliation' : null);
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const manage = can('integrations.manage');
  const refresh = () => { status.reload(); events.reload(); logs.reload(); recon.reload(); };
  const fields = [
    { name: 'name', label: 'Name (lowercase)', required: true }, { name: 'adapter_type', label: 'Adapter', type: 'select' as const, required: true, options: ['erp', 'accounting', 'webhook'].map((v) => ({ value: v, label: v })) },
    { name: 'direction', label: 'Direction', type: 'select' as const, required: true, options: ['inbound', 'outbound', 'both'].map((v) => ({ value: v, label: v })) },
    { name: 'base_url', label: 'Base URL (outbound)', placeholder: 'https://erp.example.com/api' },
    { name: 'secret_ref', label: 'Credential env var name', placeholder: 'INTEGRATION_ERP_TOKEN', hint: 'Only the variable NAME is stored. Set its value in the server environment / Kubernetes secret.' },
    { name: 'max_attempts', label: 'Max delivery attempts', type: 'number' as const }, { name: 'enabled', label: 'Enabled', type: 'checkbox' as const },
  ];
  return (
    <>
      <PageHeader title="Integrations">
        {manage && <button onClick={() => act(async () => { const r = await api('/integrations/events/process', { method: 'POST' }); refresh(); return r; }, 'Processed due events')}>Process due events</button>}
        {manage && <button className="primary" onClick={() => setEditing('new')}>New integration</button>}
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[['status', 'Status & configuration'], ['events', 'Events'], ['logs', 'Logs'], ['reconciliation', 'Reconciliation']]} />
      {testResult && <div className="panel" role="status">{testResult}</div>}
      {tab === 'status' && (status.loading && !status.data ? <Loading /> : <><ErrorBox error={status.error} />
        <DataTable rowKey={(s: any) => s.id} rows={status.data?.data ?? []} empty="No integrations configured. Nothing is connected." columns={[
          { header: 'Name', cell: (s: any) => s.name }, { header: 'Adapter', cell: (s: any) => s.adapter_type }, { header: 'Direction', cell: (s: any) => s.direction },
          { header: 'State', cell: (s: any) => <Badge tone={statusTone(s.state)}>{s.state.replace('_', ' ')}</Badge> }, { header: 'Credential', cell: (s: any) => (s.credential_present ? 'present' : 'missing') },
          { header: 'Events', cell: (s: any) => Object.entries(s.events).map(([k, n]) => `${k}: ${n}`).join(' · ') || '—' }, { header: 'Last success', cell: (s: any) => when(s.last_success_at) }, { header: 'Last error', cell: (s: any) => <span title={s.last_error ?? ''}>{s.last_error ? String(s.last_error).slice(0, 40) : '—'}</span> },
          { header: '', cell: (s: any) => manage && <span className="actions">
            <button className="small" onClick={async () => { setEditing((await api<any>('/integrations/configs')).data.find((c: any) => c.id === s.id)); }}>Edit</button>
            <button className="small" onClick={async () => { try { const r = await api('/integrations/configs/' + s.id + '/test', { method: 'POST' }); setTestResult(`${s.name}: ${r.ok ? 'connection OK' : 'FAILED — ' + r.error}`); } catch (e: any) { setTestResult(`${s.name}: ${e.message}`); } refresh(); }}>Test</button></span> },
        ]} /></>)}
      {tab === 'events' && <DataTable rowKey={(e: any) => e.id} rows={events.data?.data ?? []} empty="No events yet." columns={[
        { header: '#', cell: (e: any) => e.id }, { header: 'Integration', cell: (e: any) => e.config_name }, { header: 'Dir', cell: (e: any) => e.direction }, { header: 'Event', cell: (e: any) => e.event_type }, { header: 'Idempotency key', cell: (e: any) => e.idempotency_key },
        { header: 'Status', cell: (e: any) => <Badge tone={statusTone(e.status)}>{e.status}</Badge> }, { header: 'Attempts', cell: (e: any) => e.attempts, align: 'right' }, { header: 'Next attempt', cell: (e: any) => when(e.next_attempt_at) }, { header: 'Error', cell: (e: any) => <span title={e.last_error ?? ''}>{e.last_error ? String(e.last_error).slice(0, 50) : ''}</span> },
        { header: '', cell: (e: any) => manage && ['failed', 'dead'].includes(e.status) && <button className="small" onClick={() => act(async () => { await api(`/integrations/events/${e.id}/retry`, { method: 'POST' }); refresh(); }, 'Retry attempted')}>Retry</button> },
      ]} />}
      {tab === 'logs' && <DataTable rowKey={(l: any) => l.id} rows={logs.data?.data ?? []} empty="No log entries." columns={[{ header: 'When', cell: (l: any) => when(l.created_at) }, { header: 'Level', cell: (l: any) => <Badge tone={l.level === 'error' ? 'bad' : l.level === 'warn' ? 'warn' : 'neutral'}>{l.level}</Badge> }, { header: 'Message', cell: (l: any) => <span style={{ whiteSpace: 'normal' }}>{l.message}</span> }]} />}
      {tab === 'reconciliation' && (recon.data ? <div className="panel"><h2>{recon.data.ok ? <Badge tone="ok">Reconciled</Badge> : <Badge tone="bad">Attention needed</Badge>}</h2>
        <p>Inbound inventory events without ledger entry: <strong>{recon.data.inbound_inventory_events_without_ledger_entry.length}</strong></p>
        <p>Integration ledger entries without a succeeded event: <strong>{recon.data.integration_ledger_entries_without_succeeded_event.length}</strong></p>
        <p>Failed / dead events: <strong>{recon.data.failed_or_dead_events.length}</strong></p>
        <p>Internal ledger vs balances: <Badge tone={recon.data.internal_consistency.ok ? 'ok' : 'bad'}>{recon.data.internal_consistency.ok ? 'consistent' : 'inconsistent'}</Badge></p></div> : <Loading />)}
      {editing && (
        <Modal title={editing === 'new' ? 'New integration' : `Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <Form fields={fields} initial={editing === 'new' ? { max_attempts: 5, enabled: false } : editing} onCancel={() => setEditing(null)}
            onSubmit={async (v) => { await api(editing === 'new' ? '/integrations/configs' : `/integrations/configs/${editing.id}`, { method: editing === 'new' ? 'POST' : 'PATCH', body: v }); setEditing(null); refresh(); }} />
        </Modal>
      )}
    </>
  );
}
