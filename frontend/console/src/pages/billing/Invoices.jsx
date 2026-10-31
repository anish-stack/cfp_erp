import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Pagination } from '@/components/common/DataTable';
import { SearchInput } from '@/components/common/SearchInput';
import { StatCard } from '@/components/common/StatCard';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { Can } from '@/components/common/Can';
import { usePaged } from '@/hooks/queries';
import { useDebounce } from '@/hooks/useDebounce';
import { fmtDateTime, inr, todayIST, addDays } from '@/lib/utils';

export default function Invoices() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState(addDays(todayIST(), -30));
  const [to, setTo] = useState(todayIST());
  const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  const { data, isLoading } = usePaged(['/billing/invoices'], '/billing/invoices', { q: dq || undefined, status: status || undefined, type: type || undefined, from, to, page, limit: 25 });
  const s = data?.meta?.sums;
  return (
    <div>
      <PageHeader title="Invoices" actions={<Can perm="billing.create"><Button onClick={() => nav('/billing/new')}><Plus /> New invoice</Button></Can>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Billed" value={inr(s?.total)} loading={isLoading} />
        <StatCard label="Collected" value={inr(s?.paid)} loading={isLoading} tone="emerald" />
        <StatCard label="Outstanding" value={inr(s?.balance)} loading={isLoading} tone="amber" />
        <StatCard label="Refunded" value={inr(s?.refunded)} loading={isLoading} tone="red" />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Invoice no, patient, mobile" />
        <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        <Select className="w-36" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses">{['unpaid', 'partial', 'paid', 'partially_refunded', 'refunded', 'cancelled'].map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</Select>
        <Select className="w-36" value={type} onChange={(e) => setType(e.target.value)} placeholder="All types">{['consultation', 'treatment', 'procedure', 'pharmacy', 'mixed'].map((x) => <option key={x}>{x}</option>)}</Select>
      </div>
      <DataTable loading={isLoading} rows={data?.items} onRowClick={(i) => nav(`/billing/${i._id}`)} footer={<Pagination meta={data?.meta} page={page} setPage={setPage} />} columns={[
        { key: 'no', header: 'Invoice', cell: (i) => <span className="font-mono text-xs">{i.invoiceNo}</span> },
        { key: 'd', header: 'Date', cell: (i) => fmtDateTime(i.createdAt) },
        { key: 'p', header: 'Patient / customer', cell: (i) => (i.patient ? <div><p className="font-medium">{i.patient.name}</p><p className="text-xs text-muted-foreground">{i.patient.patientId}</p></div> : i.customer?.name || 'Walk-in') },
        { key: 't', header: 'Type', cell: (i) => <div className="flex gap-1"><Badge variant="outline">{i.type}</Badge>{i.source === 'pos' && <Badge variant="info">POS</Badge>}</div> },
        { key: 'g', header: 'Total', cell: (i) => inr(i.grandTotal) },
        { key: 'b', header: 'Balance', cell: (i) => (i.balance > 0 ? <span className="text-amber-700">{inr(i.balance)}</span> : '—') },
        { key: 's', header: 'Status', cell: (i) => <StatusBadge status={i.status} /> },
      ]} />
    </div>
  );
}
