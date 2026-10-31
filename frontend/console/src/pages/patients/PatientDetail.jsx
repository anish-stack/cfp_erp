import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CalendarPlus, FilePlus2, Pill, Upload, FileText, Printer, Receipt, Pencil, Phone, Mail, Droplet, AlertTriangle, BellPlus, MessageCircle } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input, Select } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { FormBuilder } from '@/components/common/FormBuilder';
import { Field } from '@/components/common/Field';
import { Can } from '@/components/common/Can';
import { BookDialog } from '@/pages/appointments/BookDialog';
import { RecordForm } from './ClinicalForms';
import { PrescriptionComposer } from '@/components/clinic/PrescriptionComposer';
import { PrescriptionList } from '@/components/clinic/PrescriptionList';
import { useGet, useAction } from '@/hooks/queries';
import { api, patch, post, openFile } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { fmtDate, fmtTime, fmtDateTime, ageOf, inr, todayIST, addDays } from '@/lib/utils';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

const EDIT_FIELDS = [
  { name: 'name', label: 'Name', required: true },
  { name: 'gender', label: 'Gender', type: 'select', required: true, options: ['male', 'female', 'other'] },
  { name: 'dob', label: 'Date of birth', type: 'date' },
  { name: 'ageYears', label: 'Age (years)', type: 'number' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'altPhone', label: 'Alternate phone', type: 'tel' },
  { name: 'bloodGroup', label: 'Blood group', type: 'select', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
  { name: 'allergies', label: 'Allergies (comma separated)' },
  { name: 'line1', label: 'Address', colSpan: 2 },
  { name: 'city', label: 'City' },
  { name: 'pincode', label: 'Pincode' },
];

export default function PatientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const branchId = useAuth((s) => s.branchId);
  const { data, isLoading } = useGet(['timeline', id], `/clinical/timeline/${id}`);
  const [dlg, setDlg] = useState(null);
  const fileRef = useRef();
  const [docTitle, setDocTitle] = useState('');
  const [docCat, setDocCat] = useState('report');
  const [fuDate, setFuDate] = useState(addDays(todayIST(), 7));
  const [fuReason, setFuReason] = useState('');

  const edit = useAction((v) => patch(`/patients/${id}`, {
    name: v.name, gender: v.gender, dob: v.dob || undefined, ageYears: v.ageYears, email: v.email, altPhone: v.altPhone, bloodGroup: v.bloodGroup,
    allergies: v.allergies ? v.allergies.split(',').map((s) => s.trim()).filter(Boolean) : [], address: { line1: v.line1, city: v.city, pincode: v.pincode },
  }), { success: 'Profile updated', invalidate: ['timeline', '/patients'], onSuccess: () => setDlg(null) });

  const upload = useAction(async () => {
    const f = fileRef.current?.files?.[0];
    if (!f) throw new Error('Choose a file');
    const fd = new FormData();
    fd.append('file', f);
    fd.append('patient', id);
    fd.append('title', docTitle || f.name);
    fd.append('category', docCat);
    if (branchId) fd.append('branch', branchId);
    return api.post('/clinical/documents', fd).then((r) => r.data.data);
  }, { success: 'Uploaded', invalidate: ['docs'], onSuccess: () => { setDlg(null); setDocTitle(''); } });

  const addFu = useAction(() => post('/clinical/followups', { patient: id, branch: branchId || data.patient.registeredBranch?._id, dueDate: fuDate, reason: fuReason || undefined }), { success: 'Follow-up added', invalidate: ['timeline'], onSuccess: () => setDlg(null) });

  const docs = useGet(['docs', id], '/clinical/documents', { patient: id }, { enabled: !!data?.access?.medical });
  const qc = useQueryClient();

  if (isLoading || !data) return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-80 w-full" /></div>;
  const { patient: p, appointments, records, prescriptions, followups, invoices, family, access } = data;

  return (
    <div className="space-y-4">
      <PageHeader
        title={p.name}
        description={`${p.patientId} · ${p.gender} · ${ageOf(p) ?? '—'} yrs · registered ${fmtDate(p.createdAt)} at ${p.registeredBranch?.name || '—'}`}
        actions={<>
          <Can perm="patients.edit"><Button variant="outline" onClick={() => setDlg('edit')}><Pencil /> Edit</Button></Can>
          <Can perm="appointments.create"><Button variant="outline" onClick={() => setDlg('book')}><CalendarPlus /> Book</Button></Can>
          <Can perm="billing.create"><Button onClick={() => nav(`/billing/new?patient=${p._id}`)}><Receipt /> Bill</Button></Can>
        </>}
      />
      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-1">
          <CardContent className="space-y-2 pt-4 text-sm">
            <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /> {p.mobile}{p.altPhone && ` / ${p.altPhone}`}</p>
            {p.email && <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /> {p.email}</p>}
            {p.bloodGroup && <p className="flex items-center gap-2"><Droplet className="h-4 w-4 text-muted-foreground" /> {p.bloodGroup}</p>}
            {p.allergies?.length > 0 && <p className="flex items-center gap-2 text-red-600"><AlertTriangle className="h-4 w-4" /> {p.allergies.join(', ')}</p>}
            {p.address?.city && <p className="text-muted-foreground">{[p.address.line1, p.address.city, p.address.pincode].filter(Boolean).join(', ')}</p>}
            <div className="flex flex-wrap gap-1 pt-1">{p.branchesVisited?.map((b) => <Badge key={b._id} variant="secondary">{b.code}</Badge>)}</div>
            {family.length > 0 && (
              <div className="border-t pt-2">
                <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Family on this mobile</p>
                {family.map((f) => <button key={f._id} className="block text-primary hover:underline" onClick={() => nav(`/patients/${f._id}`)}>{f.name} <span className="text-xs text-muted-foreground">({f.relation})</span></button>)}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-3">
          <Tabs defaultValue="visits">
            <TabsList>
              <TabsTrigger value="visits">Visits ({appointments.length})</TabsTrigger>
              {access.medical && <TabsTrigger value="records">Records ({records.length})</TabsTrigger>}
              {access.medical && <TabsTrigger value="rx">Prescriptions ({prescriptions.length})</TabsTrigger>}
              {access.medical && <TabsTrigger value="docs">Documents</TabsTrigger>}
              {access.billing && <TabsTrigger value="billing">Billing ({invoices.length})</TabsTrigger>}
              <TabsTrigger value="fu">Follow-ups ({followups.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="visits">
              <DataTable rows={appointments} onRowClick={(a) => nav(`/appointments/${a._id}`)} columns={[
                { key: 'd', header: 'Date', cell: (a) => `${fmtDate(a.date)} ${fmtTime(a.start)}` },
                { key: 'b', header: 'Branch', cell: (a) => a.branch?.code },
                { key: 'doc', header: 'Doctor', cell: (a) => a.doctor?.name },
                { key: 'v', header: 'Visit', cell: (a) => a.visitType },
                { key: 's', header: 'Status', cell: (a) => <StatusBadge status={a.status} /> },
              ]} />
            </TabsContent>

            {access.medical && (
              <TabsContent value="records" className="space-y-3">
                <Can perm="medical_records.create"><Button size="sm" onClick={() => setDlg('record')}><FilePlus2 /> Add record</Button></Can>
                {!records.length && <Card><EmptyState title="No medical records" /></Card>}
                {records.map((r) => (
                  <Card key={r._id}>
                    <CardHeader className="pb-1">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-sm"><Badge>{r.type}</Badge>{r.diagnosis || 'Clinical note'}<span className="ml-auto text-xs font-normal text-muted-foreground">{fmtDateTime(r.createdAt)} · {r.doctor?.name || r.createdBy?.name}</span></CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-1 text-sm sm:grid-cols-2">
                      {r.vitals && Object.values(r.vitals).some(Boolean) && <p className="sm:col-span-2 text-xs text-muted-foreground">Vitals: {Object.entries(r.vitals).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>}
                      {r.complaints && <p><b>C/O:</b> {r.complaints}</p>}
                      {r.history && <p><b>History:</b> {r.history}</p>}
                      {r.examination && <p><b>O/E:</b> {r.examination}</p>}
                      {r.procedure?.name && <p><b>Procedure:</b> {r.procedure.name} {r.procedure.anesthesia && `(${r.procedure.anesthesia})`}</p>}
                      {r.plan && <p className="sm:col-span-2"><b>Plan:</b> {r.plan}</p>}
                    </CardContent>
                  </Card>
                ))}
              </TabsContent>
            )}

            {access.medical && (
              <TabsContent value="rx" className="space-y-3">
                <Can perm="medical_records.create"><Button size="sm" onClick={() => setDlg('rx')}><Pill /> New prescription</Button></Can>
                <PrescriptionList items={prescriptions} />
              </TabsContent>
            )}

            {access.medical && (
              <TabsContent value="docs" className="space-y-3">
                <Can perm="medical_records.create"><Button size="sm" onClick={() => setDlg('upload')}><Upload /> Upload</Button></Can>
                <DataTable rows={docs.data} loading={docs.isLoading} columns={[
                  { key: 't', header: 'Title', cell: (d) => <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" />{d.title}</span> },
                  { key: 'c', header: 'Category', cell: (d) => <Badge variant="outline">{d.category}</Badge> },
                  { key: 'by', header: 'Uploaded', cell: (d) => `${fmtDate(d.createdAt)} · ${d.uploadedBy?.name || ''}` },
                  { key: 'o', header: '', cell: (d) => <Button size="sm" variant="ghost" onClick={() => openFile(`/clinical/documents/${d._id}/file`)}>Open</Button> },
                ]} />
              </TabsContent>
            )}

            {access.billing && (
              <TabsContent value="billing">
                <DataTable rows={invoices} onRowClick={(i) => nav(`/billing/${i._id}`)} columns={[
                  { key: 'no', header: 'Invoice', cell: (i) => <span className="font-mono text-xs">{i.invoiceNo}</span> },
                  { key: 'd', header: 'Date', cell: (i) => fmtDate(i.createdAt) },
                  { key: 't', header: 'Type', cell: (i) => i.type },
                  { key: 'g', header: 'Total', cell: (i) => inr(i.grandTotal) },
                  { key: 'b', header: 'Balance', cell: (i) => inr(i.balance) },
                  { key: 's', header: 'Status', cell: (i) => <StatusBadge status={i.status} /> },
                ]} />
              </TabsContent>
            )}

            <TabsContent value="fu" className="space-y-3">
              <Can perm="followups.create"><Button size="sm" onClick={() => setDlg('fu')}><BellPlus /> Add follow-up</Button></Can>
              <DataTable rows={followups} columns={[
                { key: 'd', header: 'Due', cell: (f) => fmtDate(f.dueDate) },
                { key: 'r', header: 'Reason', cell: (f) => f.reason || '—' },
                { key: 'doc', header: 'Doctor', cell: (f) => f.doctor?.name || '—' },
                { key: 's', header: 'Status', cell: (f) => <StatusBadge status={f.status} /> },
              ]} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <Dialog open={dlg === 'edit'} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent title="Edit patient" size="lg">
          <FormBuilder fields={EDIT_FIELDS} defaultValues={{ ...p, dob: p.dob?.slice(0, 10) || '', allergies: p.allergies?.join(', ') || '', line1: p.address?.line1, city: p.address?.city, pincode: p.address?.pincode }} onSubmit={(v) => edit.mutate(v)} loading={edit.isPending} onCancel={() => setDlg(null)} />
        </DialogContent>
      </Dialog>
      <Dialog open={dlg === 'record'} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent title="New medical record" size="xl"><RecordForm patient={p} branch={branchId || p.registeredBranch?._id} onDone={() => setDlg(null)} /></DialogContent>
      </Dialog>
      <Dialog open={dlg === 'rx'} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent title="New prescription" size="xl"><PrescriptionComposer patient={p} branch={branchId || p.registeredBranch?._id} onSaved={() => { setDlg(null); qc.invalidateQueries({ queryKey: ['timeline'] }); }} /></DialogContent>
      </Dialog>
      <Dialog open={dlg === 'upload'} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent title="Upload document" size="sm">
          <div className="space-y-3">
            <Field label="Title"><Input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="e.g. MRI pelvis" /></Field>
            <Field label="Category"><Select value={docCat} onChange={(e) => setDocCat(e.target.value)}>{['report', 'scan', 'prescription', 'consent', 'invoice', 'other'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="File (PDF/JPG/PNG, max 10 MB)"><Input type="file" ref={fileRef} accept=".pdf,image/*" onChange={() => {}} /></Field>
            <div className="flex justify-end"><Button loading={upload.isPending} onClick={() => upload.mutate()}>Upload</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={dlg === 'fu'} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent title="Add follow-up" size="sm">
          <div className="space-y-3">
            <Field label="Due date"><Input type="date" value={fuDate} onChange={(e) => setFuDate(e.target.value)} /></Field>
            <Field label="Reason"><Input value={fuReason} onChange={(e) => setFuReason(e.target.value)} /></Field>
            <div className="flex justify-end"><Button loading={addFu.isPending} onClick={() => (branchId || p.registeredBranch ? addFu.mutate() : toast.error('Select a branch'))}>Add</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      <BookDialog open={dlg === 'book'} onOpenChange={(o) => !o && setDlg(null)} initialPatient={p} />
    </div>
  );
}
