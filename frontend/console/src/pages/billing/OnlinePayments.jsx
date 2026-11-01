import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { RefreshCw, Ban, Send, ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Pagination } from '@/components/common/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/input';
import { usePaged, useAction } from '@/hooks/queries';
import { post } from '@/lib/api';
import { fmtDateTime, inr, errMsg } from '@/lib/utils';
import { usePayConfig } from '@/components/billing/CollectOnline';

const ST = { created: ['Waiting', 'info'], paid: ['Paid', 'success'], expired: ['Expired', 'secondary'], cancelled: ['Cancelled', 'secondary'], failed: ['Failed', 'danger'], refunded: ['Refunded', 'warning'] };
const PURPOSE = { invoice: 'Bill', advance: 'Advance / deposit', appointment: 'Online booking' };

/** every Razorpay link / QR / booking payment and what happened to it */
export default function OnlinePayments() {
  const { data: cfg } = usePayConfig();
  const [f, setF] = useState({ status: '', purpose: '' });
  const [page, setPage] = useState(1);
  const { data, isLoading } = usePaged('online-payments', '/payments/online', { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), page, limit: 30 });
  const act = useAction(({ id, a }) => post(`/payments/online/${id}/${a}`), { success: (x) => `Status: ${x.status || 'sent'}`, invalidate: ['online-payments'] });
  return (
    <div className="space-y-4">
      <PageHeader title="Online payments" description="Razorpay payment links, UPI QR codes and online booking payments" />
      {!cfg?.enabled && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">Online payments are off — add Razorpay keys (Settings → Integrations) and enable them (Settings → Payments).</p>}
      <div className="flex flex-wrap gap-2">
        <Select className="w-40" value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); setPage(1); }}><option value="">All statuses</option>{Object.entries(ST).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select className="w-44" value={f.purpose} onChange={(e) => { setF({ ...f, purpose: e.target.value }); setPage(1); }}><option value="">All purposes</option>{Object.entries(PURPOSE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
      </div>
      <DataTable loading={isLoading} rows={data?.items} empty="No online payments yet" footer={<Pagination meta={data?.meta} page={page} setPage={setPage} />} columns={[
        { key: 'at', header: 'Created', cell: (r) => <span className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</span> },
        { key: 'for', header: 'For', cell: (r) => <div className="text-sm"><p className="font-medium">{PURPOSE[r.purpose]} · {r.kind === 'qr' ? 'UPI QR' : r.kind === 'link' ? 'Link' : 'Checkout'}</p>
          <p className="text-xs text-muted-foreground">{r.invoice ? <Link className="text-primary hover:underline" to={`/billing/${r.invoice._id}`}>{r.invoice.invoiceNo}</Link> : null}{r.appointment ? <Link className="text-primary hover:underline" to={`/appointments/${r.appointment._id}`}>{r.appointment.bookingId}</Link> : null}{r.patient ? ` ${r.patient.name}` : r.customer?.name ? ` ${r.customer.name}` : ''}</p></div> },
        { key: 'amt', header: 'Amount', cell: (r) => <b>{inr(r.paidAmount || r.amount)}</b> },
        { key: 'st', header: 'Status', cell: (r) => <div className="space-y-0.5"><Badge variant={ST[r.status]?.[1]}>{ST[r.status]?.[0]}</Badge>{r.purpose === 'appointment' && r.status === 'paid' && !r.appointment && <p className="text-[11px] font-medium text-amber-700">Paid, not booked — call the patient / refund</p>}{r.recordError && <p className="max-w-[220px] text-[11px] text-destructive">{r.recordError}</p>}</div> },
        { key: 'pay', header: 'Payment', cell: (r) => (r.paymentId ? <div className="text-xs"><p className="font-mono">{r.paymentId}</p><p className="text-muted-foreground">{String(r.method || '').toUpperCase()} · {fmtDateTime(r.paidAt)}{r.receipt ? ` · ${r.receipt.receiptNo}` : ''}</p></div> : '—') },
        { key: 'by', header: 'By', cell: (r) => <span className="text-xs">{r.createdBy?.name || (r.purpose === 'appointment' ? 'Patient (portal)' : '—')}</span> },
        { key: 'act', header: '', cell: (r) => r.status === 'created' && (
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" className="h-8 w-8" title="Check status" onClick={() => act.mutate({ id: r._id, a: 'check' })}><RefreshCw /></Button>
            {r.shortUrl && <a href={r.shortUrl} target="_blank" rel="noopener noreferrer" className="grid h-8 w-8 place-items-center rounded hover:bg-muted" title="Open link"><ExternalLink className="h-4 w-4" /></a>}
            {r.kind === 'link' && <Button size="icon" variant="ghost" className="h-8 w-8" title="Resend on WhatsApp" onClick={() => post(`/payments/online/${r._id}/send`, {}).then((x) => toast.success(`Sent to ${x.to}`)).catch((e) => toast.error(errMsg(e)))}><Send /></Button>}
            {r.purpose !== 'appointment' && <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" title="Cancel" onClick={() => window.confirm('Cancel this payment request?') && act.mutate({ id: r._id, a: 'cancel' })}><Ban /></Button>}
          </div>
        ) },
      ]} />
    </div>
  );
}
