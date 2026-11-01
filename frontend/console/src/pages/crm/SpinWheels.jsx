import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, LineChart, Line } from 'recharts';
import { Plus, Trash2, Pencil, BarChart3, Gift, Ticket, Download, Search, Trophy, MousePointerClick, Users, Percent, CheckCircle2, ExternalLink, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Pagination } from '@/components/common/DataTable';
import { StatCard } from '@/components/common/StatCard';
import { EmptyState } from '@/components/common/EmptyState';
import { Field } from '@/components/common/Field';
import { Can } from '@/components/common/Can';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { WheelSvg } from '@/components/landing/Widgets';
import { useGet, usePaged, useAction } from '@/hooks/queries';
import { get, post, patch, del, openFile } from '@/lib/api';
import { useCan } from '@/store/auth';
import { fmtDateTime, fmtDate, todayIST, addDays, errMsg, titleCase } from '@/lib/utils';

const PALETTE = ['#e21f26', '#0f172a', '#d4a017', '#14b8a6', '#7c3aed', '#64748b', '#0ea5e9', '#f97316', '#16a34a', '#db2777', '#475569', '#ca8a04'];
const STATUS = { won: ['Won — not redeemed', 'default'], redeemed: ['Redeemed', 'success'], lost: ['No prize', 'secondary'], cancelled: ['Cancelled', 'danger'] };
const blankSeg = (i) => ({ label: '', kind: 'prize', weight: 10, stock: null, color: PALETTE[i % PALETTE.length], textColor: '#ffffff', description: '' });
const NEW = {
  name: '', title: 'Spin & Win!', subtitle: 'Try your luck — every spin wins a health benefit.', buttonText: 'Spin now', validDays: 30, codePrefix: 'CPF', isActive: true, sendWhatsapp: true, createLead: true,
  terms: 'One spin per mobile number. Show the code at the clinic reception. Not redeemable for cash.',
  winMessage: 'Congratulations {name}! 🎉\n\nYou won *{prize}* at {clinic}.\nYour code: *{code}*\nValid till {expiry}.\n\nShow this code at reception. Call {phone} to book.',
  segments: [
    { ...blankSeg(0), label: 'Free consultation', weight: 30 }, { ...blankSeg(1), label: '10% off procedure', weight: 15 }, { ...blankSeg(2), label: 'Free CBC test', weight: 15 },
    { ...blankSeg(5), label: 'Better luck next time', kind: 'none', weight: 25 }, { ...blankSeg(3), label: '₹500 off', weight: 10 }, { ...blankSeg(4), label: 'Free pickup & drop', weight: 5 },
  ],
};
const ymdLocal = (d) => (d ? new Date(new Date(d).getTime() + 330 * 60000).toISOString().slice(0, 16) : '');

/* ------------------------------------------------------------------ editor */
function WheelEditor({ open, onOpenChange, wheel }) {
  const [w, setW] = useState(NEW);
  useEffect(() => { if (open) setW(wheel?._id ? { ...NEW, ...wheel } : { ...NEW, segments: NEW.segments.map((s) => ({ ...s })) }); }, [open, wheel]);
  const set = (k, v) => setW((x) => ({ ...x, [k]: v }));
  const setSeg = (i, k, v) => setW((x) => ({ ...x, segments: x.segments.map((s, j) => (j === i ? { ...s, [k]: v } : s)) }));
  const total = w.segments.reduce((a, s) => a + (Number(s.weight) || 0), 0);
  const save = useAction(() => {
    const body = {
      name: w.name, title: w.title, subtitle: w.subtitle, buttonText: w.buttonText, validDays: Number(w.validDays) || 30, codePrefix: w.codePrefix || '', terms: w.terms,
      sendWhatsapp: !!w.sendWhatsapp, winMessage: w.winMessage, createLead: !!w.createLead, isActive: !!w.isActive,
      startsAt: w.startsAt || null, endsAt: w.endsAt || null,
      segments: w.segments.map((s) => ({ ...(s._id ? { _id: s._id } : {}), label: s.label.trim(), kind: s.kind, description: s.description || undefined, weight: Number(s.weight) || 0, stock: s.stock === '' || s.stock === null || s.stock === undefined ? null : Number(s.stock), color: s.color, textColor: s.textColor })),
    };
    return wheel?._id ? patch(`/crm/wheels/${wheel._id}`, body) : post('/crm/wheels', body);
  }, { success: 'Wheel saved', invalidate: ['wheels'], onSuccess: () => onOpenChange(false) });
  const valid = w.name.trim().length >= 2 && w.segments.length >= 2 && w.segments.every((s) => s.label.trim()) && total > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="max-w-6xl" title={wheel?._id ? `Edit wheel — ${wheel.name}` : 'New spin wheel'} description="Prizes, chances and stock. The server decides each result — visitors can't cheat.">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="min-w-0 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Internal name" required><Input value={w.name} onChange={(e) => set('name', e.target.value)} placeholder="Diwali Spin & Win" /></Field>
              <Field label="Heading on the wheel"><Input value={w.title} maxLength={80} onChange={(e) => set('title', e.target.value)} /></Field>
              <Field label="Sub-heading" className="sm:col-span-2"><Input value={w.subtitle} maxLength={200} onChange={(e) => set('subtitle', e.target.value)} /></Field>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-sm font-semibold">Prizes ({w.segments.length}/12)</p>
                <Button size="sm" variant="outline" disabled={w.segments.length >= 12} onClick={() => set('segments', [...w.segments, blankSeg(w.segments.length)])}><Plus /> Add</Button>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="p-2 text-left">Prize label</th><th className="p-2 text-left">Type</th><th className="p-2 text-left">Weight</th><th className="p-2 text-left">Chance</th><th className="p-2 text-left">Stock</th><th className="p-2 text-left">Won</th><th className="p-2 text-left">Colours</th><th /></tr></thead>
                  <tbody>
                    {w.segments.map((s, i) => (
                      <tr key={s._id || i} className="border-t align-top">
                        <td className="p-1.5"><Input className="h-8" maxLength={40} value={s.label} onChange={(e) => setSeg(i, 'label', e.target.value)} />
                          {s.kind === 'prize' && <Input className="mt-1 h-7 text-xs" maxLength={200} placeholder="Note shown to winner (optional)" value={s.description || ''} onChange={(e) => setSeg(i, 'description', e.target.value)} />}</td>
                        <td className="p-1.5"><Select className="h-8 w-28" value={s.kind} onChange={(e) => setSeg(i, 'kind', e.target.value)}><option value="prize">Prize</option><option value="none">No prize</option></Select></td>
                        <td className="p-1.5"><Input className="h-8 w-20" type="number" min={0} value={s.weight} onChange={(e) => setSeg(i, 'weight', e.target.value)} /></td>
                        <td className="p-1.5 pt-3 text-xs font-medium">{total ? `${((Number(s.weight) || 0) / total * 100).toFixed(1)}%` : '—'}</td>
                        <td className="p-1.5"><Input className="h-8 w-24" type="number" min={0} placeholder="Unlimited" value={s.stock ?? ''} onChange={(e) => setSeg(i, 'stock', e.target.value === '' ? null : e.target.value)} disabled={s.kind === 'none'} />
                          {s.stock !== null && s.stock !== undefined && s.remaining !== undefined && s._id && <p className="mt-0.5 text-[10px] text-muted-foreground">{s.remaining ?? '—'} left</p>}</td>
                        <td className="p-1.5 pt-3 text-xs">{s.won || 0}</td>
                        <td className="p-1.5"><div className="flex gap-1"><input type="color" title="Slice colour" value={s.color} onChange={(e) => setSeg(i, 'color', e.target.value)} className="h-8 w-8 cursor-pointer rounded border" /><input type="color" title="Text colour" value={s.textColor} onChange={(e) => setSeg(i, 'textColor', e.target.value)} className="h-8 w-8 cursor-pointer rounded border" /></div></td>
                        <td className="p-1.5"><Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" disabled={w.segments.length <= 2} onClick={() => set('segments', w.segments.filter((_, j) => j !== i))}><Trash2 /></Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">Higher weight = more likely. When a prize's stock runs out it is never picked again. Keep one "No prize" slice if you want some visitors to lose.</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Code valid for (days)"><Input type="number" min={1} max={365} value={w.validDays} onChange={(e) => set('validDays', e.target.value)} /></Field>
              <Field label="Code prefix"><Input maxLength={8} value={w.codePrefix} onChange={(e) => set('codePrefix', e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} /></Field>
              <Field label="Button text"><Input maxLength={30} value={w.buttonText} onChange={(e) => set('buttonText', e.target.value)} /></Field>
              <Field label="Starts (optional)"><Input type="datetime-local" value={ymdLocal(w.startsAt)} onChange={(e) => set('startsAt', e.target.value ? new Date(`${e.target.value}:00+05:30`).toISOString() : null)} /></Field>
              <Field label="Ends (optional)"><Input type="datetime-local" value={ymdLocal(w.endsAt)} onChange={(e) => set('endsAt', e.target.value ? new Date(`${e.target.value}:00+05:30`).toISOString() : null)} /></Field>
            </div>
            <Field label="Terms shown under the wheel"><Textarea rows={2} maxLength={600} value={w.terms} onChange={(e) => set('terms', e.target.value)} /></Field>
            <div className="space-y-2 rounded-lg border p-3">
              <label className="flex items-center gap-2 text-sm"><Switch checked={!!w.isActive} onCheckedChange={(v) => set('isActive', v)} /> Active</label>
              <label className="flex items-center gap-2 text-sm"><Switch checked={!!w.createLead} onCheckedChange={(v) => set('createLead', v)} /> Create a CRM lead for every spin</label>
              <label className="flex items-center gap-2 text-sm"><Switch checked={!!w.sendWhatsapp} onCheckedChange={(v) => set('sendWhatsapp', v)} /> Send the prize code on WhatsApp</label>
              {w.sendWhatsapp && <Field label="WhatsApp message" hint="{name} {prize} {code} {expiry} {clinic} {phone}"><Textarea rows={5} maxLength={1000} value={w.winMessage} onChange={(e) => set('winMessage', e.target.value)} /></Field>}
            </div>
          </div>
          <div className="space-y-3 lg:sticky lg:top-0 lg:self-start">
            <p className="text-sm font-semibold">Preview</p>
            <Card className="p-4 text-center" style={{ '--lp-primary': '#e21f26' }}>
              <p className="text-lg font-extrabold text-primary">{w.title}</p>
              <p className="mb-3 text-xs text-muted-foreground">{w.subtitle}</p>
              <WheelSvg segments={w.segments.map((s) => ({ ...s, label: s.label || '…' }))} rotation={0} />
            </Card>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Save wheel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ redeem by code */
function RedeemDialog({ open, onOpenChange }) {
  const [code, setCode] = useState('');
  const [e, setE] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setCode(''); setE(null); } }, [open]);
  const find = async (ev) => {
    ev?.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    try { setE(await get(`/crm/wheels/code/${encodeURIComponent(code.trim())}`)); } catch (x) { setE(null); toast.error(errMsg(x)); } finally { setBusy(false); }
  };
  const redeem = useAction(() => post(`/crm/wheels/entries/${e._id}/redeem`, {}), { success: 'Prize redeemed', invalidate: ['wheel-entries', 'wheels', 'wheel-report'], onSuccess: (x) => setE({ ...e, ...x, redeemedBy: null }) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" title="Redeem a prize code" description="Patient shows the code at reception — check and mark it used.">
        <form onSubmit={find} className="flex gap-2"><Input autoFocus value={code} onChange={(x) => setCode(x.target.value.toUpperCase())} placeholder="CPF-XXXXXX" className="font-mono" /><Button type="submit" loading={busy}><Search /> Check</Button></form>
        {e && (
          <Card className="mt-3 space-y-1.5 p-4 text-sm">
            <p className="text-lg font-bold text-primary">{e.prize}</p>
            <p><span className="text-muted-foreground">Name:</span> {e.name} · {e.phone}</p>
            <p><span className="text-muted-foreground">Wheel:</span> {e.wheel?.name}</p>
            <p><span className="text-muted-foreground">Won:</span> {fmtDateTime(e.createdAt)} · <span className="text-muted-foreground">Valid till</span> {fmtDate(e.expiresAt)}</p>
            <div className="pt-1"><Badge variant={e.expired ? 'danger' : STATUS[e.status]?.[1]}>{e.expired ? 'Expired' : STATUS[e.status]?.[0]}</Badge>{e.redeemedAt && <span className="ml-2 text-xs text-muted-foreground">on {fmtDateTime(e.redeemedAt)}{e.redeemedBy?.name ? ` by ${e.redeemedBy.name}` : ''}</span>}</div>
            {e.status === 'won' && !e.expired && <Can perm="cms.edit"><Button className="mt-2 w-full" loading={redeem.isPending} onClick={() => redeem.mutate()}><CheckCircle2 /> Mark as redeemed</Button></Can>}
          </Card>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ spins list */
function Entries({ wheels, initialWheel }) {
  const [f, setF] = useState({ wheel: initialWheel || '', status: '', source: '', from: addDays(todayIST(), -29), to: todayIST(), q: '' });
  const [page, setPage] = useState(1);
  useEffect(() => { setF((x) => ({ ...x, wheel: initialWheel || x.wheel })); }, [initialWheel]);
  const params = useMemo(() => Object.fromEntries(Object.entries({ ...f, page, limit: 25 }).filter(([, v]) => v !== '')), [f, page]);
  const { data, isLoading } = usePaged('wheel-entries', '/crm/wheels/entries', params);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPage(1); };
  const act = useAction(({ id, kind }) => post(`/crm/wheels/entries/${id}/${kind}`, {}), { success: (x) => (x.status === 'redeemed' ? 'Redeemed' : 'Cancelled'), invalidate: ['wheel-entries', 'wheel-report', 'wheels'] });
  const csv = () => openFile('/crm/wheels/entries.csv', { download: true, filename: `spins-${f.from}-${f.to}.csv`, params: Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')) }).catch((e) => toast.error(errMsg(e)));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative w-56"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-8" placeholder="Name, mobile, code, city" value={f.q} onChange={(e) => set('q', e.target.value)} /></div>
        <Select className="w-48" value={f.wheel} onChange={(e) => set('wheel', e.target.value)}><option value="">All wheels</option>{wheels.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}</Select>
        <Select className="w-44" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">All results</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Input className="w-32" placeholder="Source" value={f.source} onChange={(e) => set('source', e.target.value)} />
        <Input type="date" className="w-36" value={f.from} onChange={(e) => set('from', e.target.value)} />
        <Input type="date" className="w-36" value={f.to} onChange={(e) => set('to', e.target.value)} />
        <Button variant="outline" onClick={csv}><Download /> Export CSV</Button>
      </div>
      <DataTable loading={isLoading} rows={data?.items} empty="No spins yet" footer={<Pagination meta={data?.meta} page={page} setPage={setPage} />} columns={[
        { key: 'at', header: 'When', cell: (r) => <span className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</span> },
        { key: 'who', header: 'Visitor', cell: (r) => <div><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.phone}{r.lead && <> · <Link className="text-primary hover:underline" to={`/leads/${r.lead}`}>lead</Link></>}</p></div> },
        { key: 'prize', header: 'Result', cell: (r) => <div><p className={r.isWin ? 'font-semibold text-primary' : 'text-muted-foreground'}>{r.prize}</p>{r.code && <p className="font-mono text-xs">{r.code}</p>}</div> },
        { key: 'status', header: 'Status', cell: (r) => <div className="space-y-0.5"><Badge variant={STATUS[r.status]?.[1]}>{STATUS[r.status]?.[0]}</Badge>{r.redeemedAt && <p className="text-[10px] text-muted-foreground">{fmtDate(r.redeemedAt)}{r.redeemedBy?.name ? ` · ${r.redeemedBy.name}` : ''}</p>}{r.whatsapp?.status && <p className="text-[10px] text-muted-foreground">WhatsApp: {r.whatsapp.status}</p>}</div> },
        { key: 'from', header: 'Came from', cell: (r) => <div className="max-w-[220px] text-xs"><p className="font-medium">{r.utm?.source ? titleCase(r.utm.source) : 'Direct'}{r.utm?.medium ? ` / ${r.utm.medium}` : ''}</p>{r.utm?.campaign && <p className="text-muted-foreground">{r.utm.campaign}</p>}<p className="truncate text-muted-foreground" title={r.pageUrl}>{r.form?.name || r.pageUrl || '—'}</p>{r.referrer && <p className="truncate text-muted-foreground" title={r.referrer}>ref: {r.referrer.replace(/^https?:\/\//, '')}</p>}</div> },
        { key: 'device', header: 'Device / location', cell: (r) => <div className="text-xs"><p>{titleCase(r.device?.type || '—')} · {r.device?.os} · {r.device?.browser}</p><p className="text-muted-foreground">{[r.city, r.region].filter(Boolean).join(', ') || '—'}{r.ip ? ` · ${r.ip}` : ''}</p></div> },
        { key: 'act', header: '', cell: (r) => r.status === 'won' && <Can perm="cms.edit"><div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => act.mutate({ id: r._id, kind: 'redeem' })}>Redeem</Button><Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" title="Cancel prize" onClick={() => window.confirm('Cancel this prize?') && act.mutate({ id: r._id, kind: 'cancel' })}><Ban /></Button></div></Can> },
      ]} />
    </div>
  );
}

/* ------------------------------------------------------------------ analytics */
const HBar = ({ data, dataKey = 'n', name = 'Spins', height = 220, extra }) => (
  <ResponsiveContainer width="100%" height={height}>
    <BarChart data={data} layout="vertical" margin={{ left: 10, right: 16 }}>
      <CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} fontSize={11} /><YAxis type="category" dataKey="label" width={130} fontSize={11} /><Tooltip />
      <Bar dataKey={dataKey} name={name} fill="#e21f26" maxBarSize={22} radius={[0, 4, 4, 0]} />{extra}
    </BarChart>
  </ResponsiveContainer>
);
function Analytics({ wheels, wheelId, setWheelId }) {
  const [from, setFrom] = useState(addDays(todayIST(), -29));
  const [to, setTo] = useState(todayIST());
  const id = wheelId || wheels[0]?._id;
  const { data: d, isLoading } = useGet('wheel-report', `/crm/wheels/${id}/report`, { from, to }, { enabled: !!id });
  if (!wheels.length) return <EmptyState icon={Gift} title="No wheels yet" />;
  const t = d?.totals || {};
  const lbl = (arr = [], fn = (x) => x._id) => arr.map((x) => ({ ...x, label: fn(x) || '—' }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Select className="w-56" value={id} onChange={(e) => setWheelId(e.target.value)}>{wheels.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}</Select>
        <Input type="date" className="w-36" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="w-36" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Spins" value={t.spins ?? 0} icon={MousePointerClick} loading={isLoading} />
        <StatCard label="Winners" value={t.wins ?? 0} icon={Trophy} loading={isLoading} />
        <StatCard label="Win rate" value={t.spins ? `${Math.round((t.wins / t.spins) * 100)}%` : '—'} icon={Percent} loading={isLoading} />
        <StatCard label="Redeemed" value={t.redeemed ?? 0} hint={t.wins ? `${Math.round((t.redeemed / t.wins) * 100)}% of wins` : undefined} icon={Ticket} loading={isLoading} />
        <StatCard label="Leads created" value={t.leads ?? 0} icon={Users} loading={isLoading} />
      </div>
      <Card className="p-4">
        <p className="mb-2 text-sm font-semibold">Spins per day</p>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={d?.byDay || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="_id" fontSize={11} tickFormatter={(v) => v.slice(5)} /><YAxis allowDecimals={false} fontSize={11} /><Tooltip /><Legend />
            <Line type="monotone" dataKey="spins" name="Spins" stroke="#0f172a" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="wins" name="Wins" stroke="#e21f26" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4"><p className="mb-2 text-sm font-semibold">By prize</p><HBar data={lbl(d?.byPrize)} extra={<Bar dataKey="redeemed" name="Redeemed" fill="#16a34a" maxBarSize={22} radius={[0, 4, 4, 0]} />} /></Card>
        <Card className="p-4"><p className="mb-2 text-sm font-semibold">By source (UTM)</p><HBar data={lbl(d?.bySource, (x) => titleCase(x._id))} /></Card>
        <Card className="p-4"><p className="mb-2 text-sm font-semibold">By landing page</p><HBar data={lbl(d?.byPage, (x) => x.name)} /></Card>
        <Card className="p-4"><p className="mb-2 text-sm font-semibold">By device</p><HBar data={lbl(d?.byDevice, (x) => titleCase(x._id))} /></Card>
        <Card className="p-4"><p className="mb-2 text-sm font-semibold">By city</p><HBar data={lbl(d?.byCity)} />
          <p className="mt-1 text-[11px] text-muted-foreground">City comes from Cloudflare geo headers. Without Cloudflare in front of the API, it shows "Unknown" (IP is still saved).</p></Card>
        <Card className="p-4"><p className="mb-2 text-sm font-semibold">Prize stock</p>
          <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="py-1 text-left">Prize</th><th className="text-right">Won</th><th className="text-right">Stock</th><th className="text-right">Left</th></tr></thead>
            <tbody>{(d?.stock || []).map((s) => <tr key={s.label} className="border-t"><td className="py-1.5">{s.label}{s.kind === 'none' && <span className="text-xs text-muted-foreground"> (no prize)</span>}</td><td className="text-right">{s.won}</td><td className="text-right">{s.stock ?? '∞'}</td><td className={`text-right ${s.remaining === 0 ? 'font-semibold text-destructive' : ''}`}>{s.remaining ?? '∞'}</td></tr>)}</tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ page */
export default function SpinWheels() {
  const can = useCan();
  const { data: wheels = [], isLoading } = useGet('wheels', '/crm/wheels');
  const [tab, setTab] = useState('wheels');
  const [edit, setEdit] = useState(null);
  const [redeem, setRedeem] = useState(false);
  const [focus, setFocus] = useState('');
  const toggle = useAction(({ id, isActive }) => patch(`/crm/wheels/${id}`, { isActive }), { success: 'Updated', invalidate: ['wheels'] });
  const remove = useAction((id) => del(`/crm/wheels/${id}`), { success: (x) => x.message || 'Deleted', invalidate: ['wheels'] });
  return (
    <div className="space-y-4">
      <PageHeader title="Spin Wheels" description="Spin & Win offers for landing pages — prizes, stock, and every spin tracked with its source"
        actions={<div className="flex gap-2"><Button variant="outline" onClick={() => setRedeem(true)}><Ticket /> Redeem code</Button><Can perm="cms.create"><Button onClick={() => setEdit({})}><Plus /> New wheel</Button></Can></div>} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="wheels">Wheels</TabsTrigger><TabsTrigger value="spins">All spins</TabsTrigger><TabsTrigger value="report">Analytics</TabsTrigger></TabsList>
        <TabsContent value="wheels">
          {!isLoading && !wheels.length ? (
            <EmptyState icon={Gift} title="No spin wheels yet" description="Create a wheel, then switch it on in any landing page: CMS & Forms → Design → Widgets." action={can('cms.create') && <Button onClick={() => setEdit({})}><Plus /> New wheel</Button>} />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {wheels.map((w) => (
                <Card key={w._id} className="flex flex-col p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-20 shrink-0"><WheelSvg segments={w.segments} rotation={0} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><p className="truncate font-semibold">{w.name}</p><Badge variant={w.live ? 'success' : 'secondary'}>{w.live ? 'Live' : 'Off'}</Badge></div>
                      <p className="text-xs text-muted-foreground">{w.segments.length} slices · codes valid {w.validDays} days{w.endsAt ? ` · ends ${fmtDate(w.endsAt)}` : ''}</p>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                        {[['Spins', w.stats.spins], ['Wins', w.stats.wins], ['Redeemed', w.stats.redeemed]].map(([l, v]) => <div key={l} className="rounded-md bg-muted/60 py-1"><p className="text-base font-bold">{v}</p><p className="text-[10px] text-muted-foreground">{l}</p></div>)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1 border-t pt-3">
                    <Can perm="cms.edit"><label className="mr-auto flex items-center gap-2 text-xs"><Switch checked={w.isActive} onCheckedChange={(v) => toggle.mutate({ id: w._id, isActive: v })} /> Active</label></Can>
                    <Button size="sm" variant="ghost" onClick={() => { setFocus(w._id); setTab('spins'); }}><ExternalLink /> Spins</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setFocus(w._id); setTab('report'); }}><BarChart3 /> Report</Button>
                    <Can perm="cms.edit"><Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEdit(w)}><Pencil /></Button></Can>
                    <Can perm="cms.delete"><Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => window.confirm(`Delete "${w.name}"? Wheels with spins are switched off instead.`) && remove.mutate(w._id)}><Trash2 /></Button></Can>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="spins"><Entries wheels={wheels} initialWheel={focus} /></TabsContent>
        <TabsContent value="report"><Analytics wheels={wheels} wheelId={focus} setWheelId={setFocus} /></TabsContent>
      </Tabs>
      <WheelEditor open={!!edit} onOpenChange={(v) => !v && setEdit(null)} wheel={edit} />
      <RedeemDialog open={redeem} onOpenChange={setRedeem} />
    </div>
  );
}
