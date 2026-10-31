import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/common/Field';
import { Can } from '@/components/common/Can';
import { useGet, useAction, useDoctors } from '@/hooks/queries';
import { get, post, patch, del } from '@/lib/api';

const CONDITIONS = ['Piles', 'Fistula', 'Fissure', 'Pilonidal sinus', 'Post-op', 'Constipation', 'General'];
const blank = { name: '', condition: 'Piles', diagnosis: '', complaints: '', items: [], investigations: '', advice: '', diet: '', followUpDays: 15, doctor: '' };

function Editor({ tpl, onDone }) {
  const [f, setF] = useState(() => ({ ...blank, ...tpl, doctor: tpl?.doctor?._id || '', items: (tpl?.items || []).map((i) => ({ ...i })) }));
  const { data: doctors = [] } = useDoctors();
  const { data: meds = [] } = useQuery({ queryKey: ['rx-meds'], queryFn: () => get('/inventory/products/search', { q: '', type: 'medicine,consumable' }), staleTime: 300_000 });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const upd = (i, k, v) => set('items', f.items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const save = useAction(() => {
    const body = { ...f, doctor: f.doctor || null, followUpDays: f.followUpDays === '' ? null : Number(f.followUpDays), items: f.items.filter((i) => i.name?.trim()).map(({ _id, ...i }) => ({ ...i, product: meds.find((m) => m.name === i.name)?._id || i.product || undefined, qty: i.qty === '' || i.qty == null ? undefined : Number(i.qty) })) };
    delete body._id; delete body.createdAt; delete body.updatedAt; delete body.__v; delete body.createdBy;
    return tpl?._id ? patch(`/clinical/rx-templates/${tpl._id}`, body) : post('/clinical/rx-templates', body);
  }, { success: 'Saved', invalidate: ['rx-templates', '/clinical/rx-templates'], onSuccess: onDone });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Piles Grade II — conservative" /></Field>
        <Field label="Condition"><Select value={f.condition} onChange={(e) => set('condition', e.target.value)}>{CONDITIONS.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Diagnosis" className="sm:col-span-2"><Input value={f.diagnosis} onChange={(e) => set('diagnosis', e.target.value)} /></Field>
        <Field label="Follow-up after (days)"><Input type="number" value={f.followUpDays ?? ''} onChange={(e) => set('followUpDays', e.target.value)} /></Field>
        <Field label="Only for doctor" hint="Blank = all doctors" className="sm:col-span-3"><Select value={f.doctor} onChange={(e) => set('doctor', e.target.value)} placeholder="All doctors">{doctors.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>
      </div>
      <datalist id="tpl-meds">{meds.map((m) => <option key={m._id} value={m.name} />)}</datalist>
      <p className="text-sm font-medium">Medicines</p>
      {f.items.map((it, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-12">
          <Input className="col-span-2 sm:col-span-4" list="tpl-meds" placeholder="Medicine" value={it.name || ''} onChange={(e) => upd(i, 'name', e.target.value)} />
          <Input className="sm:col-span-2" placeholder="Dose" value={it.dose || ''} onChange={(e) => upd(i, 'dose', e.target.value)} />
          <Input className="sm:col-span-2" placeholder="1-0-1" value={it.frequency || ''} onChange={(e) => upd(i, 'frequency', e.target.value)} />
          <Input className="sm:col-span-2" placeholder="When" value={it.timing || ''} onChange={(e) => upd(i, 'timing', e.target.value)} />
          <Input className="sm:col-span-1" placeholder="Days" value={it.duration || ''} onChange={(e) => upd(i, 'duration', e.target.value)} />
          <Button variant="ghost" size="icon" className="sm:col-span-1" onClick={() => set('items', f.items.filter((_, j) => j !== i))}><Trash2 /></Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => set('items', [...f.items, { name: '', dose: '', frequency: '', timing: '', duration: '' }])}><Plus /> Add medicine</Button>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Investigations"><Textarea rows={2} value={f.investigations || ''} onChange={(e) => set('investigations', e.target.value)} /></Field>
        <Field label="Advice"><Textarea rows={2} value={f.advice || ''} onChange={(e) => set('advice', e.target.value)} /></Field>
        <Field label="Diet"><Textarea rows={2} value={f.diet || ''} onChange={(e) => set('diet', e.target.value)} /></Field>
        <Field label="Typical complaints"><Textarea rows={2} value={f.complaints || ''} onChange={(e) => set('complaints', e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onDone}>Cancel</Button><Button disabled={f.name.trim().length < 2} loading={save.isPending} onClick={() => save.mutate()}>Save type</Button></div>
    </div>
  );
}

export default function RxTemplates() {
  const [editing, setEditing] = useState(null);
  const { data = [], isLoading } = useGet('/clinical/rx-templates', '/clinical/rx-templates');
  const remove = useAction((id) => del(`/clinical/rx-templates/${id}`), { success: 'Removed', invalidate: ['/clinical/rx-templates', 'rx-templates'] });
  return (
    <div>
      <PageHeader title="Prescription types" description="Ready-made prescriptions doctors pick and edit — medicines, advice, diet, follow-up" actions={<Can perm="medical_records.create"><Button onClick={() => setEditing({})}><Plus /> New type</Button></Can>} />
      <DataTable loading={isLoading} rows={data} onRowClick={setEditing} columns={[
        { key: 'n', header: 'Type', cell: (t) => <div><p className="font-medium">{t.name}</p><p className="text-xs text-muted-foreground">{t.diagnosis}</p></div> },
        { key: 'c', header: 'Condition', cell: (t) => <Badge variant="outline">{t.condition || '—'}</Badge> },
        { key: 'm', header: 'Medicines', cell: (t) => <span className="text-xs">{t.items.map((i) => i.name).join(', ') || '—'}</span> },
        { key: 'f', header: 'Follow-up', cell: (t) => (t.followUpDays ? `${t.followUpDays} days` : '—') },
        { key: 'd', header: 'Doctor', cell: (t) => t.doctor?.name || 'All' },
        { key: 'x', header: '', cell: (t) => <div className="flex gap-1" onClick={(e) => e.stopPropagation()}><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(t)}><Pencil /></Button><Can perm="medical_records.delete"><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove.mutate(t._id)}><Trash2 /></Button></Can></div> },
      ]} />
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title={editing?._id ? `Edit · ${editing.name}` : 'New prescription type'} size="xl">{editing && <Editor tpl={editing._id ? editing : null} onDone={() => setEditing(null)} />}</DialogContent>
      </Dialog>
    </div>
  );
}
