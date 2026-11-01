import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarClock, MapPin, Stethoscope, XCircle, Phone, Download } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DateStrip, SlotGrid } from '@/components/SlotGrid';
import { get, post, openDoc } from '@/lib/api';
import { usePatient } from '@/store/patient';
import { cn, errMsg, fmtDate, fmtTime, todayIST } from '@/lib/utils';

const TONE = { booked: 'info', confirmed: 'default', checked_in: 'warning', completed: 'success', cancelled: 'secondary', no_show: 'danger', rescheduled: 'secondary' };

function Reschedule({ appt, onDone }) {
  const [date, setDate] = useState(todayIST());
  const [slot, setSlot] = useState(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const n = await post(`/portal/appointments/${appt._id}/reschedule`, { date, start: slot.start, doctor: slot.doctor });
      toast.success(`Rescheduled to ${fmtDate(n.date)} ${fmtTime(n.start)}`);
      onDone();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      <DateStrip value={date} onChange={(d) => { setDate(d); setSlot(null); }} />
      <SlotGrid branch={appt.branch._id} date={date} doctor={appt.doctor?._id || 'any'} value={slot} onChange={setSlot} />
      <Button className="w-full" disabled={!slot} loading={busy} onClick={go}>Confirm new time</Button>
    </div>
  );
}

export default function MyAppointments() {
  const token = usePatient((s) => s.token);
  const qc = useQueryClient();
  const [scope, setScope] = useState('upcoming');
  const [resched, setResched] = useState(null);
  const { data = [], isLoading } = useQuery({ queryKey: ['my-appts', scope], enabled: !!token, queryFn: () => get('/portal/appointments', { scope }) });
  if (!token) return <Card className="p-6 text-center"><p>Please verify your mobile to see appointments.</p><Button asChild className="mt-3"><Link to="/login?next=/appointments">Login</Link></Button></Card>;

  const cancel = async (a) => {
    if (!confirm(`Cancel appointment ${a.bookingId}?`)) return;
    try {
      const r = await post(`/portal/appointments/${a._id}/cancel`, {});
      toast.success(r?.refund ? (r.refund.status === 'initiated' ? `Appointment cancelled · refund of ₹${r.refund.amount} started (5–7 working days)` : `Appointment cancelled · ${r.refund.message}`) : 'Appointment cancelled');
      qc.invalidateQueries({ queryKey: ['my-appts'] });
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">My appointments</h1>
        <div className="flex rounded-lg bg-muted p-1 text-sm">
          {['upcoming', 'past'].map((s) => <button key={s} onClick={() => setScope(s)} className={cn('rounded-md px-3 py-1 capitalize', scope === s && 'bg-card shadow-sm')}>{s}</button>)}
        </div>
      </div>
      {isLoading ? <Skeleton className="h-32 w-full" /> : !data.length ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No {scope} appointments. <Link to="/" className="text-primary underline">Book now</Link></Card>
      ) : data.map((a) => (
        <Card key={a._id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">{fmtDate(a.date)} · {fmtTime(a.start)}</p>
              <p className="text-sm">{a.patient?.name}</p>
            </div>
            <Badge variant={TONE[a.status]}>{a.status.replace('_', ' ')}</Badge>
          </div>
          <div className="mt-2 space-y-1 text-sm text-muted-foreground">
            <p className="flex items-center gap-1.5"><Stethoscope className="h-4 w-4" /> {a.doctor?.name}</p>
            <p className="flex items-center gap-1.5"><MapPin className="h-4 w-4" /> {a.branch?.name}{a.branch?.address?.line1 ? `, ${a.branch.address.line1}` : ''}</p>
            {a.branch?.phone && <a href={`tel:${a.branch.phone}`} className="flex items-center gap-1.5"><Phone className="h-4 w-4" /> {a.branch.phone}</a>}
            <p className="font-mono text-xs">{a.bookingId}</p>
          </div>
          {scope === 'upcoming' && ['booked', 'confirmed'].includes(a.status) && (
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setResched(resched === a._id ? null : a._id)}><CalendarClock /> Reschedule</Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => cancel(a)}><XCircle /> Cancel</Button>
              <Button size="sm" variant="ghost" onClick={() => openDoc('slip', a._id, { download: true, filename: `${a.bookingId}.pdf` }).catch((e) => toast.error(errMsg(e)))}><Download /> Slip</Button>
            </div>
          )}
          {resched === a._id && <Reschedule appt={a} onDone={() => { setResched(null); qc.invalidateQueries({ queryKey: ['my-appts'] }); }} />}
        </Card>
      ))}
    </div>
  );
}
