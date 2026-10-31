import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, Check, MapPin, Phone, ShieldCheck, Stethoscope, UserPlus, UserRound, CalendarCheck2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DateStrip, SlotGrid } from '@/components/SlotGrid';
import { get, post } from '@/lib/api';
import { usePatient, getUtm } from '@/store/patient';
import { cn, errMsg, fmtDate, fmtTime, todayIST, ageOf } from '@/lib/utils';

const STEPS = ['mobile', 'otp', 'profile', 'branch', 'slot', 'confirm', 'done'];
const LABEL = { profile: 'Patient', branch: 'Clinic', slot: 'Time', confirm: 'Confirm' };

function Progress({ step }) {
  const vis = ['profile', 'branch', 'slot', 'confirm'];
  const idx = vis.indexOf(step);
  if (idx < 0) return null;
  return (
    <div className="mb-5 flex items-center gap-2">
      {vis.map((s, i) => (
        <div key={s} className="flex flex-1 flex-col gap-1">
          <div className={cn('h-1.5 rounded-full', i <= idx ? 'bg-primary' : 'bg-border')} />
          <span className={cn('text-[11px]', i === idx ? 'font-semibold text-primary' : 'text-muted-foreground')}>{LABEL[s]}</span>
        </div>
      ))}
    </div>
  );
}

const memberSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter full name'),
    relation: z.enum(['self', 'spouse', 'child', 'parent', 'sibling', 'other']),
    gender: z.enum(['male', 'female', 'other'], { errorMap: () => ({ message: 'Select gender' }) }),
    ageYears: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().min(0).max(120).optional()),
    dob: z.string().optional(),
  })
  .refine((d) => d.ageYears !== undefined || d.dob, { message: 'Enter age or date of birth', path: ['ageYears'] });

function MemberForm({ hasSelf, onSaved, onCancel }) {
  const form = useForm({ resolver: zodResolver(memberSchema), defaultValues: { relation: hasSelf ? 'spouse' : 'self', gender: '', name: '' } });
  const e = form.formState.errors;
  const submit = async (v) => {
    try {
      const p = await post('/portal/profiles', { ...v, dob: v.dob || undefined });
      toast.success(`Profile created · ${p.patientId}`);
      onSaved(p);
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-3">
      <div className="space-y-1.5"><Label>Full name</Label><Input {...form.register('name')} autoFocus />{e.name && <p className="text-xs text-destructive">{e.name.message}</p>}</div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5"><Label>Relation</Label><Select {...form.register('relation')}>{['self', 'spouse', 'child', 'parent', 'sibling', 'other'].filter((r) => !(hasSelf && r === 'self')).map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}</Select></div>
        <div className="space-y-1.5"><Label>Gender</Label><Select {...form.register('gender')} placeholder="Select"><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></Select>{e.gender && <p className="text-xs text-destructive">{e.gender.message}</p>}</div>
        <div className="space-y-1.5"><Label>Age (years)</Label><Input type="number" inputMode="numeric" {...form.register('ageYears')} />{e.ageYears && <p className="text-xs text-destructive">{e.ageYears.message}</p>}</div>
        <div className="space-y-1.5"><Label>or Date of birth</Label><Input type="date" max={todayIST()} {...form.register('dob')} /></div>
      </div>
      <div className="flex gap-2 pt-1">
        {onCancel && <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" className="flex-1" loading={form.formState.isSubmitting}>Save &amp; continue</Button>
      </div>
    </form>
  );
}

export default function Book() {
  const qc = useQueryClient();
  const { token, mobile: savedMobile, login } = usePatient();
  const [step, setStep] = useState(token ? 'profile' : 'mobile');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [channel, setChannel] = useState('whatsapp');
  const [busy, setBusy] = useState(false);
  const [patient, setPatient] = useState(null);
  const [adding, setAdding] = useState(false);
  const [branch, setBranch] = useState(null);
  const [doctor, setDoctor] = useState('any');
  const [date, setDate] = useState(todayIST());
  const [slot, setSlot] = useState(null);
  const [complaint, setComplaint] = useState('');
  const [booked, setBooked] = useState(null);
  const otpRef = useRef();

  useEffect(() => { if (!token && STEPS.indexOf(step) > 1) setStep('mobile'); }, [token, step]);
  useEffect(() => { if (cooldown <= 0) return undefined; const t = setTimeout(() => setCooldown(cooldown - 1), 1000); return () => clearTimeout(t); }, [cooldown]);
  useEffect(() => setSlot(null), [branch, doctor, date]);

  const me = useQuery({ queryKey: ['me', token], enabled: !!token && step === 'profile', queryFn: () => get('/portal/me') });
  const branches = useQuery({ queryKey: ['pub-branches'], queryFn: () => get('/branches/public'), staleTime: 600_000 });
  const doctors = useQuery({ queryKey: ['pub-doctors', branch?._id], enabled: !!branch, queryFn: () => get('/doctors/public', { branch: branch._id }) });

  const sendOtp = async () => {
    if (!/^[6-9]\d{9}$/.test(mobile)) return toast.error('Enter a valid 10-digit mobile number');
    setBusy(true);
    try {
      const r = await post('/auth/patient/otp/send', { mobile });
      setCooldown(r.resendIn);
      if (r.channel) setChannel(r.channel);
      setStep('otp');
      setTimeout(() => otpRef.current?.focus(), 50);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    if (!/^\d{6}$/.test(otp)) return toast.error('Enter the 6-digit OTP');
    setBusy(true);
    try {
      const r = await post('/auth/patient/otp/verify', { mobile, otp });
      login(r.token, r.mobile);
      qc.setQueryData(['me', r.token], { mobile: r.mobile, profiles: r.profiles, maxProfiles: 10 });
      setAdding(r.isNew);
      setStep('profile');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    setBusy(true);
    try {
      const a = await post('/portal/appointments', { patient: patient._id, branch: branch._id, doctor: slot.doctor, date, start: slot.start, complaint: complaint || undefined, utm: getUtm() });
      setBooked(a);
      setStep('done');
      qc.invalidateQueries({ queryKey: ['my-appts'] });
    } catch (e) {
      toast.error(errMsg(e));
      if (e.response?.status === 409) { setSlot(null); qc.invalidateQueries({ queryKey: ['pub-avail'] }); setStep('slot'); }
    } finally {
      setBusy(false);
    }
  };
  const back = () => setStep(STEPS[Math.max(STEPS.indexOf(step) - 1, token ? 2 : 0)]);

  return (
    <div>
      {['mobile', 'otp'].includes(step) && (
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Book your consultation</h1>
          <p className="mt-1 text-sm text-muted-foreground">Rohini · Paschim Vihar · Indirapuram · Tilak Nagar · Dwarka</p>
        </div>
      )}
      <Progress step={step} />
      {!['mobile', 'done', 'profile'].includes(step) && <button onClick={back} className="mb-3 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</button>}

      {step === 'mobile' && (
        <Card className="mx-auto max-w-sm space-y-4 p-6">
          <div className="space-y-1.5">
            <Label>Mobile number</Label>
            <div className="flex">
              <span className="flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm">+91</span>
              <Input className="rounded-l-none text-base" inputMode="numeric" maxLength={10} autoFocus value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && sendOtp()} placeholder="98XXXXXXXX" />
            </div>
          </div>
          <Button className="w-full" size="lg" loading={busy} onClick={sendOtp}>Get OTP</Button>
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> One number can book for your whole family</p>
        </Card>
      )}

      {step === 'otp' && (
        <Card className="mx-auto max-w-sm space-y-4 p-6">
          <p className="text-sm">Enter the 6-digit code sent on <b>{channel === 'sms' ? 'SMS' : channel === 'whatsapp' ? 'WhatsApp' : 'WhatsApp & SMS'}</b> to <b>+91 {mobile}</b> <button className="text-primary underline" onClick={() => setStep('mobile')}>change</button></p>
          <Input ref={otpRef} className="text-center text-2xl tracking-[0.5em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && verify()} />
          <Button className="w-full" size="lg" loading={busy} onClick={verify}>Verify</Button>
          <p className="text-center text-sm text-muted-foreground">{cooldown > 0 ? `Resend in ${cooldown}s` : <button className="text-primary underline" onClick={sendOtp}>Resend OTP</button>}</p>
        </Card>
      )}

      {step === 'profile' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Who is the appointment for?</h2><span className="text-xs text-muted-foreground">{savedMobile}</span></div>
          {me.isLoading ? <Skeleton className="h-32 w-full" /> : adding || !me.data?.profiles.length ? (
            <Card className="p-5"><MemberForm hasSelf={me.data?.profiles.some((p) => p.relation === 'self')} onCancel={me.data?.profiles.length ? () => setAdding(false) : undefined} onSaved={(p) => { qc.invalidateQueries({ queryKey: ['me'] }); setPatient(p); setAdding(false); setStep('branch'); }} /></Card>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {me.data.profiles.map((p) => (
                  <button key={p._id} onClick={() => { setPatient(p); setStep('branch'); }} className="flex items-center gap-3 rounded-xl border bg-card p-4 text-left transition hover:border-primary hover:shadow">
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary"><UserRound className="h-5 w-5" /></span>
                    <div><p className="font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{p.relation} · {p.gender} · {ageOf(p)}y · {p.patientId}</p></div>
                  </button>
                ))}
              </div>
              {me.data.profiles.length < (me.data.maxProfiles || 10) && <Button variant="outline" className="w-full" onClick={() => setAdding(true)}><UserPlus /> Add family member</Button>}
            </>
          )}
        </div>
      )}

      {step === 'branch' && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Choose a clinic</h2>
          {branches.isLoading ? <Skeleton className="h-40 w-full" /> : branches.data.map((b) => (
            <button key={b._id} onClick={() => { setBranch(b); setDoctor('any'); setStep('slot'); }} className="flex w-full items-start gap-3 rounded-xl border bg-card p-4 text-left transition hover:border-primary hover:shadow">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><MapPin className="h-5 w-5" /></span>
              <div className="min-w-0">
                <p className="font-medium">{b.name}</p>
                <p className="text-xs text-muted-foreground">{[b.address?.line1, b.address?.city].filter(Boolean).join(', ') || 'Delhi NCR'}</p>
                <p className="mt-1 text-xs text-muted-foreground">{fmtTime(b.settings?.openTime)} – {fmtTime(b.settings?.closeTime)}{b.phone && ` · ${b.phone}`}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {step === 'slot' && branch && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Pick a time at {branch.name}</h2>
          <div className="space-y-1.5">
            <Label>Doctor</Label>
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button onClick={() => setDoctor('any')} className={cn('shrink-0 rounded-full border px-4 py-1.5 text-sm', doctor === 'any' ? 'border-primary bg-primary text-primary-foreground' : 'bg-card')}>Any available</button>
              {doctors.data?.map((d) => <button key={d._id} onClick={() => setDoctor(d._id)} className={cn('shrink-0 rounded-full border px-4 py-1.5 text-sm', doctor === d._id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card')}>{d.name}</button>)}
            </div>
          </div>
          <DateStrip value={date} onChange={setDate} />
          <SlotGrid branch={branch._id} date={date} doctor={doctor} value={slot} onChange={setSlot} />
          <div className="sticky bottom-3"><Button className="w-full shadow-lg" size="lg" disabled={!slot} onClick={() => setStep('confirm')}>Continue{slot ? ` · ${fmtTime(slot.start)}` : ''}</Button></div>
        </div>
      )}

      {step === 'confirm' && (
        <Card className="space-y-4 p-5">
          <h2 className="text-lg font-semibold">Confirm appointment</h2>
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2"><UserRound className="h-4 w-4 text-muted-foreground" /> {patient.name} <Badge variant="secondary">{patient.patientId}</Badge></p>
            <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" /> {branch.name}</p>
            <p className="flex items-center gap-2"><Stethoscope className="h-4 w-4 text-muted-foreground" /> {doctor === 'any' ? 'First available doctor' : doctors.data?.find((d) => d._id === doctor)?.name}</p>
            <p className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /> {fmtDate(date)} · {fmtTime(slot.start)}</p>
          </div>
          <div className="space-y-1.5"><Label>Tell us briefly about the problem (optional)</Label><Textarea rows={3} value={complaint} onChange={(e) => setComplaint(e.target.value)} maxLength={500} placeholder="e.g. bleeding, pain while passing stool…" /></div>
          <Button className="w-full" size="lg" loading={busy} onClick={confirm}>Confirm booking</Button>
          <p className="text-center text-xs text-muted-foreground">Your details are kept confidential.</p>
        </Card>
      )}

      {step === 'done' && booked && (
        <Card className="space-y-4 p-6 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-7 w-7" /></div>
          <div><h2 className="text-xl font-semibold">Appointment booked</h2><p className="text-sm text-muted-foreground">Confirmation sent on SMS / WhatsApp</p></div>
          <div className="rounded-lg bg-muted p-4 text-left text-sm">
            <p className="text-xs uppercase text-muted-foreground">Booking ID</p>
            <p className="font-mono text-lg font-semibold">{booked.bookingId}</p>
            <div className="mt-2 space-y-1">
              <p>{booked.patient?.name}</p>
              <p>{fmtDate(booked.date)} · {fmtTime(booked.start)}</p>
              <p>{booked.doctor?.name} · {booked.branch?.name}</p>
              {booked.branch?.phone && <p className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {booked.branch.phone}</p>}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Please arrive 10 minutes early and carry previous reports, if any.</p>
          <div className="flex gap-2">
            <Button asChild variant="outline" className="flex-1"><Link to="/appointments"><CalendarCheck2 /> My visits</Link></Button>
            <Button className="flex-1" onClick={() => { setStep('profile'); setSlot(null); setComplaint(''); setBooked(null); }}>Book another</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
