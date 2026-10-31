import { useState } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Pagination } from '@/components/common/DataTable';
import { Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { usePaged } from '@/hooks/queries';
import { useDebounce } from '@/hooks/useDebounce';
import { fmtDateTime } from '@/lib/utils';

const ENTITIES = ['Patient', 'Appointment', 'MedicalRecord', 'Prescription', 'PatientDocument', 'Invoice', 'Payment', 'Batch', 'PurchaseOrder', 'StockTransfer', 'Lead', 'User', 'Role', 'Branch', 'Doctor', 'DoctorSchedule', 'ScheduleException', 'Expense', 'Settings'];

export default function AuditLogs() {
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const da = useDebounce(action);
  const { data, isLoading } = usePaged(['/audit-logs'], '/audit-logs', { action: da || undefined, entity: entity || undefined, from: from || undefined, page, limit: 50 });
  return (
    <div>
      <PageHeader title="Audit logs" description="Every create, edit, export and medical-record view" />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input className="w-56" placeholder="Action prefix e.g. medical_records" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />
        <Select className="w-48" value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="All entities">{ENTITIES.map((e) => <option key={e}>{e}</option>)}</Select>
        <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <DataTable loading={isLoading} rows={data?.items} onRowClick={setOpen} footer={<Pagination meta={data?.meta} page={page} setPage={setPage} />} columns={[
        { key: 't', header: 'When', cell: (l) => fmtDateTime(l.createdAt) },
        { key: 'u', header: 'Actor', cell: (l) => (l.actorType === 'staff' ? l.user?.name : <Badge variant="secondary">{l.actorType}</Badge>) },
        { key: 'a', header: 'Action', cell: (l) => <span className="font-mono text-xs">{l.action}</span> },
        { key: 'e', header: 'Entity', cell: (l) => l.entity || '—' },
        { key: 'b', header: 'Branch', cell: (l) => l.branch?.code || '—' },
        { key: 'ip', header: 'IP', cell: (l) => <span className="text-xs text-muted-foreground">{l.ip}</span> },
      ]} />
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent title={open?.action} size="xl">
          <div className="grid gap-3 text-xs lg:grid-cols-2">
            <div><p className="mb-1 font-semibold">Before</p><pre className="max-h-96 overflow-auto rounded bg-muted p-2">{JSON.stringify(open?.before, null, 2) || '—'}</pre></div>
            <div><p className="mb-1 font-semibold">After</p><pre className="max-h-96 overflow-auto rounded bg-muted p-2">{JSON.stringify(open?.after ?? open?.meta, null, 2) || '—'}</pre></div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
