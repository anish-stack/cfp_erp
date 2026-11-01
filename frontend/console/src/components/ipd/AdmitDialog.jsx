import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BedDouble } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/common/Field';
import { PatientPicker } from '@/components/clinic/PatientPicker';
import { useBranches, useDoctors } from '@/hooks/queries';
import { useAuth } from '@/store/auth';
import { get, post } from '@/lib/api';
import { errMsg, inr } from '@/lib/utils';
import { PAYERS, toLocalInput } from './ipdUtils';

/** Admit a patient: pick patient → bed → doctor → reason/procedure → payer → optional deposit */
export function AdmitDialog({ open, onOpenChange, bed: presetBed, patient: presetPatient, appointment, branch: presetBranch, doctor: presetDoctor }) {
  const nav = useNavigate();
  const activeBranch = useAuth((s) => s.branchId);
  const { data: branches = [] } = useBranches();
  const [f, setF] = useState(null);
  useEffect(() => {
    if (!open) return;
    setF({
      branch: presetBranch || presetBed?.branch || activeBranch || '', patient: presetPatient || presetBed?.reservation?.patient || null, bed: presetBed?._id || '', doctor: presetDoctor || '',
      type: 'planned', admittedAt: toLocalInput(), expectedDischargeAt: '', reason: '', provisionalDiagnosis: '', allergies: '', procedure: '', procedureAt: '',
      attendant: { name: presetBed?.reservation?.name && !presetPatient ? presetBed.reservation.name : '', phone: presetBed?.reservation?.phone || '', relation: '' }, payer: { type: 'self' }, estimate: '', deposit: '', depositMode: 'upi', note: presetBed?.reservation?.note || '', package: '',
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const branch = f?.branch;
  const { data: beds = [] } = useQuery({ queryKey: ['ipd-free-beds', branch, open], enabled: !!branch && open, queryFn: () => get('/ipd/beds', { branch, status: 'available' }) });
  const { data: doctors = [] } = useDoctors(branch);
  const { data: services = [] } = useQuery({ queryKey: ['ipd-services'], enabled: open, staleTime: 300_000, queryFn: () => get('/inventory/products/search', { q: '', type: 'service' }) });
  const { data: packages = [] } = useQuery({ queryKey: ['ipd-packages', branch], enabled: open, staleTime: 300_000, queryFn: () => get('/ipd/packages', branch ? { branch } : undefined) });
  const [busy, setBusy] = useState(false);
  const bedOpts = useMemo(() => {
    const list = [...beds];
    if (presetBed && !list.some((b) => b._id === presetBed._id)) list.unshift({ ...presetBed, ward: presetBed.wardObj || presetBed.ward });
    return list;
  }, [beds, presetBed]);
  if (!f) return null;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setP = (k, v) => setF((x) => ({ ...x, payer: { ...x.payer, [k]: v } }));
  const setA = (k, v) => setF((x) => ({ ...x, attendant: { ...x.attendant, [k]: v } }));
  const svc = services.find((s) => s._id === f.procedure);

  const submit = async () => {
    if (!f.patient) return toast.error('Select the patient');
    if (!f.bed) return toast.error('Select a bed');
    if (!f.doctor) return toast.error('Select the consultant');
    setBusy(true);
    try {
      const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null));
      const a = await post('/ipd/admissions', clean({
        branch: f.branch, patient: f.patient._id, bed: f.bed, doctor: f.doctor, appointment, type: f.type,
        admittedAt: f.admittedAt ? new Date(f.admittedAt).toISOString() : undefined, expectedDischargeAt: f.expectedDischargeAt ? new Date(f.expectedDischargeAt).toISOString() : undefined,
        reason: f.reason, provisionalDiagnosis: f.provisionalDiagnosis, allergies: f.allergies, note: f.note,
        package: f.package || undefined,
        plannedProcedure: f.procedure ? { product: f.procedure } : undefined, procedureAt: f.procedureAt ? new Date(f.procedureAt).toISOString() : undefined,
        attendant: Object.values(f.attendant).some(Boolean) ? clean(f.attendant) : undefined,
        payer: { ...clean(f.payer), approvedAmount: f.payer.approvedAmount ? Number(f.payer.approvedAmount) : undefined },
        estimate: f.estimate ? Number(f.estimate) : undefined,
        deposit: Number(f.deposit) > 0 ? { mode: f.depositMode, amount: Number(f.deposit) } : undefined,
      }));
      toast.success(`Admitted · ${a.admissionNo}`);
      onOpenChange(false);
      nav(`/ipd/admissions/${a._id}`);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Admit patient" size="xl">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <Field label="Patient" required><PatientPicker value={f.patient} onChange={(p) => set('patient', p)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Branch" required><Select value={f.branch} onChange={(e) => setF((x) => ({ ...x, branch: e.target.value, bed: '', doctor: '' }))} placeholder="Select">{branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</Select></Field>
              <Field label="Admission type"><Select value={f.type} onChange={(e) => set('type', e.target.value)}><option value="planned">Planned</option><option value="emergency">Emergency</option><option value="day_care">Day care</option></Select></Field>
            </div>
            <Field label="Bed" required hint={branch && !bedOpts.length ? 'No free bed in this branch — mark a bed ready on the Bed board' : undefined}>
              <Select value={f.bed} onChange={(e) => set('bed', e.target.value)} placeholder={branch ? 'Select free bed' : 'Select branch first'}>
                {bedOpts.map((b) => <option key={b._id} value={b._id}>{b.number} · {b.ward?.name}{b.ward?.dailyRate ? ` · ${inr(b.ward.dailyRate)}/day` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Consultant" required><Select value={f.doctor} onChange={(e) => set('doctor', e.target.value)} placeholder="Select doctor">{doctors.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Admitted at"><Input type="datetime-local" value={f.admittedAt} onChange={(e) => set('admittedAt', e.target.value)} /></Field>
              <Field label="Expected discharge"><Input type="datetime-local" value={f.expectedDischargeAt} onChange={(e) => set('expectedDischargeAt', e.target.value)} /></Field>
            </div>
            <Field label="Reason for admission / complaints"><Textarea rows={2} value={f.reason} onChange={(e) => set('reason', e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Provisional diagnosis"><Input value={f.provisionalDiagnosis} onChange={(e) => set('provisionalDiagnosis', e.target.value)} /></Field>
              <Field label="Allergies"><Input value={f.allergies} placeholder="None known" onChange={(e) => set('allergies', e.target.value)} /></Field>
            </div>
          </div>
          <div className="space-y-3">
            <Field label="Package (optional)" hint="Fixed price covering room, procedure, OT & visits for the included days">
              <Select value={f.package} onChange={(e) => { const pk = packages.find((x) => x._id === e.target.value); setF((x) => ({ ...x, package: e.target.value, procedure: pk?.procedure?._id || x.procedure, estimate: pk ? String(pk.price) : x.estimate })); }} placeholder="No package — itemised bill">
                {packages.map((p) => <option key={p._id} value={p._id}>{p.name} · {inr(p.price)}{p.includedDays ? ` · ${p.includedDays} day` : ''}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Planned procedure"><Select value={f.procedure} onChange={(e) => set('procedure', e.target.value)} placeholder="None / decide later">{services.map((s) => <option key={s._id} value={s._id}>{s.name}{s.sellPrice ? ` · ${inr(s.sellPrice)}` : ''}</option>)}</Select></Field>
              <Field label="Procedure date & time"><Input type="datetime-local" disabled={!f.procedure} value={f.procedureAt} onChange={(e) => set('procedureAt', e.target.value)} /></Field>
            </div>
            <p className="pt-1 text-xs font-semibold uppercase text-muted-foreground">Attendant</p>
            <div className="grid grid-cols-3 gap-2">
              <Input placeholder="Name" value={f.attendant.name} onChange={(e) => setA('name', e.target.value)} />
              <Input placeholder="Mobile" inputMode="numeric" maxLength={10} value={f.attendant.phone} onChange={(e) => setA('phone', e.target.value.replace(/\D/g, ''))} />
              <Input placeholder="Relation" value={f.attendant.relation} onChange={(e) => setA('relation', e.target.value)} />
            </div>
            <p className="pt-1 text-xs font-semibold uppercase text-muted-foreground">Payment</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Payer"><Select value={f.payer.type} onChange={(e) => setP('type', e.target.value)}>{Object.entries(PAYERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
              <Field label="Estimate (₹)"><Input type="number" min="0" value={f.estimate} onChange={(e) => set('estimate', e.target.value)} /></Field>
            </div>
            {f.payer.type !== 'self' && (
              <div className="grid grid-cols-2 gap-2 rounded-md border p-2">
                <Input placeholder="Insurer / company" value={f.payer.insurer || ''} onChange={(e) => setP('insurer', e.target.value)} />
                <Input placeholder="TPA" value={f.payer.tpa || ''} onChange={(e) => setP('tpa', e.target.value)} />
                <Input placeholder="Policy no." value={f.payer.policyNo || ''} onChange={(e) => setP('policyNo', e.target.value)} />
                <Input placeholder="Card / member ID" value={f.payer.cardNo || ''} onChange={(e) => setP('cardNo', e.target.value)} />
                <Input placeholder="Pre-auth no." value={f.payer.preAuthNo || ''} onChange={(e) => setP('preAuthNo', e.target.value)} />
                <Select value={f.payer.preAuthStatus || 'pending'} onChange={(e) => setP('preAuthStatus', e.target.value)}>{['pending', 'approved', 'partial', 'rejected', 'not_required'].map((s) => <option key={s} value={s}>Pre-auth: {s.replace('_', ' ')}</option>)}</Select>
                <Input className="col-span-2" type="number" placeholder="Approved amount (₹)" value={f.payer.approvedAmount || ''} onChange={(e) => setP('approvedAmount', e.target.value)} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Advance deposit (₹)" hint="Saved to the patient's advance wallet; adjusted in the final bill"><Input type="number" min="0" value={f.deposit} onChange={(e) => set('deposit', e.target.value)} /></Field>
              <Field label="Mode"><Select value={f.depositMode} disabled={!Number(f.deposit)} onChange={(e) => set('depositMode', e.target.value)}>{['upi', 'cash', 'card', 'bank'].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}</Select></Field>
            </div>
            <Field label="Admission note"><Textarea rows={2} value={f.note} onChange={(e) => set('note', e.target.value)} /></Field>
            {svc && <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">Pre-op checklist will be created for <b>{svc.name}</b>. The procedure charge is added automatically when it is marked done.</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={busy} onClick={submit}><BedDouble /> Admit</Button></div>
      </DialogContent>
    </Dialog>
  );
}
