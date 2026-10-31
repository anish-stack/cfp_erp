import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldCheck, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { post } from '@/lib/api';
import { usePatient } from '@/store/patient';
import { errMsg } from '@/lib/utils';

export default function Login() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const next = sp.get('next')?.startsWith('/') ? sp.get('next') : '/profile';
  const qc = useQueryClient();
  const { token, login } = usePatient();
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [channel, setChannel] = useState('whatsapp');
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const otpRef = useRef();

  useEffect(() => { if (token) nav(next, { replace: true }); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (cooldown <= 0) return undefined; const t = setTimeout(() => setCooldown(cooldown - 1), 1000); return () => clearTimeout(t); }, [cooldown]);

  const send = async () => {
    if (!/^[6-9]\d{9}$/.test(mobile)) return toast.error('Enter a valid 10-digit mobile number');
    setBusy(true);
    try {
      const r = await post('/auth/patient/otp/send', { mobile });
      setCooldown(r.resendIn || 30);
      if (r.channel) setChannel(r.channel);
      setSent(true);
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
      toast.success('Logged in');
      nav(r.profiles?.length ? next : '/profile', { replace: true });
    } catch (e) {
      toast.error(errMsg(e));
      setOtp('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mx-auto max-w-sm space-y-5 p-6">
      <div className="text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary"><Smartphone className="h-6 w-6" /></div>
        <h1 className="text-xl font-semibold">Login</h1>
        <p className="text-sm text-muted-foreground">Manage appointments, prescriptions, bills &amp; family profiles</p>
      </div>
      <div className="space-y-1.5">
        <Label>Mobile number</Label>
        <div className="flex">
          <span className="flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm">+91</span>
          <Input className="rounded-l-none text-base" inputMode="numeric" maxLength={10} autoFocus disabled={sent} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="98XXXXXXXX" />
        </div>
      </div>
      {!sent ? (
        <Button className="w-full" size="lg" loading={busy} onClick={send}>Get OTP</Button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">Code sent on <b>{channel === 'sms' ? 'SMS' : channel === 'whatsapp' ? 'WhatsApp' : 'WhatsApp & SMS'}</b> · <button className="text-primary underline" onClick={() => { setSent(false); setOtp(''); }}>change number</button></p>
          <Input ref={otpRef} className="text-center text-2xl tracking-[0.5em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setOtp(v); if (v.length === 6) verify(v); }} />
          <Button className="w-full" size="lg" loading={busy} disabled={otp.length !== 6} onClick={() => verify()}>Verify &amp; login</Button>
          <p className="text-center text-sm text-muted-foreground">{cooldown > 0 ? `Resend in ${cooldown}s` : <button className="text-primary underline" onClick={send}>Resend OTP</button>}</p>
        </div>
      )}
      <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> New here? Logging in creates your account.</p>
      <p className="text-center text-sm"><Link to="/" className="text-primary underline">Book an appointment instead</Link></p>
    </Card>
  );
}
