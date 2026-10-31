import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserRound, Receipt, CalendarClock, XCircle, CheckCircle2, LogIn, Stethoscope, Ban, MessageCircle } from 'lucide-react';
import { Dialog, SheetContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { BookDialog } from './BookDialog';
import { useGet, useAction } from '@/hooks/queries';
import { post, patch } from '@/lib/api';
import { useCan } from '@/store/auth';
import { fmtDate, fmtTime, fmtDateTime, ageOf, inr } from '@/lib/utils';

const Row = ({ k, v }) => <div className="flex justify-between gap-4 border-b py-2 text-sm last:border-0"><span className="text-muted-foreground">{k}</span><span className="text-right font-medium">{v || '—'}</span></div>;

export function AppointmentSheet({ id, onOpenChange }) {
  const nav = useNavigate();
  const can = useCan();
  const { data: a, isLoading } = useGet(['/appointments', id], `/appointments/${id}`, undefined, { enabled: !!id });
  const [cancel, setCancel] = useState(false);
  const [resched, setResched] = useState(false);
  const [notes, setNotes] = useState(null);
  const inv = ['/appointments', 'dashboard', 'availability'];
  const status = useAction((s) => patch(`/appointments/${id}/status`, { status: s }), { success: 'Updated', invalidate: inv });
  const doCancel = useAction((reason) => post(`/appointments/${id}/cancel`, { reason }), { success: 'Cancelled', invalidate: inv, onSuccess: () => setCancel(false) });
  const resend = useAction(() => post(`/appointments/${id}/notify`), { success: (r) => `WhatsApp queued (${r.event.replace('_', ' ')})` });
  const saveNotes = useAction(() => patch(`/appointments/${id}/notes`, { notes }), { success: 'Notes saved', invalidate: ['/appointments'] });

  const act = (s, label, Icon, variant = 'outline') => (
    <Button size="sm" variant={variant} loading={status.isPending && status.variables === s} onClick={() => status.mutate(s)}><Icon /> {label}</Button>
  );

  return (
    <Dialog open={!!id} onOpenChange={onOpenChange}>
      <SheetContent title={a ? `${a.bookingId}` : 'Appointment'} description={a ? `${fmtDate(a.date)} · ${fmtTime(a.start)}` : ''}>
        {isLoading || !a ? <Skeleton className="h-64 w-full" /> : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={a.status} />
              <Badge variant="outline">{a.type}</Badge>
              <Badge variant="outline">{a.visitType}</Badge>
              {a.tokenNo && <Badge variant="warning">Token {a.tokenNo}</Badge>}
            </div>

            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{a.patient?.name}</p>
                  <p className="text-xs text-muted-foreground">{a.patient?.patientId} · {[a.patient?.gender, ageOf(a.patient) && `${ageOf(a.patient)}y`, a.patient?.mobile].filter(Boolean).join(' · ')}</p>
                  {a.patient?.allergies?.length > 0 && <p className="mt-1 text-xs text-red-600">Allergies: {a.patient.allergies.join(', ')}</p>}
                </div>
                <Button size="sm" variant="ghost" onClick={() => nav(`/patients/${a.patient._id}`)}><UserRound /> Profile</Button>
              </div>
            </div>

            <div>
              <Row k="Branch" v={a.branch?.name} />
              <Row k="Doctor" v={a.doctor?.name} />
              <Row k="Slot" v={`${fmtTime(a.start)} – ${fmtTime(a.end)}`} />
              <Row k="Complaint" v={a.complaint} />
              <Row k="Booked by" v={a.createdBy?.name || (a.type === 'online' ? 'Patient (online)' : '')} />
              <Row k="Created" v={fmtDateTime(a.createdAt)} />
              {a.checkedInAt && <Row k="Checked in" v={fmtDateTime(a.checkedInAt)} />}
              {a.cancelReason && <Row k="Cancel reason" v={a.cancelReason} />}
              {a.invoice && <Row k="Invoice" v={<button className="text-primary underline" onClick={() => nav(`/billing/${a.invoice._id}`)}>{a.invoice.invoiceNo} · {inr(a.invoice.grandTotal)}</button>} />}
            </div>

            {can('appointments.edit') && (
              <div className="flex flex-wrap gap-2">
                {a.status === 'booked' && act('confirmed', 'Confirm', CheckCircle2)}
                {['booked', 'confirmed'].includes(a.status) && act('checked_in', 'Check in', LogIn, 'default')}
                {a.status === 'checked_in' && act('in_consultation', 'Start consult', Stethoscope, 'default')}
                {['checked_in', 'in_consultation'].includes(a.status) && act('completed', 'Complete', CheckCircle2, 'default')}
                {['booked', 'confirmed', 'checked_in'].includes(a.status) && act('no_show', 'No-show', Ban)}
                {['booked', 'confirmed'].includes(a.status) && <Button size="sm" variant="outline" onClick={() => setResched(true)}><CalendarClock /> Reschedule</Button>}
                {['booked', 'confirmed', 'checked_in', 'in_consultation'].includes(a.status) && <Button size="sm" variant="outline" className="text-destructive" onClick={() => setCancel(true)}><XCircle /> Cancel</Button>}
                {['booked', 'confirmed', 'checked_in', 'in_consultation', 'cancelled', 'no_show'].includes(a.status) && <Button size="sm" variant="ghost" loading={resend.isPending} onClick={() => resend.mutate()}><MessageCircle /> Resend WhatsApp</Button>}
              </div>
            )}
            {!a.invoice && can('billing.create') && ['checked_in', 'in_consultation', 'completed'].includes(a.status) && (
              <Button className="w-full" onClick={() => nav(`/billing/new?appointment=${a._id}`)}><Receipt /> Create invoice</Button>
            )}
            {can('appointments.edit') && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Internal notes</p>
                <Textarea rows={3} value={notes ?? a.notes ?? ''} onChange={(e) => setNotes(e.target.value)} />
                {notes !== null && <Button size="sm" loading={saveNotes.isPending} onClick={() => saveNotes.mutate()}>Save notes</Button>}
              </div>
            )}
          </div>
        )}
        <ConfirmDialog open={cancel} onOpenChange={setCancel} title="Cancel appointment" reason destructive confirmText="Cancel appointment" loading={doCancel.isPending} onConfirm={(r) => doCancel.mutate(r)} />
        {a && <BookDialog open={resched} onOpenChange={setResched} mode="reschedule" appointment={a} onDone={(n) => onOpenChange(false) || n} />}
      </SheetContent>
    </Dialog>
  );
}
