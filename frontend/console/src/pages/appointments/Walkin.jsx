import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Phone, UserPlus, UserRound, CheckCircle2, Printer, ArrowRight, RotateCcw, Ticket } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Field } from '@/components/common/Field';
import { DataTable } from '@/components/common/DataTable';
import { SlotPicker } from '@/components/clinic/SlotPicker';
import { useGet, useBranches } from '@/hooks/queries';
import { get, post, openFile } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { ageOf, cn, errMsg, fmtTime, todayIST } from '@/lib/utils';

const COMPLAINTS = ['Bleeding during stools', 'Pain while passing stool', 'Swelling / lump near anus', 'Pus / discharge', 'Itching', 'Constipation', 'Follow-up / dressing'];

export default function Walkin() {
  const nav = useNavigate();
  const branchId = useAuth((s) => s.branchId);
  const { data: branches = [] } = useBranches();
  const [mobile, setMobile] = useState('');
  const [patient, setPatient] = useState(null);
  const [creating, setCreating] = useState(false);
  const [np, setNp] = useState({ name: '', gender: '', ageYears: '', relation: 'self', city: '' });
  const [branch, setBranch] = useState(branchId || '');
  const [doctor, setDoctor] = useState('');
  const [mode, setMode] = useState('queue'); // queue | slot
  const [slot, setSlot] = useState(null);
  const [visitType, setVisitType] = useState('new');
  const [complaint, setComplaint] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  useEffect(() => { if (branchId) setBranch(branchId); }, [branchId]);
  useEffect(() => setSlot(null), [branch, doctor, mode]);

  const valid = /^[6-9]\d{9}$/.test(mobile);
  const lookup = useQuery({ queryKey: ['walkin-lookup', mobile], enabled: valid, queryFn: () => get('/patients/lookup', { mobile }) });
  useEffect(() => {
    setPatient(null);
    if (lookup.data && !lookup.data.length) setCreating(true);
    if (lookup.data?.length) setCreating(false);
  }, [lookup.data]);

  const today = todayIST();
  const avail = useQuery({ queryKey: ['availability', branch, today, 'any', 'walkin'], enabled: !!branch, queryFn: () => get('/scheduling/availability', { branch, date: today, doctor: 'any' }, { branchScoped: false }) });
  const doctorsToday = (avail.data?.doctors || []).filter((d) => !d.closed);
  useEffect(() => { if (!doctor && doctorsToday.length) setDoctor(String(doctorsToday[0].doctor._id)); }, [avail.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const queue = useGet(['/appointments', 'walkin-queue', today, branch], '/appointments', { date: today, branch: branch || undefined, status: 'checked_in,in_consultation', limit: 50 }, { enabled: !!branch, refetchInterval: 20_000 });

  const submit = async () => {
    if (!branch) return toast.error('Select branch');
    if (!doctor) return toast.error('Select doctor');
    if (mode === 'slot' && !slot) return toast.error('Pick a slot');
    setBusy(true);
    try {
      let p = patient;
      if (!p) {
        if (!np.name.trim() || !np.gender || !np.ageYears) throw new Error('Enter name, gender and age');
        p = await post('/patients', { mobile, name: np.name.trim(), gender: np.gender, ageYears: Number(np.ageYears), relation: np.relation, registeredBranch: branch, address: np.city ? { city: np.city } : undefined });
      }
      const a = await post('/appointments/walkin', { patient: p._id, branch, doctor: mode === 'slot' ? slot.doctor : doctor, start: mode === 'slot' ? slot.start : undefined, complaint: complaint || undefined, visitType });
      setDone({ ...a, patientName: p.name, patientId: p.patientId });
      queue.refetch();
      toast.success(`Token ${a.tokenNo} · ${a.bookingId}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setDone(null);
    setMobile('');
    setPatient(null);
    setCreating(false);
    setNp({ name: '', gender: '', ageYears: '', relation: 'self', city: '' });
    setComplaint('');
    setVisitType('new');
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Walk-in registration" description="Register, assign doctor and issue a token in one go" />
      {done ? (
        <Card className="mx-auto max-w-lg p-6 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
          <p className="mt-2 text-lg font-semibold">{done.patientName} checked in</p>
          <p className="text-sm text-muted-foreground">{done.patientId} · {done.bookingId}</p>
          <div className="my-4 rounded-xl bg-accent p-4"><p className="text-xs uppercase text-muted-foreground">Token</p><p className="text-5xl font-bold text-primary">{done.tokenNo}</p><p className="mt-1 text-sm">{fmtTime(done.start)}</p></div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => openFile(`/appointments/${done._id}/slip`)}><Printer /> Print slip</Button>
            <Button variant="outline" onClick={() => nav(`/appointments/${done._id}`)}><ArrowRight /> Open visit</Button>
            <Button onClick={reset}><RotateCcw /> Next walk-in</Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">1 · Patient</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Field label="Mobile number">
                <div className="relative"><Phone className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input autoFocus inputMode="numeric" maxLength={10} className="pl-8 text-base" value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))} placeholder="10-digit mobile" /></div>
              </Field>
              {valid && lookup.isLoading && <p className="text-sm text-muted-foreground">Searching…</p>}
              {valid && lookup.data?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Profiles on this number</p>
                  {lookup.data.map((p) => (
                    <button key={p._id} type="button" onClick={() => { setPatient(p); setCreating(false); setVisitType('followup'); }} className={cn('flex w-full items-center gap-3 rounded-lg border p-3 text-left', patient?._id === p._id ? 'border-primary bg-accent' : 'hover:border-primary')}>
                      <UserRound className="h-5 w-5 text-primary" />
                      <div><p className="font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{p.patientId} · {p.gender} · {ageOf(p)}y · {p.relation}{p.registeredBranch ? ` · ${p.registeredBranch.code}` : ''}</p></div>
                    </button>
                  ))}
                  {!creating && <Button variant="outline" size="sm" onClick={() => { setPatient(null); setCreating(true); setNp((x) => ({ ...x, relation: 'other' })); setVisitType('new'); }}><UserPlus /> New family member</Button>}
                </div>
              )}
              {valid && creating && !patient && (
                <div className="grid gap-3 rounded-lg border border-dashed p-3 sm:grid-cols-2">
                  <p className="text-sm font-medium sm:col-span-2">New patient</p>
                  <Field label="Full name" required className="sm:col-span-2"><Input value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} /></Field>
                  <Field label="Gender" required><Select value={np.gender} onChange={(e) => setNp({ ...np, gender: e.target.value })} placeholder="Select"><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></Select></Field>
                  <Field label="Age" required><Input type="number" value={np.ageYears} onChange={(e) => setNp({ ...np, ageYears: e.target.value })} /></Field>
                  <Field label="Relation"><Select value={np.relation} onChange={(e) => setNp({ ...np, relation: e.target.value })}>{['self', 'spouse', 'child', 'parent', 'sibling', 'other'].map((r) => <option key={r}>{r}</option>)}</Select></Field>
                  <Field label="City / area"><Input value={np.city} onChange={(e) => setNp({ ...np, city: e.target.value })} /></Field>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">2 · Visit</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Branch"><Select value={branch} onChange={(e) => { setBranch(e.target.value); setDoctor(''); }} placeholder="Select">{branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</Select></Field>
                <Field label="Visit type"><Select value={visitType} onChange={(e) => setVisitType(e.target.value)}><option value="new">New</option><option value="followup">Follow-up</option><option value="procedure">Procedure / dressing</option></Select></Field>
              </div>
              <Field label="Doctor available today">
                {avail.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : !doctorsToday.length ? <p className="text-sm text-destructive">No doctor scheduled at this branch today. Set schedules in Doctors.</p> : (
                  <div className="flex flex-wrap gap-2">
                    {doctorsToday.map((d) => {
                      const free = d.slots.filter((s) => s.available).length;
                      return <button key={d.doctor._id} type="button" onClick={() => setDoctor(String(d.doctor._id))} className={cn('rounded-lg border px-3 py-2 text-left text-sm', doctor === String(d.doctor._id) ? 'border-primary bg-accent' : 'hover:border-primary')}><p className="font-medium">{d.doctor.name}</p><p className="text-xs text-muted-foreground">{free} free slot(s) left</p></button>;
                    })}
                  </div>
                )}
              </Field>
              <div className="flex rounded-lg bg-muted p-1 text-sm">
                <button type="button" onClick={() => setMode('queue')} className={cn('flex-1 rounded-md py-1.5', mode === 'queue' && 'bg-card font-medium shadow-sm')}>Add to queue now</button>
                <button type="button" onClick={() => setMode('slot')} className={cn('flex-1 rounded-md py-1.5', mode === 'slot' && 'bg-card font-medium shadow-sm')}>Pick a slot today</button>
              </div>
              {mode === 'slot' && <SlotPicker branch={branch} date={today} doctor={doctor || 'any'} value={slot} onChange={setSlot} />}
              <Field label="Complaint">
                <div className="mb-2 flex flex-wrap gap-1">{COMPLAINTS.map((c) => <button key={c} type="button" onClick={() => setComplaint(c)} className="rounded-full border px-2.5 py-0.5 text-xs hover:border-primary">{c}</button>)}</div>
                <Textarea rows={2} value={complaint} onChange={(e) => setComplaint(e.target.value)} />
              </Field>
              <Button className="w-full" size="lg" disabled={!valid || (!patient && !creating)} loading={busy} onClick={submit}><Ticket /> Register & issue token</Button>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Waiting now <Badge variant="secondary" className="ml-1">{queue.data?.items?.length ?? 0}</Badge></CardTitle></CardHeader>
        <CardContent>
          <DataTable rows={queue.data?.items} loading={queue.isLoading} onRowClick={(a) => nav(`/appointments/${a._id}`)} columns={[
            { key: 't', header: 'Token', cell: (a) => <span className="text-lg font-semibold">{a.tokenNo || '—'}</span> },
            { key: 'p', header: 'Patient', cell: (a) => <div><p className="font-medium">{a.patient?.name}</p><p className="text-xs text-muted-foreground">{a.patient?.patientId}</p></div> },
            { key: 'd', header: 'Doctor', cell: (a) => a.doctor?.name },
            { key: 'time', header: 'Since', cell: (a) => fmtTime(a.start) },
            { key: 'type', header: 'Type', cell: (a) => <Badge variant="outline">{a.type}</Badge> },
            { key: 's', header: 'Status', cell: (a) => <StatusBadge status={a.status} /> },
          ]} />
        </CardContent>
      </Card>
    </div>
  );
}
