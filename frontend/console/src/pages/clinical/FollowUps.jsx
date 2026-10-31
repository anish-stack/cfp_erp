import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, Phone } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Pagination } from '@/components/common/DataTable';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { BookDialog } from '@/pages/appointments/BookDialog';
import { usePaged, useAction } from '@/hooks/queries';
import { patch } from '@/lib/api';
import { useCan } from '@/store/auth';
import { fmtDate } from '@/lib/utils';

export default function FollowUps() {
  const nav = useNavigate();
  const can = useCan();
  const [due, setDue] = useState('today');
  const [page, setPage] = useState(1);
  const [booking, setBooking] = useState(null);
  const { data, isLoading } = usePaged(['/clinical/followups'], '/clinical/followups', { due: due === 'all' ? undefined : due, page, limit: 25, status: due === 'all' ? undefined : 'pending,contacted' });
  const upd = useAction(({ id, ...b }) => patch(`/clinical/followups/${id}`, b), { success: 'Updated', invalidate: ['/clinical/followups'] });
  return (
    <div>
      <PageHeader title="Follow-ups" description="Patients due for review" />
      <Tabs value={due} onValueChange={(v) => { setDue(v); setPage(1); }} className="mb-3">
        <TabsList><TabsTrigger value="today">Today</TabsTrigger><TabsTrigger value="overdue">Overdue</TabsTrigger><TabsTrigger value="upcoming">Upcoming</TabsTrigger><TabsTrigger value="all">All</TabsTrigger></TabsList>
      </Tabs>
      <DataTable loading={isLoading} rows={data?.items} footer={<Pagination meta={data?.meta} page={page} setPage={setPage} />} columns={[
        { key: 'due', header: 'Due', cell: (f) => fmtDate(f.dueDate) },
        { key: 'p', header: 'Patient', cell: (f) => <button className="text-left" onClick={() => nav(`/patients/${f.patient._id}`)}><p className="font-medium text-primary">{f.patient?.name}</p><p className="text-xs text-muted-foreground">{f.patient?.patientId}</p></button> },
        { key: 'm', header: 'Mobile', cell: (f) => <a href={`tel:${f.patient?.mobile}`} className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{f.patient?.mobile}</a> },
        { key: 'd', header: 'Doctor', cell: (f) => f.doctor?.name || '—' },
        { key: 'r', header: 'Reason', cell: (f) => f.reason || '—' },
        { key: 's', header: 'Status', cell: (f) => can('followups.edit') ? (
          <Select className="h-8 w-32" value={f.status} onChange={(e) => upd.mutate({ id: f._id, status: e.target.value })}>{['pending', 'contacted', 'booked', 'done', 'missed', 'cancelled'].map((s) => <option key={s}>{s}</option>)}</Select>
        ) : <StatusBadge status={f.status} /> },
        { key: 'a', header: '', cell: (f) => can('appointments.create') && ['pending', 'contacted'].includes(f.status) && <Button size="sm" variant="outline" onClick={() => setBooking(f)}><CalendarPlus /> Book</Button> },
      ]} />
      <BookDialog open={!!booking} onOpenChange={(o) => !o && setBooking(null)} initialPatient={booking?.patient} onDone={(a) => upd.mutate({ id: booking._id, status: 'booked', bookedAppointment: a._id })} />
    </div>
  );
}
