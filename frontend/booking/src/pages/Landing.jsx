import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Check } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { get, post } from '@/lib/api';
import { getUtm } from '@/store/patient';
import { errMsg, cn } from '@/lib/utils';
import LandingPage, { fontHref } from '@/components/landing/LandingRenderer';

export default function Landing() {
  const { slug } = useParams();
  const { data: f, isLoading, error } = useQuery({ queryKey: ['form', slug], queryFn: () => get(`/public/forms/${slug}`) });
  const { data: info } = useQuery({ queryKey: ['clinic'], queryFn: () => get('/public/clinic'), staleTime: 600_000 });
  const [vals, setVals] = useState({});
  const [errors, setErrors] = useState({});
  const [hp, setHp] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  useEffect(() => {
    if (f?.page?.seoTitle || f?.name) document.title = f.page?.seoTitle || f.name;
    if (f?.page?.seoDescription) document.querySelector('meta[name="description"]')?.setAttribute('content', f.page.seoDescription);
    if (f?.blocks?.length) {
      let l = document.getElementById('lp-font');
      if (!l) { l = document.createElement('link'); l.id = 'lp-font'; l.rel = 'stylesheet'; document.head.appendChild(l); }
      l.href = fontHref(f.design?.font);
    }
  }, [f]);

  if (isLoading) return <div className="mx-auto max-w-3xl px-4 py-6"><Skeleton className="h-96 w-full" /></div>;
  if (error) return <div className="mx-auto max-w-3xl px-4 py-6"><Card className="p-8 text-center text-muted-foreground">This page is not available.</Card></div>;

  const set = (k, v) => setVals((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    for (const fl of f.fields) {
      const v = vals[fl.key];
      if (fl.required && (v === undefined || v === '' || (Array.isArray(v) && !v.length))) errs[fl.key] = `${fl.label} is required`;
      if (fl.mapTo === 'phone' && v && !/^[6-9]\d{9}$/.test(String(v))) errs[fl.key] = 'Enter a valid 10-digit mobile';
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const r = await post(`/public/forms/${slug}/submit`, { data: vals, utm: getUtm(), ...(hp ? { website: hp } : {}) });
      if (r.redirectUrl) location.href = r.redirectUrl;
      else setDone(r.message);
    } catch (err) {
      const details = err.response?.data?.details;
      if (Array.isArray(details)) setErrors(Object.fromEntries(details.map((d) => [d.path, d.message])));
      else setErrors({ _: errMsg(err) });
    } finally {
      setBusy(false);
    }
  };

  const field = (fl) => {
    const common = { id: fl.key, value: vals[fl.key] ?? '', onChange: (e) => set(fl.key, e.target.value), placeholder: fl.placeholder };
    if (fl.mapTo === 'branch') return <Select {...common} placeholder="Select branch">{f.branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</Select>;
    switch (fl.type) {
      case 'textarea': return <Textarea rows={3} {...common} />;
      case 'select': return <Select {...common} placeholder="Select">{fl.options.map((o) => <option key={o}>{o}</option>)}</Select>;
      case 'radio': return <div className="flex flex-wrap gap-3">{fl.options.map((o) => <label key={o} className="flex items-center gap-1.5 text-sm"><input type="radio" name={fl.key} checked={vals[fl.key] === o} onChange={() => set(fl.key, o)} />{o}</label>)}</div>;
      case 'checkbox': return <div className="flex flex-wrap gap-3">{fl.options.map((o) => <label key={o} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={(vals[fl.key] || []).includes(o)} onChange={(e) => set(fl.key, e.target.checked ? [...(vals[fl.key] || []), o] : (vals[fl.key] || []).filter((x) => x !== o))} />{o}</label>)}</div>;
      case 'tel': return <Input inputMode="numeric" maxLength={10} {...common} onChange={(e) => set(fl.key, e.target.value.replace(/\D/g, ''))} />;
      default: return <Input type={fl.type} {...common} />;
    }
  };

  const inputCls = 'h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[color:var(--lp-accent)]';
  const inlineField = (fl) => {
    const ph = `${fl.label}${fl.required ? '*' : ''}`;
    const v = vals[fl.key] ?? '';
    if (fl.mapTo === 'branch') return <select className={inputCls} value={v} onChange={(e) => set(fl.key, e.target.value)}><option value="">{ph}</option>{f.branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</select>;
    if (['select', 'radio'].includes(fl.type)) return <select className={inputCls} value={v} onChange={(e) => set(fl.key, e.target.value)}><option value="">{ph}</option>{fl.options.map((o) => <option key={o}>{o}</option>)}</select>;
    if (fl.type === 'textarea') return <textarea rows={3} className={cn(inputCls, 'h-auto py-2')} placeholder={ph} value={v} onChange={(e) => set(fl.key, e.target.value)} />;
    if (fl.type === 'checkbox') return <div className="flex flex-wrap gap-3 text-sm">{fl.options.map((o) => <label key={o} className="flex items-center gap-1.5"><input type="checkbox" checked={(vals[fl.key] || []).includes(o)} onChange={(e) => set(fl.key, e.target.checked ? [...(vals[fl.key] || []), o] : (vals[fl.key] || []).filter((x) => x !== o))} />{o}</label>)}</div>;
    if (fl.type === 'tel') return <input className={inputCls} inputMode="numeric" maxLength={10} placeholder={ph} value={v} onChange={(e) => set(fl.key, e.target.value.replace(/\D/g, ''))} />;
    return <input className={inputCls} type={fl.type} placeholder={ph} value={v} onChange={(e) => set(fl.key, e.target.value)} />;
  };
  const blockForm = ({ layout, buttonText, dark }) => (done ? (
    <div className="flex items-center gap-3 rounded-lg bg-white/95 p-4 text-slate-900"><CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-600" /><p className="font-semibold">{done}</p></div>
  ) : (
    <form onSubmit={submit} noValidate>
      <div className={cn('grid gap-3', layout === 'inline' && 'sm:grid-cols-2 lg:grid-cols-4')}>
        {f.fields.map((fl) => (
          <div key={fl.key} className={cn(layout === 'inline' && ['textarea', 'checkbox'].includes(fl.type) && 'sm:col-span-2 lg:col-span-4')}>
            {inlineField(fl)}
            {errors[fl.key] && <p className={cn('mt-1 text-xs', dark ? 'text-yellow-200' : 'text-red-600')}>{errors[fl.key]}</p>}
          </div>
        ))}
        <input type="text" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} className="hidden" aria-hidden="true" />
        <button type="submit" disabled={busy} className={cn('h-11 rounded-md px-5 text-sm font-bold shadow disabled:opacity-60', dark ? 'bg-[color:var(--lp-accent)] text-slate-900' : 'bg-[color:var(--lp-primary)] text-white')}>{busy ? 'Sending…' : buttonText || 'Submit'}</button>
      </div>
      {errors._ && <p className={cn('mt-2 text-sm', dark ? 'text-yellow-200' : 'text-red-600')}>{errors._}</p>}
    </form>
  ));

  if (f.blocks?.length) return <LandingPage blocks={f.blocks} design={f.design} renderForm={blockForm} clinic={info?.clinic} />;

  const form = done ? (
    <Card className="p-8 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" /><p className="mt-3 text-lg font-semibold">{done}</p></Card>
  ) : (
    <Card className="p-5 shadow-lg">
      {f.kind === 'landing_page' && <p className="mb-3 text-lg font-semibold">{f.page?.ctaText || 'Get a call back'}</p>}
      <form onSubmit={submit} className="space-y-3" noValidate>
        {f.fields.map((fl) => (
          <div key={fl.key} className="space-y-1.5">
            <Label htmlFor={fl.key}>{fl.label}{fl.required && <span className="text-destructive"> *</span>}</Label>
            {field(fl)}
            {errors[fl.key] && <p className="text-xs text-destructive">{errors[fl.key]}</p>}
          </div>
        ))}
        <input type="text" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} className="hidden" aria-hidden="true" />
        {errors._ && <p className="text-sm text-destructive">{errors._}</p>}
        <Button type="submit" className="w-full" size="lg" loading={busy}>{f.page?.ctaText || 'Submit'}</Button>
      </form>
    </Card>
  );

  if (f.kind !== 'landing_page') return <div className="mx-auto max-w-md px-4 py-6">{form}</div>;
  const p = f.page || {};
  return (
    <div className="mx-auto grid max-w-3xl items-start gap-6 px-4 py-6 md:grid-cols-2">
      <div className="space-y-4">
        {p.heroImage && <img src={p.heroImage} alt="" className="w-full rounded-xl object-cover" />}
        <h1 className="text-3xl font-bold leading-tight tracking-tight">{p.headline || f.name}</h1>
        {p.subheadline && <p className="text-muted-foreground">{p.subheadline}</p>}
        {p.bullets?.length > 0 && <ul className="space-y-2">{p.bullets.map((b) => <li key={b} className="flex items-start gap-2"><Check className="mt-0.5 h-5 w-5 shrink-0 text-primary" />{b}</li>)}</ul>}
        {p.body && <p className="whitespace-pre-line text-sm text-foreground/80">{p.body}</p>}
      </div>
      {form}
    </div>
  );
}
