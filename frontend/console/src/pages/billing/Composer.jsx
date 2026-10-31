import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trash2, Plus, ScanBarcode, Wallet } from 'lucide-react';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/common/Field';
import { PatientPicker } from '@/components/clinic/PatientPicker';
import { get } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useAction, useBranches } from '@/hooks/queries';
import { post } from '@/lib/api';
import { useAuth, useCan } from '@/store/auth';
import { inr, cn } from '@/lib/utils';

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
/** mirrors backend invoiceMath (inclusive GST) for live preview */
const lineTotal = (l) => r2(l.qty * l.rate * (1 - (l.discountPct || 0) / 100));

export function ProductSearch({ onPick, types, autoFocus, branch }) {
  const [q, setQ] = useState('');
  const dq = useDebounce(q.trim(), 200);
  const ref = useRef();
  const { data = [], isFetching } = useQuery({ queryKey: ['psearch', dq, types, branch], enabled: dq.length >= 1, queryFn: () => get('/inventory/products/search', { q: dq, type: types, branch: branch || undefined }) });
  const pick = (p) => { onPick(p); setQ(''); ref.current?.focus(); };
  return (
    <div className="relative">
      <ScanBarcode className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input ref={ref} autoFocus={autoFocus} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Scan barcode / search product or service"
        className="pl-8" onKeyDown={(e) => { if (e.key === 'Enter' && data.length) { e.preventDefault(); pick(data[0]); } }} />
      {dq && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-popover shadow-lg scrollbar-thin">
          {isFetching && !data.length && <p className="p-3 text-sm text-muted-foreground">Searching…</p>}
          {!isFetching && !data.length && <p className="p-3 text-sm text-muted-foreground">No match</p>}
          {data.map((p) => (
            <button key={p._id} type="button" onClick={() => pick(p)} className="flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted">
              <div><p className="font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{p.sku}{p.genericName ? ` · ${p.genericName}` : ''}</p></div>
              <div className="text-right"><p>{inr(p.sellPrice)}</p>{p.stock !== null && <p className={cn('text-xs', p.stock > 0 ? 'text-emerald-600' : 'text-red-600')}>{p.stock} in stock</p>}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * source: 'billing' | 'pos'
 * initial: { patient, appointment, doctor, items }
 */
export function Composer({ source = 'billing', initial = {}, onDone }) {
  const can = useCan();
  const branchId = useAuth((s) => s.branchId);
  const { data: branches = [] } = useBranches();
  const [branch, setBranch] = useState(branchId || '');
  const [patient, setPatient] = useState(initial.patient || null);
  const [walkin, setWalkin] = useState(source === 'pos' && !initial.patient);
  const [customer, setCustomer] = useState({ name: '', phone: '' });
  const [lines, setLines] = useState(initial.items || []);
  const [pay, setPay] = useState([{ mode: 'cash', amount: '', reference: '' }]);
  const [useAdvance, setUseAdvance] = useState(false);
  const [notes, setNotes] = useState('');
  useEffect(() => { if (initial.patient) setPatient(initial.patient); }, [initial.patient]);
  useEffect(() => { if (initial.items?.length) setLines(initial.items); }, [initial.items]);
  useEffect(() => { if (branchId) setBranch(branchId); }, [branchId]);

  const { data: adv } = useQuery({ queryKey: ['advance', patient?._id], enabled: !!patient?._id && can('billing.view'), queryFn: () => get(`/billing/advances/${patient._id}`) });

  const add = (p) => setLines((ls) => {
    const i = ls.findIndex((l) => l.product === p._id);
    if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
    return [...ls, { product: p._id, description: p.name, qty: 1, rate: p.sellPrice, discountPct: 0, gstRate: p.gstRate, stock: p.stock, type: p.type }];
  });
  const upd = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = useMemo(() => Math.round(lines.reduce((a, l) => a + lineTotal(l), 0)), [lines]);
  const advUse = useAdvance ? Math.min(adv?.balance || 0, total) : 0;
  const paying = r2(pay.reduce((a, p) => a + (Number(p.amount) || 0), 0));
  const due = r2(total - advUse - paying);

  const submit = useAction(() => post(source === 'pos' ? '/billing/pos/checkout' : '/billing/invoices', {
    branch,
    patient: walkin ? undefined : patient?._id,
    customer: walkin && (customer.name || customer.phone) ? customer : undefined,
    appointment: initial.appointment,
    doctor: initial.doctor,
    items: lines.map((l) => ({ product: l.product, description: l.product ? undefined : l.description, qty: Number(l.qty), rate: Number(l.rate), discountPct: Number(l.discountPct) || 0, ...(l.product ? {} : { gstRate: Number(l.gstRate) || 0 }) })),
    payments: pay.filter((p) => Number(p.amount) > 0).map((p) => ({ mode: p.mode, amount: Number(p.amount), reference: p.reference || undefined })),
    useAdvance,
    notes: notes || undefined,
  }), { success: (inv) => `Invoice ${inv.invoiceNo} created`, invalidate: ['/billing/invoices', 'dashboard', 'psearch', 'advance'], onSuccess: onDone });

  const stockIssue = lines.some((l) => l.stock !== null && l.stock !== undefined && l.type !== 'service' && Number(l.qty) > l.stock);
  const valid = branch && lines.length && lines.every((l) => l.description && Number(l.qty) > 0) && (walkin || patient) && due >= -0.01 && !stockIssue;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Branch" required>
              <Select value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Select">{branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</Select>
            </Field>
            <div className="flex items-end gap-2 sm:col-span-2">
              <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={walkin} onChange={(e) => { setWalkin(e.target.checked); if (e.target.checked) setPatient(null); }} /> Walk-in customer (no patient record)</label>
            </div>
          </div>
          {walkin ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Customer name"><Input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></Field>
              <Field label="Phone"><Input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} /></Field>
            </div>
          ) : <Field label="Patient" required><PatientPicker value={patient} onChange={setPatient} /></Field>}
        </Card>

        <Card className="space-y-3 p-4">
          <ProductSearch onPick={add} branch={branch} types={source === 'pos' ? 'medicine,consumable,product' : undefined} autoFocus={source === 'pos'} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="py-2">Item</th><th className="w-20">Qty</th><th className="w-28">Rate</th><th className="w-20">Disc %</th><th className="w-20">GST %</th><th className="w-24 text-right">Amount</th><th className="w-8" /></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 pr-2">
                      {l.product ? <div><p className="font-medium">{l.description}</p>{l.stock != null && l.type !== 'service' && <p className={cn('text-xs', Number(l.qty) > l.stock ? 'text-red-600' : 'text-muted-foreground')}>Stock {l.stock}</p>}</div>
                        : <Input className="h-8" value={l.description} placeholder="Description" onChange={(e) => upd(i, { description: e.target.value })} />}
                    </td>
                    <td><Input className="h-8" type="number" min="1" value={l.qty} onChange={(e) => upd(i, { qty: e.target.value })} /></td>
                    <td><Input className="h-8" type="number" min="0" value={l.rate} onChange={(e) => upd(i, { rate: e.target.value })} disabled={!!l.product && !can('billing.edit')} /></td>
                    <td><Input className="h-8" type="number" min="0" max="100" value={l.discountPct} onChange={(e) => upd(i, { discountPct: e.target.value })} /></td>
                    <td>{l.product ? <span className="pl-2">{l.gstRate}</span> : <Input className="h-8" type="number" value={l.gstRate} onChange={(e) => upd(i, { gstRate: e.target.value })} />}</td>
                    <td className="text-right font-medium">{inr(lineTotal(l))}</td>
                    <td><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!lines.length && <p className="py-6 text-center text-sm text-muted-foreground">Add products or services above.</p>}
          </div>
          {source === 'billing' && <Button variant="outline" size="sm" onClick={() => setLines([...lines, { description: '', qty: 1, rate: 0, discountPct: 0, gstRate: 0 }])}><Plus /> Custom line</Button>}
          {stockIssue && <p className="text-sm text-destructive">Some items exceed available stock.</p>}
        </Card>
      </div>

      <Card className="h-fit space-y-4 p-4 lg:sticky lg:top-0">
        <div className="flex items-baseline justify-between"><span className="text-sm text-muted-foreground">Total (incl. GST, rounded)</span><span className="text-2xl font-semibold">{inr(total)}</span></div>
        {adv?.balance > 0 && (
          <label className="flex items-center justify-between rounded-md border bg-accent/40 p-2 text-sm">
            <span className="flex items-center gap-2"><input type="checkbox" checked={useAdvance} onChange={(e) => setUseAdvance(e.target.checked)} /><Wallet className="h-4 w-4" /> Use advance</span>
            <Badge>{inr(adv.balance)} available</Badge>
          </label>
        )}
        <div className="space-y-2">
          <p className="text-sm font-medium">Payment</p>
          {pay.map((p, i) => (
            <div key={i} className="grid grid-cols-5 gap-2">
              <Select className="col-span-2 h-8" value={p.mode} onChange={(e) => setPay(pay.map((x, j) => (j === i ? { ...x, mode: e.target.value } : x)))}>{['cash', 'upi', 'card', 'bank'].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}</Select>
              <Input className="col-span-2 h-8" type="number" placeholder="Amount" value={p.amount} onChange={(e) => setPay(pay.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setPay(pay.map((x, j) => (j === i ? { ...x, amount: r2(Math.max(0, total - advUse - paying + (Number(x.amount) || 0))) } : x)))}>Full</Button>
              {p.mode !== 'cash' && <Input className="col-span-5 h-8" placeholder="Txn / ref no." value={p.reference} onChange={(e) => setPay(pay.map((x, j) => (j === i ? { ...x, reference: e.target.value } : x)))} />}
            </div>
          ))}
          {pay.length < 3 && <Button variant="ghost" size="sm" onClick={() => setPay([...pay, { mode: 'upi', amount: '', reference: '' }])}><Plus /> Split payment</Button>}
        </div>
        <div className="space-y-1 border-t pt-3 text-sm">
          {advUse > 0 && <div className="flex justify-between"><span>Advance</span><span>− {inr(advUse)}</span></div>}
          <div className="flex justify-between"><span>Paying now</span><span>{inr(paying)}</span></div>
          <div className={cn('flex justify-between font-semibold', due < -0.01 && 'text-destructive')}><span>{due < -0.01 ? 'Excess' : 'Balance due'}</span><span>{inr(Math.abs(due))}</span></div>
        </div>
        <Input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button className="w-full" size="lg" disabled={!valid} loading={submit.isPending} onClick={() => submit.mutate()}>{source === 'pos' ? 'Checkout' : 'Create invoice'}</Button>
      </Card>
    </div>
  );
}
