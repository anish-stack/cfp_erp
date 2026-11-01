import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, UserRound, Receipt, CalendarClock, XCircle, CheckCircle2, LogIn, Stethoscope, Ban, MessageCircle, Printer, Phone,
  AlertTriangle, Pill, FileText, Upload, History, ClipboardList,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DataTable } from '@/components/common/DataTable';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Can } from '@/components/common/Can';
import { PrescriptionComposer } from '@/components/clinic/PrescriptionComposer';
import { PrescriptionList } from '@/components/clinic/PrescriptionList';
import { CallButton } from '@/components/clinic/Calling';
import { RecordForm } from '@/pages/patients/ClinicalForms';
import { BookDialog } from './BookDialog';
import { AdmitDialog } from '@/components/ipd/AdmitDialog';
import { BedDouble, Tags } from 'lucide-react';
import { StickersDialog } from '@/components/print/PrintDialogs';
import { useGet, useAction } from '@/hooks/queries';
import { api, post, patch, openFile } from '@/lib/api';
import { useCan, useFeature } from '@/store/auth';
import { fmtDate, fmtTime, fmtDateTime, ageOf, inr, titleCase } from '@/lib/utils';

const STEPS = ['booked', 'confirmed', 'checked_in', 'in_consultation', 'completed'];

function StatusTrack({ status }) {
  const idx = STEPS.indexOf(status);
  if (idx < 0) return <StatusBadge status={status} />;
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${i <= idx ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{titleCase(s)}</span>
          {i < STEPS.length - 1 && <span className={`h-px w-3 ${i < idx ? 'bg-primary' : 'bg-border'}`} />}
        </div>
      ))}
    </div>
  );
}

function DocumentsTab({ patient, branch }) {
  const fileRef = useRef();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('report');
  const docs = useGet(['docs', patient._id], '/clinical/documents', { patient: patient._id });
  const upload = useAction(async () => {
    const f = fileRef.current?.files?.[0];
    if (!f) throw new Error('Choose a file');
    const fd = new FormData();
    fd.append('file', f);
    fd.append('patient', patient._id);
    fd.append('title', title || f.name);
    fd.append('category', category);
    if (branch) fd.append('branch', branch);
    return api.post('/clinical/documents', fd).then((r) => r.data.data);
  }, { success: 'Uploaded', invalidate: ['docs'], onSuccess: () => { setTitle(''); if (fileRef.current) fileRef.current.value = ''; } });
  return (
    <div className="space-y-3">
      <Can perm="medical_records.create">
        <Card className="grid gap-2 p-3 sm:grid-cols-4">
          <Input placeholder="Title (e.g. MRI report)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>{['report', 'scan', 'prescription', 'consent', 'invoice', 'other'].map((c) => <option key={c}>{c}</option>)}</Select>
          <Input type="file" ref={fileRef} accept=".pdf,image/*" capture="environment" />
          <Button loading={upload.isPending} onClick={() => upload.mutate()}><Upload /> Upload</Button>
        </Card>
      </Can>
      <DataTable rows={docs.data} loading={docs.isLoading} columns={[
        { key: 't', header: 'Title', cell: (d) => <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" />{d.title}</span> },
        { key: 'c', header: 'Category', cell: (d) => <Badge variant="outline">{d.category}</Badge> },
        { key: 'by', header: 'Uploaded', cell: (d) => `${fmtDate(d.createdAt)} · ${d.uploadedBy?.name || ''}` },
        { key: 'o', header: '', cell: (d) => <Button size="sm" variant="ghost" onClick={() => openFile(`/clinical/documents/${d._id}/file`)}>Open</Button> },
      ]} />
    </div>
  );
}

export default function AppointmentPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const can = useCan();
  const { data: a, isLoading } = useGet(['/appointments', id], `/appointments/${id}`);
  const pid = a?.patient?._id;
  const medical = can('medical_records.view');
  const rx = useGet(['rx', id], '/clinical/prescriptions', { patient: pid, appointment: id }, { enabled: !!pid && medical });
  const records = useGet(['records', id], '/clinical/records', { patient: pid, appointment: id }, { enabled: !!pid && medical });
  const timeline = useGet(['timeline', pid], `/clinical/timeline/${pid}`, undefined, { enabled: !!pid });
  const [cancel, setCancel] = useState(false);
  const [stickers, setStickers] = useState(false);
  const [resched, setResched] = useState(false);
  const [admit, setAdmit] = useState(false);
  const feat = useFeature();
  const [notes, setNotes] = useState(null);
  const [tab, setTab] = useState('rx');
  const inv = ['/appointments', 'dashboard', 'availability'];
  const status = useAction((s) => patch(`/appointments/${id}/status`, { status: s }), { success: 'Updated', invalidate: inv });
  const doCancel = useAction((reason) => post(`/appointments/${id}/cancel`, { reason }), { success: 'Cancelled', invalidate: inv, onSuccess: () => setCancel(false) });
  const resend = useAction(() => post(`/appointments/${id}/notify`), { success: (r) => `WhatsApp queued (${r.event.replace('_', ' ')})` });
  const saveNotes = useAction(() => patch(`/appointments/${id}/notes`, { notes }), { success: 'Notes saved', invalidate: ['/appointments'], onSuccess: () => setNotes(null) });

  if (isLoading || !a) return <div className="space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-96 w-full" /></div>;
  const p = a.patient;
  const act = (s, label, Icon, variant = 'outline') => <Button size="sm" variant={variant} loading={status.isPending && status.variables === s} onClick={() => status.mutate(s)}><Icon /> {label}</Button>;
  const canConsult = ['checked_in', 'in_consultation', 'completed'].includes(a.status) || a.date <= new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const history = (timeline.data?.appointments || []).filter((x) => x._id !== a._id);

  return (
    <div className="space-y-4">
      <StickersDialog open={stickers} onOpenChange={setStickers} appointment={a} />
      <button onClick={() => nav('/appointments')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Appointments</button>
      <PageHeader
        title={`${p?.name} · ${fmtTime(a.start)}`}
        description={`${a.bookingId} · ${fmtDate(a.date)} · ${a.doctor?.name} · ${a.branch?.name}`}
        actions={<>
          <Button variant="outline" onClick={() => openFile(`/appointments/${id}/slip`)}><Printer /> Slip</Button>
          <Button variant="outline" onClick={() => setStickers(true)}><Tags /> Stickers</Button>
          {can('appointments.edit') && <Button variant="outline" loading={resend.isPending} onClick={() => resend.mutate()}><MessageCircle /> WhatsApp</Button>}
          {feat('ipd') && can('ipd.create') && ['checked_in', 'in_consultation', 'completed'].includes(a.status) && <Button variant="outline" onClick={() => setAdmit(true)}><BedDouble /> Admit (IPD)</Button>}
          {!a.invoice && can('billing.create') && <Button onClick={() => nav(`/billing/new?appointment=${a._id}`)}><Receipt /> Bill</Button>}
          {a.invoice && <Button variant="outline" onClick={() => nav(`/billing/${a.invoice._id}`)}><Receipt /> {a.invoice.invoiceNo}</Button>}
        </>}
      >
        <div className="mt-2 flex flex-wrap items-center gap-2"><StatusTrack status={a.status} /><Badge variant="outline">{a.type}</Badge><Badge variant="outline">{a.visitType}</Badge>{a.tokenNo && <Badge variant="warning">Token {a.tokenNo}</Badge>}</div>
      </PageHeader>

      {can('appointments.edit') && (
        <div className="flex flex-wrap gap-2">
          {a.status === 'booked' && act('confirmed', 'Confirm', CheckCircle2)}
          {['booked', 'confirmed'].includes(a.status) && act('checked_in', 'Check in', LogIn, 'default')}
          {a.status === 'checked_in' && act('in_consultation', 'Start consultation', Stethoscope, 'default')}
          {['checked_in', 'in_consultation'].includes(a.status) && act('completed', 'Complete visit', CheckCircle2, 'default')}
          {['booked', 'confirmed', 'checked_in'].includes(a.status) && act('no_show', 'No-show', Ban)}
          {['booked', 'confirmed'].includes(a.status) && <Button size="sm" variant="outline" onClick={() => setResched(true)}><CalendarClock /> Reschedule</Button>}
          {['booked', 'confirmed', 'checked_in', 'in_consultation'].includes(a.status) && <Button size="sm" variant="outline" className="text-destructive" onClick={() => setCancel(true)}><XCircle /> Cancel</Button>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-4">
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-2 pt-4 text-sm">
              <div className="flex items-center justify-between">
                <p className="text-base font-semibold">{p?.name}</p>
                <Button size="sm" variant="ghost" onClick={() => nav(`/patients/${p._id}`)}><UserRound /> Profile</Button>
              </div>
              <p className="text-muted-foreground">{p?.patientId} · {[p?.gender, ageOf(p) && `${ageOf(p)} y`].filter(Boolean).join(' · ')}</p>
              <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /> {p?.mobile} <CallButton patient={p} label="" size="icon" variant="ghost" className="h-7 w-7" /></div>
              {p?.allergies?.length > 0 && <p className="flex items-center gap-1.5 text-red-600"><AlertTriangle className="h-4 w-4" /> {p.allergies.join(', ')}</p>}
              {a.complaint && <div className="rounded-md bg-muted p-2"><p className="text-xs font-semibold uppercase text-muted-foreground">Complaint</p><p>{a.complaint}</p></div>}
              <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
                <p>Booked {fmtDateTime(a.createdAt)}{a.createdBy ? ` by ${a.createdBy.name}` : ' online'}</p>
                {a.checkedInAt && <p>Checked in {fmtDateTime(a.checkedInAt)}</p>}
                {a.cancelReason && <p className="text-red-600">Cancelled: {a.cancelReason}</p>}
              </div>
            </CardContent>
          </Card>
          {can('appointments.edit') && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Internal notes</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <Textarea rows={3} value={notes ?? a.notes ?? ''} onChange={(e) => setNotes(e.target.value)} />
                {notes !== null && <Button size="sm" loading={saveNotes.isPending} onClick={() => saveNotes.mutate()}>Save</Button>}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="lg:col-span-3">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              {medical && <TabsTrigger value="rx"><Pill className="h-4 w-4" /> Prescription ({rx.data?.length ?? 0})</TabsTrigger>}
              {medical && <TabsTrigger value="notes"><ClipboardList className="h-4 w-4" /> Clinical notes ({records.data?.length ?? 0})</TabsTrigger>}
              {medical && <TabsTrigger value="docs"><FileText className="h-4 w-4" /> Reports & images</TabsTrigger>}
              <TabsTrigger value="history"><History className="h-4 w-4" /> History ({history.length})</TabsTrigger>
            </TabsList>

            {medical && (
              <TabsContent value="rx" className="space-y-4">
                {can('medical_records.create') && !['cancelled', 'no_show', 'rescheduled'].includes(a.status) && (
                  <Card className="p-4">
                    {!canConsult && <p className="mb-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800">This appointment is in the future — you can still write the prescription now.</p>}
                    <PrescriptionComposer patient={p} branch={a.branch?._id} appointment={a._id} defaultDoctor={a.doctor?._id} defaultComplaint={a.complaint} onSaved={() => { rx.refetch(); timeline.refetch(); }} />
                  </Card>
                )}
                <PrescriptionList items={rx.data} loading={rx.isLoading} />
              </TabsContent>
            )}

            {medical && (
              <TabsContent value="notes" className="space-y-4">
                <Can perm="medical_records.create"><Card className="p-4"><RecordForm patient={p} branch={a.branch?._id} appointmentId={a._id} onDone={() => records.refetch()} /></Card></Can>
                {(records.data || []).map((r) => (
                  <Card key={r._id} className="p-3 text-sm">
                    <p className="font-medium">{r.diagnosis || titleCase(r.type)} <span className="text-xs font-normal text-muted-foreground">· {fmtDateTime(r.createdAt)} · {r.doctor?.name || r.createdBy?.name}</span></p>
                    {r.complaints && <p><b>C/O:</b> {r.complaints}</p>}
                    {r.examination && <p><b>O/E:</b> {r.examination}</p>}
                    {r.plan && <p><b>Plan:</b> {r.plan}</p>}
                  </Card>
                ))}
              </TabsContent>
            )}

            {medical && <TabsContent value="docs"><DocumentsTab patient={p} branch={a.branch?._id} /></TabsContent>}

            <TabsContent value="history" className="space-y-4">
              <DataTable rows={history} loading={timeline.isLoading} onRowClick={(x) => nav(`/appointments/${x._id}`)} columns={[
                { key: 'd', header: 'Date', cell: (x) => `${fmtDate(x.date)} ${fmtTime(x.start)}` },
                { key: 'b', header: 'Branch', cell: (x) => x.branch?.code },
                { key: 'doc', header: 'Doctor', cell: (x) => x.doctor?.name },
                { key: 's', header: 'Status', cell: (x) => <StatusBadge status={x.status} /> },
              ]} />
              {timeline.data?.invoices?.length > 0 && (
                <DataTable rows={timeline.data.invoices} onRowClick={(i) => nav(`/billing/${i._id}`)} columns={[
                  { key: 'no', header: 'Invoice', cell: (i) => <span className="font-mono text-xs">{i.invoiceNo}</span> },
                  { key: 'd', header: 'Date', cell: (i) => fmtDate(i.createdAt) },
                  { key: 'g', header: 'Total', cell: (i) => inr(i.grandTotal) },
                  { key: 'b', header: 'Balance', cell: (i) => inr(i.balance) },
                  { key: 's', header: 'Status', cell: (i) => <StatusBadge status={i.status} /> },
                ]} />
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <ConfirmDialog open={cancel} onOpenChange={setCancel} title="Cancel appointment" reason destructive confirmText="Cancel appointment" loading={doCancel.isPending} onConfirm={(r) => doCancel.mutate(r)} />
      <BookDialog open={resched} onOpenChange={setResched} mode="reschedule" appointment={a} onDone={(n) => nav(`/appointments/${n._id}`)} />
      <AdmitDialog open={admit} onOpenChange={setAdmit} patient={a.patient} appointment={a._id} branch={a.branch?._id || a.branch} doctor={a.doctor?._id || a.doctor} />
    </div>
  );
}
