import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, MapPin, Phone, Stethoscope, UserPlus, UserRound, CalendarCheck2, Clock, ShieldCheck, Pencil, Download, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DateStrip, SlotGrid } from '@/components/SlotGrid';
import { get, post, openDoc } from '@/lib/api';
import { usePatient, getUtm } from '@/store/patient';
import { cn, errMsg, fmtDate, fmtTime, todayIST, ageOf } from '@/lib/utils';

const COMPLAINTS = ['Piles / bleeding', 'Fistula / pus', 'Fissure / pain', 'Pilonidal sinus', 'Constipation', 'Other'];

function Steps({ step }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      {['Choose slot', 'Your details'].map((l, i) => (
        <div key={l} className="flex flex-1 items-center gap-2">
          <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-semibold', i + 1 <= step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{i + 1 < step ? <Check className="h-4 w-4" /> : i + 1}</span>
          <span className={cn('text-sm', i + 1 === step ? 'font-semibold' : 'text-muted-foreground')}>{l}</span>
          {i === 0 && <span className={cn('h-px flex-1', step > 1 ? 'bg-primary' : 'bg-border')} />}
        </div>
      ))}
    </div>
  );
}

function Chip({ active, onClick, children, className }) {
  return <button type="button" onClick={onClick} className={cn('shrink-0 rounded-xl border bg-card px-3 py-2 text-left text-sm transition', active ? 'border-primary bg-primary text-primary-foreground shadow' : 'hover:border-primary', className)}>{children}</button>;
}

export default function Book() {
  const qc = useQueryClient();
  const { token, mobile: savedMobile, login } = usePatient();
  const [step, setStep] = useState(1);
  // step 1
  const [branch, setBranch] = useState(null);
  const [doctor, setDoctor] = useState('any');
  const [date, setDate] = useState(todayIST());
  const [slot, setSlot] = useState(null);
  const [complaint, setComplaint] = useState('');
  // step 2
  const [mobile, setMobile] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [channel, setChannel] = useState('whatsapp');
  const [cooldown, setCooldown] = useState(0);
  const [profileId, setProfileId] = useState('');
  const [np, setNp] = useState({ name: '', gender: '', ageYears: '', relation: 'self' });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [booked, setBooked] = useState(null);
  const otpRef = useRef();

  useEffect(() => setSlot(null), [branch, doctor, date]);
  useEffect(() => { if (cooldown <= 0) return undefined; const t = setTimeout(() => setCooldown(cooldown - 1), 1000); return () => clearTimeout(t); }, [cooldown]);

  const branches = useQuery({ queryKey: ['pub-branches'], queryFn: () => get('/branches/public'), staleTime: 600_000 });
  const doctors = useQuery({ queryKey: ['pub-doctors', branch?._id], enabled: !!branch, queryFn: () => get('/doctors/public', { branch: branch._id }) });
  const me = useQuery({ queryKey: ['me', token], enabled: !!token, queryFn: () => get('/portal/me') });
  useEffect(() => { if (branches.data?.length === 1) setBranch(branches.data[0]); }, [branches.data]);
  useEffect(() => {
    const ps = me.data?.profiles || [];
    if (!ps.length && me.data) { setAdding(true); setNp((x) => ({ ...x, relation: 'self' })); }
    if (ps.length && !profileId) setProfileId(ps[0]._id);
  }, [me.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendOtp = async () => {
    if (!/^[6-9]\d{9}$/.test(mobile)) return toast.error('Enter a valid 10-digit mobile number');
    setBusy(true);
    try {
      const r = await post('/auth/patient/otp/send', { mobile });
      setCooldown(r.resendIn);
      if (r.channel) setChannel(r.channel);
      setOtpSent(true);
      setTimeout(() => otpRef.current?.focus(), 50);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const verify = async (code = otp) => {
    if (!/^\d{6}$/.test(code)) return;
    setBusy(true);
    try {
      const r = await post('/auth/patient/otp/verify', { mobile, otp: code });
      login(r.token, r.mobile);
      qc.setQueryData(['me', r.token], { mobile: r.mobile, profiles: r.profiles, maxProfiles: 10 });
      if (r.profiles?.length) setProfileId(r.profiles[0]._id);
      else setAdding(true);
      setOtpSent(false);
      setOtp('');
    } catch (e) {
      toast.error(errMsg(e));
      setOtp('');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      let pid = profileId;
      if (adding || !pid) {
        if (np.name.trim().length < 2 || !np.gender || !np.ageYears) throw new Error('Enter name, gender and age');
        const hasSelf = me.data?.profiles?.some((p) => p.relation === 'self');
        const p = await post('/portal/profiles', { name: np.name.trim(), gender: np.gender, ageYears: Number(np.ageYears), relation: hasSelf && np.relation === 'self' ? 'other' : np.relation, registeredBranch: branch._id });
        pid = p._id;
        qc.invalidateQueries({ queryKey: ['me'] });
      }
      const a = await post('/portal/appointments', { patient: pid, branch: branch._id, doctor: slot.doctor, date, start: slot.start, complaint: complaint || undefined, utm: getUtm() });
      setBooked(a);
      setStep(3);
      qc.invalidateQueries({ queryKey: ['my-appts'] });
    } catch (e) {
      toast.error(errMsg(e));
      if (e.response?.status === 409) { setSlot(null); qc.invalidateQueries({ queryKey: ['pub-avail'] }); setStep(1); }
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------- done
  if (step === 3 && booked) {
    return (
      <Card className="mx-auto max-w-md space-y-4 p-6 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-7 w-7" /></div>
        <div><h2 className="text-xl font-semibold">Appointment booked</h2><p className="text-sm text-muted-foreground">Confirmation sent on WhatsApp</p></div>
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
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => openDoc('slip', booked._id, { download: true, filename: `${booked.bookingId}.pdf` }).catch((e) => toast.error(errMsg(e)))}><Download /> Slip</Button>
          <Button asChild variant="outline"><Link to="/appointments"><CalendarCheck2 /> My visits</Link></Button>
        </div>
        <Button className="w-full" onClick={() => { setStep(1); setSlot(null); setComplaint(''); setBooked(null); }}>Book another</Button>
      </Card>
    );
  }

  return (
    <div>
      <div className="mb-5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Book your consultation</h1>
        <p className="mt-1 text-sm text-muted-foreground">Free consultation · 5 branches across Delhi NCR</p>
      </div>
      <Steps step={step} />

      {step === 1 && (
        <div className="space-y-5">
          <section>
            <Label className="mb-2 block">Clinic</Label>
            {branches.isLoading ? <Skeleton className="h-16 w-full" /> : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {branches.data.map((b) => (
                  <Chip key={b._id} active={branch?._id === b._id} onClick={() => { setBranch(b); setDoctor('any'); }}>
                    <p className="flex items-center gap-1 font-medium"><MapPin className="h-3.5 w-3.5" />{b.name}</p>
                    <p className="text-[11px] opacity-80">{fmtTime(b.settings?.openTime)}–{fmtTime(b.settings?.closeTime)}</p>
                  </Chip>
                ))}
              </div>
            )}
          </section>

          {branch && (
            <>
              <section>
                <Label className="mb-2 block">Doctor</Label>
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                  <Chip active={doctor === 'any'} onClick={() => setDoctor('any')}><p className="font-medium">Any available</p><p className="text-[11px] opacity-80">Earliest slot</p></Chip>
                  {doctors.data?.map((d) => (
                    <Chip key={d._id} active={doctor === d._id} onClick={() => setDoctor(d._id)}><p className="font-medium">{d.name}</p><p className="max-w-[180px] truncate text-[11px] opacity-80">{d.qualification}</p></Chip>
                  ))}
                </div>
              </section>
              <section>
                <Label className="mb-2 block">Date</Label>
                <DateStrip value={date} onChange={setDate} />
              </section>
              <section>
                <Label className="mb-2 block">Time</Label>
                <SlotGrid branch={branch._id} date={date} doctor={doctor} value={slot} onChange={setSlot} />
              </section>
              {slot && (
                <section>
                  <Label className="mb-2 block">Problem (optional)</Label>
                  <div className="flex flex-wrap gap-2">{COMPLAINTS.map((c) => <button key={c} type="button" onClick={() => setComplaint(complaint === c ? '' : c)} className={cn('rounded-full border px-3 py-1 text-sm', complaint === c ? 'border-primary bg-primary text-primary-foreground' : 'bg-card')}>{c}</button>)}</div>
                </section>
              )}
            </>
          )}
          <div className="sticky bottom-3 z-10"><Button className="w-full shadow-lg" size="lg" disabled={!slot} onClick={() => setStep(2)}>{slot ? `Continue · ${fmtDate(date)}, ${fmtTime(slot.start)}` : 'Select a time slot'}</Button></div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <Card className="flex items-start justify-between gap-3 p-4">
            <div className="space-y-1 text-sm">
              <p className="flex items-center gap-2 font-semibold"><Clock className="h-4 w-4 text-primary" /> {fmtDate(date)} · {fmtTime(slot.start)}</p>
              <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" /> {branch.name}</p>
              <p className="flex items-center gap-2"><Stethoscope className="h-4 w-4 text-muted-foreground" /> {doctor === 'any' ? 'First available doctor' : doctors.data?.find((d) => d._id === doctor)?.name}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setStep(1)}><Pencil /> Change</Button>
          </Card>

          {!token ? (
            <Card className="space-y-4 p-5">
              <div className="space-y-1.5">
                <Label>Mobile number</Label>
                <div className="flex">
                  <span className="flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm">+91</span>
                  <Input className="rounded-l-none text-base" inputMode="numeric" maxLength={10} autoFocus disabled={otpSent} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && sendOtp()} placeholder="98XXXXXXXX" />
                </div>
              </div>
              {!otpSent ? (
                <Button className="w-full" size="lg" loading={busy} onClick={sendOtp}>Get OTP</Button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm">Enter the code sent on <b>{channel === 'sms' ? 'SMS' : channel === 'whatsapp' ? 'WhatsApp' : 'WhatsApp & SMS'}</b> <button className="text-primary underline" onClick={() => { setOtpSent(false); setOtp(''); }}>change number</button></p>
                  <Input ref={otpRef} className="text-center text-2xl tracking-[0.5em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setOtp(v); if (v.length === 6) verify(v); }} />
                  <Button className="w-full" size="lg" loading={busy} disabled={otp.length !== 6} onClick={() => verify()}>Verify</Button>
                  <p className="text-center text-sm text-muted-foreground">{cooldown > 0 ? `Resend in ${cooldown}s` : <button className="text-primary underline" onClick={sendOtp}>Resend OTP</button>}</p>
                </div>
              )}
              <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> One number books for your whole family</p>
            </Card>
          ) : (
            <Card className="space-y-4 p-5">
              <div className="flex items-center justify-between"><p className="font-semibold">Who is visiting?</p><span className="text-xs text-muted-foreground">+91 {savedMobile}</span></div>
              {me.isLoading ? <Skeleton className="h-20 w-full" /> : (
                <>
                  {me.data?.profiles?.length > 0 && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {me.data.profiles.map((p) => (
                        <button key={p._id} type="button" onClick={() => { setProfileId(p._id); setAdding(false); }} className={cn('flex items-center gap-3 rounded-xl border p-3 text-left', !adding && profileId === p._id ? 'border-primary bg-accent' : 'hover:border-primary')}>
                          <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary"><UserRound className="h-4 w-4" /></span>
                          <div><p className="font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{p.relation} · {p.gender} · {ageOf(p)}y</p></div>
                        </button>
                      ))}
                      <button type="button" onClick={() => { setAdding(true); setNp({ name: '', gender: '', ageYears: '', relation: 'spouse' }); }} className={cn('flex items-center gap-3 rounded-xl border border-dashed p-3 text-left', adding ? 'border-primary bg-accent' : 'hover:border-primary')}>
                        <UserPlus className="h-5 w-5 text-primary" /><span className="text-sm font-medium">Someone else</span>
                      </button>
                    </div>
                  )}
                  {adding && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2 space-y-1.5"><Label>Full name</Label><Input value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} autoFocus /></div>
                      <div className="space-y-1.5"><Label>Gender</Label><Select value={np.gender} onChange={(e) => setNp({ ...np, gender: e.target.value })} placeholder="Select"><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></Select></div>
                      <div className="space-y-1.5"><Label>Age</Label><Input type="number" inputMode="numeric" value={np.ageYears} onChange={(e) => setNp({ ...np, ageYears: e.target.value })} /></div>
                      {me.data?.profiles?.length > 0 && <div className="col-span-2 space-y-1.5"><Label>Relation</Label><Select value={np.relation} onChange={(e) => setNp({ ...np, relation: e.target.value })}>{['spouse', 'child', 'parent', 'sibling', 'other'].map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}</Select></div>}
                    </div>
                  )}
                  <div className="space-y-1.5"><Label>Anything the doctor should know? (optional)</Label><Textarea rows={2} maxLength={500} value={complaint} onChange={(e) => setComplaint(e.target.value)} /></div>
                  <Button className="w-full" size="lg" loading={busy} onClick={confirm}>Confirm booking</Button>
                </>
              )}
            </Card>
          )}
          <button onClick={() => setStep(1)} className="flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Back</button>
        </div>
      )}
    </div>
  );
}
