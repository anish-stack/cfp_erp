import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Phone, MessageCircle, StickyNote, UserRoundCheck, ListPlus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/common/Field';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { PatientPicker } from '@/components/clinic/PatientPicker';
import { CallButton, RecordingPlayer, fmtDuration } from '@/components/clinic/Calling';
import { SlotPicker } from '@/components/clinic/SlotPicker';
import { useGet, useAction, useStages, useStaffList, useDoctors } from '@/hooks/queries';
import { post, patch, del } from '@/lib/api';
import { useCan } from '@/store/auth';
import { fmtDateTime, titleCase, todayIST, addDays } from '@/lib/utils';

const toLocal = (d) => (d ? new Date(new Date(d).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const ICON = { call: Phone, whatsapp: MessageCircle, note: StickyNote };

function ConvertDialog({ lead, onDone }) {
  const [patient, setPatient] = useState(null);
  const [mode, setMode] = useState('new');
  const [np, setNp] = useState({ name: lead.name, gender: 'male', ageYears: '', registeredBranch: lead.branch?._id || '' });
  const [book, setBook] = useState(true);
  const [branch, setBranch] = useState(lead.branch?._id || '');
  const [doctor, setDoctor] = useState('any');
  const [date, setDate] = useState(addDays(todayIST(), 1));
  const [slot, setSlot] = useState(null);
  const { data: branches = [] } = useGet(['branch-names'], '/branches/names');
  const { data: doctors = [] } = useDoctors(branch);
  const can = useCan();
  const go = useAction(() => post(`/crm/leads/${lead._id}/convert`, {
    patient: mode === 'existing' ? patient?._id : undefined,
    newPatient: mode === 'new' ? { name: np.name, gender: np.gender, ageYears: np.ageYears ? Number(np.ageYears) : undefined, registeredBranch: np.registeredBranch } : undefined,
    appointment: book && slot ? { branch, doctor: slot.doctor, date, start: slot.start } : undefined,
  }), { success: (r) => `Converted · ${r.patient.patientId}${r.appointment ? ` · ${r.appointment.bookingId}` : ''}`, invalidate: ['/crm/leads'], onSuccess: onDone });
  const ok = (mode === 'existing' ? patient : np.name && np.registeredBranch) && (!book || slot);
  return (
    <div className="space-y-4">
      <div className="flex gap-2"><Button size="sm" variant={mode === 'new' ? 'default' : 'outline'} onClick={() => setMode('new')}>New patient</Button><Button size="sm" variant={mode === 'existing' ? 'default' : 'outline'} onClick={() => setMode('existing')}>Existing patient</Button></div>
      {mode === 'existing' ? <PatientPicker value={patient} onChange={setPatient} allowCreate={false} /> : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} /></Field>
          <Field label="Mobile"><Input value={lead.phone} disabled /></Field>
          <Field label="Gender"><Select value={np.gender} onChange={(e) => setNp({ ...np, gender: e.target.value })}><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></Select></Field>
          <Field label="Age"><Input type="number" value={np.ageYears} onChange={(e) => setNp({ ...np, ageYears: e.target.value })} /></Field>
          <Field label="Branch" className="sm:col-span-2"><Select value={np.registeredBranch} onChange={(e) => { setNp({ ...np, registeredBranch: e.target.value }); setBranch(e.target.value); }} placeholder="Select">{branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</Select></Field>
        </div>
      )}
      {can('appointments.create') && (
        <div className="space-y-3 rounded-lg border p-3">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={book} onChange={(e) => setBook(e.target.checked)} /> Book appointment now</label>
          {book && <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Branch"><Select value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Select">{branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</Select></Field>
              <Field label="Doctor"><Select value={doctor} onChange={(e) => setDoctor(e.target.value)}><option value="any">Any</option>{doctors.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>
              <Field label="Date"><Input type="date" value={date} min={todayIST()} onChange={(e) => { setDate(e.target.value); setSlot(null); }} /></Field>
            </div>
            <SlotPicker branch={branch} date={date} doctor={doctor} value={slot} onChange={setSlot} />
          </>}
        </div>
      )}
      <div className="flex justify-end"><Button disabled={!ok} loading={go.isPending} onClick={() => go.mutate()}>Convert</Button></div>
    </div>
  );
}

export default function LeadDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const can = useCan();
  const { data, isLoading } = useGet(['/crm/leads', id], `/crm/leads/${id}`);
  const { data: stages = [] } = useStages();
  const { data: staff = [] } = useStaffList();
  const [act, setAct] = useState({ type: 'call', text: '', outcome: 'connected', durationSec: '', next: '' });
  const [lost, setLost] = useState(null);
  const [dlg, setDlg] = useState(null);
  const [task, setTask] = useState({ title: '', dueAt: '' });
  const inv = ['/crm/leads', 'crm-dash'];
  const update = useAction((body) => patch(`/crm/leads/${id}`, body), { success: 'Updated', invalidate: inv });
  const log = useAction(() => post(`/crm/leads/${id}/activities`, {
    type: act.type, text: act.text || undefined,
    call: act.type === 'call' ? { direction: 'outbound', outcome: act.outcome, durationSec: act.durationSec ? Number(act.durationSec) : undefined } : undefined,
    nextFollowUpAt: act.next ? new Date(act.next).toISOString() : undefined,
  }), { success: 'Logged', invalidate: inv, onSuccess: () => setAct({ ...act, text: '', durationSec: '', next: '' }) });
  const addTask = useAction(() => post('/crm/tasks', { title: task.title, lead: id, dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : undefined }), { success: 'Task added', invalidate: [...inv, '/crm/tasks'], onSuccess: () => setTask({ title: '', dueAt: '' }) });
  const remove = useAction(() => del(`/crm/leads/${id}`), { success: 'Lead removed', invalidate: inv, onSuccess: () => nav('/leads') });
  const calls = useGet(['/crm/calls', 'lead', id], '/crm/calls', { lead: id, limit: 50 }, { refetchInterval: 15_000 });

  if (isLoading || !data) return <Skeleton className="h-96 w-full" />;
  const { lead: l, activities, tasks, duplicate } = data;
  const setStage = (sid) => {
    const s = stages.find((x) => x._id === sid);
    if (s?.isLost) return setLost(sid);
    update.mutate({ stage: sid });
  };

  return (
    <div className="space-y-4">
      <PageHeader title={l.name} description={`${l.phone}${l.email ? ` · ${l.email}` : ''} · created ${fmtDateTime(l.createdAt)}${l.createdBy ? ` by ${l.createdBy.name}` : ''}`} actions={<>
        {can('leads.edit') ? <CallButton lead={l} size="default" onPlaced={() => setTimeout(() => calls.refetch(), 3000)} /> : <Button variant="outline" asChild><a href={`tel:${l.phone}`}><Phone /> Call</a></Button>}
        <Button variant="outline" asChild><a href={`https://wa.me/91${l.phone}`} target="_blank" rel="noreferrer"><MessageCircle /> WhatsApp</a></Button>
        {can('leads.edit') && !l.convertedPatient && <Button onClick={() => setDlg('convert')}><UserRoundCheck /> Convert</Button>}
        {can('leads.delete') && <Button variant="ghost" size="icon" onClick={() => setDlg('delete')}><Trash2 /></Button>}
      </>} />
      {duplicate && <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm">Possible duplicate of <a className="underline" href={`/leads/${duplicate._id}`}>{duplicate.name}</a> ({fmtDateTime(duplicate.createdAt)})</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 pt-4">
              <Field label="Stage">
                <Select value={l.stage?._id} disabled={!can('leads.edit')} onChange={(e) => setStage(e.target.value)}>{stages.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>
              </Field>
              {l.lostReason && <p className="text-sm text-red-600">Lost: {l.lostReason}</p>}
              <Field label="Owner">
                <Select value={l.assignedTo?._id || ''} disabled={!can('leads.assign')} onChange={(e) => update.mutate({ assignedTo: e.target.value || null })} placeholder="Unassigned">{staff.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}</Select>
              </Field>
              <Field label="Next follow-up">
                <Input type="datetime-local" defaultValue={toLocal(l.nextFollowUpAt)} disabled={!can('leads.edit')} onBlur={(e) => e.target.value && e.target.value !== toLocal(l.nextFollowUpAt) && update.mutate({ nextFollowUpAt: new Date(e.target.value).toISOString() })} />
              </Field>
              <Field label="Priority">
                <Select value={l.priority} disabled={!can('leads.edit')} onChange={(e) => update.mutate({ priority: e.target.value })}>{['low', 'medium', 'high'].map((p) => <option key={p}>{p}</option>)}</Select>
              </Field>
              <div className="space-y-1 border-t pt-3 text-sm">
                <p><span className="text-muted-foreground">Condition:</span> {l.condition || '—'}</p>
                <p><span className="text-muted-foreground">City:</span> {l.city || '—'}</p>
                <p><span className="text-muted-foreground">Branch:</span> {l.branch?.name || '—'}</p>
                <p><span className="text-muted-foreground">Source:</span> {titleCase(l.source)}{l.sourceDetail ? ` · ${l.sourceDetail}` : ''}</p>
                {l.campaign && <p><span className="text-muted-foreground">Campaign:</span> {l.campaign.name}</p>}
                {l.utm?.source && <p className="text-xs text-muted-foreground">UTM: {[l.utm.source, l.utm.medium, l.utm.campaign].filter(Boolean).join(' / ')}</p>}
                {l.form && <p><span className="text-muted-foreground">Form:</span> {l.form.name}</p>}
                <p><span className="text-muted-foreground">Calls:</span> {l.callCount}</p>
                {l.convertedPatient && <p className="pt-1"><Badge variant="success">Converted</Badge> <button className="text-primary underline" onClick={() => nav(`/patients/${l.convertedPatient._id}`)}>{l.convertedPatient.patientId}</button></p>}
                {l.appointment && <p><span className="text-muted-foreground">Appointment:</span> {l.appointment.bookingId} · <StatusBadge status={l.appointment.status} /></p>}
              </div>
              {l.formData && (
                <div className="border-t pt-3 text-sm">
                  <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Form submission</p>
                  {Object.entries(l.formData).map(([k, v]) => <p key={k}><span className="text-muted-foreground">{k}:</span> {String(v)}</p>)}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Calls ({calls.data?.length ?? 0})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!calls.data?.length && <p className="text-sm text-muted-foreground">No calls yet</p>}
              {calls.data?.map((c) => (
                <div key={c._id} className="border-b pb-2 text-sm last:border-0">
                  <div className="flex items-center justify-between">
                    <span>{c.direction === 'inbound' ? '↙ Inbound' : '↗ Outbound'} · {fmtDuration(c.durationSec)}</span>
                    <StatusBadge status={c.status === 'completed' ? 'done' : c.status === 'no-answer' ? 'missed' : c.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">{fmtDateTime(c.startedAt || c.createdAt)} · {c.agent?.name || '—'}{c.ivrLabel ? ` · IVR ${c.ivrLabel}` : ''}</p>
                  {c.hasRecording && <div className="mt-1"><RecordingPlayer callId={c._id} compact /></div>}
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Tasks</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {tasks.map((t) => <div key={t._id} className="flex items-center justify-between text-sm"><span>{t.title}<span className="block text-xs text-muted-foreground">{t.dueAt ? fmtDateTime(t.dueAt) : 'No due'} · {t.assignedTo?.name}</span></span><StatusBadge status={t.status} /></div>)}
              {can('tasks.create') && (
                <div className="space-y-2 border-t pt-2">
                  <Input placeholder="New task" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} />
                  <div className="flex gap-2"><Input type="datetime-local" value={task.dueAt} onChange={(e) => setTask({ ...task, dueAt: e.target.value })} /><Button size="icon" disabled={task.title.length < 2} loading={addTask.isPending} onClick={() => addTask.mutate()}><ListPlus /></Button></div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Activity</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {can('leads.edit') && (
              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap gap-2">
                  {['call', 'whatsapp', 'note'].map((t) => { const I = ICON[t]; return <Button key={t} size="sm" variant={act.type === t ? 'default' : 'outline'} onClick={() => setAct({ ...act, type: t })}><I /> {titleCase(t)}</Button>; })}
                </div>
                {act.type === 'call' && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select value={act.outcome} onChange={(e) => setAct({ ...act, outcome: e.target.value })}>{['connected', 'no_answer', 'busy', 'switched_off', 'wrong_number', 'callback'].map((o) => <option key={o} value={o}>{titleCase(o)}</option>)}</Select>
                    <Input type="number" placeholder="Duration (sec)" value={act.durationSec} onChange={(e) => setAct({ ...act, durationSec: e.target.value })} />
                  </div>
                )}
                <Textarea rows={2} placeholder={act.type === 'note' ? 'Note…' : 'Summary…'} value={act.text} onChange={(e) => setAct({ ...act, text: e.target.value })} />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Next follow-up</span>
                  <Input type="datetime-local" className="w-auto" value={act.next} onChange={(e) => setAct({ ...act, next: e.target.value })} />
                  <Button className="ml-auto" size="sm" disabled={act.type === 'note' && !act.text} loading={log.isPending} onClick={() => log.mutate()}>Log</Button>
                </div>
              </div>
            )}
            <ol className="relative space-y-4 border-l pl-5">
              {activities.map((a) => {
                const I = ICON[a.type] || StickyNote;
                return (
                  <li key={a._id} className="relative">
                    <span className="absolute -left-[27px] top-0.5 grid h-5 w-5 place-items-center rounded-full border bg-card"><I className="h-3 w-3 text-muted-foreground" /></span>
                    <p className="text-sm">
                      <span className="font-medium">{titleCase(a.type)}</span>
                      {a.call?.outcome && <Badge variant="outline" className="ml-2">{titleCase(a.call.outcome)}{a.call.durationSec ? ` · ${Math.round(a.call.durationSec / 60)}m` : ''}</Badge>}
                    </p>
                    {a.text && <p className="text-sm text-foreground/80">{a.text}</p>}
                    <p className="text-xs text-muted-foreground">{fmtDateTime(a.createdAt)} · {a.by?.name || 'system'}</p>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dlg === 'convert'} onOpenChange={(o) => !o && setDlg(null)}><DialogContent title="Convert lead to patient" size="lg"><ConvertDialog lead={l} onDone={() => setDlg(null)} /></DialogContent></Dialog>
      <ConfirmDialog open={!!lost} onOpenChange={(o) => !o && setLost(null)} title="Mark as lost" reason reasonLabel="Lost reason" destructive confirmText="Mark lost" loading={update.isPending} onConfirm={(r) => update.mutate({ stage: lost, lostReason: r }, { onSuccess: () => setLost(null) })} />
      <ConfirmDialog open={dlg === 'delete'} onOpenChange={(o) => !o && setDlg(null)} title="Delete lead?" destructive confirmText="Delete" loading={remove.isPending} onConfirm={() => remove.mutate()} />
    </div>
  );
}
