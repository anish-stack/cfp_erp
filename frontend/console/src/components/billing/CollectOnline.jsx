import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import QRCode from 'qrcode';
import { QrCode, Link2, Copy, Check, MessageCircle, Loader2, CheckCircle2, XCircle, RefreshCw, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/common/Field';
import { get, post } from '@/lib/api';
import { inr, errMsg, cn } from '@/lib/utils';

export const usePayConfig = () => useQuery({ queryKey: ['pay-config'], queryFn: () => get('/payments/config'), staleTime: 300_000 });

/**
 * Razorpay collection: UPI QR on screen, or a payment link (QR + copy + WhatsApp). Polls until paid.
 * purpose 'invoice' (invoice required) | 'advance' (patient + branch, optional admission)
 */
export function CollectOnline({ open, onOpenChange, purpose = 'invoice', invoice, patient, branch, admission, defaultAmount, title, onPaid }) {
  const qc = useQueryClient();
  const { data: cfg } = usePayConfig();
  const [kind, setKind] = useState('qr');
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [op, setOp] = useState(null);
  const [busy, setBusy] = useState(false);
  const [linkQr, setLinkQr] = useState('');
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  const maxAmt = purpose === 'invoice' ? invoice?.balance : undefined;

  useEffect(() => {
    if (!open) { clearInterval(timer.current); return; }
    setOp(null); setKind('qr'); setLinkQr(''); setCopied(false);
    setAmount(String(defaultAmount ?? (purpose === 'invoice' ? invoice?.balance ?? '' : '')));
    setPhone((patient?.mobile || invoice?.patient?.mobile || invoice?.customer?.phone || '').replace(/\D/g, '').slice(-10));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // poll Razorpay while a request is open
  useEffect(() => {
    clearInterval(timer.current);
    if (!open || !op || op.status !== 'created') return undefined;
    timer.current = setInterval(async () => {
      try {
        const x = await post(`/payments/online/${op._id}/check`);
        if (x.status !== op.status) setOp(x);
      } catch { /* keep polling */ }
    }, 4000);
    return () => clearInterval(timer.current);
  }, [open, op?._id, op?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (op?.status === 'paid') {
      toast.success(`₹${op.paidAmount || op.amount} received online`);
      ['/billing/invoices', '/billing/payments', 'advance', 'ipd-bill', 'ipd-admission', 'online-payments'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries();
      onPaid?.(op);
    }
  }, [op?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (op?.shortUrl) QRCode.toDataURL(op.shortUrl, { margin: 1, width: 260 }).then(setLinkQr).catch(() => setLinkQr('')); }, [op?.shortUrl]);

  const generate = async (send = false) => {
    setBusy(true);
    try {
      const x = await post('/payments/online', {
        kind, purpose, invoice: invoice?._id, patient: patient?._id, branch, admission,
        amount: Number(amount) || undefined, phone: phone || undefined, send: kind === 'link' && send,
      });
      setOp(x);
      if (x.sent?.sent) toast.success(`Payment link sent on WhatsApp to ${x.sent.to}`);
      else if (x.sent && !x.sent.sent) toast.error(`Link created, WhatsApp not sent: ${x.sent.error}`);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true);
    try { const r = await post(`/payments/online/${op._id}/send`, { phone }); toast.success(`Sent to ${r.to}`); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const cancel = async () => { try { setOp(await post(`/payments/online/${op._id}/cancel`)); } catch (e) { toast.error(errMsg(e)); } };
  const check = async () => { setBusy(true); try { setOp(await post(`/payments/online/${op._id}/check`)); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  const copy = async () => { try { await navigator.clipboard.writeText(op.shortUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };

  const amt = Number(amount);
  const valid = amt >= 1 && (!maxAmt || amt <= maxAmt + 0.009);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" title={title || 'Collect online payment'} description={purpose === 'invoice' ? `Bill ${invoice?.invoiceNo || ''} · balance ${inr(invoice?.balance)}` : `${admission ? 'IPD deposit' : 'Advance'} for ${patient?.name || 'patient'}`}>
        {!cfg?.enabled ? (
          <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">Online payments are off. {cfg?.configured ? 'Switch them on in Settings → Payments.' : 'Add Razorpay keys in Settings → Integrations, then enable in Settings → Payments.'}</p>
        ) : !op ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {[['qr', QrCode, 'UPI QR on screen', 'Patient scans with any UPI app'], ['link', Link2, 'Payment link', 'WhatsApp / copy — UPI, card, net banking']].map(([k, Ic, l, h]) => (
                <button key={k} type="button" onClick={() => setKind(k)} className={cn('rounded-lg border p-3 text-left transition', kind === k ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted')}>
                  <Ic className="mb-1 h-5 w-5 text-primary" /><p className="text-sm font-semibold">{l}</p><p className="text-xs text-muted-foreground">{h}</p>
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Amount ₹" hint={maxAmt ? `Max ${inr(maxAmt)}` : undefined}><Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
              {kind === 'link' && <Field label="Patient mobile (WhatsApp)"><Input inputMode="numeric" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} /></Field>}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {kind === 'link' && <Button variant="outline" disabled={!valid || phone.length !== 10} loading={busy} onClick={() => generate(true)}><MessageCircle /> Create & send on WhatsApp</Button>}
              <Button disabled={!valid} loading={busy} onClick={() => generate(false)}>{kind === 'qr' ? <><QrCode /> Show QR</> : <><Link2 /> Create link</>}</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Payments are recorded automatically on the bill / advance as soon as Razorpay confirms them.</p>
          </div>
        ) : op.status === 'paid' ? (
          <div className="space-y-3 py-4 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" />
            <p className="text-xl font-semibold">{inr(op.paidAmount || op.amount)} received</p>
            <p className="text-sm text-muted-foreground">{String(op.method || '').toUpperCase()} · {op.paymentId}</p>
            {op.recordError && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">{op.recordError}</p>}
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        ) : ['cancelled', 'expired', 'failed', 'refunded'].includes(op.status) ? (
          <div className="space-y-3 py-4 text-center">
            <XCircle className="mx-auto h-12 w-12 text-muted-foreground" />
            <p className="font-semibold">Request {op.status}</p>
            <Button variant="outline" onClick={() => setOp(null)}>New request</Button>
          </div>
        ) : (
          <div className="space-y-3 text-center">
            <p className="text-2xl font-bold">{inr(op.amount)}</p>
            {op.kind === 'qr' ? (
              op.imageUrl ? <img src={op.imageUrl} alt="UPI QR" className="mx-auto max-h-[360px] rounded-lg border" /> : <p className="text-sm text-muted-foreground">QR image not available</p>
            ) : (
              <>
                {linkQr && <img src={linkQr} alt="Payment link QR" className="mx-auto h-52 w-52 rounded-lg border p-1" />}
                <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-left text-sm">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{op.shortUrl}</span>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={copy}>{copied ? <Check className="text-emerald-600" /> : <Copy />}</Button>
                  <a href={op.shortUrl} target="_blank" rel="noopener noreferrer" className="rounded p-1.5 hover:bg-muted"><ExternalLink className="h-4 w-4" /></a>
                </div>
                <div className="flex gap-2"><Input inputMode="numeric" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} placeholder="Mobile" /><Button variant="outline" disabled={phone.length !== 10} loading={busy} onClick={send}><MessageCircle /> WhatsApp</Button></div>
              </>
            )}
            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Waiting for payment…</p>
            <div className="flex justify-center gap-2">
              <Button size="sm" variant="outline" loading={busy} onClick={check}><RefreshCw /> Check now</Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={cancel}>Cancel request</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
