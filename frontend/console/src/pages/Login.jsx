import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Stethoscope, Smartphone, Mail, Eye, EyeOff, Lock, AlertTriangle, CalendarCheck2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/store/auth';
import { post } from '@/lib/api';
import { usePublicInfo } from '@/hooks/queries';
import { loadMe } from '@/lib/session';
import { appMode } from '@/lib/mode';
import { errMsg } from '@/lib/utils';

const BOOKING_URL = import.meta.env.VITE_BOOKING_URL || 'https://appointment.centreforpilesandfistula.com';

/** One simple sign-in for all staff. The role decides what each person sees after login. */
export default function Login() {
  const me = useAuth((s) => s.me);
  const nav = useNavigate();
  const loc = useLocation();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [forgot, setForgot] = useState(false);
  const { data: info } = usePublicInfo();
  const clinic = info?.clinic || info;
  if (me) return <Navigate to={loc.state?.from || '/'} replace />;

  const isMobile = /^[+\d\s-]+$/.test(login) && login.replace(/\D/g, '').length > 0;
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const id = isMobile ? login.replace(/\D/g, '').slice(-10) : login.trim();
    if (isMobile ? id.length !== 10 : !/^\S+@\S+\.\S+$/.test(id)) return setError('Enter your 10-digit mobile number or email');
    if (!password) return setError('Enter your password');
    setBusy(true);
    try {
      const { accessToken } = await post('/auth/staff/login', { login: id, password });
      useAuth.getState().setToken(accessToken);
      await loadMe();
      nav(loc.state?.from || (appMode() === 'crm' ? '/crm' : '/'), { replace: true });
    } catch (err) {
      // never reveal whether the account exists
      const m = errMsg(err);
      setError(/locked/i.test(m) ? 'Too many attempts. Please try again in 15 minutes.' : /too many/i.test(m) ? 'Too many attempts. Please wait and try again.' : 'Incorrect mobile/email or password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.08),transparent_55%)] bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          {clinic?.logo ? <img src={clinic.logo} alt={clinic?.name || 'logo'} className="h-16 w-auto max-w-[240px] object-contain" /> : <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary text-primary-foreground"><Stethoscope className="h-7 w-7" /></span>}
          <h1 className="mt-4 text-2xl font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground">{clinic?.name || 'Staff console'}</p>
        </div>
        <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl border bg-card p-6 shadow-lg">
          <div className="space-y-1.5">
            <label htmlFor="login" className="text-sm font-medium">Mobile number or email</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{isMobile ? <Smartphone className="h-5 w-5" /> : <Mail className="h-5 w-5" />}</span>
              <input id="login" autoFocus autoComplete="username" inputMode={isMobile ? 'tel' : 'email'} value={login} onChange={(e) => setLogin(e.target.value)}
                className="h-12 w-full rounded-lg border bg-background pl-11 pr-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium">Password</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"><Lock className="h-5 w-5" /></span>
              <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyUp={(e) => setCaps(e.getModifierState?.('CapsLock'))}
                className="h-12 w-full rounded-lg border bg-background pl-11 pr-11 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
              <button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button>
            </div>
            {caps && <p className="flex items-center gap-1 text-xs text-amber-600"><AlertTriangle className="h-3.5 w-3.5" /> Caps Lock is on</p>}
          </div>
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive" role="alert">{error}</p>}
          <Button type="submit" size="lg" className="h-12 w-full text-base" loading={busy}>Sign in</Button>
          <button type="button" className="w-full text-center text-xs text-muted-foreground hover:text-primary" onClick={() => setForgot(!forgot)}>Forgot password?</button>
          {forgot && <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">Ask your branch admin or the super admin to reset your password.</p>}
        </form>
        <a href={BOOKING_URL} className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary"><CalendarCheck2 className="h-4 w-4" /> Patient? Book an appointment <ArrowRight className="h-4 w-4" /></a>
      </div>
    </div>
  );
}
