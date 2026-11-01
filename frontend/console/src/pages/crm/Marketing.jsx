import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Send, Users, CalendarClock, XCircle, ImagePlus, X, FlaskConical, Package, HeartPulse, Tent, MessageSquareText, Eye } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Pagination } from '@/components/common/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/common/Field';
import { MediaPicker } from '@/components/landing/MediaPicker';
import { useBranches, useStages, usePublicClinic } from '@/hooks/queries';
import { useCan } from '@/store/auth';
import { get, getPaged, post, patch, del } from '@/lib/api';
import { cn, errMsg, fmtDateTime, titleCase } from '@/lib/utils';
import { SOURCES } from './LeadForm';

const CATS = { package: ['Packages', Package], lab_offer: ['Lab tests', FlaskConical], health_info: ['Health info', HeartPulse], camp: ['Camp', Tent], festival: ['Festival', MessageSquareText], reminder: ['Reminder', CalendarClock], other: ['Other', MessageSquareText] };
const STATUS = { draft: 'secondary', scheduled: 'info', sending: 'warning', done: 'success', cancelled: 'outline', failed: 'danger' };
const BLANK = { name: '', category: 'package', message: '', mediaUrl: '', mediaType: 'image', gapSeconds: 4, audience: { patients: true, leads: false, branches: [], visitedFrom: '', visitedTo: '', gender: null, ageMin: null, ageMax: null, leadStages: [], leadSources: [], condition: '', extraNumbers: [] } };

function Composer({ initial, onClose }) {
  const qc = useQueryClient();
  const can = useCan();
  const { data: branches = [] } = useBranches();
  const { data: stages = [] } = useStages();
  const { data: clinic } = usePublicClinic();
  const { data: templates = [] } = useQuery({ queryKey: ['mkt-templates'], queryFn: () => get('/marketing/templates'), staleTime: 300_000 });
  const [f, setF] = useState(() => (initial?._id ? { ...BLANK, ...initial, mediaUrl: initial.mediaUrl || '', audience: { ...BLANK.audience, ...initial.audience, branches: (initial.audience?.branches || []).map(String), leadStages: (initial.audience?.leadStages || []).map(String), extraNumbers: initial.audience?.extraNumbers || [] } } : BLANK));
  const [count, setCount] = useState(null);
  const [media, setMedia] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState('');
  const aud = f.audience;
  const setA = (k, v) => setF((x) => ({ ...x, audience: { ...x.audience, [k]: v } }));
  const toggle = (k, v) => setA(k, aud[k].includes(v) ? aud[k].filter((x) => x !== v) : [...aud[k], v]);
  const payload = () => ({
    name: f.name, category: f.category, message: f.message, mediaUrl: f.mediaUrl || '', mediaType: f.mediaUrl ? f.mediaType : null, gapSeconds: Number(f.gapSeconds) || 4,
    audience: { ...aud, visitedFrom: aud.visitedFrom || undefined, visitedTo: aud.visitedTo || undefined, ageMin: aud.ageMin === '' || aud.ageMin == null ? null : Number(aud.ageMin), ageMax: aud.ageMax === '' || aud.ageMax == null ? null : Number(aud.ageMax), condition: aud.condition || undefined },
  });
  useEffect(() => {
    const t = setTimeout(() => post('/marketing/audience', { audience: payload().audience }).then(setCount).catch(() => setCount(null)), 500);
    return () => clearTimeout(t);
  }, [JSON.stringify(aud)]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const body = payload();
    const b = f._id ? await patch(`/marketing/broadcasts/${f._id}`, body) : await post('/marketing/broadcasts', body);
    setF((x) => ({ ...x, _id: b._id }));
    qc.invalidateQueries({ queryKey: ['mkt'] });
    return b;
  };
  const act = async (kind) => {
    setBusy(kind);
    try {
      const b = await save();
      if (kind === 'save') toast.success('Draft saved');
      if (kind === 'test') { const r = await post(`/marketing/broadcasts/${b._id}/test`, { to: testTo }); toast[r.sent ? 'success' : 'warning'](r.sent ? 'Test message sent' : `Not sent: ${r.skipped}`); }
      if (kind === 'send') {
        if (!window.confirm(`Send to ${count?.count ?? '?'} recipients${when ? ` at ${new Date(when).toLocaleString('en-IN')}` : ' now'}?`)) return;
        await post(`/marketing/broadcasts/${b._id}/send`, when ? { scheduledAt: new Date(when).toISOString() } : {});
        toast.success(when ? 'Campaign scheduled' : 'Sending started');
        qc.invalidateQueries({ queryKey: ['mkt'] });
        onClose();
      }
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(''); }
  };
  const preview = f.message.replaceAll('{name}', 'Ramesh Kumar').replaceAll('{first}', 'Ramesh').replaceAll('{clinic}', clinic?.name || 'Clinic').replaceAll('{branch}', 'Rohini').replaceAll('{phone}', clinic?.phone || '98XXXXXXXX');
  const valid = f.name.trim().length >= 2 && f.message.trim().length >= 5;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Campaign name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Laser piles package — November" /></Field>
          <Field label="Type"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{Object.entries(CATS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        </div>
        {templates.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">Start from a template (live prices)</p>
            <div className="flex flex-wrap gap-1.5">{templates.map((t) => <button key={t.name} type="button" onClick={() => setF({ ...f, category: t.category, message: t.message, name: f.name || t.name })} className="rounded-full border px-3 py-1 text-xs hover:border-primary hover:text-primary">{t.name}</button>)}</div>
          </div>
        )}
        <Field label="Message" hint="Placeholders: {first} {name} {clinic} {branch} {phone}. *bold* works on WhatsApp. An opt-out line is added automatically.">
          <Textarea rows={9} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
        </Field>
        <div className="flex flex-wrap items-end gap-2">
          {f.mediaUrl ? (
            <div className="flex items-center gap-2 rounded-md border p-1.5">{f.mediaType === 'image' ? <img src={f.mediaUrl} alt="" className="h-12 w-12 rounded object-cover" /> : <Badge>PDF</Badge>}<span className="max-w-[220px] truncate text-xs">{f.mediaUrl}</span><Button size="icon" variant="ghost" onClick={() => setF({ ...f, mediaUrl: '' })}><X /></Button></div>
          ) : <Button variant="outline" size="sm" onClick={() => setMedia(true)}><ImagePlus /> Add image / PDF</Button>}
          {f.mediaUrl && <Select className="h-9 w-28" value={f.mediaType} onChange={(e) => setF({ ...f, mediaType: e.target.value })}><option value="image">Image</option><option value="pdf">PDF</option></Select>}
          <p className="text-xs text-muted-foreground">Media must be a public https link (Media library uploads are).</p>
        </div>
        {can('cms.view') && <MediaPicker open={media} onOpenChange={setMedia} onPick={(u) => setF({ ...f, mediaUrl: u, mediaType: /\.pdf($|\?)/i.test(u) ? 'pdf' : 'image' })} />}
        {!can('cms.view') && media && <Field label="Media URL"><Input placeholder="https://…" onBlur={(e) => { setF({ ...f, mediaUrl: e.target.value }); setMedia(false); }} /></Field>}

        <Card className="space-y-3 p-4">
          <p className="flex items-center gap-2 font-semibold"><Users className="h-4 w-4" /> Audience {count && <Badge variant="info">{count.count}{count.capped ? '+' : ''} recipients</Badge>}</p>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={aud.patients} onChange={(e) => setA('patients', e.target.checked)} /> Patients</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={aud.leads} onChange={(e) => setA('leads', e.target.checked)} /> Leads (not yet converted)</label>
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Branches (none = all)</p>
            <div className="flex flex-wrap gap-1.5">{branches.map((b) => <button key={b._id} type="button" onClick={() => toggle('branches', b._id)} className={cn('rounded-full border px-2.5 py-0.5 text-xs', aud.branches.includes(b._id) && 'border-primary bg-primary text-primary-foreground')}>{b.name}</button>)}</div>
          </div>
          {aud.patients && (
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="Visited from"><Input type="date" value={aud.visitedFrom || ''} onChange={(e) => setA('visitedFrom', e.target.value)} /></Field>
              <Field label="Visited to"><Input type="date" value={aud.visitedTo || ''} onChange={(e) => setA('visitedTo', e.target.value)} /></Field>
              <Field label="Gender"><Select value={aud.gender || ''} onChange={(e) => setA('gender', e.target.value || null)}><option value="">Any</option><option value="male">Male</option><option value="female">Female</option></Select></Field>
              <Field label="Age"><div className="flex gap-1"><Input type="number" placeholder="min" value={aud.ageMin ?? ''} onChange={(e) => setA('ageMin', e.target.value)} /><Input type="number" placeholder="max" value={aud.ageMax ?? ''} onChange={(e) => setA('ageMax', e.target.value)} /></div></Field>
            </div>
          )}
          {aud.leads && (
            <div className="space-y-2">
              <div><p className="mb-1 text-xs text-muted-foreground">Lead stages (none = all)</p><div className="flex flex-wrap gap-1.5">{stages.filter((s) => !s.isWon).map((s) => <button key={s._id} type="button" onClick={() => toggle('leadStages', s._id)} className={cn('rounded-full border px-2.5 py-0.5 text-xs', aud.leadStages.includes(s._id) && 'border-primary bg-primary text-primary-foreground')}>{s.name}</button>)}</div></div>
              <div><p className="mb-1 text-xs text-muted-foreground">Sources (none = all)</p><div className="flex flex-wrap gap-1.5">{SOURCES.map((s) => <button key={s} type="button" onClick={() => toggle('leadSources', s)} className={cn('rounded-full border px-2.5 py-0.5 text-xs', aud.leadSources.includes(s) && 'border-primary bg-primary text-primary-foreground')}>{titleCase(s)}</button>)}</div></div>
              <Field label="Condition contains"><Input className="w-60" value={aud.condition || ''} placeholder="e.g. fistula" onChange={(e) => setA('condition', e.target.value)} /></Field>
            </div>
          )}
          <Field label="Extra numbers (one per line)"><Textarea rows={2} value={aud.extraNumbers.join('\n')} onChange={(e) => setA('extraNumbers', e.target.value.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean))} /></Field>
          {count?.sample?.length > 0 && <p className="text-xs text-muted-foreground">e.g. {count.sample.map((x) => `${x.name || '—'} (${x.to})`).join(', ')}</p>}
          <p className="text-[11px] text-muted-foreground">One message per mobile number. People marked “no offers” and demo numbers are skipped automatically.</p>
        </Card>
      </div>

      <div className="space-y-3">
        <Card className="p-3">
          <p className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground"><Eye className="h-3.5 w-3.5" /> Preview</p>
          <div className="rounded-lg bg-[#e5ddd5] p-3">
            <div className="ml-auto max-w-[95%] rounded-lg bg-[#dcf8c6] p-2 text-[13px] shadow-sm">
              {f.mediaUrl && f.mediaType === 'image' && <img src={f.mediaUrl} alt="" className="mb-1.5 max-h-40 w-full rounded object-cover" />}
              {f.mediaUrl && f.mediaType === 'pdf' && <p className="mb-1.5 rounded bg-white/70 p-1.5 text-xs">📄 Attachment.pdf</p>}
              <p className="whitespace-pre-line">{preview || 'Your message…'}{preview && '\n\nReply STOP to stop receiving offers.'}</p>
            </div>
          </div>
        </Card>
        <Card className="space-y-2 p-3">
          <Field label="Seconds between messages" hint="Slower = safer for your WhatsApp number"><Input type="number" min="1" max="120" value={f.gapSeconds} onChange={(e) => setF({ ...f, gapSeconds: e.target.value })} /></Field>
          {count && <p className="text-xs text-muted-foreground">≈ {Math.ceil(((count.count || 0) * (Number(f.gapSeconds) || 4)) / 60)} min to finish</p>}
          <Button className="w-full" variant="outline" disabled={!valid} loading={busy === 'save'} onClick={() => act('save')}>Save draft</Button>
          <div className="flex gap-1.5"><Input placeholder="Test mobile" value={testTo} onChange={(e) => setTestTo(e.target.value.replace(/\D/g, '').slice(0, 10))} /><Button variant="outline" disabled={!valid || testTo.length !== 10} loading={busy === 'test'} onClick={() => act('test')}>Test</Button></div>
          {can('marketing.approve') && (
            <>
              <Field label="Schedule (optional)"><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
              <Button className="w-full" disabled={!valid || !count?.count} loading={busy === 'send'} onClick={() => act('send')}><Send /> {when ? 'Schedule' : 'Send now'} to {count?.count ?? 0}</Button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function Marketing() {
  const can = useCan();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: ['mkt', page], queryFn: () => getPaged('/marketing/broadcasts', { page, limit: 20 }), refetchInterval: (q) => (q.state.data?.items?.some((b) => ['sending', 'scheduled'].includes(b.status)) ? 5000 : false) });
  const cancel = async (b) => { if (!window.confirm('Stop this campaign?')) return; try { await post(`/marketing/broadcasts/${b._id}/cancel`); qc.invalidateQueries({ queryKey: ['mkt'] }); } catch (e) { toast.error(errMsg(e)); } };
  const remove = async (b) => { if (!window.confirm('Delete draft?')) return; try { await del(`/marketing/broadcasts/${b._id}`); qc.invalidateQueries({ queryKey: ['mkt'] }); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="space-y-4">
      <PageHeader title="Marketing" description="Bulk WhatsApp to patients & leads — packages, lab test prices, health tips, camps"
        actions={can('marketing.create') && <Button onClick={() => setEdit({})}><Plus /> New campaign</Button>} />
      <DataTable loading={isLoading} rows={data?.items} onRowClick={(b) => ['draft'].includes(b.status) && can('marketing.edit') && setEdit(b)} columns={[
        { key: 'n', header: 'Campaign', cell: (b) => { const [l, I] = CATS[b.category] || CATS.other; return <div><p className="font-medium">{b.name}</p><p className="flex items-center gap-1 text-xs text-muted-foreground"><I className="h-3 w-3" />{l} · {b.createdBy?.name}</p></div>; } },
        { key: 'a', header: 'Audience', cell: (b) => [b.audience?.patients && 'Patients', b.audience?.leads && 'Leads', b.audience?.extraNumbers?.length && `+${b.audience.extraNumbers.length} numbers`].filter(Boolean).join(' · ') },
        { key: 'p', header: 'Progress', cell: (b) => { const s = b.stats || {}; const done = s.sent + s.failed + s.skipped; return b.status === 'draft' ? '—' : <div className="w-40"><div className="h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-primary" style={{ width: `${s.total ? Math.round((done / s.total) * 100) : 0}%` }} /></div><p className="mt-1 text-[11px] text-muted-foreground">{s.sent} sent · {s.failed} failed · {s.skipped} skipped / {s.total}</p></div>; } },
        { key: 'w', header: 'When', cell: (b) => <span className="text-xs">{fmtDateTime(b.finishedAt || b.scheduledAt || b.createdAt)}</span> },
        { key: 's', header: 'Status', cell: (b) => <Badge variant={STATUS[b.status]}>{b.status}</Badge> },
        { key: 'x', header: '', className: 'text-right', cell: (b) => (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {['scheduled', 'sending'].includes(b.status) && can('marketing.approve') && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => cancel(b)}><XCircle /> Stop</Button>}
            {['draft', 'cancelled'].includes(b.status) && can('marketing.delete') && <Button size="sm" variant="ghost" onClick={() => remove(b)}>Delete</Button>}
          </div>
        ) },
      ]} footer={<Pagination meta={data?.meta} page={page} setPage={setPage} />} />
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent title={edit?._id ? `Edit · ${edit.name}` : 'New WhatsApp campaign'} size="xl">{edit && <Composer initial={edit} onClose={() => setEdit(null)} />}</DialogContent>
      </Dialog>
    </div>
  );
}
