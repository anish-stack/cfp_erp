import { useEffect, useState } from 'react';
import { CalendarClock, Plus, Trash2, PenLine } from 'lucide-react';
import { SignatureUpload } from '@/components/clinic/SignatureUpload';
import { useQueryClient } from '@tanstack/react-query';
import { ResourcePage } from '@/components/common/ResourcePage';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { DropdownItem } from '@/components/ui/dropdown';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/checkbox';
import { Field } from '@/components/common/Field';
import { useGet, useAction, useBranches } from '@/hooks/queries';
import { put } from '@/lib/api';
import { useCan } from '@/store/auth';
import { inr } from '@/lib/utils';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ScheduleEditor({ doctor, onClose }) {
  const can = useCan();
  const [branch, setBranch] = useState(doctor.branches[0]?._id || '');
  const { data = [], isLoading } = useGet(['schedules', doctor._id], `/doctors/${doctor._id}/schedules`);
  const [days, setDays] = useState([]);
  useEffect(() => {
    const own = data.filter((s) => (s.branch?._id || s.branch) === branch);
    setDays(DAYS.map((_, w) => {
      const s = own.find((x) => x.weekday === w);
      return { weekday: w, isActive: s ? s.isActive && s.sessions.length > 0 : false, sessions: s?.sessions?.length ? s.sessions : [{ start: '10:00', end: '14:00' }], slotMinutes: s?.slotMinutes ?? '', gapMinutes: s?.gapMinutes ?? '', capacityPerSlot: s?.capacityPerSlot ?? 1 };
    }));
  }, [data, branch]);
  const save = useAction(() => put(`/doctors/${doctor._id}/schedules`, {
    branch,
    days: days.map((d) => ({ weekday: d.weekday, isActive: d.isActive, sessions: d.isActive ? d.sessions : [], slotMinutes: d.slotMinutes === '' ? null : Number(d.slotMinutes), gapMinutes: d.gapMinutes === '' ? null : Number(d.gapMinutes), capacityPerSlot: Number(d.capacityPerSlot) || 1 })),
  }), { success: 'Schedule saved', invalidate: ['schedules', 'availability'] });
  const upd = (w, patch) => setDays((ds) => ds.map((d) => (d.weekday === w ? { ...d, ...patch } : d)));
  const { data: allBranches = [] } = useBranches();
  const fillFromBranch = () => {
    const b = allBranches.find((x) => x._id === branch);
    if (!b) return;
    const off = b.settings?.weeklyOff || [];
    const sessions = [{ start: b.settings?.openTime || '10:00', end: b.settings?.closeTime || '19:00' }];
    setDays((ds) => ds.map((d) => ({ ...d, isActive: !off.includes(d.weekday), sessions })));
  };
  const editable = can('slots.edit');

  return (
    <div className="space-y-3">
      <Field label="Branch"><Select value={branch} onChange={(e) => setBranch(e.target.value)}>{doctor.branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</Select></Field>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Blank slot/gap → branch default. Branch breaks (lunch) and weekly offs still apply. Make sure the doctor isn't scheduled at two branches at the same time.</p>
            {editable && <Button size="sm" variant="outline" onClick={fillFromBranch}>Fill from branch hours</Button>}
          </div>
          {days.map((d) => (
            <div key={d.weekday} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
              <div className="flex w-20 items-center gap-2"><Switch checked={d.isActive} onCheckedChange={(v) => upd(d.weekday, { isActive: v })} disabled={!editable} /><span className="text-sm font-medium">{DAYS[d.weekday]}</span></div>
              {d.isActive ? (
                <>
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    {d.sessions.map((s, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <Input type="time" className="h-8 w-28" value={s.start} onChange={(e) => upd(d.weekday, { sessions: d.sessions.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} />
                        <span>–</span>
                        <Input type="time" className="h-8 w-28" value={s.end} onChange={(e) => upd(d.weekday, { sessions: d.sessions.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} />
                        {d.sessions.length > 1 && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => upd(d.weekday, { sessions: d.sessions.filter((_, j) => j !== i) })}><Trash2 /></Button>}
                      </div>
                    ))}
                    {d.sessions.length < 4 && <Button variant="ghost" size="sm" onClick={() => upd(d.weekday, { sessions: [...d.sessions, { start: '17:00', end: '19:00' }] })}><Plus /> Session</Button>}
                  </div>
                  <Input type="number" className="h-8 w-20" placeholder="Slot m" value={d.slotMinutes} onChange={(e) => upd(d.weekday, { slotMinutes: e.target.value })} title="Slot minutes" />
                  <Input type="number" className="h-8 w-20" placeholder="Gap m" value={d.gapMinutes} onChange={(e) => upd(d.weekday, { gapMinutes: e.target.value })} title="Gap minutes" />
                  <Input type="number" className="h-8 w-20" min={1} value={d.capacityPerSlot} onChange={(e) => upd(d.weekday, { capacityPerSlot: e.target.value })} title="Capacity per slot" />
                </>
              ) : <span className="text-sm text-muted-foreground">Off</span>}
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Close</Button>
        {editable && <Button loading={save.isPending} disabled={!branch} onClick={() => save.mutate()}>Save schedule</Button>}
      </div>
    </div>
  );
}

const FIELDS = [
  { name: 'name', label: 'Name', required: true },
  { name: 'qualification', label: 'Qualification', placeholder: 'MBBS, MS (General Surgery)' },
  { name: 'specialization', label: 'Specialization' },
  { name: 'regNo', label: 'Registration no.' },
  { name: 'experienceYears', label: 'Experience (years)', type: 'number' },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'consultationFee', label: 'Consultation fee', type: 'number' },
  { name: 'followUpFee', label: 'Follow-up fee', type: 'number' },
  { name: 'user', label: 'Login account (doctor role)', optionsQuery: { url: '/staff', params: { limit: 100 }, map: (u) => ({ value: u._id, label: `${u.name} · ${u.role?.name || ''}` }) } },
  { name: 'branches', label: 'Branches', type: 'multiselect', required: true, colSpan: 2, optionsQuery: { url: '/branches/names', map: (b) => ({ value: b._id, label: b.name }) } },
  { name: 'photo', label: 'Doctor photo (shown on booking site & landing pages)', type: 'image', uploadUrl: '/doctors/photo', round: true, colSpan: 2 },
  { name: 'bio', label: 'Bio', type: 'textarea', colSpan: 2 },
  { name: 'acceptsOnlineBooking', label: 'Online booking', type: 'switch' },
  { name: 'isActive', label: 'Active', type: 'switch' },
];

export default function Doctors() {
  const [sched, setSched] = useState(null);
  const [sig, setSig] = useState(null);
  const qc = useQueryClient();
  return (
    <>
      <ResourcePage
        title="Doctors"
        endpoint="/doctors"
        module="doctors"
        fields={FIELDS}
        canDelete={false}
        newDefaults={{ acceptsOnlineBooking: true, isActive: true, specialization: 'Proctology', branches: [] }}
        toForm={(d) => ({ ...d, user: d.user?._id || '', branches: d.branches.map((b) => b._id) })}
        toPayload={(v) => ({ ...v, user: v.user || null, photo: v.photo || undefined })}
        columns={[
          { key: 'name', header: 'Doctor', cell: (d) => <div className="flex items-center gap-3">{d.photo ? <img src={d.photo} alt="" className="h-10 w-10 shrink-0 rounded-full border object-cover object-top" /> : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{d.name.replace(/^Dr\.?\s*/i, '')[0]}</span>}<div><p className="font-medium">{d.name}</p><p className="text-xs text-muted-foreground">{d.qualification}</p></div></div> },
          { key: 'branches', header: 'Branches', cell: (d) => <div className="flex flex-wrap gap-1">{d.branches.map((b) => <Badge key={b._id} variant="secondary">{b.code}</Badge>)}</div> },
          { key: 'fee', header: 'Fee', cell: (d) => inr(d.consultationFee) },
          { key: 'online', header: 'Online', cell: (d) => (d.acceptsOnlineBooking ? <Badge variant="success">Yes</Badge> : <Badge variant="secondary">No</Badge>) },
          { key: 'login', header: 'Login', cell: (d) => d.user?.name || '—' },
          { key: 'sig', header: 'Signature', cell: (d) => (d.signature?.storedName ? <Badge variant="success">Uploaded</Badge> : <Badge variant="outline">—</Badge>) },
          { key: 'active', header: 'Status', cell: (d) => (d.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>) },
        ]}
        rowActions={(d) => (
          <>
            <DropdownItem onSelect={() => setSched(d)}><CalendarClock /> Weekly schedule</DropdownItem>
            <DropdownItem onSelect={() => setSig(d)}><PenLine /> Signature</DropdownItem>
          </>
        )}
        onRowClick={setSched}
      />
      <Dialog open={!!sig} onOpenChange={(o) => !o && setSig(null)}>
        <DialogContent title={`Signature · ${sig?.name || ''}`}>{sig && <SignatureUpload doctorId={sig._id} hasSignature={!!sig.signature?.storedName} onChange={(has) => { setSig((x) => ({ ...x, signature: has ? { storedName: 'x' } : undefined })); qc.invalidateQueries({ queryKey: ['/doctors'] }); }} />}</DialogContent>
      </Dialog>
      <Dialog open={!!sched} onOpenChange={(o) => !o && setSched(null)}>
        <DialogContent title={`Schedule · ${sched?.name || ''}`} size="xl">{sched && <ScheduleEditor doctor={sched} onClose={() => setSched(null)} />}</DialogContent>
      </Dialog>
    </>
  );
}
