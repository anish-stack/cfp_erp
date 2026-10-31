import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Pagination } from '@/components/common/DataTable';
import { SearchInput } from '@/components/common/SearchInput';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { NewPatientForm } from '@/components/clinic/PatientForm';
import { Can } from '@/components/common/Can';
import { usePaged } from '@/hooks/queries';
import { useDebounce } from '@/hooks/useDebounce';
import { ageOf, fmtDate } from '@/lib/utils';

export default function Patients() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const dq = useDebounce(q);
  const { data, isLoading } = usePaged(['/patients'], '/patients', { q: dq || undefined, page, limit: 25 });
  const cols = [
    { key: 'patientId', header: 'Patient ID', cell: (p) => <span className="font-mono text-xs">{p.patientId}</span> },
    { key: 'name', header: 'Name', cell: (p) => <div className="flex items-center gap-2"><span className="font-medium">{p.name}</span>{p.relation !== 'self' && <Badge variant="secondary">{p.relation}</Badge>}</div> },
    { key: 'mobile', header: 'Mobile' },
    { key: 'ga', header: 'Gender / Age', cell: (p) => `${p.gender} · ${ageOf(p) ?? '—'}` },
    { key: 'branch', header: 'Registered at', cell: (p) => p.registeredBranch?.name || '—' },
    { key: 'source', header: 'Source', cell: (p) => <Badge variant="outline">{p.source}</Badge> },
    { key: 'created', header: 'Since', cell: (p) => fmtDate(p.createdAt) },
  ];
  return (
    <div>
      <PageHeader title="Patients" description="Search by mobile, name or patient ID" actions={<Can perm="patients.create"><Button onClick={() => setCreating(true)}><Plus /> New patient</Button></Can>} />
      <div className="mb-3"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Mobile, name, CPF-…" className="sm:w-80" /></div>
      <DataTable columns={cols} rows={data?.items} loading={isLoading} onRowClick={(p) => nav(`/patients/${p._id}`)} footer={<Pagination meta={data?.meta} page={page} setPage={setPage} />} />
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="New patient" size="lg"><NewPatientForm onCancel={() => setCreating(false)} onCreated={(p) => nav(`/patients/${p._id}`)} /></DialogContent>
      </Dialog>
    </div>
  );
}
