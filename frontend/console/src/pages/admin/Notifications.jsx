import { useState } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Pagination } from '@/components/common/DataTable';
import { StatCard } from '@/components/common/StatCard';
import { Select } from '@/components/ui/input';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { usePaged } from '@/hooks/queries';
import { fmtDateTime } from '@/lib/utils';

export default function Notifications() {
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = usePaged(['/admin/notifications'], '/admin/notifications', { channel: channel || undefined, status: status || undefined, page, limit: 50 }, { refetchInterval: 30_000 });
  const qc = data?.meta?.queue;
  return (
    <div>
      <PageHeader title="Notifications" description="SMS, WhatsApp, email and webhook deliveries" />
      {qc && <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Waiting" value={qc.waiting} /><StatCard label="Scheduled (reminders)" value={qc.delayed} tone="sky" /><StatCard label="Active" value={qc.active} tone="emerald" /><StatCard label="Failed" value={qc.failed} tone="red" />
      </div>}
      <div className="mb-3 flex gap-2">
        <Select className="w-36" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="All channels">{['sms', 'whatsapp', 'email', 'webhook'].map((c) => <option key={c}>{c}</option>)}</Select>
        <Select className="w-36" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses">{['sent', 'failed', 'skipped'].map((c) => <option key={c}>{c}</option>)}</Select>
      </div>
      <DataTable loading={isLoading} rows={data?.items} footer={<Pagination meta={data?.meta} page={page} setPage={setPage} />} columns={[
        { key: 't', header: 'When', cell: (n) => fmtDateTime(n.createdAt) },
        { key: 'c', header: 'Channel', cell: (n) => <Badge variant="outline">{n.channel}</Badge> },
        { key: 'e', header: 'Event / template', cell: (n) => <div className="text-xs"><p>{n.event}</p><p className="text-muted-foreground">{n.template}</p></div> },
        { key: 'to', header: 'To', cell: (n) => <span className="text-xs">{n.to}</span> },
        { key: 's', header: 'Status', cell: (n) => <StatusBadge status={n.status} /> },
        { key: 'err', header: 'Error', cell: (n) => <span className="text-xs text-red-600">{n.error}</span> },
      ]} />
    </div>
  );
}
