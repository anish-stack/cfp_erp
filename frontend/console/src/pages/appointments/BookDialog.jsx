import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/common/Field';
import { PatientPicker } from '@/components/clinic/PatientPicker';
import { SlotPicker } from '@/components/clinic/SlotPicker';
import { useAction, useBranches, useDoctors } from '@/hooks/queries';
import { post } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { todayIST, addDays } from '@/lib/utils';

/** mode: 'book' | 'walkin' | 'reschedule' */
export function BookDialog({ open, onOpenChange, mode = 'book', appointment, initialPatient, onDone }) {
  const branchId = useAuth((s) => s.branchId);
  const { data: branches = [] } = useBranches();
  const [patient, setPatient] = useState(initialPatient || null);
  const [branch, setBranch] = useState('');
  const [doctor, setDoctor] = useState('any');
  const [date, setDate] = useState(todayIST());
  const [slot, setSlot] = useState(null);
  const [visitType, setVisitType] = useState('new');
  const [complaint, setComplaint] = useState('');
  const [noSlot, setNoSlot] = useState(false);
  const { data: doctors = [] } = useDoctors(branch);

  useEffect(() => {
    if (!open) return;
    setPatient(initialPatient || appointment?.patient || null);
    setBranch(appointment?.branch?._id || appointment?.branch || branchId || '');
    setDoctor(appointment?.doctor?._id || 'any');
    setDate(mode === 'reschedule' ? appointment?.date || todayIST() : todayIST());
    setSlot(null);
    setComplaint('');
    setVisitType('new');
    setNoSlot(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setSlot(null), [branch, doctor, date]);

  const submit = useAction(
    () => {
      if (mode === 'reschedule') return post(`/appointments/${appointment._id}/reschedule`, { date, start: slot.start, doctor: slot.doctor });
      if (mode === 'walkin') return post('/appointments/walkin', { patient: patient._id, branch, doctor: noSlot ? doctor : slot?.doctor || doctor, start: noSlot ? undefined : slot?.start, complaint: complaint || undefined, visitType });
      return post('/appointments', { patient: patient._id, branch, doctor: slot.doctor, date, start: slot.start, visitType, complaint: complaint || undefined, type: 'phone' });
    },
    { success: (a) => `${mode === 'walkin' ? `Token ${a.tokenNo}` : 'Booked'} · ${a.bookingId}`, invalidate: ['/appointments', 'dashboard', 'availability'], onSuccess: (a) => { onOpenChange(false); onDone?.(a); } }
  );

  const ready = mode === 'reschedule' ? !!slot : patient && branch && (mode === 'walkin' ? (noSlot ? doctor !== 'any' : !!slot) : !!slot);
  const title = { book: 'Book appointment', walkin: 'Walk-in registration', reschedule: `Reschedule ${appointment?.bookingId || ''}` }[mode];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} size="lg">
        <div className="space-y-4">
          {mode !== 'reschedule' && <Field label="Patient" required><PatientPicker value={patient} onChange={setPatient} /></Field>}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Branch" required>
              <Select value={branch} onChange={(e) => setBranch(e.target.value)} disabled={mode === 'reschedule'} placeholder="Select">
                {branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
              </Select>
            </Field>
            <Field label="Doctor">
              <Select value={doctor} onChange={(e) => setDoctor(e.target.value)}>
                <option value="any">Any available</option>
                {doctors.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
              </Select>
            </Field>
            {mode !== 'walkin' ? (
              <Field label="Date" required><Input type="date" value={date} min={todayIST()} max={addDays(todayIST(), 180)} onChange={(e) => setDate(e.target.value)} /></Field>
            ) : (
              <Field label="Visit type">
                <Select value={visitType} onChange={(e) => setVisitType(e.target.value)}><option value="new">New</option><option value="followup">Follow-up</option><option value="procedure">Procedure</option></Select>
              </Field>
            )}
          </div>
          {mode === 'walkin' && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={noSlot} onChange={(e) => setNoSlot(e.target.checked)} /> Add to queue now without a slot (select a doctor)</label>
          )}
          {!(mode === 'walkin' && noSlot) && (
            <Field label="Available slots"><SlotPicker branch={branch} date={mode === 'walkin' ? todayIST() : date} doctor={doctor} value={slot} onChange={setSlot} /></Field>
          )}
          {mode === 'book' && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Visit type">
                <Select value={visitType} onChange={(e) => setVisitType(e.target.value)}><option value="new">New</option><option value="followup">Follow-up</option><option value="procedure">Procedure</option></Select>
              </Field>
              <Field label="Complaint" className="sm:col-span-2"><Input value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="e.g. bleeding, pain" /></Field>
            </div>
          )}
          {mode === 'walkin' && <Field label="Complaint"><Textarea rows={2} value={complaint} onChange={(e) => setComplaint(e.target.value)} /></Field>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button disabled={!ready} loading={submit.isPending} onClick={() => submit.mutate()}>{mode === 'walkin' ? 'Register & check in' : mode === 'reschedule' ? 'Reschedule' : 'Book'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
