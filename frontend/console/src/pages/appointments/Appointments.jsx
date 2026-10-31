import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, UserPlus, ChevronLeft, ChevronRight, List, Columns3, CalendarRange } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Pagination } from '@/components/common/DataTable';
import { SearchInput } from '@/components/common/SearchInput';
import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BookDialog } from './BookDialog';
import { AppointmentSheet } from './AppointmentSheet';
import { usePaged, useGet, useDoctors } from '@/hooks/queries';
import { useDebounce } from '@/hooks/useDebounce';
import { Can } from '@/components/common/Can';
import { useAuth } from '@/store/auth';
import { todayIST, addDays, fmtTime, fmtDate, cn } from '@/lib/utils';

const STATUSES = ['booked', 'confirmed', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show', 'rescheduled'];
const COLORS = { booked: 'border-l-sky-500', confirmed: 'border-l-teal-600', checked_in: 'border-l-amber-500', in_consultation: 'border-l-orange-500', completed: 'border-l-emerald-500', cancelled: 'border-l-slate-300 opacity-60', no_show: 'border-l-red-500 opacity-70', rescheduled: 'border-l-slate-300 opacity-60' };

function Chip({ a, onClick }) {
  return (
    <button onClick={onClick} className={cn('w-full rounded-md border border-l-4 bg-card px-2 py-1 text-left text-xs shadow-sm hover:shadow', COLORS[a.status])}>
      <p className="truncate font-medium">{fmtTime(a.start)} · {a.patient?.name}</p>
      <p className="truncate text-muted-foreground">{a.doctor?.name}{a.tokenNo ? ` · T${a.tokenNo}` : ''}</p>
    </button>
  );
}

function DayBoard({ date, onOpen }) {
  const { data = [], isLoading } = useGet(['/appointments', 'cal', date], '/appointments', { view: 'calendar', date });
  const doctors = useMemo(() => {
    const m = new Map();
    data.filter((a) => a.status !== 'rescheduled').forEach((a) => {
      const k = a.doctor?._id || 'none';
      if (!m.has(k)) m.set(k, { name: a.doctor?.name || '—', items: [] });
      m.get(k).items.push(a);
    });
    return [...m.values()];
  }, [data]);
  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (!doctors.length) return <Card><EmptyState title="No appointments on this day" /></Card>;
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(doctors.length, 4)}, minmax(220px, 1fr))` }}>
      {doctors.map((d) => (
        <Card key={d.name} className="p-2">
          <p className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">{d.name}<Badge variant="secondary">{d.items.length}</Badge></p>
          <div className="space-y-1.5">{d.items.map((a) => <Chip key={a._id} a={a} onClick={() => onOpen(a._id)} />)}</div>
        </Card>
      ))}
    </div>
  );
}

function WeekBoard({ date, onOpen }) {
  const from = date;
  const to = addDays(date, 6);
  const { data = [], isLoading } = useGet(['/appointments', 'cal', from, to], '/appointments', { view: 'calendar', from, to });
  if (isLoading) return <Skeleton className="h-80 w-full" />;
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return (
    <div className="grid gap-2 overflow-x-auto sm:grid-cols-7">
      {days.map((d) => {
        const items = data.filter((a) => a.date === d && a.status !== 'rescheduled');
        return (
          <Card key={d} className={cn('min-h-[200px] p-2', d === todayIST() && 'ring-2 ring-primary/40')}>
            <p className="mb-2 text-xs font-semibold">{new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} <span className="text-muted-foreground">({items.length})</span></p>
            <div className="space-y-1">{items.slice(0, 30).map((a) => <Chip key={a._id} a={a} onClick={() => onOpen(a._id)} />)}</div>
          </Card>
        );
      })}
    </div>
  );
}

export default function Appointments() {
  const [sp, setSp] = useSearchParams();
  const branchId = useAuth((s) => s.branchId);
  const [tab, setTab] = useState('list');
  const [date, setDate] = useState(todayIST());
  const [allDates, setAllDates] = useState(false);
  const [status, setStatus] = useState('');
  const [doctor, setDoctor] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null);
  const dq = useDebounce(q);
  const openId = sp.get('open');
  const setOpen = (id) => setSp(id ? { open: id } : {});
  const { data: doctors = [] } = useDoctors(branchId);

  const params = { page, limit: 25, date: allDates ? undefined : date, status: status || undefined, doctor: doctor || undefined, q: dq || undefined };
  const { data, isLoading } = usePaged(['/appointments'], '/appointments', params, { enabled: tab === 'list', refetchInterval: 30_000 });
  const { data: summary } = useGet(['/appointments', 'summary', date], '/appointments/summary', { date });

  const cols = [
    { key: 'time', header: 'Time', cell: (a) => <div><p className="font-medium">{fmtTime(a.start)}</p>{allDates && <p className="text-xs text-muted-foreground">{fmtDate(a.date)}</p>}</div> },
    { key: 'token', header: 'Token', cell: (a) => a.tokenNo || '—' },
    { key: 'patient', header: 'Patient', cell: (a) => <div><p className="font-medium">{a.patient?.name}</p><p className="text-xs text-muted-foreground">{a.patient?.patientId} · {a.patient?.mobile}</p></div> },
    { key: 'doctor', header: 'Doctor', cell: (a) => a.doctor?.name },
    { key: 'branch', header: 'Branch', cell: (a) => a.branch?.code },
    { key: 'type', header: 'Source', cell: (a) => <Badge variant="outline">{a.type}</Badge> },
    { key: 'status', header: 'Status', cell: (a) => <StatusBadge status={a.status} /> },
    { key: 'id', header: 'Booking', cell: (a) => <span className="font-mono text-xs">{a.bookingId}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Appointments"
        description={summary ? `${fmtDate(date)} · ${Object.entries(summary).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(' · ') || 'none'}` : ' '}
        actions={<>
          <Can perm="walkins.create"><Button variant="outline" onClick={() => setDialog('walkin')}><UserPlus /> Walk-in</Button></Can>
          <Can perm="appointments.create"><Button onClick={() => setDialog('book')}><Plus /> Book</Button></Can>
        </>}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <TabsList>
            <TabsTrigger value="list"><List className="h-4 w-4" /> List</TabsTrigger>
            <TabsTrigger value="day"><Columns3 className="h-4 w-4" /> Day</TabsTrigger>
            <TabsTrigger value="week"><CalendarRange className="h-4 w-4" /> Week</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="outline" onClick={() => setDate(addDays(date, tab === 'week' ? -7 : -1))}><ChevronLeft /></Button>
            <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setPage(1); }} className="w-40" />
            <Button size="icon" variant="outline" onClick={() => setDate(addDays(date, tab === 'week' ? 7 : 1))}><ChevronRight /></Button>
            <Button size="sm" variant="ghost" onClick={() => setDate(todayIST())}>Today</Button>
          </div>
          {tab === 'list' && <>
            <Select className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="All statuses">{STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select>
            <Select className="w-44" value={doctor} onChange={(e) => { setDoctor(e.target.value); setPage(1); }} placeholder="All doctors">{doctors.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select>
            <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Patient, mobile, booking ID" />
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={allDates} onChange={(e) => setAllDates(e.target.checked)} /> All dates</label>
          </>}
        </div>
        <TabsContent value="list">
          <DataTable columns={cols} rows={data?.items} loading={isLoading} onRowClick={(a) => setOpen(a._id)} footer={<Pagination meta={data?.meta} page={page} setPage={setPage} />} empty={<EmptyState title="No appointments" description="Try another date or filter." />} />
        </TabsContent>
        <TabsContent value="day"><DayBoard date={date} onOpen={setOpen} /></TabsContent>
        <TabsContent value="week"><WeekBoard date={date} onOpen={setOpen} /></TabsContent>
      </Tabs>
      <BookDialog open={dialog === 'book' || dialog === 'walkin'} mode={dialog || 'book'} onOpenChange={(o) => !o && setDialog(null)} onDone={(a) => setOpen(a._id)} />
      <AppointmentSheet id={openId} onOpenChange={(o) => !o && setOpen(null)} />
    </div>
  );
}
