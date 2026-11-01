import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Printer, Plus, Trash2 } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/common/Field';
import { get } from '@/lib/api';
import { usePublicInfo } from '@/hooks/queries';
import { ageOf } from '@/lib/utils';
import { printAttendantPass } from './attendantPass';
import { printStickers, STICKER_LAYOUTS } from './stickers';

const KEY = 'cpf-sticker-layout';
const remembered = () => { try { return localStorage.getItem(KEY) || 'a4-24'; } catch { return 'a4-24'; } };
const day = (x) => (x ? new Date(x).toISOString().slice(0, 10) : '');

/** Attendant / visitor pass for an admission */
export function AttendantPassDialog({ open, onOpenChange, admission: a }) {
  const { data: info } = useQuery({ queryKey: ['ipd-print-info'], queryFn: () => get('/ipd/print-info'), staleTime: 300_000, enabled: open });
  const { data: pub } = usePublicInfo();
  const [passes, setPasses] = useState([]);
  const [till, setTill] = useState('');
  useEffect(() => {
    if (!open || !a) return;
    setPasses([{ name: a.attendant?.name || '', relation: a.attendant?.relation || '', phone: a.attendant?.phone || '' }]);
    setTill(day(a.expectedDischargeAt));
  }, [open, a]);
  const upd = (i, k, v) => setPasses((ps) => ps.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const go = async () => {
    try {
      await printAttendantPass({ admission: a, passes, validTill: till || null, clinic: info?.clinic || { name: pub?.name }, logo: pub?.logo, visitingHours: info?.visitingHours, rules: info?.passRules, color: getComputedStyle(document.documentElement).getPropertyValue('--primary-hex') || undefined });
    } catch (e) { toast.error(e.message); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" title="Attendant pass" description="Card-size ward visiting passes (print on card paper and cut). Visiting hours & rules: Settings → IPD.">
        <div className="space-y-2">
          {passes.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px_130px_32px] items-end gap-2">
              <Field label={i ? `Attendant ${i + 1}` : 'Attendant name'}><Input value={p.name} onChange={(e) => upd(i, 'name', e.target.value)} placeholder="Leave blank to write by hand" /></Field>
              <Field label="Relation"><Input value={p.relation} onChange={(e) => upd(i, 'relation', e.target.value)} /></Field>
              <Field label="Mobile"><Input inputMode="numeric" maxLength={10} value={p.phone} onChange={(e) => upd(i, 'phone', e.target.value.replace(/\D/g, ''))} /></Field>
              <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" disabled={passes.length < 2} onClick={() => setPasses(passes.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
          ))}
          {passes.length < 4 && <Button size="sm" variant="outline" onClick={() => setPasses([...passes, { name: '', relation: '', phone: '' }])}><Plus /> Another pass</Button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Valid till" hint="Empty = till discharge"><Input type="date" value={till} onChange={(e) => setTill(e.target.value)} /></Field>
          <div className="rounded-md bg-muted p-2 text-xs text-muted-foreground"><b>Visiting hours:</b> {info?.visitingHours || '—'}<br /><b>Rules:</b> {info?.passRules || '—'}</div>
        </div>
        <div className="flex justify-end border-t pt-3"><Button onClick={go}><Printer /> Print {passes.length} pass{passes.length > 1 ? 'es' : ''}</Button></div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Patient stickers. Give either an admission, an appointment, or just a patient.
 */
export function StickersDialog({ open, onOpenChange, patient, admission, appointment }) {
  const [layout, setLayout] = useState(remembered);
  const [count, setCount] = useState(24);
  const [skip, setSkip] = useState(0);
  const p = patient || admission?.patient || appointment?.patient || {};
  const base = {
    name: p.name || '',
    ageSex: [ageOf(p) && `${ageOf(p)}Y`, p.gender?.[0]?.toUpperCase()].filter(Boolean).join(' / '),
    patientId: p.patientId || '',
    line2: admission ? `${admission.admissionNo} · ${admission.ward?.name || ''} ${admission.bed?.number ? `Bed ${admission.bed.number}` : ''}`.trim()
      : appointment ? `${appointment.bookingId} · ${appointment.date}` : p.mobile ? `Mob ${p.mobile}` : '',
    line3: [admission?.doctor?.name || appointment?.doctor?.name, admission ? `Adm ${new Date(admission.admittedAt).toLocaleDateString('en-IN')}` : null].filter(Boolean).join(' · '),
    barcode: admission?.admissionNo || p.patientId || '',
  };
  const [d, setD] = useState(base);
  useEffect(() => { if (open) setD(base); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const L = STICKER_LAYOUTS[layout];
  useEffect(() => { setCount(L.roll ? 3 : L.cols * L.rows); setSkip(0); }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = () => {
    try { localStorage.setItem(KEY, layout); } catch { /* ignore */ }
    printStickers(d, { layout, count: Number(count) || 1, skip: Number(skip) || 0 });
  };
  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" title="Print stickers" description="Labels for case files, sample tubes, slips & forms — with barcode.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Label stock" className="sm:col-span-2"><Select value={layout} onChange={(e) => setLayout(e.target.value)}>{Object.entries(STICKER_LAYOUTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
          <Field label="How many stickers"><Input type="number" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} /></Field>
          {!L.roll && <Field label="Skip used labels on the sheet" hint="Start after this many already-used labels"><Input type="number" min={0} max={L.cols * L.rows - 1} value={skip} onChange={(e) => setSkip(e.target.value)} /></Field>}
          <Field label="Name"><Input value={d.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Age / sex"><Input value={d.ageSex} onChange={(e) => set('ageSex', e.target.value)} /></Field>
          <Field label="Line 2"><Input value={d.line2} onChange={(e) => set('line2', e.target.value)} /></Field>
          <Field label="Line 3"><Input value={d.line3} onChange={(e) => set('line3', e.target.value)} /></Field>
          <Field label="Barcode value" hint="Scanned by any barcode reader"><Input value={d.barcode} onChange={(e) => set('barcode', e.target.value)} /></Field>
        </div>
        {/* live preview of one sticker */}
        <div className="flex items-center gap-3 rounded-md bg-muted/50 p-3">
          <div className="flex flex-col gap-0.5 rounded border bg-white p-2 text-[11px] leading-tight text-black shadow-sm" style={{ width: `${L.w * 3}px`, height: `${L.h * 3}px` }}>
            <b className="truncate text-xs">{d.name}</b>
            <div className="flex justify-between"><span>{d.ageSex}</span><b>{d.patientId}</b></div>
            {d.line2 && <div className="truncate">{d.line2}</div>}
            {d.line3 && L.h >= 24 && <div className="truncate">{d.line3}</div>}
            <div className="mt-auto h-4 bg-[repeating-linear-gradient(90deg,#000_0_2px,#fff_2px_3px,#000_3px_4px,#fff_4px_6px)]" />
          </div>
          <p className="text-xs text-muted-foreground">Print at 100% scale (“Actual size”, margins none). For a label printer, choose its paper size in the print window.</p>
        </div>
        <div className="flex justify-end border-t pt-3"><Button disabled={!d.name} onClick={go}><Printer /> Print</Button></div>
      </DialogContent>
    </Dialog>
  );
}
