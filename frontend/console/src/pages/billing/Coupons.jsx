import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, TicketPercent, Award, Search } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { Field } from '@/components/common/Field';
import { Can } from '@/components/common/Can';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useGet, useAction, useBranches } from '@/hooks/queries';
import { get, post, patch, del } from '@/lib/api';
import { useCan } from '@/store/auth';
import { inr, fmtDate, fmtDateTime, errMsg } from '@/lib/utils';

const BLANK = { code: '', description: '', type: 'percent', value: 10, maxDiscount: '', minBill: 0, appliesTo: 'all', branches: [], validFrom: '', validTo: '', usageLimit: '', perCustomer: 1, isActive: true };
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const statusOf = (c) => {
  const now = new Date();
  if (!c.isActive) return ['Off', 'secondary'];
  if (c.validTo && new Date(c.validTo) < now) return ['Expired', 'danger'];
  if (c.validFrom && new Date(c.validFrom) > now) return ['Scheduled', 'info'];
  if (c.usageLimit && c.used >= c.usageLimit) return ['Used up', 'warning'];
  return ['Active', 'success'];
};

function CouponDialog({ open, onOpenChange, coupon }) {
  const { data: branches = [] } = useBranches();
  const [c, setC] = useState(BLANK);
  useEffect(() => { if (open) setC(coupon?._id ? { ...BLANK, ...coupon, branches: (coupon.branches || []).map((b) => b._id || b), validFrom: day(coupon.validFrom), validTo: day(coupon.validTo), maxDiscount: coupon.maxDiscount ?? '', usageLimit: coupon.usageLimit ?? '' } : BLANK); }, [open, coupon]);
  const set = (k, v) => setC((x) => ({ ...x, [k]: v }));
  const num = (v) => (v === '' || v === null ? null : Number(v));
  const save = useAction(() => {
    const body = { ...c, value: Number(c.value), maxDiscount: num(c.maxDiscount), minBill: Number(c.minBill) || 0, usageLimit: num(c.usageLimit), perCustomer: Number(c.perCustomer) || 0,
      validFrom: c.validFrom ? `${c.validFrom}T00:00:00+05:30` : null, validTo: c.validTo ? `${c.validTo}T23:59:59+05:30` : null };
    delete body._id; delete body.used; delete body.createdAt; delete body.updatedAt; delete body.createdBy; delete body.__v;
    return coupon?._id ? patch(`/billing/coupons/${coupon._id}`, body) : post('/billing/coupons', body);
  }, { success: 'Coupon saved', invalidate: ['coupons'], onSuccess: () => onOpenChange(false) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" title={coupon?._id ? `Edit ${coupon.code}` : 'New coupon'} description="Discount is applied on the bill before GST.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Code" required><Input className="uppercase" value={c.code} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} placeholder="DIWALI10" /></Field>
          <Field label="Description (shown at billing)"><Input maxLength={200} value={c.description} onChange={(e) => set('description', e.target.value)} placeholder="10% off on medicines" /></Field>
          <Field label="Discount type"><Select value={c.type} onChange={(e) => set('type', e.target.value)}><option value="percent">Percent (%)</option><option value="flat">Flat amount (₹)</option></Select></Field>
          <Field label={c.type === 'percent' ? 'Discount %' : 'Discount ₹'} required><Input type="number" min={0} value={c.value} onChange={(e) => set('value', e.target.value)} /></Field>
          {c.type === 'percent' && <Field label="Max discount ₹ (optional)"><Input type="number" min={0} value={c.maxDiscount} onChange={(e) => set('maxDiscount', e.target.value)} placeholder="No cap" /></Field>}
          <Field label="Minimum bill ₹"><Input type="number" min={0} value={c.minBill} onChange={(e) => set('minBill', e.target.value)} /></Field>
          <Field label="Applies to"><Select value={c.appliesTo} onChange={(e) => set('appliesTo', e.target.value)}><option value="all">Whole bill</option><option value="products">Medicines & products only</option><option value="services">Services only</option></Select></Field>
          <Field label="Valid from"><Input type="date" value={c.validFrom} onChange={(e) => set('validFrom', e.target.value)} /></Field>
          <Field label="Valid till"><Input type="date" value={c.validTo} onChange={(e) => set('validTo', e.target.value)} /></Field>
          <Field label="Total uses (optional)"><Input type="number" min={0} value={c.usageLimit} onChange={(e) => set('usageLimit', e.target.value)} placeholder="Unlimited" /></Field>
          <Field label="Uses per customer" hint="0 = unlimited; >0 needs the customer's mobile"><Input type="number" min={0} value={c.perCustomer} onChange={(e) => set('perCustomer', e.target.value)} /></Field>
          <Field label="Branches" className="sm:col-span-2" hint="None selected = all branches">
            <div className="flex flex-wrap gap-2">{branches.map((b) => <label key={b._id} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm"><input type="checkbox" checked={c.branches.includes(b._id)} onChange={(e) => set('branches', e.target.checked ? [...c.branches, b._id] : c.branches.filter((x) => x !== b._id))} />{b.name}</label>)}</div>
          </Field>
          <label className="flex items-center gap-2 text-sm"><Switch checked={c.isActive} onCheckedChange={(v) => set('isActive', v)} /> Active</label>
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={c.code.length < 3 || !(Number(c.value) > 0)} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LoyaltyLookup() {
  const can = useCan();
  const [mobile, setMobile] = useState('');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [adj, setAdj] = useState({ points: '', note: '' });
  const load = async (m = mobile) => { setErr(''); try { setD(await get(`/billing/loyalty/${m}`)); } catch (e) { setD(null); setErr(errMsg(e)); } };
  const adjust = useAction(() => post(`/billing/loyalty/${mobile}/adjust`, { points: parseInt(adj.points, 10), note: adj.note }), { success: 'Points adjusted', onSuccess: () => { setAdj({ points: '', note: '' }); load(); } });
  const TYPE = { earn: ['Earned', 'success'], redeem: ['Redeemed', 'warning'], reverse: ['Reversed', 'secondary'], adjust: ['Adjusted', 'info'] };
  return (
    <div className="space-y-4">
      <form className="flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); load(); }}>
        <Input inputMode="numeric" maxLength={10} placeholder="Customer mobile number" value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))} />
        <Button type="submit" disabled={mobile.length !== 10}><Search /> Check</Button>
      </form>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {d && (
        <>
          {!d.enabled && <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">Loyalty is switched off — enable it in Settings → Billing & GST.</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="p-4"><p className="text-xs text-muted-foreground">Balance</p><p className="text-2xl font-bold">{d.balance} pts</p><p className="text-xs text-muted-foreground">worth {inr(d.value)}</p></Card>
            <Card className="p-4"><p className="text-xs text-muted-foreground">Expiring in 30 days</p><p className="text-2xl font-bold">{d.expiringSoon}</p></Card>
            {can('billing.approve') && (
              <Card className="space-y-2 p-4">
                <p className="text-xs font-medium">Manual adjustment</p>
                <div className="flex gap-2"><Input className="h-8 w-24" type="number" placeholder="+/- pts" value={adj.points} onChange={(e) => setAdj({ ...adj, points: e.target.value })} /><Input className="h-8" placeholder="Reason" value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} /></div>
                <Button size="sm" className="w-full" disabled={!parseInt(adj.points, 10) || adj.note.trim().length < 3} loading={adjust.isPending} onClick={() => adjust.mutate()}>Apply</Button>
              </Card>
            )}
          </div>
          <DataTable rows={d.history} empty="No points history" columns={[
            { key: 'at', header: 'When', cell: (r) => fmtDateTime(r.createdAt) },
            { key: 'type', header: 'Type', cell: (r) => <Badge variant={TYPE[r.type]?.[1]}>{TYPE[r.type]?.[0]}</Badge> },
            { key: 'points', header: 'Points', cell: (r) => <span className={r.points > 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-destructive'}>{r.points > 0 ? '+' : ''}{r.points}</span> },
            { key: 'inv', header: 'Bill', cell: (r) => r.invoiceNo || '—' },
            { key: 'br', header: 'Branch', cell: (r) => r.branch?.code || '—' },
            { key: 'exp', header: 'Expires', cell: (r) => (r.expiresAt ? fmtDate(r.expiresAt) : '—') },
            { key: 'note', header: 'Note', cell: (r) => <span className="text-xs">{r.note || ''}{r.by?.name ? ` · ${r.by.name}` : ''}</span> },
          ]} />
        </>
      )}
    </div>
  );
}

export default function Coupons() {
  const { data = [], isLoading } = useGet('coupons', '/billing/coupons');
  const [edit, setEdit] = useState(null);
  const toggle = useAction(({ id, isActive }) => patch(`/billing/coupons/${id}`, { isActive }), { success: 'Updated', invalidate: ['coupons'] });
  const remove = useAction((id) => del(`/billing/coupons/${id}`), { success: (x) => (x.deactivated ? 'Coupon was used — switched off instead' : 'Deleted'), invalidate: ['coupons'] });
  return (
    <div className="space-y-4">
      <PageHeader title="Coupons & loyalty" description="Discount codes for POS / billing, and customers' loyalty points"
        actions={<Can perm="pos.edit"><Button onClick={() => setEdit({})}><Plus /> New coupon</Button></Can>} />
      <Tabs defaultValue="coupons">
        <TabsList><TabsTrigger value="coupons"><TicketPercent className="mr-1 h-4 w-4" /> Coupons</TabsTrigger><TabsTrigger value="loyalty"><Award className="mr-1 h-4 w-4" /> Loyalty points</TabsTrigger></TabsList>
        <TabsContent value="coupons">
          <DataTable loading={isLoading} rows={data} empty="No coupons yet" columns={[
            { key: 'code', header: 'Code', cell: (c) => <div><p className="font-mono font-semibold">{c.code}</p>{c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}</div> },
            { key: 'val', header: 'Discount', cell: (c) => <span>{c.type === 'percent' ? `${c.value}%` : inr(c.value)}{c.maxDiscount ? <span className="text-xs text-muted-foreground"> (max {inr(c.maxDiscount)})</span> : ''}</span> },
            { key: 'rules', header: 'Rules', cell: (c) => <div className="text-xs">{c.minBill ? <p>Min bill {inr(c.minBill)}</p> : null}<p>{{ all: 'Whole bill', products: 'Medicines only', services: 'Services only' }[c.appliesTo]}</p>{c.branches?.length ? <p>{c.branches.map((b) => b.code || b.name).join(', ')}</p> : null}</div> },
            { key: 'valid', header: 'Valid', cell: (c) => <span className="text-xs">{c.validFrom ? fmtDate(c.validFrom) : 'Now'} → {c.validTo ? fmtDate(c.validTo) : 'no end'}</span> },
            { key: 'used', header: 'Used', cell: (c) => `${c.used}${c.usageLimit ? ` / ${c.usageLimit}` : ''}` },
            { key: 'st', header: 'Status', cell: (c) => { const [l, v] = statusOf(c); return <Badge variant={v}>{l}</Badge>; } },
            { key: 'act', header: '', cell: (c) => <Can perm="pos.edit"><div className="flex items-center gap-1"><Switch checked={c.isActive} onCheckedChange={(v) => toggle.mutate({ id: c._id, isActive: v })} /><Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEdit(c)}><Pencil /></Button><Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => window.confirm(`Delete ${c.code}?`) && remove.mutate(c._id)}><Trash2 /></Button></div></Can> },
          ]} />
        </TabsContent>
        <TabsContent value="loyalty"><LoyaltyLookup /></TabsContent>
      </Tabs>
      <CouponDialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)} coupon={edit} />
    </div>
  );
}
