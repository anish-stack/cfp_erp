import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CollectOnline, usePayConfig } from '@/components/billing/CollectOnline';
import { Printer, IndianRupee, Undo2, XCircle, MessageCircle, ReceiptText, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import { printThermal } from '@/lib/thermalReceipt';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input, Select } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { DataTable } from '@/components/common/DataTable';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Field } from '@/components/common/Field';
import { useGet, useAction } from '@/hooks/queries';
import { post, openFile } from '@/lib/api';
import { useCan } from '@/store/auth';
import { inr, fmtDateTime, ageOf } from '@/lib/utils';

export default function InvoiceDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [online, setOnline] = useState(sp.get('collect') === '1');
  const { data: payCfg } = usePayConfig();
  const can = useCan();
  const { data, isLoading } = useGet(['/billing/invoices', id], `/billing/invoices/${id}`);
  const [dlg, setDlg] = useState(null);
  const [pay, setPay] = useState({ mode: 'cash', amount: '', reference: '' });
  const [ret, setRet] = useState({});
  const [refundMode, setRefundMode] = useState('cash');
  const [reason, setReason] = useState('');
  const inv = ['/billing/invoices', 'dashboard'];
  const addPay = useAction((body) => post(`/billing/invoices/${id}/payments`, body), { success: 'Payment recorded', invalidate: inv, onSuccess: () => setDlg(null) });
  const doReturn = useAction(() => post(`/billing/invoices/${id}/return`, { lines: Object.entries(ret).filter(([, q]) => Number(q) > 0).map(([lineId, qty]) => ({ lineId, qty: Number(qty) })), refundMode, reason }), { success: (r) => `Credit note ${r.creditNote.creditNoteNo} · refunded ${inr(r.refunded)}`, invalidate: inv, onSuccess: () => { setDlg(null); setRet({}); } });
  const cancel = useAction((r) => post(`/billing/invoices/${id}/cancel`, { reason: r }), { success: 'Invoice cancelled', invalidate: inv, onSuccess: () => setDlg(null) });
  const sendWa = useAction(() => post(`/billing/invoices/${id}/send`), { success: 'Invoice queued on WhatsApp' });

  if (isLoading || !data) return <Skeleton className="h-96 w-full" />;
  const { invoice: i, payments, creditNotes } = data;
  const open = !['cancelled', 'refunded'].includes(i.status);

  return (
    <div className="space-y-4">
      <PageHeader
        title={i.invoiceNo}
        description={`${fmtDateTime(i.createdAt)} · ${i.branch?.name} · by ${i.createdBy?.name || '—'}`}
        actions={<>
          <Button variant="outline" onClick={() => openFile(`/billing/invoices/${id}/pdf`)}><Printer /> Print / PDF</Button>
          <Button variant="outline" onClick={() => printThermal(id).catch((e) => toast.error(e?.response?.data?.message || e.message))}><ReceiptText /> Thermal print</Button>
          {i.status !== 'cancelled' && (i.patient || i.customer?.phone) && <Button variant="outline" loading={sendWa.isPending} onClick={() => sendWa.mutate()}><MessageCircle /> WhatsApp</Button>}
          {open && i.balance > 0 && payCfg?.enabled && (can('billing.create') || can('pos.create')) && <Button variant="outline" onClick={() => setOnline(true)}><QrCode /> Collect online</Button>}
          {open && i.balance > 0 && (can('billing.create') || can('pos.create')) && <Button onClick={() => { setPay({ mode: 'cash', amount: i.balance, reference: '' }); setDlg('pay'); }}><IndianRupee /> Collect</Button>}
          {open && can('billing.approve') && i.paid > 0 && <Button variant="outline" onClick={() => setDlg('return')}><Undo2 /> Return / refund</Button>}
          {open && can('billing.delete') && i.paid - i.refunded <= 0 && <Button variant="outline" className="text-destructive" onClick={() => setDlg('cancel')}><XCircle /> Cancel</Button>}
        </>}
      >
        <div className="mt-2 flex gap-2"><StatusBadge status={i.status} /><Badge variant="outline">{i.type}</Badge>{i.source === 'pos' && <Badge variant="info">POS</Badge>}</div>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Items</CardTitle></CardHeader>
          <CardContent>
            <DataTable rows={i.items} className="border-0 shadow-none" columns={[
              { key: 'd', header: 'Description', cell: (l) => <div><p className="font-medium">{l.description}</p>{l.allocations?.length > 0 && <p className="text-xs text-muted-foreground">Batch {l.allocations.map((a) => `${a.batchNo} (${a.qty})`).join(', ')}</p>}{l.returnedQty > 0 && <Badge variant="warning" className="mt-1">Returned {l.returnedQty}</Badge>}</div> },
              { key: 'q', header: 'Qty', cell: (l) => l.qty },
              { key: 'r', header: 'Rate', cell: (l) => inr(l.rate) },
              { key: 'ds', header: 'Disc', cell: (l) => (l.discountPct ? `${l.discountPct}%` : '—') },
              { key: 'g', header: 'GST', cell: (l) => `${l.gstRate}%` },
              { key: 't', header: 'Total', className: 'text-right', cell: (l) => inr(l.total) },
            ]} />
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-1.5 pt-4 text-sm">
              <p className="font-semibold">{i.patient ? i.patient.name : i.customer?.name || 'Walk-in customer'}</p>
              {i.patient && <button className="text-xs text-primary hover:underline" onClick={() => nav(`/patients/${i.patient._id}`)}>{i.patient.patientId} · {[i.patient.gender, ageOf(i.patient) && `${ageOf(i.patient)}y`, i.patient.mobile].filter(Boolean).join(' · ')}</button>}
              {i.doctor && <p className="text-muted-foreground">Doctor: {i.doctor.name}</p>}
              <div className="mt-3 space-y-1 border-t pt-3">
                {[['Subtotal', i.subtotal], ['Discount', -Math.round((i.discount - (i.coupon?.discount || 0) - (i.loyalty?.redeemValue || 0)) * 100) / 100], [`Coupon ${i.coupon?.code || ''}`, -(i.coupon?.discount || 0)], [`Loyalty (${i.loyalty?.redeemed || 0} pts)`, -(i.loyalty?.redeemValue || 0)], ['Taxable', i.taxable], ['CGST', i.cgst], ['SGST', i.sgst], ['Round off', i.roundOff]].map(([k, v]) => (v ? <div key={k} className="flex justify-between"><span className="text-muted-foreground">{k}</span><span>{inr(v)}</span></div> : null))}
                <div className="flex justify-between text-base font-semibold"><span>Grand total</span><span>{inr(i.grandTotal)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span>{inr(i.paid)}</span></div>
                {i.refunded > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Refunded</span><span>{inr(i.refunded)}</span></div>}
                <div className="flex justify-between font-semibold text-amber-700"><span>Balance</span><span>{inr(i.balance)}</span></div>
                {i.loyalty?.earned > 0 && i.status !== 'cancelled' && <p className="text-xs font-medium text-emerald-700">+{i.loyalty.earned} loyalty points earned</p>}
              </div>
              {i.cancelReason && <p className="text-xs text-destructive">Cancelled: {i.cancelReason}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Payments</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {!payments.length && <p className="text-muted-foreground">No payments</p>}
              {payments.map((p) => (
                <div key={p._id} className="flex justify-between border-b pb-1.5 last:border-0">
                  <div><p className="font-medium">{p.kind === 'refund' ? 'Refund' : p.kind === 'advance_adjust' ? 'Advance used' : 'Payment'} · {p.mode.toUpperCase()}</p><p className="text-xs text-muted-foreground">{p.receiptNo} · {fmtDateTime(p.createdAt)}{p.reference ? ` · ${p.reference}` : ''}</p></div>
                  <span className={p.kind === 'refund' ? 'text-red-600' : ''}>{p.kind === 'refund' ? '−' : ''}{inr(p.amount)}</span>
                </div>
              ))}
              {creditNotes.map((c) => <p key={c._id} className="text-xs text-muted-foreground">Credit note {c.creditNoteNo}: {inr(c.amount)} · {c.reason}</p>)}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={dlg === 'pay'} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent title="Collect payment" size="sm">
          <div className="space-y-3">
            <Field label="Mode"><Select value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>{['cash', 'upi', 'card', 'bank'].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}</Select></Field>
            <Field label={`Amount (balance ${inr(i.balance)})`}><Input type="number" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
            {pay.mode !== 'cash' && <Field label="Reference"><Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>}
            <div className="flex justify-between gap-2">
              {i.patient && <Button variant="outline" loading={addPay.isPending} onClick={() => addPay.mutate({ useAdvance: true, amount: Number(pay.amount) || undefined })}>Use advance</Button>}
              <Button className="ml-auto" disabled={!(Number(pay.amount) > 0)} loading={addPay.isPending} onClick={() => addPay.mutate({ mode: pay.mode, amount: Number(pay.amount), reference: pay.reference || undefined })}>Record</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === 'return'} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent title="Return items / refund" description="Products are restocked into their original batches." size="lg">
          <div className="space-y-3">
            {i.items.map((l) => {
              const max = l.qty - l.returnedQty;
              return (
                <div key={l._id} className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm">
                  <div><p className="font-medium">{l.description}</p><p className="text-xs text-muted-foreground">Sold {l.qty} · returned {l.returnedQty} · {inr(l.total / l.qty)} each</p></div>
                  <Input type="number" min="0" max={max} disabled={max <= 0} className="h-8 w-24" value={ret[l._id] || ''} onChange={(e) => setRet({ ...ret, [l._id]: Math.min(max, Math.max(0, Number(e.target.value))) })} />
                </div>
              );
            })}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Refund mode"><Select value={refundMode} onChange={(e) => setRefundMode(e.target.value)}>{['cash', 'upi', 'card', 'bank'].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}</Select></Field>
              <Field label="Reason" required><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            </div>
            <div className="flex justify-end"><Button disabled={reason.trim().length < 3 || !Object.values(ret).some((v) => v > 0)} loading={doReturn.isPending} onClick={() => doReturn.mutate()}>Process return</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      {i && <CollectOnline open={online && i.balance > 0} onOpenChange={(o) => { setOnline(o); if (!o && sp.get('collect')) { sp.delete('collect'); setSp(sp, { replace: true }); } }} purpose="invoice" invoice={i} onPaid={() => setTimeout(() => setOnline(false), 2500)} />}
      <ConfirmDialog open={dlg === 'cancel'} onOpenChange={(o) => !o && setDlg(null)} title="Cancel invoice" description="All products are restocked. This cannot be undone." reason destructive confirmText="Cancel invoice" loading={cancel.isPending} onConfirm={(r) => cancel.mutate(r)} />
    </div>
  );
}
