import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Select } from '@/components/ui/input';
import { Field } from '@/components/common/Field';
import { useAction, useDoctors } from '@/hooks/queries';
import { post } from '@/lib/api';
import { useAuth } from '@/store/auth';

const num = (v) => (v === '' || v == null ? undefined : Number(v));

export function RecordForm({ patient, appointmentId, branch, onDone }) {
  const branchId = useAuth((s) => s.branchId);
  const me = useAuth((s) => s.me);
  const { data: doctors = [] } = useDoctors(branch || branchId);
  const { register, handleSubmit } = useForm({ defaultValues: { type: 'consultation', doctor: me.user.doctor || '' } });
  const save = useAction(
    (v) => post('/clinical/records', {
      patient: patient._id, branch: branch || branchId, appointment: appointmentId, doctor: v.doctor || undefined, type: v.type,
      complaints: v.complaints || undefined, history: v.history || undefined, examination: v.examination || undefined, diagnosis: v.diagnosis || undefined, plan: v.plan || undefined,
      procedure: v.type === 'procedure' ? { name: v.procName, anesthesia: v.anesthesia, notes: v.procNotes } : undefined,
      vitals: { bp: v.bp || undefined, pulse: num(v.pulse), temp: num(v.temp), weightKg: num(v.weightKg), spo2: num(v.spo2) },
    }),
    { success: 'Record saved', invalidate: ['timeline'], onSuccess: onDone }
  );
  const [type, setType] = useState('consultation');
  if (!branch && !branchId) return <p className="text-sm text-destructive">Select a branch from the top bar first.</p>;
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type"><Select {...register('type', { onChange: (e) => setType(e.target.value) })}><option value="consultation">Consultation</option><option value="procedure">Procedure</option><option value="investigation">Investigation</option><option value="note">Note</option></Select></Field>
        <Field label="Doctor"><Select {...register('doctor')} placeholder="—">{doctors.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Field label="BP"><Input placeholder="120/80" {...register('bp')} /></Field>
        <Field label="Pulse"><Input type="number" {...register('pulse')} /></Field>
        <Field label="Temp °F"><Input type="number" step="0.1" {...register('temp')} /></Field>
        <Field label="Weight kg"><Input type="number" step="0.1" {...register('weightKg')} /></Field>
        <Field label="SpO₂ %"><Input type="number" {...register('spo2')} /></Field>
      </div>
      <Field label="Chief complaints"><Textarea rows={2} {...register('complaints')} /></Field>
      <Field label="History"><Textarea rows={2} {...register('history')} /></Field>
      <Field label="Examination (P/R, proctoscopy…)"><Textarea rows={2} {...register('examination')} /></Field>
      <Field label="Diagnosis"><Input {...register('diagnosis')} placeholder="e.g. Grade III haemorrhoids, fistula-in-ano" /></Field>
      {type === 'procedure' && (
        <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
          <Field label="Procedure"><Input {...register('procName')} placeholder="Laser haemorrhoidoplasty" /></Field>
          <Field label="Anaesthesia"><Input {...register('anesthesia')} /></Field>
          <Field label="Procedure notes" className="sm:col-span-2"><Textarea rows={2} {...register('procNotes')} /></Field>
        </div>
      )}
      <Field label="Plan / advice"><Textarea rows={2} {...register('plan')} /></Field>
      <div className="flex justify-end"><Button type="submit" loading={save.isPending}>Save record</Button></div>
    </form>
  );
}

export function PrescriptionForm({ patient, appointmentId, branch, onDone }) {
  const branchId = useAuth((s) => s.branchId);
  const me = useAuth((s) => s.me);
  const { data: doctors = [] } = useDoctors(branch || branchId);
  const { register, handleSubmit, control } = useForm({ defaultValues: { doctor: me.user.doctor || '', items: [{ name: '', dose: '1 tab', frequency: '1-0-1', timing: 'After food', duration: '5 days' }], sendWhatsApp: true } });
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const save = useAction(
    (v) => post('/clinical/prescriptions', {
      patient: patient._id, branch: branch || branchId, appointment: appointmentId, doctor: v.doctor || undefined, diagnosis: v.diagnosis || undefined,
      items: v.items.filter((i) => i.name.trim()).map((i) => ({ ...i, qty: num(i.qty) })), advice: v.advice || undefined, diet: v.diet || undefined, followUpDate: v.followUpDate || undefined, sendWhatsApp: !!v.sendWhatsApp,
    }),
    { success: 'Prescription saved', invalidate: ['timeline'], onSuccess: onDone }
  );
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Doctor" required><Select {...register('doctor')} placeholder="Select">{doctors.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>
        <Field label="Diagnosis"><Input {...register('diagnosis')} /></Field>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Medicines</p>
        {fields.map((f, i) => (
          <div key={f.id} className="grid grid-cols-2 gap-2 rounded-md border p-2 sm:grid-cols-12">
            <Input className="col-span-2 sm:col-span-4" placeholder="Medicine" {...register(`items.${i}.name`)} />
            <Input className="sm:col-span-2" placeholder="Dose" {...register(`items.${i}.dose`)} />
            <Input className="sm:col-span-2" placeholder="1-0-1" {...register(`items.${i}.frequency`)} />
            <Input className="sm:col-span-2" placeholder="Timing" {...register(`items.${i}.timing`)} />
            <Input className="sm:col-span-1" placeholder="Days" {...register(`items.${i}.duration`)} />
            <Button type="button" variant="ghost" size="icon" className="sm:col-span-1" onClick={() => remove(i)}><Trash2 /></Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => append({ name: '', dose: '', frequency: '', timing: '', duration: '' })}><Plus /> Add medicine</Button>
      </div>
      <Field label="Advice"><Textarea rows={2} {...register('advice')} placeholder="Sitz bath, high-fibre diet, plenty of water…" /></Field>
      <Field label="Diet"><Textarea rows={2} {...register('diet')} /></Field>
      <Field label="Follow-up date" hint="Creates a follow-up reminder"><Input type="date" {...register('followUpDate')} /></Field>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('sendWhatsApp')} /> Send to patient on WhatsApp (with PDF)</label>
        <Button type="submit" loading={save.isPending}>Save prescription</Button>
      </div>
    </form>
  );
}
