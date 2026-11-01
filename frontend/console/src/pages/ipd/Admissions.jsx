import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { UserPlus, BedDouble } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Pagination } from '@/components/common/DataTable';
import { SearchInput } from '@/components/common/SearchInput';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AdmitDialog } from '@/components/ipd/AdmitDialog';
import { ADM_STATUS, PAYERS, stayLabel } from '@/components/ipd/ipdUtils';
import { usePaged } from '@/hooks/queries';
import { useDebounce } from '@/hooks/useDebounce';
import { useCan } from '@/store/auth';
import { cn, fmtDateTime, inr } from '@/lib/utils';

const TABS = [['active', 'In hospital'], ['discharge_initiated', 'Discharge pending'], ['discharged', 'Discharged'], ['cancelled', 'Cancelled'], ['', 'All']];

export default function Admissions() {
  const nav = useNavigate();
  const can = useCan();
  const [sp] = useSearchParams();
  const [status, setStatus] = useState(sp.get('status') ?? 'active');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [admit, setAdmit] = useState(false);
  const dq = useDebounce(q, 300);
  const { data, isLoading } = usePaged(['/ipd/admissions'], '/ipd/admissions', { status: status || undefined, q: dq || undefined, from: from || undefined, to: to || undefined, page, limit: 25 }, { refetchInterval: 60_000 });

  return (
    <div className="space-y-4">
      <PageHeader title="Admissions (IPD)" description="In-patients, day-care and discharged patients"
        actions={<div className="flex gap-2"><Button variant="outline" onClick={() => nav('/ipd')}><BedDouble /> Bed board</Button>{can('ipd.create') && <Button onClick={() => setAdmit(true)}><UserPlus /> Admit patient</Button>}</div>} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
          {TABS.map(([k, l]) => <button key={k} type="button" onClick={() => { setStatus(k); setPage(1); }} className={cn('rounded-md px-3 py-1 text-sm', status === k ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground')}>{l}</button>)}
        </div>
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Patient, mobile, Adm. No." className="w-64" />
        <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} title="Admitted from" />
        <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} title="Admitted to" />
      </div>
      <DataTable loading={isLoading} rows={data?.items} onRowClick={(a) => nav(`/ipd/admissions/${a._id}`)} columns={[
        { key: 'no', header: 'Adm. No', cell: (a) => <div><p className="font-mono text-xs font-medium">{a.admissionNo}</p><p className="text-xs text-muted-foreground">{a.branch?.name}</p></div> },
        { key: 'p', header: 'Patient', cell: (a) => <div><p className="font-medium">{a.patient?.name}</p><p className="text-xs text-muted-foreground">{a.patient?.patientId} · {a.patient?.mobile}</p></div> },
        { key: 'bed', header: 'Ward / bed', cell: (a) => <div><p>{a.bed?.number || '—'}</p><p className="text-xs text-muted-foreground">{a.ward?.name}</p></div> },
        { key: 'd', header: 'Consultant', cell: (a) => a.doctor?.name },
        { key: 'adm', header: 'Admitted', cell: (a) => <div><p className="text-sm">{fmtDateTime(a.admittedAt)}</p><p className="text-xs text-muted-foreground">{stayLabel(a.admittedAt, a.dischargedAt)}{a.type !== 'planned' ? ` · ${a.type.replace('_', ' ')}` : ''}</p></div> },
        { key: 'proc', header: 'Procedure', cell: (a) => a.plannedProcedure?.name || '—' },
        { key: 'pay', header: 'Payer', cell: (a) => PAYERS[a.payer?.type || 'self'] },
        { key: 'bill', header: 'Bill', cell: (a) => (a.invoice ? <div><p className="text-sm">{inr(a.invoice.grandTotal)}</p>{a.invoice.balance > 0 && <p className="text-xs text-destructive">Due {inr(a.invoice.balance)}</p>}</div> : '—') },
        { key: 's', header: 'Status', cell: (a) => <Badge variant={ADM_STATUS[a.status][1]}>{ADM_STATUS[a.status][0]}</Badge> },
      ]} footer={<Pagination meta={data?.meta} page={page} setPage={setPage} />} />
      <AdmitDialog open={admit} onOpenChange={setAdmit} />
    </div>
  );
}
