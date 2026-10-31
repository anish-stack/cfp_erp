import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, ImagePlus, X, Keyboard, Camera, Layers, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/common/Field';
import { api, get, post } from '@/lib/api';
import { useDoctors } from '@/hooks/queries';
import { useAuth } from '@/store/auth';
import { addDays, todayIST, cn, errMsg } from '@/lib/utils';

const blankItem = () => ({ product: null, name: '', dose: '', frequency: '', timing: '', duration: '', qty: '', notes: '' });
const FREQ = ['1-0-1', '1-1-1', '1-0-0', '0-0-1', '0-1-0', '1-1-1-1', 'SOS', 'Once a week'];
const TIMING = ['After food', 'Before food', 'Bedtime', 'Empty stomach', 'After sitz bath', 'With warm water', 'Local application'];
const MODES = [
  { v: 'typed', label: 'Type', icon: Keyboard },
  { v: 'image', label: 'Upload photo', icon: Camera },
  { v: 'both', label: 'Both', icon: Layers },
];

/**
 * Write a prescription: pick a prescription type (template) → edit → save.
 * mode typed | image (photo of handwritten Rx) | both.
 */
export function PrescriptionComposer({ patient, branch, appointment, defaultDoctor, defaultComplaint, onSaved }) {
  const me = useAuth((s) => s.me);
  const { data: doctors = [] } = useDoctors(branch);
  const { data: templates = [] } = useQuery({ queryKey: ['rx-templates'], queryFn: () => get('/clinical/rx-templates'), staleTime: 300_000 });
  const { data: meds = [] } = useQuery({ queryKey: ['rx-meds'], queryFn: () => get('/inventory/products/search', { q: '', type: 'medicine,consumable' }), staleTime: 300_000 });
  const [mode, setMode] = useState('typed');
  const [doctor, setDoctor] = useState(defaultDoctor || me.user.doctor || '');
  const [template, setTemplate] = useState('');
  const [f, setF] = useState({ complaints: defaultComplaint || '', diagnosis: '', investigations: '', advice: '', diet: '', followUpDate: '', notes: '' });
  const [vitals, setVitals] = useState({ bp: '', pulse: '', temp: '', weightKg: '', spo2: '' });
  const [items, setItems] = useState([blankItem()]);
  const [files, setFiles] = useState([]);
  const [send, setSend] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  useEffect(() => { if (!doctor && defaultDoctor) setDoctor(defaultDoctor); }, [defaultDoctor]); // eslint-disable-line react-hooks/exhaustive-deps

  const medByName = useMemo(() => new Map(meds.map((m) => [m.name.toLowerCase(), m])), [meds]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const upd = (i, patch) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const applyTemplate = (id) => {
    setTemplate(id);
    const t = templates.find((x) => x._id === id);
    if (!t) return;
    setF((x) => ({
      ...x,
      diagnosis: t.diagnosis || x.diagnosis,
      complaints: x.complaints || t.complaints || '',
      investigations: t.investigations || '',
      advice: t.advice || '',
      diet: t.diet || '',
      followUpDate: t.followUpDays ? addDays(todayIST(), t.followUpDays) : x.followUpDate,
    }));
    setItems(t.items?.length ? t.items.map((i) => ({ ...blankItem(), ...i, product: i.product || null, qty: i.qty ?? '' })) : [blankItem()]);
    toast.success(`Loaded "${t.name}" — edit as needed`);
  };

  const pickFiles = (list) => {
    const ok = [...list].filter((x) => /image\/(png|jpe?g)/.test(x.type) && x.size <= 10 * 1024 * 1024);
    if (ok.length < list.length) toast.error('Only PNG/JPG images up to 10 MB');
    setFiles((xs) => [...xs, ...ok].slice(0, 5));
  };

  const save = async () => {
    const typed = mode !== 'image';
    const cleanItems = typed ? items.filter((i) => i.name.trim()).map((i) => ({ ...i, product: i.product || undefined, qty: i.qty === '' ? undefined : Number(i.qty) })) : [];
    if (!doctor) return toast.error('Select the doctor');
    if (mode !== 'typed' && !files.length) return toast.error('Add a photo of the prescription');
    if (typed && !cleanItems.length && !f.diagnosis && !f.advice) return toast.error('Add at least one medicine, diagnosis or advice');
    const v = Object.fromEntries(Object.entries(vitals).filter(([, x]) => x !== '').map(([k, x]) => [k, k === 'bp' ? x : Number(x)]));
    setBusy(true);
    try {
      const rx = await post('/clinical/prescriptions', {
        patient: patient._id, branch, appointment: appointment || undefined, doctor, mode, template: template || undefined,
        complaints: f.complaints || undefined, diagnosis: f.diagnosis || undefined, vitals: Object.keys(v).length ? v : undefined,
        items: cleanItems, investigations: f.investigations || undefined, advice: f.advice || undefined, diet: f.diet || undefined,
        notes: f.notes || undefined, followUpDate: f.followUpDate || undefined, sendWhatsApp: send,
      });
      if (files.length) {
        const fd = new FormData();
        files.forEach((x) => fd.append('files', x));
        await api.post(`/clinical/prescriptions/${rx._id}/images${send ? '?send=1' : ''}`, fd);
      }
      toast.success(`Prescription ${rx.rxNo} saved${send ? ' · sent on WhatsApp' : ''}`);
      onSaved?.(rx);
      setItems([blankItem()]);
      setFiles([]);
      setTemplate('');
      setF({ complaints: '', diagnosis: '', investigations: '', advice: '', diet: '', followUpDate: '', notes: '' });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!branch) return <p className="text-sm text-destructive">Select a branch from the top bar first.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex rounded-lg bg-muted p-1">
          {MODES.map((m) => (
            <button key={m.v} type="button" onClick={() => setMode(m.v)} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm', mode === m.v ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground')}>
              <m.icon className="h-4 w-4" /> {m.label}
            </button>
          ))}
        </div>
        <Field label="Doctor" className="min-w-[200px] flex-1"><Select value={doctor} onChange={(e) => setDoctor(e.target.value)} placeholder="Select doctor">{doctors.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>
        {mode !== 'image' && (
          <Field label="Prescription type" className="min-w-[240px] flex-1">
            <Select value={template} onChange={(e) => applyTemplate(e.target.value)} placeholder="— Blank —">
              {templates.map((t) => <option key={t._id} value={t._id}>{t.condition ? `${t.condition} · ` : ''}{t.name}</option>)}
            </Select>
          </Field>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[['bp', 'BP', '120/80'], ['pulse', 'Pulse'], ['temp', 'Temp °F'], ['weightKg', 'Weight kg'], ['spo2', 'SpO₂ %']].map(([k, l, ph]) => (
          <Field key={k} label={l}><Input value={vitals[k]} placeholder={ph} type={k === 'bp' ? 'text' : 'number'} onChange={(e) => setVitals({ ...vitals, [k]: e.target.value })} /></Field>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Chief complaints"><Textarea rows={2} value={f.complaints} onChange={(e) => set('complaints', e.target.value)} /></Field>
        <Field label="Diagnosis"><Textarea rows={2} value={f.diagnosis} onChange={(e) => set('diagnosis', e.target.value)} placeholder="e.g. Grade II internal haemorrhoids" /></Field>
      </div>

      {mode !== 'typed' && (
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Prescription photo / scan</p>
            <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}><ImagePlus /> Add image</Button>
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" capture="environment" multiple hidden onChange={(e) => { pickFiles(e.target.files || []); e.target.value = ''; }} />
          {!files.length && <p className="text-xs text-muted-foreground">Take a photo of the handwritten prescription (phone camera works) — up to 5 images. They are added to the PDF.</p>}
          <div className="flex flex-wrap gap-2">
            {files.map((x, i) => (
              <div key={i} className="relative h-24 w-24 overflow-hidden rounded-md border">
                <img src={URL.createObjectURL(x)} alt="" className="h-full w-full object-cover" />
                <button type="button" className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {mode !== 'image' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between"><p className="text-sm font-medium">Medicines</p>{template && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Wand2 className="h-3 w-3" /> from prescription type</span>}</div>
          <datalist id="rx-meds">{meds.map((m) => <option key={m._id} value={m.name}>{m.genericName}</option>)}</datalist>
          <datalist id="rx-freq">{FREQ.map((x) => <option key={x} value={x} />)}</datalist>
          <datalist id="rx-timing">{TIMING.map((x) => <option key={x} value={x} />)}</datalist>
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-md border p-2 sm:grid-cols-12">
              <Input className="col-span-2 sm:col-span-4" list="rx-meds" placeholder="Medicine" value={it.name} onChange={(e) => { const m = medByName.get(e.target.value.toLowerCase()); upd(i, { name: e.target.value, product: m?._id || null }); }} />
              <Input className="sm:col-span-2" placeholder="Dose" value={it.dose} onChange={(e) => upd(i, { dose: e.target.value })} />
              <Input className="sm:col-span-1" list="rx-freq" placeholder="1-0-1" value={it.frequency} onChange={(e) => upd(i, { frequency: e.target.value })} />
              <Input className="sm:col-span-2" list="rx-timing" placeholder="When" value={it.timing} onChange={(e) => upd(i, { timing: e.target.value })} />
              <Input className="sm:col-span-1" placeholder="Days" value={it.duration} onChange={(e) => upd(i, { duration: e.target.value })} />
              <Input className="sm:col-span-1" placeholder="Qty" type="number" value={it.qty} onChange={(e) => upd(i, { qty: e.target.value })} />
              <Button type="button" variant="ghost" size="icon" className="sm:col-span-1" onClick={() => setItems(items.length > 1 ? items.filter((_, j) => j !== i) : [blankItem()])}><Trash2 /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setItems([...items, blankItem()])}><Plus /> Add medicine</Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {mode !== 'image' && <Field label="Investigations advised"><Textarea rows={2} value={f.investigations} onChange={(e) => set('investigations', e.target.value)} /></Field>}
        {mode !== 'image' && <Field label="Advice"><Textarea rows={2} value={f.advice} onChange={(e) => set('advice', e.target.value)} /></Field>}
        {mode !== 'image' && <Field label="Diet"><Textarea rows={2} value={f.diet} onChange={(e) => set('diet', e.target.value)} /></Field>}
        <Field label="Follow-up date" hint="Creates a follow-up reminder">
          <div className="flex gap-1">
            <Input type="date" value={f.followUpDate} min={todayIST()} onChange={(e) => set('followUpDate', e.target.value)} />
            {[7, 15, 30].map((d) => <Button key={d} type="button" size="sm" variant="ghost" onClick={() => set('followUpDate', addDays(todayIST(), d))}>{d}d</Button>)}
          </div>
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} /> Send to patient on WhatsApp (with PDF)</label>
        <Button loading={busy} onClick={save}>Save prescription</Button>
      </div>
    </div>
  );
}
