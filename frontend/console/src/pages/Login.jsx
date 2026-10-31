import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Stethoscope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/common/Field';
import { useAuth } from '@/store/auth';
import { post } from '@/lib/api';
import { loadMe } from '@/lib/session';
import { appMode, MODE_TITLES } from '@/lib/mode';
import { errMsg } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';

const schema = z.object({ login: z.string().trim().min(3, 'Enter email or mobile'), password: z.string().min(1, 'Enter password') });

export default function Login() {
  const me = useAuth((s) => s.me);
  const nav = useNavigate();
  const loc = useLocation();
  const [error, setError] = useState('');
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { login: '', password: '' } });
  const { data: clinic } = useQuery({ queryKey: ['public-clinic'], queryFn: () => get('/public/clinic').then((r) => r.clinic), retry: false });
  if (me) return <Navigate to={loc.state?.from || '/'} replace />;

  const onSubmit = async (v) => {
    setError('');
    try {
      const { accessToken } = await post('/auth/staff/login', v);
      useAuth.getState().setToken(accessToken);
      await loadMe();
      nav(loc.state?.from || '/', { replace: true });
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-gradient-to-br from-teal-700 to-teal-900 p-10 text-white lg:flex">
        <div className="flex items-center gap-3 text-lg font-semibold">{clinic?.logo ? <img src={clinic.logo} alt="" className="h-10 w-10 rounded-lg bg-white object-contain p-0.5" /> : <Stethoscope />} {clinic?.name || 'Centre for Piles & Fistula'}</div>
        <div>
          <h2 className="text-3xl font-semibold leading-tight">Clinic operations,<br />one console.</h2>
          <p className="mt-3 max-w-md text-teal-100">Appointments, patients, pharmacy, billing and CRM across Rohini, Paschim Vihar, Indirapuram, Tilak Nagar and Dwarka.</p>
        </div>
        <p className="text-sm text-teal-200">© {new Date().getFullYear()} Centre for Piles & Fistula</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-sm p-6">
          <h1 className="text-xl font-semibold">{MODE_TITLES[appMode()]} sign in</h1>
          <p className="mb-5 text-sm text-muted-foreground">Use your staff email or mobile number.</p>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <Field label="Email or mobile" error={form.formState.errors.login?.message}>
              <Input autoComplete="username" autoFocus {...form.register('login')} />
            </Field>
            <Field label="Password" error={form.formState.errors.password?.message}>
              <Input type="password" autoComplete="current-password" {...form.register('password')} />
            </Field>
            {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>Sign in</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
