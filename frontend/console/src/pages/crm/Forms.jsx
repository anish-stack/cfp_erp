import { useEffect, useState } from 'react';
import { Plus, Trash2, Copy, ExternalLink, Pencil, ArrowUp, ArrowDown, Paintbrush, Sparkles, Send, Gift } from 'lucide-react';
import { AiCreateDialog } from '@/components/landing/AiCreateDialog';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/common/Field';
import { Can } from '@/components/common/Can';
import { useGet, useAction } from '@/hooks/queries';
import { post, patch, API_URL } from '@/lib/api';
import { useCan, useFeature } from '@/store/auth';
import { SOURCES, CONDITIONS } from './LeadForm';
import { titleCase } from '@/lib/utils';

const BOOKING_URL = import.meta.env.VITE_BOOKING_URL || 'https://appointment.centreforpilesandfistula.com';

const DEFAULT_FIELDS = [
  { key: 'name', label: 'Full name', type: 'text', required: true, mapTo: 'name' },
  { key: 'phone', label: 'Mobile number', type: 'tel', required: true, mapTo: 'phone' },
  { key: 'city', label: 'City / area', type: 'text', required: false, mapTo: 'city' },
  { key: 'problem', label: 'Problem', type: 'select', required: false, mapTo: 'condition', options: CONDITIONS },
];
const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function Builder({ form, onDone }) {
  const [f, setF] = useState(() => form ? { ...form, campaign: form.campaign?._id || '', branch: form.branch?._id || '', page: form.page || {}, redirectUrl: form.redirectUrl || '' } : { name: '', slug: '', kind: 'landing_page', fields: DEFAULT_FIELDS, defaultSource: 'landing_page', campaign: '', branch: '', page: { headline: 'Painless laser treatment for Piles & Fistula', subheadline: 'Same-day discharge · Expert proctologists · 5 branches in Delhi NCR', ctaText: 'Book Free Consultation', bullets: ['USFDA-approved laser', 'Insurance & cashless', 'No cuts, no stitches'] }, successMessage: 'Thank you! Our team will call you shortly.', redirectUrl: '', isActive: true });
  const { data: campaigns = [] } = useGet(['campaigns-all'], '/crm/campaigns', { all: 'true' });
  const { data: branches = [] } = useGet(['branch-names'], '/branches/names');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setPage = (k, v) => setF((x) => ({ ...x, page: { ...x.page, [k]: v } }));
  const setField = (i, k, v) => setF((x) => ({ ...x, fields: x.fields.map((fl, j) => (j === i ? { ...fl, [k]: v } : fl)) }));
  const move = (i, d) => setF((x) => { const a = [...x.fields]; const [it] = a.splice(i, 1); a.splice(i + d, 0, it); return { ...x, fields: a }; });
  useEffect(() => { if (!form && f.name) set('slug', slugify(f.name)); }, [f.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useAction(() => {
    const body = { ...f, campaign: f.campaign || null, branch: f.branch || null, redirectUrl: f.redirectUrl || '', fields: f.fields.map(({ key, label, type, required, options, placeholder, mapTo }) => ({ key, label, type, required: !!required, options: ['select', 'radio', 'checkbox'].includes(type) ? options || [] : undefined, placeholder: placeholder || undefined, mapTo: mapTo || null })) };
    delete body._id; delete body.submissions; delete body.createdAt; delete body.updatedAt; delete body.__v;
    return form ? patch(`/crm/forms/${form._id}`, body) : post('/crm/forms', body);
  }, { success: 'Saved', invalidate: ['/crm/forms'], onSuccess: (d) => onDone(!form && d?.kind === 'landing_page' ? d._id : null) });

  return (
    <Tabs defaultValue="setup">
      <TabsList><TabsTrigger value="setup">Setup</TabsTrigger><TabsTrigger value="fields">Fields ({f.fields.length})</TabsTrigger>{f.kind === 'landing_page' && <TabsTrigger value="page">Basic content</TabsTrigger>}</TabsList>
      <TabsContent value="setup" className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Slug (URL)" required hint={`${BOOKING_URL}/f/${f.slug || '…'}`}><Input value={f.slug} onChange={(e) => set('slug', slugify(e.target.value))} /></Field>
        <Field label="Kind"><Select value={f.kind} onChange={(e) => set('kind', e.target.value)}><option value="landing_page">Landing page + form</option><option value="form">Embeddable form only</option></Select></Field>
        <Field label="Default source"><Select value={f.defaultSource} onChange={(e) => set('defaultSource', e.target.value)}>{SOURCES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></Field>
        <Field label="Campaign"><Select value={f.campaign} onChange={(e) => set('campaign', e.target.value)} placeholder="Auto from utm_campaign">{campaigns.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</Select></Field>
        <Field label="Branch"><Select value={f.branch} onChange={(e) => set('branch', e.target.value)} placeholder="Any / from form">{branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</Select></Field>
        <Field label="Success message" className="sm:col-span-2"><Input value={f.successMessage} onChange={(e) => set('successMessage', e.target.value)} /></Field>
        <Field label="Redirect URL after submit (optional)" className="sm:col-span-2"><Input value={f.redirectUrl} onChange={(e) => set('redirectUrl', e.target.value)} placeholder="https://centreforpilesandfistula.com/thank-you" /></Field>
        <label className="flex items-center gap-2 text-sm"><Switch checked={f.isActive} onCheckedChange={(v) => set('isActive', v)} /> Active</label>
      </TabsContent>
      <TabsContent value="fields" className="space-y-2">
        <p className="text-xs text-muted-foreground">Map one field to <b>phone</b> (required). Mapped fields fill the lead; all answers are stored on the lead.</p>
        {f.fields.map((fl, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-md border p-2 sm:grid-cols-12">
            <Input className="sm:col-span-3" placeholder="Label" value={fl.label} onChange={(e) => setField(i, 'label', e.target.value)} />
            <Input className="sm:col-span-2" placeholder="key" value={fl.key} onChange={(e) => setField(i, 'key', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} />
            <Select className="sm:col-span-2" value={fl.type} onChange={(e) => setField(i, 'type', e.target.value)}>{['text', 'tel', 'email', 'number', 'textarea', 'select', 'radio', 'checkbox', 'date'].map((t) => <option key={t}>{t}</option>)}</Select>
            <Select className="sm:col-span-2" value={fl.mapTo || ''} onChange={(e) => setField(i, 'mapTo', e.target.value || null)} placeholder="map to…">{['name', 'phone', 'email', 'city', 'condition', 'branch'].map((t) => <option key={t}>{t}</option>)}</Select>
            <label className="flex items-center gap-1.5 text-xs sm:col-span-1"><input type="checkbox" checked={!!fl.required} onChange={(e) => setField(i, 'required', e.target.checked)} /> Req</label>
            <div className="flex gap-0.5 sm:col-span-2">
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === f.fields.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => set('fields', f.fields.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
            {['select', 'radio', 'checkbox'].includes(fl.type) && fl.mapTo !== 'branch' && <Input className="col-span-2 sm:col-span-12" placeholder="Options, comma separated" value={(fl.options || []).join(', ')} onChange={(e) => setField(i, 'options', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />}
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => set('fields', [...f.fields, { key: `field_${f.fields.length + 1}`, label: 'New field', type: 'text', required: false, mapTo: null }])}><Plus /> Add field</Button>
      </TabsContent>
      <TabsContent value="page" className="grid gap-3">
        <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">Used only when the page has no designed blocks. For a full drag &amp; drop page use <b>Design</b> (paintbrush) in the list.</p>
        <Field label="Headline"><Input value={f.page.headline || ''} onChange={(e) => setPage('headline', e.target.value)} /></Field>
        <Field label="Sub-headline"><Input value={f.page.subheadline || ''} onChange={(e) => setPage('subheadline', e.target.value)} /></Field>
        <Field label="Bullets (one per line)"><Textarea rows={3} value={(f.page.bullets || []).join('\n')} onChange={(e) => setPage('bullets', e.target.value.split('\n').filter(Boolean))} /></Field>
        <Field label="Body text"><Textarea rows={4} value={f.page.body || ''} onChange={(e) => setPage('body', e.target.value)} /></Field>
        <Field label="Hero image URL"><Input value={f.page.heroImage || ''} onChange={(e) => setPage('heroImage', e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="CTA text"><Input value={f.page.ctaText || ''} onChange={(e) => setPage('ctaText', e.target.value)} /></Field>
          <Field label="SEO title"><Input value={f.page.seoTitle || ''} onChange={(e) => setPage('seoTitle', e.target.value)} /></Field>
          <Field label="SEO description"><Input value={f.page.seoDescription || ''} onChange={(e) => setPage('seoDescription', e.target.value)} /></Field>
        </div>
      </TabsContent>
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => onDone()}>Cancel</Button><Button disabled={!f.name || !f.slug || !f.fields.some((x) => x.mapTo === 'phone')} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>
    </Tabs>
  );
}

export default function Forms() {
  const can = useCan();
  const nav = useNavigate();
  const feat = useFeature();
  const [editing, setEditing] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const { data, isLoading } = useGet(['/crm/forms'], '/crm/forms', { all: 'true' });
  const { data: campaigns = [] } = useGet(['campaigns-all'], '/crm/campaigns', { all: 'true' });
  const copy = (t) => navigator.clipboard.writeText(t).then(() => toast.success('Copied'));
  const embed = (slug) => `<form id="cpf-lead" data-slug="${slug}"></form>\n<script>/* POST ${API_URL}/public/forms/${slug}/submit  body: { data: {...fields}, utm: {...} } */</script>`;
  return (
    <div>
      <PageHeader title="CMS & Forms" description="Landing pages and enquiry forms that drop leads straight into the CRM with UTM tracking" actions={<div className="flex gap-2"><Button variant="outline" onClick={() => nav('/wheels')}><Gift /> Spin wheels</Button>{feat('marketing') && can('marketing.view') && <Button variant="outline" onClick={() => nav('/marketing')}><Send /> Marketing</Button>}<Can perm="cms.create"><div className="flex gap-2"><Button variant="outline" onClick={() => setAiOpen(true)}><Sparkles /> Create with AI</Button><Button onClick={() => setEditing({})}><Plus /> New</Button></div></Can></div>} />
      <AiCreateDialog open={aiOpen} onOpenChange={setAiOpen} fields={DEFAULT_FIELDS} campaigns={campaigns} />
      <DataTable loading={isLoading} rows={data} columns={[
        { key: 'n', header: 'Name', cell: (f) => <div><p className="font-medium">{f.name}</p><p className="font-mono text-xs text-muted-foreground">/f/{f.slug}</p></div> },
        { key: 'k', header: 'Kind', cell: (f) => <div className="flex gap-1"><Badge variant="outline">{f.kind === 'landing_page' ? 'Landing page' : 'Form'}</Badge>{f.blocks?.length > 0 && <Badge variant="info">{f.blocks.length} blocks</Badge>}</div> },
        { key: 'c', header: 'Campaign', cell: (f) => f.campaign?.name || 'utm-based' },
        { key: 's', header: 'Submissions', cell: (f) => f.submissions },
        { key: 'a', header: 'Status', cell: (f) => (f.isActive ? <Badge variant="success">Live</Badge> : <Badge variant="secondary">Off</Badge>) },
        { key: 'x', header: '', className: 'text-right', cell: (f) => (
          <div className="flex justify-end gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" title="Copy public URL" onClick={() => copy(`${BOOKING_URL}/f/${f.slug}?utm_source=google&utm_medium=cpc&utm_campaign=${f.campaign?.name ? slugify(f.campaign.name) : 'campaign'}`)}><Copy /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" title="Copy API snippet" onClick={() => copy(embed(f.slug))}><span className="text-[10px] font-bold">{'</>'}</span></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" asChild><a href={`${BOOKING_URL}/f/${f.slug}`} target="_blank" rel="noreferrer"><ExternalLink /></a></Button>
            {can('cms.view') && f.kind === 'landing_page' && <Button size="icon" variant="ghost" className="h-7 w-7" title="Design page (drag & drop)" onClick={() => nav(`/forms/${f._id}/design`)}><Paintbrush /></Button>}
            {can('cms.edit') && <Button size="icon" variant="ghost" className="h-7 w-7" title="Settings & fields" onClick={() => setEditing(f)}><Pencil /></Button>}
          </div>
        ) },
      ]} />
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title={editing?._id ? `Edit · ${editing.name}` : 'New landing page / form'} size="xl">{editing && <Builder form={editing._id ? editing : null} onDone={(newId) => { setEditing(null); if (newId) nav(`/forms/${newId}/design`); }} />}</DialogContent>
      </Dialog>
    </div>
  );
}
