import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import {
  ArrowLeft, BedDouble, FileText, Printer, ArrowRightLeft, XCircle, Stethoscope, Activity, NotebookPen, Pill, Receipt, LogOut, Plus, Trash2, Play, CheckCircle2,
  ShieldCheck, Phone, Clock, Syringe, PackageMinus, Copy,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/common/Field';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ADM_STATUS, CHARGE_KINDS, PAYERS, stayLabel, toLocalInput, FREQ_HOURS } from '@/components/ipd/ipdUtils';
import { PackageCard, DietCard, ClaimCard, DocumentsCard, LabTab } from '@/components/ipd/AdmissionExtras';
import { FlaskConical, Send, IdCard, Tags, QrCode } from 'lucide-react';
import { AttendantPassDialog, StickersDialog } from '@/components/print/PrintDialogs';
import { CollectOnline, usePayConfig } from '@/components/billing/CollectOnline';
import { useDoctors } from '@/hooks/queries';
import { useCan } from '@/store/auth';
import { api, get, patch, post, put, openFile } from '@/lib/api';
import { cn, errMsg, fmtDate, fmtDateTime, inr, ageOf } from '@/lib/utils';

const NOTE_TYPES = { doctor_round: 'Doctor round', nursing: 'Nursing', progress: 'Progress', diet: 'Diet', handover: 'Handover' };
const ANAES = ['local', 'spinal', 'saddle', 'general', 'sedation', 'none'];
const ROUTES = ['oral', 'IV', 'IM', 'SC', 'local', 'rectal', 'inhalation'];
const FREQS = ['OD', 'BD', 'TDS', 'QID', 'HS', 'SOS', 'STAT', '6 hourly', '8 hourly'];

function useAdm(id) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ipd-adm', id], queryFn: () => get(`/ipd/admissions/${id}`) });
  const bill = useQuery({ queryKey: ['ipd-bill', id], queryFn: () => get(`/ipd/admissions/${id}/bill`) });
  const run = async (fn, ok) => {
    try {
      const r = await fn();
      if (r?._id) qc.setQueryData(['ipd-adm', id], r);
      else q.refetch();
      bill.refetch();
      qc.invalidateQueries({ queryKey: ['ipd-board'] });
      qc.invalidateQueries({ queryKey: ['/ipd/admissions'] });
      if (ok) toast.success(ok);
      return r;
    } catch (e) {
      toast.error(errMsg(e));
      throw e;
    }
  };
  return { ...q, bill, run };
}

// ================================================================ overview
function Overview({ a, run, closed }) {
  const { data: doctors = [] } = useDoctors(a.branch?._id);
  const [f, setF] = useState(null);
  useEffect(() => {
    setF({
      doctor: a.doctor?._id || '', type: a.type, expectedDischargeAt: a.expectedDischargeAt ? toLocalInput(a.expectedDischargeAt) : '', reason: a.reason || '', provisionalDiagnosis: a.provisionalDiagnosis || '', allergies: a.allergies || '',
      estimate: a.estimate ?? '', attendant: { name: '', phone: '', relation: '', ...(a.attendant || {}) }, payer: { type: 'self', ...(a.payer || {}) },
      consent: { signed: false, signedBy: '', relation: '', witness: '', notes: '', ...(a.consent || {}) }, preOp: (a.preOp || []).map((x) => ({ item: x.item, done: !!x.done, by: x.by?.name, at: x.at })),
    });
  }, [a]);
  const [newItem, setNewItem] = useState('');
  if (!f) return null;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const nest = (g, k, v) => setF((x) => ({ ...x, [g]: { ...x[g], [k]: v } }));
  const saveDetails = () => run(() => patch(`/ipd/admissions/${a._id}`, {
    doctor: f.doctor, type: f.type, expectedDischargeAt: f.expectedDischargeAt ? new Date(f.expectedDischargeAt).toISOString() : null, reason: f.reason, provisionalDiagnosis: f.provisionalDiagnosis, allergies: f.allergies,
    estimate: f.estimate === '' ? undefined : Number(f.estimate), attendant: f.attendant,
    payer: { type: f.payer.type, insurer: f.payer.insurer || undefined, tpa: f.payer.tpa || undefined, policyNo: f.payer.policyNo || undefined, cardNo: f.payer.cardNo || undefined, preAuthNo: f.payer.preAuthNo || undefined, preAuthStatus: f.payer.preAuthStatus || undefined, approvedAmount: f.payer.approvedAmount ? Number(f.payer.approvedAmount) : undefined },
  }), 'Saved');
  const saveConsent = (preOp = f.preOp) => run(() => patch(`/ipd/admissions/${a._id}`, { consent: { signed: !!f.consent.signed, signedBy: f.consent.signedBy || undefined, relation: f.consent.relation || undefined, witness: f.consent.witness || undefined, notes: f.consent.notes || undefined }, preOp: preOp.map(({ item, done }) => ({ item, done })) }), 'Saved');

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-4">
        <p className="font-semibold">Admission details</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Consultant"><Select disabled={closed} value={f.doctor} onChange={(e) => set('doctor', e.target.value)}>{doctors.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>
          <Field label="Type"><Select disabled={closed} value={f.type} onChange={(e) => set('type', e.target.value)}><option value="planned">Planned</option><option value="emergency">Emergency</option><option value="day_care">Day care</option></Select></Field>
          <Field label="Expected discharge"><Input disabled={closed} type="datetime-local" value={f.expectedDischargeAt} onChange={(e) => set('expectedDischargeAt', e.target.value)} /></Field>
          <Field label="Estimate (₹)"><Input disabled={closed} type="number" value={f.estimate} onChange={(e) => set('estimate', e.target.value)} /></Field>
          <Field label="Reason for admission" className="col-span-2"><Textarea disabled={closed} rows={2} value={f.reason} onChange={(e) => set('reason', e.target.value)} /></Field>
          <Field label="Provisional diagnosis"><Input disabled={closed} value={f.provisionalDiagnosis} onChange={(e) => set('provisionalDiagnosis', e.target.value)} /></Field>
          <Field label="Allergies"><Input disabled={closed} value={f.allergies} onChange={(e) => set('allergies', e.target.value)} /></Field>
        </div>
        <p className="pt-1 text-xs font-semibold uppercase text-muted-foreground">Attendant</p>
        <div className="grid grid-cols-3 gap-2">
          <Input disabled={closed} placeholder="Name" value={f.attendant.name || ''} onChange={(e) => nest('attendant', 'name', e.target.value)} />
          <Input disabled={closed} placeholder="Mobile" value={f.attendant.phone || ''} onChange={(e) => nest('attendant', 'phone', e.target.value.replace(/\D/g, '').slice(0, 10))} />
          <Input disabled={closed} placeholder="Relation" value={f.attendant.relation || ''} onChange={(e) => nest('attendant', 'relation', e.target.value)} />
        </div>
        <p className="pt-1 text-xs font-semibold uppercase text-muted-foreground">Payer</p>
        <Select disabled={closed} value={f.payer.type} onChange={(e) => nest('payer', 'type', e.target.value)}>{Object.entries(PAYERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        {f.payer.type !== 'self' && (
          <div className="grid grid-cols-2 gap-2">
            {[['insurer', 'Insurer / company'], ['tpa', 'TPA'], ['policyNo', 'Policy no.'], ['cardNo', 'Card / member ID'], ['preAuthNo', 'Pre-auth no.']].map(([k, l]) => <Input key={k} disabled={closed} placeholder={l} value={f.payer[k] || ''} onChange={(e) => nest('payer', k, e.target.value)} />)}
            <Select disabled={closed} value={f.payer.preAuthStatus || 'pending'} onChange={(e) => nest('payer', 'preAuthStatus', e.target.value)}>{['pending', 'approved', 'partial', 'rejected', 'not_required'].map((s) => <option key={s} value={s}>Pre-auth: {s.replace('_', ' ')}</option>)}</Select>
            <Input disabled={closed} className="col-span-2" type="number" placeholder="Approved amount (₹)" value={f.payer.approvedAmount || ''} onChange={(e) => nest('payer', 'approvedAmount', e.target.value)} />
          </div>
        )}
        {!closed && <div className="flex justify-end"><Button onClick={saveDetails}>Save details</Button></div>}
      </Card>

      <div className="space-y-4">
        <PackageCard a={a} run={run} closed={closed} />
        <ClaimCard a={a} run={run} />
        <DietCard a={a} run={run} closed={closed} />
        <Card className="space-y-3 p-4">
          <p className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" /> Consent {f.consent.signed ? <Badge variant="success">Signed{a.consent?.at ? ` · ${fmtDateTime(a.consent.at)}` : ''}</Badge> : <Badge variant="warning">Pending</Badge>}</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={closed} checked={!!f.consent.signed} onChange={(e) => nest('consent', 'signed', e.target.checked)} /> Consent form signed (print the admission sheet for signature)</label>
          <div className="grid grid-cols-3 gap-2">
            <Input disabled={closed} placeholder="Signed by" value={f.consent.signedBy || ''} onChange={(e) => nest('consent', 'signedBy', e.target.value)} />
            <Input disabled={closed} placeholder="Relation" value={f.consent.relation || ''} onChange={(e) => nest('consent', 'relation', e.target.value)} />
            <Input disabled={closed} placeholder="Witness" value={f.consent.witness || ''} onChange={(e) => nest('consent', 'witness', e.target.value)} />
          </div>
          {!closed && <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => saveConsent()}>Save consent</Button></div>}
        </Card>
        <Card className="space-y-2 p-4">
          <p className="font-semibold">Pre-op checklist <span className="text-xs font-normal text-muted-foreground">{f.preOp.filter((x) => x.done).length}/{f.preOp.length} done</span></p>
          {!f.preOp.length && <p className="text-sm text-muted-foreground">Created automatically when a procedure is planned.</p>}
          {f.preOp.map((x, i) => (
            <label key={i} className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={closed} checked={x.done} onChange={(e) => { const p = f.preOp.map((y, j) => (j === i ? { ...y, done: e.target.checked } : y)); set('preOp', p); saveConsent(p); }} />
              <span className={cn(x.done && 'text-muted-foreground line-through')}>{x.item}</span>
              {x.done && x.by && <span className="ml-auto text-[11px] text-muted-foreground">{x.by}{x.at ? ` · ${fmtDateTime(x.at)}` : ''}</span>}
            </label>
          ))}
          {!closed && <div className="flex gap-2 pt-1"><Input className="h-8" placeholder="Add checklist item" value={newItem} onChange={(e) => setNewItem(e.target.value)} /><Button size="sm" variant="outline" disabled={newItem.trim().length < 2} onClick={() => { const p = [...f.preOp, { item: newItem.trim(), done: false }]; set('preOp', p); setNewItem(''); saveConsent(p); }}><Plus /></Button></div>}
        </Card>
        <DocumentsCard a={a} run={run} closed={closed} />
        <Card className="p-4">
          <p className="mb-2 font-semibold">Bed history</p>
          {(a.bedHistory || []).map((h, i) => <p key={i} className="flex justify-between border-b py-1.5 text-sm last:border-0"><span>{h.wardName} · Bed {h.bedNumber} <span className="text-xs text-muted-foreground">({inr(h.dailyRate)}/day)</span></span><span className="text-xs text-muted-foreground">{fmtDateTime(h.from)} → {h.to ? fmtDateTime(h.to) : 'now'}</span></p>)}
        </Card>
      </div>
    </div>
  );
}

// ================================================================ procedures / OT
function Procedures({ a, run, closed }) {
  const { data: doctors = [] } = useDoctors(a.branch?._id);
  const { data: ot } = useQuery({ queryKey: ['ipd-ot-rooms'], queryFn: () => get('/ipd/ot'), staleTime: 300_000 });
  const rooms = ot?.rooms || ['OT-1'];
  const { data: services = [] } = useQuery({ queryKey: ['ipd-services'], staleTime: 300_000, queryFn: () => get('/inventory/products/search', { q: '', type: 'service' }) });
  const [add, setAdd] = useState({ service: '', scheduledAt: '', ot: '', durationMin: 60 });
  const [edit, setEdit] = useState(null);
  const upd = (p, body, msg) => run(() => patch(`/ipd/admissions/${a._id}/procedures/${p._id}`, body), msg);
  const tone = { scheduled: 'info', in_progress: 'warning', done: 'success', cancelled: 'secondary' };
  return (
    <div className="space-y-3">
      {!a.procedures?.length && <Card className="p-6 text-center text-sm text-muted-foreground">No procedure planned.</Card>}
      {(a.procedures || []).map((p) => (
        <Card key={p._id} className="space-y-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="flex items-center gap-2 font-semibold"><Syringe className="h-4 w-4 text-primary" /> {p.name} <Badge variant={tone[p.status]}>{p.status.replace('_', ' ')}</Badge></p>
              <p className="text-xs text-muted-foreground">{[p.surgeon?.name && `Surgeon: ${p.surgeon.name}`, p.anaesthesia && `Anaesthesia: ${p.anaesthesia}`, p.anaesthetist, p.ot && `OT: ${p.ot}`].filter(Boolean).join(' · ')}</p>
              <p className="text-xs text-muted-foreground">{p.scheduledAt && `Scheduled ${fmtDateTime(p.scheduledAt)}`}{p.startedAt && ` · Started ${fmtDateTime(p.startedAt)}`}{p.endedAt && ` · Done ${fmtDateTime(p.endedAt)}`}{p.chargePosted ? ' · charge posted' : ''}</p>
            </div>
            {!closed && (
              <div className="flex flex-wrap gap-1.5">
                {p.status === 'scheduled' && <Button size="sm" variant="outline" onClick={() => upd(p, { status: 'in_progress' }, 'Procedure started')}><Play /> Start</Button>}
                {['scheduled', 'in_progress'].includes(p.status) && <Button size="sm" onClick={() => upd(p, { status: 'done' }, 'Procedure completed')}><CheckCircle2 /> Mark done</Button>}
                <Button size="sm" variant="ghost" onClick={() => setEdit({ ...p, surgeon: p.surgeon?._id || '', scheduledAt: p.scheduledAt ? toLocalInput(p.scheduledAt) : '' })}>Edit / notes</Button>
                {p.status === 'scheduled' && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => upd(p, { status: 'cancelled' }, 'Cancelled')}>Cancel</Button>}
              </div>
            )}
          </div>
          {p.findings && <p className="text-sm"><b>Findings:</b> {p.findings}</p>}
          {p.notes && <p className="whitespace-pre-line text-sm text-muted-foreground">{p.notes}</p>}
        </Card>
      ))}
      {!closed && (
        <Card className="flex flex-wrap items-end gap-2 p-4">
          <Field label="Add procedure" className="min-w-[220px] flex-1"><Select value={add.service} onChange={(e) => setAdd({ ...add, service: e.target.value })} placeholder="Select service">{services.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select></Field>
          <Field label="Scheduled at"><Input type="datetime-local" value={add.scheduledAt} onChange={(e) => setAdd({ ...add, scheduledAt: e.target.value })} /></Field>
          <Field label="OT"><Select className="w-28" value={add.ot} onChange={(e) => setAdd({ ...add, ot: e.target.value })} placeholder="—">{rooms.map((r) => <option key={r}>{r}</option>)}</Select></Field>
          <Field label="Minutes"><Input className="w-20" type="number" min="5" value={add.durationMin} onChange={(e) => setAdd({ ...add, durationMin: e.target.value })} /></Field>
          <Button disabled={!add.service} onClick={() => run(() => post(`/ipd/admissions/${a._id}/procedures`, { service: add.service, name: services.find((s) => s._id === add.service)?.name, scheduledAt: add.scheduledAt ? new Date(add.scheduledAt).toISOString() : undefined, ot: add.ot || undefined, durationMin: Number(add.durationMin) || 60 }), 'Procedure added').then(() => setAdd({ service: '', scheduledAt: '', ot: '', durationMin: 60 }))}><Plus /> Add</Button>
        </Card>
      )}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent title={`Procedure · ${edit?.name || ''}`} size="lg">
          {edit && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Surgeon"><Select value={edit.surgeon} onChange={(e) => setEdit({ ...edit, surgeon: e.target.value })}>{doctors.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>
              <Field label="Assistant"><Input value={edit.assistant || ''} onChange={(e) => setEdit({ ...edit, assistant: e.target.value })} /></Field>
              <Field label="Anaesthesia"><Select value={edit.anaesthesia || 'local'} onChange={(e) => setEdit({ ...edit, anaesthesia: e.target.value })}>{ANAES.map((x) => <option key={x}>{x}</option>)}</Select></Field>
              <Field label="Anaesthetist"><Input value={edit.anaesthetist || ''} onChange={(e) => setEdit({ ...edit, anaesthetist: e.target.value })} /></Field>
              <Field label="OT"><Select value={edit.ot || ''} onChange={(e) => setEdit({ ...edit, ot: e.target.value })} placeholder="—">{rooms.map((r) => <option key={r}>{r}</option>)}</Select></Field>
              <Field label="Duration (minutes)"><Input type="number" min="5" value={edit.durationMin || 60} onChange={(e) => setEdit({ ...edit, durationMin: e.target.value })} /></Field>
              <Field label="Scheduled at"><Input type="datetime-local" value={edit.scheduledAt} onChange={(e) => setEdit({ ...edit, scheduledAt: e.target.value })} /></Field>
              <Field label="Operative findings" className="sm:col-span-2"><Textarea rows={2} value={edit.findings || ''} onChange={(e) => setEdit({ ...edit, findings: e.target.value })} /></Field>
              <Field label="Operation notes" className="sm:col-span-2"><Textarea rows={4} value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
              <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="outline" onClick={() => setEdit(null)}>Close</Button>
                <Button onClick={() => upd(edit, { surgeon: edit.surgeon || undefined, assistant: edit.assistant, anaesthesia: edit.anaesthesia, anaesthetist: edit.anaesthetist, ot: edit.ot || undefined, durationMin: Number(edit.durationMin) || 60, findings: edit.findings, notes: edit.notes, scheduledAt: edit.scheduledAt ? new Date(edit.scheduledAt).toISOString() : undefined }, 'Saved').then(() => setEdit(null))}>Save</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ================================================================ vitals
function Vitals({ a, run, closed }) {
  const blank = { bp: '', pulse: '', temp: '', spo2: '', rr: '', pain: '', sugar: '', intake: '', output: '', note: '' };
  const [v, setV] = useState(blank);
  const rows = [...(a.vitals || [])].sort((x, y) => new Date(y.at) - new Date(x.at));
  const chart = [...(a.vitals || [])].sort((x, y) => new Date(x.at) - new Date(y.at)).slice(-30).map((x) => ({ t: new Date(x.at).toLocaleString('en-IN', { day: '2-digit', hour: '2-digit', minute: '2-digit' }), Pulse: x.pulse, Temp: x.temp, SpO2: x.spo2 }));
  const save = () => {
    const body = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '').map(([k, x]) => [k, ['bp', 'note'].includes(k) ? x : Number(x)]));
    if (!Object.keys(body).length) return toast.error('Enter at least one value');
    run(() => post(`/ipd/admissions/${a._id}/vitals`, body), 'Vitals recorded').then(() => setV(blank));
  };
  const F = (k, ph, w = 'w-20') => <Input className={cn('h-9', w)} placeholder={ph} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />;
  return (
    <div className="space-y-3">
      {!closed && (
        <Card className="flex flex-wrap items-end gap-2 p-3">
          {F('bp', 'BP 120/80', 'w-28')}{F('pulse', 'Pulse')}{F('temp', 'Temp °F')}{F('spo2', 'SpO₂ %')}{F('rr', 'RR')}{F('pain', 'Pain 0-10', 'w-24')}{F('sugar', 'Sugar')}{F('intake', 'Intake ml', 'w-24')}{F('output', 'Output ml', 'w-24')}{F('note', 'Note', 'w-48')}
          <Button onClick={save}><Plus /> Record</Button>
        </Card>
      )}
      {(() => {
        const byDay = {};
        for (const x of a.vitals || []) { if (!x.intake && !x.output) continue; const k = new Date(x.at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }); byDay[k] ||= { i: 0, o: 0 }; byDay[k].i += x.intake || 0; byDay[k].o += x.output || 0; }
        const ks = Object.keys(byDay);
        return ks.length ? <Card className="flex flex-wrap gap-2 p-3 text-xs"><span className="font-semibold">Intake / output:</span>{ks.map((k) => <span key={k} className="rounded bg-muted px-2 py-0.5">{k}: {byDay[k].i} / {byDay[k].o} ml <b className={cn(byDay[k].i - byDay[k].o < 0 && 'text-destructive')}>({byDay[k].i - byDay[k].o >= 0 ? '+' : ''}{byDay[k].i - byDay[k].o})</b></span>)}</Card> : null;
      })()}
      {chart.length > 1 && (
        <Card className="h-56 p-3">
          <ResponsiveContainer><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="t" fontSize={10} /><YAxis fontSize={10} domain={['auto', 'auto']} /><Tooltip /><Legend /><Line type="monotone" dataKey="Pulse" stroke="#e21f26" dot={false} /><Line type="monotone" dataKey="Temp" stroke="#f59e0b" dot={false} /><Line type="monotone" dataKey="SpO2" stroke="#0ea5e9" dot={false} /></LineChart></ResponsiveContainer>
        </Card>
      )}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs"><tr>{['Time', 'BP', 'Pulse', 'Temp', 'SpO₂', 'RR', 'Pain', 'Sugar', 'I/O', 'Note', 'By'].map((h) => <th key={h} className="px-2 py-2 text-left font-medium">{h}</th>)}</tr></thead>
          <tbody>{rows.map((x) => (
            <tr key={x._id} className="border-t">
              <td className="whitespace-nowrap px-2 py-1.5">{fmtDateTime(x.at)}</td><td className="px-2">{x.bp}</td><td className={cn('px-2', (x.pulse > 110 || x.pulse < 55) && 'font-semibold text-destructive')}>{x.pulse}</td>
              <td className={cn('px-2', x.temp >= 100.4 && 'font-semibold text-destructive')}>{x.temp != null ? Number(x.temp).toFixed(1) : ''}</td><td className={cn('px-2', x.spo2 && x.spo2 < 94 && 'font-semibold text-destructive')}>{x.spo2}</td><td className="px-2">{x.rr}</td><td className="px-2">{x.pain}</td><td className="px-2">{x.sugar}</td>
              <td className="px-2">{x.intake || x.output ? `${x.intake || 0}/${x.output || 0}` : ''}</td><td className="px-2 text-xs">{x.note}</td><td className="px-2 text-xs text-muted-foreground">{x.by?.name}</td>
            </tr>
          ))}</tbody>
        </table>
        {!rows.length && <p className="p-6 text-center text-sm text-muted-foreground">No vitals recorded yet.</p>}
      </Card>
    </div>
  );
}

// ================================================================ notes
function Notes({ a, run, closed }) {
  const [n, setN] = useState({ type: 'progress', text: '', chargeVisit: true });
  const rows = [...(a.notes || [])].sort((x, y) => new Date(y.at) - new Date(x.at));
  return (
    <div className="space-y-3">
      {!closed && (
        <Card className="space-y-2 p-3">
          <div className="flex flex-wrap gap-1.5">{Object.entries(NOTE_TYPES).map(([k, l]) => <button key={k} type="button" onClick={() => setN({ ...n, type: k })} className={cn('rounded-full border px-3 py-1 text-xs', n.type === k ? 'border-primary bg-primary text-primary-foreground' : '')}>{l}</button>)}</div>
          <Textarea rows={3} placeholder="Write note…" value={n.text} onChange={(e) => setN({ ...n, text: e.target.value })} />
          <div className="flex items-center justify-end gap-3">
            {n.type === 'doctor_round' && <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={n.chargeVisit} onChange={(e) => setN({ ...n, chargeVisit: e.target.checked })} /> Charge doctor visit</label>}
            <Button disabled={n.text.trim().length < 2} onClick={() => run(() => post(`/ipd/admissions/${a._id}/notes`, { type: n.type, text: n.text, chargeVisit: n.type === 'doctor_round' ? n.chargeVisit : undefined }), 'Note added').then(() => setN({ ...n, text: '' }))}><NotebookPen /> Add note</Button>
          </div>
        </Card>
      )}
      <div className="space-y-2">
        {rows.map((x) => (
          <Card key={x._id} className="p-3">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><Badge variant={x.type === 'doctor_round' ? 'default' : x.type === 'nursing' ? 'info' : 'outline'}>{NOTE_TYPES[x.type]}</Badge>{fmtDateTime(x.at)} · {x.by?.name}</div>
            <p className="whitespace-pre-line text-sm">{x.text}</p>
          </Card>
        ))}
        {!rows.length && <Card className="p-6 text-center text-sm text-muted-foreground">No notes yet.</Card>}
      </div>
    </div>
  );
}

// ================================================================ medications (MAR)
function Meds({ a, run, closed }) {
  const { data: meds = [] } = useQuery({ queryKey: ['rx-meds'], queryFn: () => get('/inventory/products/search', { q: '', type: 'medicine,consumable' }), staleTime: 300_000 });
  const blank = { name: '', dose: '', route: 'oral', frequency: 'BD', instructions: '' };
  const [m, setM] = useState(blank);
  const give = (x, status) => run(() => post(`/ipd/admissions/${a._id}/medications/${x._id}/administer`, { status }), status === 'given' ? `${x.name} given` : `Marked ${status}`);
  const list = [...(a.medications || [])].sort((x, y) => Number(y.active) - Number(x.active));
  return (
    <div className="space-y-3">
      {!closed && (
        <Card className="flex flex-wrap items-end gap-2 p-3">
          <Field label="Medicine / injection" className="min-w-[220px] flex-1"><Input list="ipd-meds" value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} placeholder="e.g. Inj. Ceftriaxone 1 g" /><datalist id="ipd-meds">{meds.map((p) => <option key={p._id} value={p.name} />)}</datalist></Field>
          <Field label="Dose"><Input className="w-24" value={m.dose} onChange={(e) => setM({ ...m, dose: e.target.value })} /></Field>
          <Field label="Route"><Select className="w-28" value={m.route} onChange={(e) => setM({ ...m, route: e.target.value })}>{ROUTES.map((r) => <option key={r}>{r}</option>)}</Select></Field>
          <Field label="Frequency"><Select className="w-28" value={m.frequency} onChange={(e) => setM({ ...m, frequency: e.target.value })}>{FREQS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
          <Field label="Instructions"><Input className="w-44" value={m.instructions} onChange={(e) => setM({ ...m, instructions: e.target.value })} /></Field>
          <Button disabled={m.name.trim().length < 2} onClick={() => run(() => post(`/ipd/admissions/${a._id}/medications`, { ...m, product: meds.find((p) => p.name === m.name)?._id }), 'Medication ordered').then(() => setM(blank))}><Plus /> Order</Button>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">Medication chart (MAR). Ordering here does not bill — use <b>Charges → Issue from pharmacy</b> to dispense and charge stock.</p>
      {list.map((x) => {
        const last = x.administrations?.[x.administrations.length - 1];
        const given = (x.administrations || []).filter((d) => d.status === 'given');
        const h = FREQ_HOURS[x.frequency];
        const nextAt = h ? new Date(new Date(given.length ? given[given.length - 1].at : x.startAt).getTime() + (given.length ? h * 3_600_000 : 0)) : null;
        const dueState = !x.active || !nextAt ? null : nextAt < new Date(Date.now() - 30 * 60_000) ? 'overdue' : nextAt <= new Date(Date.now() + 60 * 60_000) ? 'due' : 'later';
        return (
          <Card key={x._id} className={cn('p-3', !x.active && 'opacity-60')}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{x.name} <span className="text-sm font-normal text-muted-foreground">{[x.dose, x.route, x.frequency].filter(Boolean).join(' · ')}</span> {!x.active && <Badge variant="secondary">Stopped</Badge>}{dueState === 'overdue' && <Badge variant="danger">Overdue</Badge>}{dueState === 'due' && <Badge variant="warning">Due now</Badge>}{dueState === 'later' && <span className="text-xs text-muted-foreground">next {nextAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>}</p>
                <p className="text-xs text-muted-foreground">{x.instructions && `${x.instructions} · `}Ordered by {x.orderedBy?.name || '—'} · {fmtDateTime(x.startAt)}{last ? ` · Last: ${last.status} ${fmtDateTime(last.at)}` : ''}</p>
              </div>
              {!closed && x.active && (
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" onClick={() => give(x, 'given')}><CheckCircle2 /> Given</Button>
                  <Button size="sm" variant="outline" onClick={() => give(x, 'missed')}>Missed</Button>
                  <Button size="sm" variant="outline" onClick={() => give(x, 'refused')}>Refused</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => run(() => patch(`/ipd/admissions/${a._id}/medications/${x._id}`, { active: false }), 'Stopped')}>Stop</Button>
                </div>
              )}
            </div>
            {x.administrations?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">{x.administrations.slice(-12).map((d, i) => <span key={i} title={`${d.status} · ${d.by?.name || ''}${d.note ? ` · ${d.note}` : ''}`} className={cn('rounded px-1.5 py-0.5 text-[10px]', d.status === 'given' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800')}>{new Date(d.at).toLocaleString('en-IN', { day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>)}</div>
            )}
          </Card>
        );
      })}
      {!list.length && <Card className="p-6 text-center text-sm text-muted-foreground">No medications ordered.</Card>}
    </div>
  );
}

// ================================================================ charges & bill
function Charges({ a, bill, run, closed }) {
  const { data: payCfg } = usePayConfig();
  const [dep, setDep] = useState(false);
  const { data: services = [] } = useQuery({ queryKey: ['ipd-services'], staleTime: 300_000, queryFn: () => get('/inventory/products/search', { q: '', type: 'service' }) });
  const [c, setC] = useState({ kind: 'doctor_visit', product: '', description: '', qty: 1, rate: '' });
  const [iss, setIss] = useState({ q: '', product: null, qty: 1, addToMar: false });
  const { data: stockItems = [] } = useQuery({ queryKey: ['ipd-stock', a.branch?._id, iss.q], enabled: iss.q.length >= 1, queryFn: () => get('/inventory/products/search', { q: iss.q, type: 'medicine,consumable,product', branch: a.branch?._id }) });
  const b = bill.data;
  const addCharge = () => {
    const svc = services.find((s) => s._id === c.product);
    const body = { kind: c.kind, qty: Number(c.qty) || 1, ...(svc ? { product: svc._id, rate: c.rate === '' ? undefined : Number(c.rate) } : { description: c.description, rate: Number(c.rate) || 0 }) };
    run(() => post(`/ipd/admissions/${a._id}/charges`, body), 'Charge added').then(() => setC({ ...c, product: '', description: '', qty: 1, rate: '' }));
  };
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        {!closed && (
          <>
            <Card className="flex flex-wrap items-end gap-2 p-3">
              <Field label="Type"><Select className="w-40" value={c.kind} onChange={(e) => setC({ ...c, kind: e.target.value })}>{Object.entries(CHARGE_KINDS).filter(([k]) => !['bed', 'nursing', 'pharmacy', 'consumable'].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
              <Field label="Service (optional)"><Select className="w-52" value={c.product} onChange={(e) => setC({ ...c, product: e.target.value, rate: '' })} placeholder="Custom item">{services.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select></Field>
              {!c.product && <Field label="Description"><Input className="w-52" value={c.description} onChange={(e) => setC({ ...c, description: e.target.value })} placeholder="e.g. Consultant visit" /></Field>}
              <Field label="Qty"><Input className="w-16" type="number" min="1" value={c.qty} onChange={(e) => setC({ ...c, qty: e.target.value })} /></Field>
              <Field label="Rate ₹"><Input className="w-24" type="number" min="0" value={c.rate} placeholder={c.product ? String(services.find((s) => s._id === c.product)?.sellPrice ?? '') : ''} onChange={(e) => setC({ ...c, rate: e.target.value })} /></Field>
              <Button disabled={!c.product && (!c.description || c.rate === '')} onClick={addCharge}><Plus /> Add charge</Button>
            </Card>
            <Card className="space-y-2 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold"><PackageMinus className="h-4 w-4" /> Issue from pharmacy (stock is deducted FEFO from {a.branch?.name})</p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="relative min-w-[240px] flex-1">
                  <Input placeholder="Search medicine / consumable" value={iss.product ? iss.product.name : iss.q} onChange={(e) => setIss({ ...iss, q: e.target.value, product: null })} />
                  {!iss.product && iss.q && stockItems.length > 0 && (
                    <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-card shadow-lg">
                      {stockItems.map((p) => <button key={p._id} type="button" disabled={!p.stock} onClick={() => setIss({ ...iss, product: p })} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-40"><span>{p.name}</span><span className="text-xs text-muted-foreground">{inr(p.sellPrice)} · stock {p.stock ?? 0}</span></button>)}
                    </div>
                  )}
                </div>
                <Input className="w-20" type="number" min="1" value={iss.qty} onChange={(e) => setIss({ ...iss, qty: e.target.value })} />
                <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={iss.addToMar} onChange={(e) => setIss({ ...iss, addToMar: e.target.checked })} /> Add to medication chart</label>
                <Button variant="outline" disabled={!iss.product} onClick={() => run(() => post(`/ipd/admissions/${a._id}/issue`, { product: iss.product._id, qty: Number(iss.qty) || 1, addToMar: iss.addToMar }), 'Issued & charged').then(() => setIss({ q: '', product: null, qty: 1, addToMar: false }))}>Issue</Button>
              </div>
            </Card>
          </>
        )}
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs"><tr>{['Date', 'Type', 'Description', 'Qty', 'Rate', 'Amount', ''].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {(b?.lines || []).map((l, i) => (
                <tr key={l._id || `c${i}`} className="border-t">
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs">{l.date ? fmtDate(l.date) : 'auto'}</td>
                  <td className="px-3 text-xs">{CHARGE_KINDS[l.kind] || l.kind}</td>
                  <td className="px-3">{l.description}</td><td className="px-3">{l.qty}</td><td className="px-3">{inr(l.rate)}</td><td className="px-3 font-medium">{l.included ? <span className="text-xs text-emerald-700">Included</span> : inr(l.amount)}</td>
                  <td className="px-2 text-right">{!closed && l._id && <button type="button" title="Remove (pharmacy items are restocked)" className="text-muted-foreground hover:text-destructive" onClick={() => run(() => api.delete(`/ipd/admissions/${a._id}/charges/${l._id}`).then((r) => r.data.data), 'Removed')}><Trash2 className="h-4 w-4" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!b?.lines?.length && <p className="p-6 text-center text-sm text-muted-foreground">No charges yet.</p>}
        </Card>
      </div>
      <Card className="h-fit space-y-2 p-4">
        <p className="font-semibold">{closed ? 'Final bill' : 'Running bill'}</p>
        {!b ? <Skeleton className="h-32" /> : (
          <>
            <Row l={`Stay (${b.days} day${b.days === 1 ? '' : 's'})`} v={inr(b.lines.filter((x) => ['bed', 'nursing'].includes(x.kind)).reduce((s, x) => s + x.amount, 0))} />
            {b.lines.some((x) => x.kind === 'package') && <Row l="Package" v={inr(b.lines.filter((x) => x.kind === 'package').reduce((s, x) => s + x.amount, 0))} />}
            <Row l="Procedures & OT" v={inr(b.lines.filter((x) => ['procedure', 'ot', 'surgeon', 'anaesthesia'].includes(x.kind)).reduce((s, x) => s + x.amount, 0))} />
            <Row l="Pharmacy & consumables" v={inr(b.lines.filter((x) => ['pharmacy', 'consumable'].includes(x.kind)).reduce((s, x) => s + x.amount, 0))} />
            <Row l="Lab / investigations" v={inr(b.lines.filter((x) => x.kind === 'investigation').reduce((s, x) => s + x.amount, 0))} />
            <Row l="Visits / other" v={inr(b.lines.filter((x) => ['doctor_visit', 'other'].includes(x.kind)).reduce((s, x) => s + x.amount, 0))} />
            <div className="border-t pt-2"><Row l="Total" v={inr(b.total)} bold /></div>
            {!closed && <Row l="Advance available" v={`− ${inr(b.advance)}`} />}
            {b.approved > 0 && <Row l="Insurance approved" v={inr(b.approved)} />}
            {b.estimate > 0 && <Row l="Estimate given" v={inr(b.estimate)} muted />}
            {!closed && <div className="border-t pt-2"><Row l="Estimated payable" v={inr(b.due)} bold /></div>}
            {a.invoice && <Button asChild variant="outline" className="w-full"><Link to={`/billing/${a.invoice._id}`}><Receipt /> {a.invoice.invoiceNo} · due {inr(a.invoice.balance)}</Link></Button>}
            {!closed && payCfg?.enabled && <Button size="sm" className="w-full" onClick={() => setDep(true)}><QrCode /> Collect deposit online</Button>}
            {!closed && (
              <div className="grid grid-cols-2 gap-2 border-t pt-2">
                <Button size="sm" variant="outline" onClick={() => openFile(`/ipd/admissions/${a._id}/pdf-bill/interim`).catch((e) => toast.error(errMsg(e)))}><Printer /> Interim bill</Button>
                <Button size="sm" variant="outline" onClick={() => post(`/ipd/admissions/${a._id}/send/interim`).then(() => toast.success('Interim bill queued on WhatsApp')).catch((e) => toast.error(errMsg(e)))}><Send /> WhatsApp</Button>
                <Button size="sm" variant="outline" onClick={() => openFile(`/ipd/admissions/${a._id}/pdf-bill/estimate`).catch((e) => toast.error(errMsg(e)))}><Printer /> Estimate</Button>
                <Button size="sm" variant="outline" onClick={() => post(`/ipd/admissions/${a._id}/send/estimate`).then(() => toast.success('Estimate queued on WhatsApp')).catch((e) => toast.error(errMsg(e)))}><Send /> WhatsApp</Button>
              </div>
            )}
          </>
        )}
      </Card>
      <CollectOnline open={dep} onOpenChange={setDep} purpose="advance" patient={a.patient} branch={a.branch?._id} admission={a._id} defaultAmount={Math.max(0, Math.round(bill.data?.due || 0)) || ''} title="IPD deposit — collect online" onPaid={() => bill.refetch?.()} />
    </div>
  );
}
const Row = ({ l, v, bold, muted }) => <p className={cn('flex justify-between text-sm', bold && 'text-base font-semibold', muted && 'text-muted-foreground')}><span>{l}</span><span>{v}</span></p>;

// ================================================================ discharge
function Discharge({ a, bill, run, closed }) {
  const [d, setD] = useState(null);
  const [pay, setPay] = useState([{ mode: 'upi', amount: '' }]);
  const [useAdvance, setUseAdvance] = useState(true);
  const [discountPct, setDiscount] = useState(0);
  const [insurerShare, setInsurerShare] = useState(a.payer?.approvedAmount ? String(a.payer.approvedAmount) : '');
  const insured = a.payer?.type && a.payer.type !== 'self';
  const [done, setDone] = useState(null);
  useEffect(() => {
    const s = a.discharge || {};
    const procs = (a.procedures || []).filter((p) => p.status === 'done');
    setD({
      type: s.type || 'normal', finalDiagnosis: s.finalDiagnosis || a.provisionalDiagnosis || '', procedureDone: s.procedureDone || procs.map((p) => `${p.name}${p.anaesthesia && p.anaesthesia !== 'none' ? ` under ${p.anaesthesia} anaesthesia` : ''}${p.endedAt ? ` on ${fmtDate(p.endedAt)}` : ''}`).join('\n'),
      courseInHospital: s.courseInHospital || '', investigations: s.investigations || '', conditionAtDischarge: s.conditionAtDischarge || 'Stable, ambulatory, vitals within normal limits.', medications: s.medications?.length ? s.medications : [],
      advice: s.advice || '', diet: s.diet || '', followUpDate: s.followUpDate || '', followUpNote: s.followUpNote || '', referredTo: s.referredTo || '',
    });
  }, [a]);
  if (!d) return null;
  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const setMed = (i, k, v) => set('medications', d.medications.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
  const saveSummary = () => run(() => put(`/ipd/admissions/${a._id}/discharge-summary`, { ...d, medications: d.medications.filter((m) => m.name?.trim()) }), 'Discharge summary saved');
  const b = bill.data;
  const paid = pay.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const finalize = async () => {
    await saveSummary();
    const r = await run(() => post(`/ipd/admissions/${a._id}/discharge`, { useAdvance, discountPct: Number(discountPct) || 0, insurerShare: insured && Number(insurerShare) > 0 ? Number(insurerShare) : undefined, payments: pay.filter((p) => Number(p.amount) > 0).map((p) => ({ mode: p.mode, amount: Number(p.amount) })) }).then((x) => x.admission), 'Patient discharged');
    setDone(r?.invoice);
  };
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <Card className="space-y-3 p-4">
        <p className="font-semibold">Discharge summary</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Discharge type"><Select disabled={closed} value={d.type} onChange={(e) => set('type', e.target.value)}>{[['normal', 'Normal / on advice'], ['lama', 'LAMA (left against advice)'], ['dama', 'DAMA'], ['referred', 'Referred'], ['death', 'Death'], ['absconded', 'Absconded']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="Final diagnosis"><Input disabled={closed} value={d.finalDiagnosis} onChange={(e) => set('finalDiagnosis', e.target.value)} /></Field>
          <Field label="Procedure(s) done" className="sm:col-span-2"><Textarea disabled={closed} rows={2} value={d.procedureDone} onChange={(e) => set('procedureDone', e.target.value)} /></Field>
          <Field label="Course in hospital" className="sm:col-span-2"><Textarea disabled={closed} rows={3} value={d.courseInHospital} onChange={(e) => set('courseInHospital', e.target.value)} /></Field>
          <Field label="Investigations"><Textarea disabled={closed} rows={2} value={d.investigations} onChange={(e) => set('investigations', e.target.value)} /></Field>
          <Field label="Condition at discharge"><Textarea disabled={closed} rows={2} value={d.conditionAtDischarge} onChange={(e) => set('conditionAtDischarge', e.target.value)} /></Field>
        </div>
        <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase text-muted-foreground">Medicines on discharge</p>
          {!closed && <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => set('medications', [...d.medications, ...(a.medications || []).filter((m) => m.active && m.route === 'oral').map((m) => ({ name: m.name, dose: m.dose || '', frequency: m.frequency || '', duration: '7 days', instructions: m.instructions || '' }))])}><Copy /> From active oral meds</Button><Button size="sm" variant="outline" onClick={() => set('medications', [...d.medications, { name: '', dose: '', frequency: '', duration: '', instructions: '' }])}><Plus /> Add</Button></div>}
        </div>
        {d.medications.map((m, i) => (
          <div key={i} className="grid grid-cols-12 gap-1.5">
            <Input disabled={closed} className="col-span-4 h-8" placeholder="Medicine" value={m.name} onChange={(e) => setMed(i, 'name', e.target.value)} />
            <Input disabled={closed} className="col-span-2 h-8" placeholder="Dose" value={m.dose || ''} onChange={(e) => setMed(i, 'dose', e.target.value)} />
            <Input disabled={closed} className="col-span-2 h-8" placeholder="Frequency" value={m.frequency || ''} onChange={(e) => setMed(i, 'frequency', e.target.value)} />
            <Input disabled={closed} className="col-span-1 h-8" placeholder="Days" value={m.duration || ''} onChange={(e) => setMed(i, 'duration', e.target.value)} />
            <Input disabled={closed} className="col-span-2 h-8" placeholder="Instructions" value={m.instructions || ''} onChange={(e) => setMed(i, 'instructions', e.target.value)} />
            {!closed && <button type="button" className="col-span-1 text-muted-foreground hover:text-destructive" onClick={() => set('medications', d.medications.filter((_, j) => j !== i))}><Trash2 className="mx-auto h-4 w-4" /></button>}
          </div>
        ))}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Advice" className="sm:col-span-2"><Textarea disabled={closed} rows={2} value={d.advice} onChange={(e) => set('advice', e.target.value)} /></Field>
          <Field label="Diet"><Input disabled={closed} value={d.diet} onChange={(e) => set('diet', e.target.value)} /></Field>
          <Field label="Referred to"><Input disabled={closed} value={d.referredTo} onChange={(e) => set('referredTo', e.target.value)} /></Field>
          <Field label="Follow-up date" hint="Creates a follow-up task on discharge"><Input disabled={closed} type="date" value={d.followUpDate} onChange={(e) => set('followUpDate', e.target.value)} /></Field>
          <Field label="Follow-up note"><Input disabled={closed} value={d.followUpNote} onChange={(e) => set('followUpNote', e.target.value)} /></Field>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => openFile(`/ipd/admissions/${a._id}/pdf/discharge`).catch((e) => toast.error(errMsg(e)))}><Printer /> Preview PDF</Button>
          {!closed && <Button variant="outline" onClick={saveSummary}>Save summary</Button>}
        </div>
      </Card>

      <Card className="h-fit space-y-3 p-4">
        <p className="flex items-center gap-2 font-semibold"><LogOut className="h-4 w-4" /> {closed ? 'Discharged' : 'Final bill & discharge'}</p>
        {closed ? (
          <div className="space-y-2 text-sm">
            <p>Discharged {fmtDateTime(a.dischargedAt)}</p>
            {a.invoice ? <Button asChild className="w-full"><Link to={`/billing/${a.invoice._id}`}><Receipt /> Open bill {a.invoice.invoiceNo}</Link></Button> : <p className="text-muted-foreground">No bill (no charges).</p>}
            {a.invoice?.balance > 0 && <p className="text-destructive">Balance due {inr(a.invoice.balance)} — collect from the bill page{a.claim ? ' or settle the insurance claim' : ''}.</p>}
            {a.status === 'discharged' && <Button size="sm" variant="outline" className="w-full" onClick={() => post(`/ipd/admissions/${a._id}/send/discharge`).then(() => toast.success('Discharge summary queued on WhatsApp')).catch((e) => toast.error(errMsg(e)))}><Send /> Send summary on WhatsApp</Button>}
            {done && <p className="rounded bg-emerald-50 p-2 text-emerald-800">Bill {done.invoiceNo} created · {inr(done.grandTotal)}</p>}
          </div>
        ) : (
          <>
            {b && <><Row l="Total charges" v={inr(b.total)} bold /><Row l="Advance on file" v={inr(b.advance)} />{b.approved > 0 && <Row l="Insurance approved" v={inr(b.approved)} />}</>}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useAdvance} onChange={(e) => setUseAdvance(e.target.checked)} /> Adjust advance deposit</label>
            <Field label="Discount % (room, procedures — not pharmacy)"><Input type="number" min="0" max="100" value={discountPct} onChange={(e) => setDiscount(e.target.value)} /></Field>
            {insured && <Field label={`${PAYERS[a.payer.type]} share (₹)`} hint="Left as balance on the bill; claim is created / updated for this amount"><Input type="number" min="0" value={insurerShare} onChange={(e) => setInsurerShare(e.target.value)} /></Field>}
            <p className="text-xs font-semibold uppercase text-muted-foreground">Collect now (patient share)</p>
            {pay.map((p, i) => (
              <div key={i} className="flex gap-1.5">
                <Select className="w-24" value={p.mode} onChange={(e) => setPay(pay.map((x, j) => (j === i ? { ...x, mode: e.target.value } : x)))}>{['upi', 'cash', 'card', 'bank'].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}</Select>
                <Input type="number" min="0" placeholder="Amount" value={p.amount} onChange={(e) => setPay(pay.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                {i > 0 && <Button size="icon" variant="ghost" onClick={() => setPay(pay.filter((_, j) => j !== i))}><Trash2 /></Button>}
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setPay([...pay, { mode: 'cash', amount: '' }])}><Plus /> Split payment</Button>
            {b && <p className="text-xs text-muted-foreground">Approx. patient payable: {inr(Math.max(0, b.total * (1 - (Number(discountPct) || 0) / 100) - (useAdvance ? b.advance : 0) - (insured ? Number(insurerShare) || 0 : 0)))} · collecting {inr(paid)}. Any balance stays due on the bill (insurance / later).</p>}
            <Button className="w-full" onClick={finalize}><LogOut /> Discharge & generate bill</Button>
            <p className="text-[11px] text-muted-foreground">Frees the bed (→ cleaning), creates the IPD invoice, schedules the follow-up and sends the discharge summary on WhatsApp.</p>
          </>
        )}
      </Card>
    </div>
  );
}

// ================================================================ page
export default function AdmissionPage() {
  const { id } = useParams();
  const can = useCan();
  const { data: a, isLoading, error, bill, run } = useAdm(id);
  const [transfer, setTransfer] = useState(false);
  const [printDlg, setPrintDlg] = useState(null);
  const [cancel, setCancel] = useState(false);
  const { data: freeBeds = [] } = useQuery({ queryKey: ['ipd-free-beds', a?.branch?._id, transfer], enabled: transfer && !!a, queryFn: () => get('/ipd/beds', { branch: a.branch._id, status: 'available' }) });
  const [toBed, setToBed] = useState('');
  const [reason, setReason] = useState('');
  const counts = useMemo(() => a && { vitals: a.vitals?.length || 0, notes: a.notes?.length || 0, meds: (a.medications || []).filter((m) => m.active).length, proc: a.procedures?.length || 0 }, [a]);

  if (isLoading) return <Skeleton className="h-96" />;
  if (error) return <p className="text-destructive">{errMsg(error)}</p>;
  const closed = ['discharged', 'cancelled'].includes(a.status) || !can('ipd.edit');
  const p = a.patient || {};
  const [label, tone] = ADM_STATUS[a.status];

  return (
    <div className="space-y-4">
      <Link to="/ipd" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Bed board</Link>
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{p.name}</h1><Badge variant={tone}>{label}</Badge>{a.type !== 'planned' && <Badge variant={a.type === 'emergency' ? 'danger' : 'info'}>{a.type.replace('_', ' ')}</Badge>}{a.payer?.type !== 'self' && <Badge variant="outline">{PAYERS[a.payer.type]}</Badge>}</div>
            <p className="text-sm text-muted-foreground">{[p.patientId, [ageOf(p) && `${ageOf(p)}y`, p.gender].filter(Boolean).join(' / '), p.mobile].filter(Boolean).join(' · ')}{p.bloodGroup ? ` · ${p.bloodGroup}` : ''}{(a.allergies || p.allergies?.length) ? <span className="text-destructive"> · Allergy: {a.allergies || p.allergies.join(', ')}</span> : null}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm">
              <span className="font-mono text-xs">{a.admissionNo}</span>
              <span className="flex items-center gap-1"><BedDouble className="h-4 w-4 text-muted-foreground" />{a.ward?.name} · Bed {a.bed?.number}</span>
              <span className="flex items-center gap-1"><Stethoscope className="h-4 w-4 text-muted-foreground" />{a.doctor?.name}</span>
              <span className="flex items-center gap-1"><Clock className="h-4 w-4 text-muted-foreground" />{fmtDateTime(a.admittedAt)} · {stayLabel(a.admittedAt, a.dischargedAt)}</span>
              {a.attendant?.phone && <a href={`tel:${a.attendant.phone}`} className="flex items-center gap-1 text-primary"><Phone className="h-4 w-4" />{a.attendant.name || 'Attendant'} ({a.attendant.relation || '—'})</a>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => openFile(`/ipd/admissions/${a._id}/pdf/admission`).catch((e) => toast.error(errMsg(e)))}><FileText /> Admission sheet</Button>
            <Button variant="outline" size="sm" onClick={() => setPrintDlg('pass')}><IdCard /> Attendant pass</Button>
            <Button variant="outline" size="sm" onClick={() => setPrintDlg('stickers')}><Tags /> Stickers</Button>
            <Button variant="outline" size="sm" onClick={() => openFile(`/ipd/admissions/${a._id}/pdf/discharge`).catch((e) => toast.error(errMsg(e)))}><Printer /> Discharge summary</Button>
            {!closed && <Button variant="outline" size="sm" onClick={() => { setToBed(''); setReason(''); setTransfer(true); }}><ArrowRightLeft /> Transfer bed</Button>}
            {!closed && can('ipd.delete') && !a.charges?.length && <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setCancel(true)}><XCircle /> Cancel</Button>}
          </div>
        </div>
      </Card>

      <AttendantPassDialog open={printDlg === 'pass'} onOpenChange={(o) => !o && setPrintDlg(null)} admission={a} />
      <StickersDialog open={printDlg === 'stickers'} onOpenChange={(o) => !o && setPrintDlg(null)} admission={a} />
      <Tabs defaultValue={a.status === 'discharge_initiated' ? 'discharge' : 'overview'}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="proc"><Syringe className="h-3.5 w-3.5" /> Procedure / OT ({counts.proc})</TabsTrigger>
          <TabsTrigger value="vitals"><Activity className="h-3.5 w-3.5" /> Vitals ({counts.vitals})</TabsTrigger>
          <TabsTrigger value="notes"><NotebookPen className="h-3.5 w-3.5" /> Notes ({counts.notes})</TabsTrigger>
          <TabsTrigger value="meds"><Pill className="h-3.5 w-3.5" /> Medications ({counts.meds})</TabsTrigger>
          <TabsTrigger value="lab"><FlaskConical className="h-3.5 w-3.5" /> Lab ({a.investigations?.length || 0})</TabsTrigger>
          <TabsTrigger value="charges"><Receipt className="h-3.5 w-3.5" /> Charges {bill.data ? `· ${inr(bill.data.total)}` : ''}</TabsTrigger>
          <TabsTrigger value="discharge"><LogOut className="h-3.5 w-3.5" /> Discharge</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><Overview a={a} run={run} closed={closed} /></TabsContent>
        <TabsContent value="proc"><Procedures a={a} run={run} closed={closed} /></TabsContent>
        <TabsContent value="vitals"><Vitals a={a} run={run} closed={closed} /></TabsContent>
        <TabsContent value="notes"><Notes a={a} run={run} closed={closed} /></TabsContent>
        <TabsContent value="meds"><Meds a={a} run={run} closed={closed} /></TabsContent>
        <TabsContent value="lab"><LabTab a={a} run={run} closed={closed} /></TabsContent>
        <TabsContent value="charges"><Charges a={a} bill={bill} run={run} closed={closed} /></TabsContent>
        <TabsContent value="discharge"><Discharge a={a} bill={bill} run={run} closed={closed} /></TabsContent>
      </Tabs>

      <Dialog open={transfer} onOpenChange={setTransfer}>
        <DialogContent title="Transfer to another bed">
          <div className="space-y-3">
            <Field label="New bed"><Select value={toBed} onChange={(e) => setToBed(e.target.value)} placeholder={freeBeds.length ? 'Select free bed' : 'No free bed'}>{freeBeds.map((b) => <option key={b._id} value={b._id}>{b.number} · {b.ward?.name} · {inr(b.ward?.dailyRate)}/day</option>)}</Select></Field>
            <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Upgraded to private room on request" /></Field>
            <p className="text-xs text-muted-foreground">Room rent switches to the new ward's rate from now. The old bed goes to “cleaning”.</p>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setTransfer(false)}>Cancel</Button><Button disabled={!toBed} onClick={() => run(() => post(`/ipd/admissions/${a._id}/transfer`, { bed: toBed, reason: reason || undefined }), 'Bed transferred').then(() => setTransfer(false))}>Transfer</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={cancel} onOpenChange={setCancel} title="Cancel admission?" description="Use only for wrong entries. The bed is freed immediately." destructive reason confirmText="Cancel admission"
        onConfirm={(r) => run(() => post(`/ipd/admissions/${a._id}/cancel`, { reason: r }), 'Admission cancelled').then(() => setCancel(false))} />
    </div>
  );
}
