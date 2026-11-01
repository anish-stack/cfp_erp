import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Plus, RefreshCw, Trash2, Copy, Upload, ImageOff, PhoneCall, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Switch, Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/common/Field';
import { DataTable } from '@/components/common/DataTable';
import { useGet, useAction, useStages } from '@/hooks/queries';
import { patch, post, del, api, API_URL } from '@/lib/api';
import { useCallConfig } from '@/components/clinic/Calling';
import { useBranches } from '@/hooks/queries';
import { applyTheme, PRESETS } from '@/lib/theme';
import { useCan, useAuth } from '@/store/auth';
import { IntegrationSettings } from '@/components/admin/IntegrationSettings';
import { fmtDateTime } from '@/lib/utils';

function Toggle({ label, hint, checked, onChange, disabled }) {
  return (
    <label className="flex items-center justify-between gap-4 border-b py-3 last:border-0">
      <div><p className="text-sm font-medium">{label}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
      <Switch checked={!!checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  );
}

function Webhooks() {
  const { data = [] } = useGet('/admin/webhooks', '/admin/webhooks');
  const { data: events = [] } = useGet('wh-events', '/admin/webhooks/events');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', url: '', events: [] });
  const [secret, setSecret] = useState(null);
  const create = useAction(() => post('/admin/webhooks', f), { invalidate: ['/admin/webhooks'], onSuccess: (w) => { setOpen(false); setSecret(w.secret); setF({ name: '', url: '', events: [] }); } });
  const toggle = useAction(({ id, isActive }) => patch(`/admin/webhooks/${id}`, { isActive }), { invalidate: ['/admin/webhooks'] });
  const rotate = useAction((id) => post(`/admin/webhooks/${id}/rotate`), { onSuccess: (r) => setSecret(r.secret) });
  const remove = useAction((id) => del(`/admin/webhooks/${id}`), { success: 'Deleted', invalidate: ['/admin/webhooks'] });
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between"><div><CardTitle className="text-base">Webhooks</CardTitle><p className="text-xs text-muted-foreground">POST JSON with header <code>X-CPF-Signature: sha256=HMAC(secret, timestamp + "." + body)</code></p></div><Button size="sm" onClick={() => setOpen(true)}><Plus /> Add</Button></CardHeader>
      <CardContent>
        <DataTable rows={data} columns={[
          { key: 'n', header: 'Name', cell: (w) => <div><p className="font-medium">{w.name}</p><p className="text-xs text-muted-foreground">{w.url}</p></div> },
          { key: 'e', header: 'Events', cell: (w) => <div className="flex flex-wrap gap-1">{w.events.map((e) => <Badge key={e} variant="outline">{e}</Badge>)}</div> },
          { key: 'l', header: 'Last delivery', cell: (w) => (w.lastDeliveredAt ? `${fmtDateTime(w.lastDeliveredAt)} · ${w.lastStatus}` : '—') },
          { key: 'f', header: 'Failures', cell: (w) => w.failures },
          { key: 'a', header: 'Active', cell: (w) => <Switch checked={w.isActive} onCheckedChange={(v) => toggle.mutate({ id: w._id, isActive: v })} /> },
          { key: 'x', header: '', cell: (w) => <div className="flex gap-1"><Button size="icon" variant="ghost" className="h-7 w-7" title="Rotate secret" onClick={() => rotate.mutate(w._id)}><RefreshCw /></Button><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove.mutate(w._id)}><Trash2 /></Button></div> },
        ]} />
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="New webhook">
          <div className="space-y-3">
            <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="URL (https)"><Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
            <Field label="Events"><div className="grid grid-cols-2 gap-1.5">{events.map((e) => <label key={e} className="flex items-center gap-2 text-sm"><Checkbox checked={f.events.includes(e)} onCheckedChange={(c) => setF({ ...f, events: c ? [...f.events, e] : f.events.filter((x) => x !== e) })} />{e}</label>)}</div></Field>
            <div className="flex justify-end"><Button disabled={!f.name || !f.url.startsWith('https://') || !f.events.length} loading={create.isPending} onClick={() => create.mutate()}>Create</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!secret} onOpenChange={(o) => !o && setSecret(null)}>
        <DialogContent title="Signing secret" description="Shown once. Store it in the receiving system." size="sm">
          <div className="flex gap-2"><Input readOnly value={secret || ''} className="font-mono text-xs" /><Button size="icon" variant="outline" onClick={() => navigator.clipboard.writeText(secret).then(() => toast.success('Copied'))}><Copy /></Button></div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ColorInput({ label, value, onChange, disabled, hint }) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <input type="color" value={value || '#e21f26'} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 cursor-pointer rounded border bg-card p-0.5" />
        <Input className="w-28 font-mono" value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder="#137a6f" />
      </div>
    </Field>
  );
}

function Appearance({ s, setS, editable, saving, onSave }) {
  const t = s.theme || {};
  const c = t.console || {};
  const b = t.booking || {};
  const setT = (path, v) => setS((x) => {
    const n = structuredClone(x);
    n.theme ||= {};
    const [a, k] = path.split('.');
    if (k) { n.theme[a] ||= {}; n.theme[a][k] = v; } else n.theme[a] = v;
    if (a === 'console') applyTheme({ ...n.theme.console }); // live preview in this console
    return n;
  });
  const valid = (v) => !v || /^#[0-9a-f]{6}$/i.test(v);
  const ok = [c.primary, c.sidebar, b.primary, b.background, t.pdf].every(valid);
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4">
        <div><p className="font-semibold">Console (admin / clinic / CRM)</p><p className="text-xs text-muted-foreground">Changes preview live here; other users see them after refresh.</p></div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.primary} type="button" disabled={!editable} onClick={() => setT('console.primary', p.primary)} className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs hover:border-primary">
              <span className="h-4 w-4 rounded-full" style={{ background: p.primary }} />{p.name}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <ColorInput label="Primary colour" value={c.primary} disabled={!editable} onChange={(v) => setT('console.primary', v)} />
          <ColorInput label="Sidebar background" value={c.sidebar} disabled={!editable} onChange={(v) => setT('console.sidebar', v)} />
          <Field label={`Corner radius (${c.radius ?? 10}px)`}><input type="range" min="0" max="20" value={c.radius ?? 10} disabled={!editable} onChange={(e) => setT('console.radius', Number(e.target.value))} className="w-full" /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
          <Button size="sm">Primary button</Button><Button size="sm" variant="outline">Outline</Button><Badge>Badge</Badge><span className="rounded-md bg-accent px-2 py-1 text-xs text-accent-foreground">Active menu item</span>
        </div>
      </Card>
      <Card className="space-y-4 p-4">
        <div><p className="font-semibold">Booking portal (patients)</p><p className="text-xs text-muted-foreground">appointment.centreforpilesandfistula.com</p></div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => <button key={p.primary} type="button" disabled={!editable} onClick={() => setT('booking.primary', p.primary)} className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs hover:border-primary"><span className="h-4 w-4 rounded-full" style={{ background: p.primary }} />{p.name}</button>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <ColorInput label="Primary colour" value={b.primary} disabled={!editable} onChange={(v) => setT('booking.primary', v)} />
          <ColorInput label="Page background tint" value={b.background} disabled={!editable} onChange={(v) => setT('booking.background', v)} />
          <div className="flex items-end"><div className="w-full rounded-lg border p-3" style={{ background: `linear-gradient(${b.background || '#f0fdfa'}, #fff)` }}><div className="rounded-md py-2 text-center text-sm font-medium text-white" style={{ background: b.primary || '#137a6f' }}>Book appointment</div></div></div>
        </div>
      </Card>
      <Card className="space-y-4 p-4">
        <p className="font-semibold">PDFs (invoices, prescriptions, receipts, slips)</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <ColorInput label="PDF accent colour" hint="Blank = console primary" value={t.pdf} disabled={!editable} onChange={(v) => setT('pdf', v)} />
          <Field label="Prescription footer note" className="sm:col-span-2"><Input disabled={!editable} value={s.pdf?.rxFooter || ''} onChange={(e) => setS((x) => ({ ...x, pdf: { ...x.pdf, rxFooter: e.target.value } }))} /></Field>
        </div>
        <Toggle label="Doctor signature line on prescriptions" checked={s.pdf?.showSignature !== false} disabled={!editable} onChange={(v) => setS((x) => ({ ...x, pdf: { ...x.pdf, showSignature: v } }))} />
        <Toggle label="Show clinic logo on PDFs" hint="Upload the logo under Clinic" checked={s.billing?.showLogoOnPdf !== false} disabled={!editable} onChange={(v) => setS((x) => ({ ...x, billing: { ...x.billing, showLogoOnPdf: v } }))} />
      </Card>
      {editable && <div className="flex justify-end"><Button disabled={!ok} loading={saving} onClick={onSave}>Save appearance</Button></div>}
    </div>
  );
}

function LogoCard({ s, editable }) {
  const [file, setFile] = useState(null);
  const ver = s.clinic?.logoUpdatedAt ? new Date(s.clinic.logoUpdatedAt).getTime() : 0;
  const upload = useAction(() => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/admin/settings/logo', fd).then((r) => r.data.data);
  }, { success: 'Logo updated — new PDFs will use it', invalidate: ['/admin/settings', 'public-clinic'], onSuccess: () => setFile(null) });
  const remove = useAction(() => del('/admin/settings/logo'), { success: 'Logo removed', invalidate: ['/admin/settings', 'public-clinic'] });
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border p-3">
      <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-md border bg-white">
        {file ? <img src={URL.createObjectURL(file)} alt="" className="max-h-full max-w-full object-contain" />
          : s.clinic?.logoFile ? <img src={`${API_URL}/public/logo?v=${ver}`} alt="Clinic logo" className="max-h-full max-w-full object-contain" />
          : <ImageOff className="h-6 w-6 text-muted-foreground" />}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Clinic logo</p>
        <p className="text-xs text-muted-foreground">PNG or JPG, max 2 MB, square works best. Used on invoice & prescription PDFs, booking portal and console.</p>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Input type="file" accept="image/png,image/jpeg" className="h-9 w-60" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <Button size="sm" disabled={!file} loading={upload.isPending} onClick={() => upload.mutate()}><Upload /> Upload</Button>
            {s.clinic?.logoFile && <Button size="sm" variant="ghost" className="text-destructive" loading={remove.isPending} onClick={() => remove.mutate()}><Trash2 /> Remove</Button>}
          </div>
        )}
      </div>
    </div>
  );
}

function IvrCard({ s, set, editable, onSave, saving }) {
  const { data: branches = [] } = useBranches();
  const menu = s.crm?.ivrMenu || [];
  const upd = (i, k, v) => set('crm', 'ivrMenu', menu.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
  return (
    <Card className="p-4">
      <p className="font-semibold">Inbound IVR (Exotel)</p>
      <p className="mb-3 text-xs text-muted-foreground">Caller presses a key → call is tagged to that branch, a lead is created for unknown numbers, and routed as below.</p>
      <Field label="Who receives inbound calls">
        <Select disabled={!editable} value={s.crm?.inboundRouting || 'lead_owner'} onChange={(e) => set('crm', 'inboundRouting', e.target.value)}>
          <option value="lead_owner">Lead owner first → branch phone → sales team</option>
          <option value="branch">Selected branch phone → sales team</option>
          <option value="sales_pool">Sales team (up to 5 ring)</option>
        </Select>
      </Field>
      <div className="mt-3 space-y-2">
        {menu.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input className="h-8 w-14 text-center" value={m.digit} disabled={!editable} onChange={(e) => upd(i, 'digit', e.target.value.slice(-1))} />
            <Input className="h-8 w-44" value={m.label} disabled={!editable} onChange={(e) => upd(i, 'label', e.target.value)} />
            <Select className="h-8 w-48" value={m.branch || ''} disabled={!editable} onChange={(e) => upd(i, 'branch', e.target.value || null)} placeholder="No branch">{branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</Select>
            {editable && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => set('crm', 'ivrMenu', menu.filter((_, j) => j !== i))}><Trash2 /></Button>}
          </div>
        ))}
        {editable && menu.length < 10 && <Button size="sm" variant="outline" onClick={() => set('crm', 'ivrMenu', [...menu, { digit: String(menu.length + 1), label: '', branch: null }])}><Plus /> Add key</Button>}
      </div>
      {editable && <div className="flex justify-end pt-3"><Button loading={saving} onClick={onSave}>Save IVR</Button></div>}
    </Card>
  );
}

function ExotelCard() {
  const { data: cfg } = useCallConfig();
  const copy = (t) => navigator.clipboard.writeText(t).then(() => toast.success('Copied'));
  if (!cfg) return null;
  return (
    <Card className="space-y-3 p-4 text-sm">
      <div className="flex items-center gap-2 font-semibold"><PhoneCall className="h-4 w-4" /> Exotel dialer & IVR
        {cfg.enabled ? <Badge variant="success"><CheckCircle2 className="mr-1 h-3 w-3" />Connected</Badge> : <Badge variant="secondary"><XCircle className="mr-1 h-3 w-3" />Not configured</Badge>}
      </div>
      {!cfg.enabled && <p className="text-muted-foreground">Fill the Exotel keys above (SID, API key, API token, region, Caller ID, webhook token) and save. Until then the console dials from the user's device.</p>}
      {cfg.callerId && <p>ExoPhone (caller ID): <b>{cfg.callerId}</b></p>}
      {cfg.webhooks && (
        <div className="space-y-2">
          {!cfg.tokenSet && <p className="text-amber-700">EXOTEL_WEBHOOK_TOKEN is empty — production rejects Exotel callbacks until it is set.</p>}
          <p className="text-xs text-muted-foreground">Exotel App Bazaar flow for your ExoPhone: <b>Greeting → IVR menu (keys above) → Passthru</b> (inbound URL) <b>→ Connect</b> (dial whom: dynamic URL = connect URL, record ON) <b>→ Passthru</b> (inbound URL again, sends the recording) <b>→ Hangup</b>. Click-to-call uses the status URL automatically.</p>
          {Object.entries(cfg.webhooks).map(([k, url]) => (
            <div key={k} className="flex items-center gap-2"><span className="w-16 text-xs font-semibold uppercase text-muted-foreground">{k}</span><Input readOnly value={url} className="h-8 font-mono text-xs" /><Button size="icon" variant="outline" className="h-8 w-8" onClick={() => copy(url)}><Copy /></Button></div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Stages() {
  const can = useCan();
  const { data: stages = [] } = useStages();
  const [f, setF] = useState({ name: '', color: '#64748b' });
  const add = useAction(() => post('/crm/stages', { name: f.name, key: f.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'), order: (stages.at(-1)?.order || 0) + 1, color: f.color }), { success: 'Stage added', invalidate: ['lead-stages'], onSuccess: () => setF({ name: '', color: '#64748b' }) });
  const upd = useAction(({ id, ...b }) => patch(`/crm/stages/${id}`, b), { invalidate: ['lead-stages'] });
  const remove = useAction((id) => del(`/crm/stages/${id}`), { success: 'Removed', invalidate: ['lead-stages'] });
  const editable = can('leads.manage_settings');
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Lead funnel stages</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {stages.map((s) => (
          <div key={s._id} className="flex items-center gap-2">
            <input type="color" value={s.color} disabled={!editable} onChange={(e) => upd.mutate({ id: s._id, color: e.target.value })} className="h-8 w-8 rounded border" />
            <Input className="h-8 w-56" defaultValue={s.name} disabled={!editable} onBlur={(e) => e.target.value !== s.name && upd.mutate({ id: s._id, name: e.target.value })} />
            <Input className="h-8 w-20" type="number" defaultValue={s.order} disabled={!editable} onBlur={(e) => Number(e.target.value) !== s.order && upd.mutate({ id: s._id, order: Number(e.target.value) })} />
            {s.isDefault && <Badge>Default</Badge>}{s.isWon && <Badge variant="success">Won</Badge>}{s.isLost && <Badge variant="danger">Lost</Badge>}
            {!s.isSystem && editable && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove.mutate(s._id)}><Trash2 /></Button>}
          </div>
        ))}
        {editable && <div className="flex items-center gap-2 border-t pt-3"><input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-8 w-8 rounded border" /><Input className="h-8 w-56" placeholder="New stage" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><Button size="sm" disabled={f.name.length < 2} loading={add.isPending} onClick={() => add.mutate()}><Plus /> Add</Button></div>}
      </CardContent>
    </Card>
  );
}

/** optional modules — Super Admin only */
function ModulesCard({ s, setS }) {
  const me = useAuth((x) => x.me);
  const isSuper = me?.permissions?.includes('*');
  const qc = useQueryClient();
  const f = s.features || {};
  const save = useAction(() => patch('/admin/settings', { features: { ipd: !!f.ipd, exotel: !!f.exotel, marketing: !!f.marketing } }), {
    success: 'Modules updated', invalidate: ['/admin/settings'],
    onSuccess: async () => { const { loadMe } = await import('@/lib/session'); await loadMe(); qc.invalidateQueries(); },
  });
  const set = (k, v) => setS((x) => ({ ...x, features: { ...x.features, [k]: v } }));
  return (
    <Card className="p-4">
      <p className="mb-1 font-semibold">Optional modules</p>
      <p className="mb-3 text-sm text-muted-foreground">Switch on only what this clinic uses. A module that is off is hidden from every console and its APIs are blocked.{!isSuper && ' Only the Super Admin can change these.'}</p>
      <Toggle label="IPD — admissions, beds, OT, nursing, insurance claims" hint="Bed board, admissions, discharge billing, packages, IPD reports" checked={!!f.ipd} disabled={!isSuper} onChange={(v) => set('ipd', v)} />
      <Toggle label="Exotel — click-to-call, IVR & call recordings" hint="Off: calls are dialled from the user's own phone and logged manually" checked={!!f.exotel} disabled={!isSuper} onChange={(v) => set('exotel', v)} />
      <Toggle label="Marketing — bulk WhatsApp campaigns" hint="Offers, package & lab prices, health tips to patients and leads (opt-outs respected)" checked={!!f.marketing} disabled={!isSuper} onChange={(v) => set('marketing', v)} />
      {isSuper && <div className="flex justify-end pt-3"><Button loading={save.isPending} onClick={() => save.mutate()}>Save modules</Button></div>}
    </Card>
  );
}

function PaymentsCard({ s, set, editable, SaveBtn, save }) {
  const { data: cfgp } = useGet('pay-config', '/payments/config');
  const p = s.payments || {};
  const ap = p.appointment || {};
  const setAp = (k, v) => set('payments', 'appointment', { ...ap, [k]: v });
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div><p className="font-semibold">Online payments (Razorpay)</p><p className="text-xs text-muted-foreground">Payment links, UPI QR and online booking payments. Keys: Settings → Integrations → Razorpay.</p></div>
          <Badge variant={cfgp?.configured ? 'success' : 'warning'}>{cfgp?.configured ? 'Keys added' : 'Keys missing'}</Badge>
        </div>
        <Toggle label="Enable online payments in the console" hint="Shows “Collect online” (UPI QR / payment link) on bills, POS, IPD deposits and advances" checked={p.onlineEnabled} disabled={!editable || !cfgp?.configured} onChange={(v) => set('payments', 'onlineEnabled', v)} />
        <Toggle label="Send payment links on WhatsApp by default" checked={p.sendLinkOnWhatsapp !== false} disabled={!editable} onChange={(v) => set('payments', 'sendLinkOnWhatsapp', v)} />
        <div className="grid gap-3 pt-3 sm:grid-cols-3">
          <Field label="Link / QR valid for (hours)"><Input type="number" min={1} disabled={!editable} value={p.linkExpiryHours ?? 48} onChange={(e) => set('payments', 'linkExpiryHours', Number(e.target.value))} /></Field>
          <Field label="UPI ID (fallback QR)" hint="Used on thermal receipts when Razorpay is off"><Input disabled={!editable} placeholder="clinic@okicici" value={p.upiId || ''} onChange={(e) => set('payments', 'upiId', e.target.value.trim())} /></Field>
          <Field label="UPI payee name"><Input disabled={!editable} value={p.upiName || ''} onChange={(e) => set('payments', 'upiName', e.target.value)} /></Field>
          <Field label="QR on thermal receipt">
            <Select disabled={!editable} value={s.print?.thermalQr || 'payment'} onChange={(e) => set('print', 'thermalQr', e.target.value)}>
              <option value="payment">Pay QR if due, else website</option><option value="website">Website QR</option><option value="none">No QR</option>
            </Select>
          </Field>
        </div>
        {editable && <div className="flex justify-end pt-3"><Button loading={save.isPending} onClick={async () => { await save.mutateAsync('print'); save.mutate('payments'); }}>Save</Button></div>}
      </Card>
      <Card className="p-4">
        <p className="font-semibold">Booking portal — payment to book</p>
        <p className="text-xs text-muted-foreground">On: patients pay online before the appointment is confirmed (amount kept as advance and adjusted in the bill; refunded automatically if the slot is lost). Off: booking is free.</p>
        <Toggle label="Payment required to book an appointment online" hint={!p.onlineEnabled ? 'Enable online payments above first' : undefined} checked={ap.required} disabled={!editable || !p.onlineEnabled} onChange={(v) => setAp('required', v)} />
        {ap.required && (
          <div className="grid gap-3 pt-3 sm:grid-cols-3">
            <Field label="Amount"><Select disabled={!editable} value={ap.amountMode || 'doctor_fee'} onChange={(e) => setAp('amountMode', e.target.value)}><option value="doctor_fee">Doctor's consultation fee</option><option value="fixed">Fixed amount</option></Select></Field>
            <Field label={ap.amountMode === 'fixed' ? 'Fixed amount ₹' : 'Fallback ₹ (any doctor / no fee set)'}><Input type="number" min={1} disabled={!editable} value={ap.amount ?? 500} onChange={(e) => setAp('amount', Number(e.target.value))} /></Field>
            <Field label="Note shown to patient" className="sm:col-span-3"><Input maxLength={200} disabled={!editable} value={ap.note || ''} onChange={(e) => setAp('note', e.target.value)} /></Field>
          </div>
        )}
        <SaveBtn section="payments" />
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  const can = useCan();
  const { data, isLoading } = useGet('/admin/settings', '/admin/settings');
  const [s, setS] = useState(null);
  useEffect(() => { if (data) setS(structuredClone(data)); }, [data]);
  const save = useAction((section) => patch('/admin/settings', { [section]: s[section] }), { success: 'Settings saved', invalidate: ['/admin/settings'] });
  const appearance = useAction(() => {
    const clean = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== '' && v !== undefined && v !== null));
    return patch('/admin/settings', {
      theme: { console: clean(s.theme?.console), booking: clean(s.theme?.booking), pdf: s.theme?.pdf || '' },
      pdf: { rxFooter: s.pdf?.rxFooter || '', showSignature: s.pdf?.showSignature !== false },
      billing: { showLogoOnPdf: s.billing?.showLogoOnPdf !== false },
    });
  }, { success: 'Appearance saved', invalidate: ['/admin/settings', 'public-clinic'] });
  const editable = can('settings.manage_settings');
  if (isLoading || !s) return <Skeleton className="h-96 w-full" />;
  const set = (sec, k, v) => setS((x) => ({ ...x, [sec]: { ...x[sec], [k]: v } }));
  const SaveBtn = ({ section }) => editable && <div className="flex justify-end pt-3"><Button loading={save.isPending && save.variables === section} onClick={() => save.mutate(section)}>Save</Button></div>;

  return (
    <div className="max-w-5xl">
      <PageHeader title="Settings" />
      <Tabs defaultValue="clinic">
        <TabsList><TabsTrigger value="clinic">Clinic</TabsTrigger><TabsTrigger value="appearance">Appearance</TabsTrigger><TabsTrigger value="billing">Billing & GST</TabsTrigger><TabsTrigger value="payments">Payments</TabsTrigger><TabsTrigger value="notifications">Notifications</TabsTrigger><TabsTrigger value="crm">CRM</TabsTrigger><TabsTrigger value="modules">Modules</TabsTrigger><TabsTrigger value="ipd">IPD</TabsTrigger><TabsTrigger value="integrations">Integrations</TabsTrigger></TabsList>
        <TabsContent value="clinic">
          <Card className="p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><LogoCard s={s} editable={editable} /></div>
              {[['name', 'Clinic name'], ['tagline', 'Tagline (shown under name on PDFs)'], ['legalName', 'Legal name'], ['website', 'Website'], ['phone', 'Phone'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['gstin', 'GSTIN']].map(([k, l]) => <Field key={k} label={l}><Input disabled={!editable} value={s.clinic?.[k] || ''} onChange={(e) => set('clinic', k, e.target.value)} /></Field>)}
              <Field label="Address" className="sm:col-span-2"><Textarea disabled={!editable} value={s.clinic?.address || ''} onChange={(e) => set('clinic', 'address', e.target.value)} /></Field>
            </div>
            <SaveBtn section="clinic" />
          </Card>
        </TabsContent>
        <TabsContent value="appearance">
          <Appearance s={s} setS={setS} editable={editable} saving={appearance.isPending} onSave={() => appearance.mutate()} />
        </TabsContent>
        <TabsContent value="payments"><PaymentsCard s={s} set={set} editable={editable} SaveBtn={SaveBtn} save={save} /></TabsContent>
        <TabsContent value="billing">
          <Card className="p-4">
            <Toggle label="GST enabled" checked={s.billing.gstEnabled} disabled={!editable} onChange={(v) => set('billing', 'gstEnabled', v)} />
            <Toggle label="Prices inclusive of GST" hint="MRP-style pricing; tax is back-calculated" checked={s.billing.taxInclusive} disabled={!editable} onChange={(v) => set('billing', 'taxInclusive', v)} />
            <Toggle label="Show clinic logo on PDFs" hint="Invoices and prescriptions (upload the logo under Clinic)" checked={s.billing.showLogoOnPdf !== false} disabled={!editable} onChange={(v) => set('billing', 'showLogoOnPdf', v)} />
            <div className="grid gap-3 pt-3 sm:grid-cols-2">
              <Field label="GST on consultation/services %" hint="Healthcare services are usually exempt (0)"><Input type="number" disabled={!editable} value={s.billing.consultationGst} onChange={(e) => set('billing', 'consultationGst', Number(e.target.value))} /></Field>
              <Field label="Expiry alert window (days)"><Input type="number" disabled={!editable} value={s.inventory?.expiryAlertDays} onChange={(e) => set('inventory', 'expiryAlertDays', Number(e.target.value))} /></Field>
              <Field label="Invoice footer" className="sm:col-span-2"><Input disabled={!editable} value={s.billing.invoiceFooter} onChange={(e) => set('billing', 'invoiceFooter', e.target.value)} /></Field>
            </div>
            {editable && <div className="flex justify-end gap-2 pt-3"><Button variant="outline" onClick={() => save.mutate('inventory')}>Save inventory</Button><Button loading={save.isPending} onClick={() => save.mutate('billing')}>Save billing</Button></div>}
          </Card>
          <Card className="mt-4 p-4">
            <p className="font-semibold">Loyalty points</p>
            <p className="text-xs text-muted-foreground">Customers earn points on every bill (tracked by mobile number, so a family shares one wallet) and redeem them in POS / billing.</p>
            <Toggle label="Loyalty points enabled" checked={s.loyalty?.enabled} disabled={!editable} onChange={(v) => set('loyalty', 'enabled', v)} />
            <Toggle label="Earn points on services too" hint="Off = points only on medicines & products" checked={s.loyalty?.earnOnServices !== false} disabled={!editable} onChange={(v) => set('loyalty', 'earnOnServices', v)} />
            <div className="grid gap-3 pt-3 sm:grid-cols-3">
              <Field label="Points per ₹100 billed"><Input type="number" min={0} step="0.5" disabled={!editable} value={s.loyalty?.earnPer100 ?? 2} onChange={(e) => set('loyalty', 'earnPer100', Number(e.target.value))} /></Field>
              <Field label="Value of 1 point (₹)"><Input type="number" min={0.01} step="0.01" disabled={!editable} value={s.loyalty?.pointValue ?? 1} onChange={(e) => set('loyalty', 'pointValue', Number(e.target.value))} /></Field>
              <Field label="Minimum points to redeem"><Input type="number" min={0} disabled={!editable} value={s.loyalty?.minRedeem ?? 50} onChange={(e) => set('loyalty', 'minRedeem', Number(e.target.value))} /></Field>
              <Field label="Max % of a bill payable by points"><Input type="number" min={0} max={100} disabled={!editable} value={s.loyalty?.maxRedeemPct ?? 50} onChange={(e) => set('loyalty', 'maxRedeemPct', Number(e.target.value))} /></Field>
              <Field label="Points expire after (days)" hint="0 = never"><Input type="number" min={0} disabled={!editable} value={s.loyalty?.expiryDays ?? 365} onChange={(e) => set('loyalty', 'expiryDays', Number(e.target.value))} /></Field>
            </div>
            <p className="mt-2 rounded-md bg-muted p-2 text-xs text-muted-foreground">Example: a ₹1,000 bill earns {Math.floor(10 * (s.loyalty?.earnPer100 ?? 2))} points = ₹{(Math.floor(10 * (s.loyalty?.earnPer100 ?? 2)) * (s.loyalty?.pointValue ?? 1)).toFixed(2)} off a later bill.</p>
            <SaveBtn section="loyalty" />
          </Card>
          <Card className="mt-4 p-4">
            <p className="font-semibold">Print & QR code</p>
            <Toggle label="QR code on bills, receipts & PDFs" hint="Scanning opens your website" checked={s.print?.showQr !== false} disabled={!editable} onChange={(v) => set('print', 'showQr', v)} />
            <div className="grid gap-3 pt-3 sm:grid-cols-2">
              <Field label="QR opens this link" hint={`Empty = clinic website (${s.clinic?.website || 'set it under Clinic'})`}><Input disabled={!editable} placeholder="https://centreforpilesandfistula.com" value={s.print?.qrUrl || ''} onChange={(e) => set('print', 'qrUrl', e.target.value)} /></Field>
              <Field label="Thermal printer paper"><Select disabled={!editable} value={s.print?.thermalWidth || '80'} onChange={(e) => set('print', 'thermalWidth', e.target.value)}><option value="80">80 mm (3 inch)</option><option value="58">58 mm (2 inch)</option></Select></Field>
              <Field label="Thermal receipt footer" className="sm:col-span-2"><Input disabled={!editable} maxLength={200} value={s.print?.thermalFooter || ''} onChange={(e) => set('print', 'thermalFooter', e.target.value)} /></Field>
            </div>
            <SaveBtn section="print" />
          </Card>
        </TabsContent>
        <TabsContent value="notifications">
          <Card className="p-4">
            <p className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Channels</p>
            {[['whatsapp', 'WhatsApp (sms4power WAPP)', 'Master switch for all WhatsApp messages below. OTP is controlled by OTP_CHANNEL on the server.'], ['sms', 'SMS', 'MSG91 DLT flows (optional)'], ['email', 'Email', 'SMTP — staff lead alerts, stock alerts']].map(([k, l, h]) => <Toggle key={k} label={l} hint={h} checked={s.notifications[k] !== false} disabled={!editable} onChange={(v) => set('notifications', k, v)} />)}
            <p className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">WhatsApp to patients</p>
            {[
              ['welcome', 'Welcome + Patient ID', 'When a new patient / family profile is created'],
              ['appointmentUpdates', 'Appointment booked / rescheduled / cancelled', 'Booking ID, date, doctor, branch & map'],
              ['checkinToken', 'Check-in token', 'Token number on arrival / walk-in'],
              ['reminders', 'Appointment reminders', '24 hours and 2 hours before'],
              ['noShow', 'Missed appointment nudge', 'Same evening, with booking link'],
              ['prescription', 'Prescription', 'Medicines + PDF after the doctor saves it'],
              ['ipd', 'Admission & discharge (IPD)', 'Admission confirmation + discharge summary PDF'],
              ['invoice', 'Invoice / POS bill', 'Amount, balance + invoice PDF'],
              ['paymentReceipt', 'Payment & advance receipts', 'Each payment, advance received / refunded'],
              ['refunds', 'Returns & refunds', 'Credit note and refund amount'],
              ['followupReminders', 'Follow-up due', 'Daily at 9 AM'],
              ['leadAutoReply', 'Website enquiry auto-reply', 'Instant acknowledgement + booking link'],
            ].map(([k, l, h]) => <Toggle key={k} label={l} hint={h} checked={s.notifications[k] !== false} disabled={!editable || s.notifications.whatsapp === false} onChange={(v) => set('notifications', k, v)} />)}
            <p className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Staff alerts</p>
            {[['staffLeadAlert', 'New lead assigned', 'WhatsApp to the salesperson (staff mobile)'], ['dailyStockAlerts', 'Daily stock alerts', '8 AM — WhatsApp to branch WhatsApp no. + email']].map(([k, l, h]) => <Toggle key={k} label={l} hint={h} checked={s.notifications[k] !== false} disabled={!editable} onChange={(v) => set('notifications', k, v)} />)}
            <SaveBtn section="notifications" />
          </Card>
        </TabsContent>
        <TabsContent value="crm" className="space-y-4">
          <Card className="p-4">
            <Field label="Auto-assign new leads"><Select disabled={!editable} value={s.crm?.autoAssign || 'none'} onChange={(e) => set('crm', 'autoAssign', e.target.value)}><option value="none">Off</option><option value="round_robin">Round-robin to Sales Executives</option></Select></Field>
            <SaveBtn section="crm" />
          </Card>
          <IvrCard s={s} set={set} editable={editable} onSave={() => save.mutate('crm')} saving={save.isPending && save.variables === 'crm'} />
          <Stages />
        </TabsContent>
        <TabsContent value="modules">
          <ModulesCard s={s} setS={setS} />
        </TabsContent>
        <TabsContent value="ipd">
          <Card className="p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Doctor visit charge per round (₹)" hint="Posted when a doctor-round note is added (can be unticked per note)"><Input type="number" min="0" disabled={!editable} value={s.ipd?.doctorVisitRate ?? 500} onChange={(e) => set('ipd', 'doctorVisitRate', Number(e.target.value))} /></Field>
              <Field label="Grace hours before a new day is charged" hint="Room rent counts every started 24 h after this grace"><Input type="number" min="0" max="12" disabled={!editable} value={s.ipd?.graceHours ?? 2} onChange={(e) => set('ipd', 'graceHours', Number(e.target.value))} /></Field>
              <Field label="Ward visiting hours (printed on attendant passes)" className="sm:col-span-2"><Input disabled={!editable} maxLength={120} value={s.ipd?.visitingHours || ''} onChange={(e) => set('ipd', 'visitingHours', e.target.value)} /></Field>
              <Field label="Attendant pass rules" className="sm:col-span-2"><Input disabled={!editable} maxLength={300} value={s.ipd?.passRules || ''} onChange={(e) => set('ipd', 'passRules', e.target.value)} /></Field>
              <Field label="Operation theatres (comma separated)" className="sm:col-span-2"><Input disabled={!editable} value={(s.ipd?.otRooms || ['OT-1', 'OT-2']).join(', ')} onChange={(e) => set('ipd', 'otRooms', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} /></Field>
            </div>
            <Toggle label="Auto-charge doctor rounds" checked={s.ipd?.autoChargeRounds !== false} disabled={!editable} onChange={(v) => set('ipd', 'autoChargeRounds', v)} />
            <p className="pt-2 text-xs text-muted-foreground">Ward rates: IPD → Wards & Beds. Packages: IPD → Packages.</p>
            <SaveBtn section="ipd" />
          </Card>
        </TabsContent>
        <TabsContent value="integrations" className="space-y-4">
          <IntegrationSettings editable={editable} />
          <Card className="p-4 text-sm">
            <p className="font-semibold">Website lead API</p>
            <p className="mt-1 text-muted-foreground">POST <code>/api/v1/public/leads</code> with header <code>x-api-key: WEBSITE_API_KEY</code> (set in server .env). Body: <code>{'{ name, phone, email?, city?, condition?, message?, utm? }'}</code></p>
            <p className="mt-3 font-semibold">Landing page forms</p>
            <p className="mt-1 text-muted-foreground">Create in CRM → CMS & Forms. Public URL: <code>appointment.centreforpilesandfistula.com/f/&lt;slug&gt;</code> — UTM params are captured automatically.</p>
          </Card>
          <ExotelCard />
          <Webhooks />
        </TabsContent>
      </Tabs>
    </div>
  );
}
