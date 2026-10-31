import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Stethoscope, Building2, Headset, ShieldCheck, Smartphone, Mail, Eye, EyeOff, ArrowRight, CalendarCheck2, KeyRound, AlertTriangle, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/store/auth';
import { get, post } from '@/lib/api';
import { loadMe } from '@/lib/session';
import { appMode } from '@/lib/mode';
import { cn, errMsg } from '@/lib/utils';

const BOOKING_URL = import.meta.env.VITE_BOOKING_URL || 'https://appointment.centreforpilesandfistula.com';

/** One sign-in for every staff member — the role decides what they see after login. */
const ROLES = [
  { key: 'clinic', icon: Building2, title: 'Clinic staff', who: 'Reception · Doctor · Pharmacy · Accounts · Branch admin', goto: '/' },
  { key: 'crm', icon: Headset, title: 'Sales / CRM', who: 'Tele-counsellors · Sales manager · Marketing', goto: '/crm' },
  { key: 'admin', icon: ShieldCheck, title: 'Super Admin', who: 'All branches, settings, reports', goto: '/' },
];
const DEMO = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_LOGINS === 'true'
  ? [['Reception', 'rohini.reception@demo.cpf'], ['Doctor', 'rakesh.gupta@demo.cpf'], ['Pharmacy', 'pharmacy.rohini@demo.cpf'], ['Accounts', 'accounts@demo.cpf'], ['Branch admin', 'rohini.admin@demo.cpf'], ['Sales', 'sales1@demo.cpf'], ['Sales mgr', 'sales.manager@demo.cpf']]
  : [];

export default function Login() {
  const me = useAuth((s) => s.me);
  const nav = useNavigate();
  const loc = useLocation();
  const mode = appMode();
  const [role, setRole] = useState(mode === 'crm' ? 'crm' : mode === 'clinic' ? 'clinic' : 'admin');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [forgot, setForgot] = useState(false);
  const { data: info } = useQuery({ queryKey: ['public-clinic'], queryFn: () => get('/public/clinic'), retry: false, staleTime: 600_000 });
  const clinic = info?.clinic;
  if (me) return <Navigate to={loc.state?.from || '/'} replace />;

  const isMobile = /^[+\d\s-]+$/.test(login) && login.replace(/\D/g, '').length > 0;
  const R = ROLES.find((r) => r.key === role);

  const submit = async (e) => {
    e?.preventDefault();
    setError('');
    const id = isMobile ? login.replace(/\D/g, '').slice(-10) : login.trim();
    if (isMobile ? id.length !== 10 : !/^\S+@\S+\.\S+$/.test(id)) return setError(isMobile ? 'Enter your 10-digit mobile number' : 'Enter a valid email or mobile number');
    if (!password) return setError('Enter your password');
    setBusy(true);
    try {
      const { accessToken } = await post('/auth/staff/login', { login: id, password });
      useAuth.getState().setToken(accessToken);
      await loadMe();
      nav(loc.state?.from || R.goto, { replace: true });
    } catch (err) {
      const m = errMsg(err);
      setError(/invalid credentials/i.test(m) ? 'Wrong mobile/email or password. Please check and try again.' : /locked/i.test(m) ? 'Too many wrong attempts — account locked for 15 minutes.' : m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.10),transparent_45%),radial-gradient(circle_at_bottom_right,hsl(var(--primary)/0.08),transparent_40%)] bg-background">
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-4 py-8 lg:grid-cols-[1.05fr_1fr] lg:px-8">
        {/* brand */}
        <div className="space-y-6">
          <div className="inline-flex items-center gap-3 rounded-2xl border bg-white px-4 py-3 shadow-sm">
            {clinic?.logo ? <img src={clinic.logo} alt={clinic?.name || 'logo'} className="h-12 w-auto max-w-[220px] object-contain" /> : <><span className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground"><Stethoscope /></span><span className="font-semibold">{clinic?.name || 'Centre for Piles & Fistula'}</span></>}
          </div>
          <div className="hidden lg:block">
            <h1 className="text-4xl font-bold leading-tight tracking-tight">One login for<br /><span className="text-primary">every team</span>.</h1>
            <p className="mt-3 max-w-md text-muted-foreground">Sign in with your mobile number or email. You will only see the screens your role needs — appointments, pharmacy, billing, CRM or admin.</p>
          </div>
          <div className="hidden gap-3 lg:grid">
            {ROLES.map((r) => (
              <div key={r.key} className="flex items-center gap-3 rounded-xl border bg-card/70 p-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><r.icon className="h-5 w-5" /></span>
                <div><p className="font-medium">{r.title}</p><p className="text-xs text-muted-foreground">{r.who}</p></div>
              </div>
            ))}
          </div>
        </div>

        {/* form */}
        <div className="w-full">
          <div className="mx-auto w-full max-w-md rounded-2xl border bg-card p-6 shadow-xl sm:p-8">
            <h2 className="text-2xl font-semibold">Welcome back 👋</h2>
            <p className="mb-5 text-sm text-muted-foreground">Choose your team, then sign in.</p>

            <div className="mb-5 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Team">
              {ROLES.map((r) => (
                <button key={r.key} type="button" role="radio" aria-checked={role === r.key} onClick={() => setRole(r.key)}
                  className={cn('flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center text-xs font-medium transition', role === r.key ? 'border-primary bg-primary/5 text-primary ring-2 ring-primary/20' : 'text-muted-foreground hover:border-primary/40')}>
                  <r.icon className="h-5 w-5" />{r.title}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <label htmlFor="login" className="text-sm font-medium">Mobile number or email</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{isMobile ? <Smartphone className="h-5 w-5" /> : <Mail className="h-5 w-5" />}</span>
                  <input id="login" autoFocus autoComplete="username" inputMode={isMobile ? 'tel' : 'email'} value={login} onChange={(e) => setLogin(e.target.value)} placeholder="98XXXXXXXX or name@clinic.com"
                    className="h-12 w-full rounded-lg border bg-background pl-11 pr-3 text-base outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20" />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between"><label htmlFor="password" className="text-sm font-medium">Password</label><button type="button" className="text-xs text-primary hover:underline" onClick={() => setForgot(!forgot)}>Forgot password?</button></div>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"><Lock className="h-5 w-5" /></span>
                  <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyUp={(e) => setCaps(e.getModifierState?.('CapsLock'))}
                    className="h-12 w-full rounded-lg border bg-background pl-11 pr-11 text-base outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20" />
                  <button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button>
                </div>
                {caps && <p className="flex items-center gap-1 text-xs text-amber-600"><AlertTriangle className="h-3.5 w-3.5" /> Caps Lock is on</p>}
              </div>
              {forgot && <p className="flex gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground"><KeyRound className="h-4 w-4 shrink-0" /> Ask your Branch Admin or the Super Admin to reset it from <b>Staff → Reset password</b>. You can change it later in Account.</p>}
              {error && <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive" role="alert">{error}</p>}
              <Button type="submit" size="lg" className="h-12 w-full text-base" loading={busy}>Sign in as {R.title} <ArrowRight /></Button>
              <p className="text-center text-xs text-muted-foreground">{R.who}</p>
            </form>

            {DEMO.length > 0 && (
              <div className="mt-5 border-t pt-4">
                <p className="mb-2 text-[11px] font-semibold uppercase text-muted-foreground">Demo logins (password Demo@1234)</p>
                <div className="flex flex-wrap gap-1.5">{DEMO.map(([l, e]) => <button key={e} type="button" onClick={() => { setLogin(e); setPassword('Demo@1234'); setRole(/sales/.test(e) ? 'crm' : 'clinic'); }} className="rounded-full border px-2.5 py-1 text-xs hover:border-primary hover:text-primary">{l}</button>)}</div>
              </div>
            )}
          </div>
          <a href={BOOKING_URL} className="mx-auto mt-4 flex max-w-md items-center justify-center gap-2 rounded-xl border bg-card/70 p-3 text-sm text-muted-foreground hover:text-primary">
            <CalendarCheck2 className="h-4 w-4" /> Patient? <b className="text-foreground">Book an appointment</b> <ArrowRight className="h-4 w-4" />
          </a>
          <p className="mt-4 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} {clinic?.name || 'Centre for Piles & Fistula'}</p>
        </div>
      </div>
    </div>
  );
}
