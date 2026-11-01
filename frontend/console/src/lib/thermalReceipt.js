import { get } from '@/lib/api';
import { esc, printHtml } from '@/lib/printHtml';

const amt = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (d) => new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Build the receipt HTML (58 / 80 mm). Exported for previews/tests. */
export function thermalHtml(d) {
  const inv = d.invoice;
  const w58 = d.print?.width === '58';
  const paper = w58 ? 58 : 80;
  const body = w58 ? 48 : 72; // printable width
  const fs = w58 ? 10.5 : 12;
  const who = inv.patient ? `${inv.patient.name} (${inv.patient.patientId})` : inv.customer?.name || 'Walk-in customer';
  const phone = inv.patient?.mobile || inv.customer?.phone;
  const itemDisc = (inv.discount || 0) - (inv.coupon?.discount || 0) - (inv.loyalty?.redeemValue || 0);
  const row = (k, v, cls = '') => `<tr class="${cls}"><td>${k}</td><td class="r">${v}</td></tr>`;
  const addr = [inv.branch?.address?.line1, inv.branch?.address?.city].filter(Boolean).join(', ');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.invoiceNo)}</title>
<style>
  @page { size: ${paper}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { width: ${body}mm; margin: 0 auto; padding: 3mm 0 6mm; font: ${fs}px/1.35 'Courier New', ui-monospace, monospace; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .c { text-align: center; } .r { text-align: right; white-space: nowrap; } .b { font-weight: 700; }
  .big { font-size: ${fs + 4}px; } .sm { font-size: ${fs - 2}px; }
  .hr { border-top: 1px dashed #000; margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; } td { padding: 1px 0; vertical-align: top; }
  .item td { padding-top: 3px; }
  .logo { max-width: 60%; max-height: 18mm; filter: grayscale(1) contrast(1.4); }
  .qr { width: ${w58 ? 26 : 30}mm; height: ${w58 ? 26 : 30}mm; image-rendering: pixelated; }
  .qr.pay { width: ${w58 ? 34 : 40}mm; height: ${w58 ? 34 : 40}mm; }
  .total td { font-size: ${fs + 3}px; font-weight: 700; padding: 3px 0; }
</style></head><body>
  <div class="c">
    ${d.clinic?.logo ? `<img class="logo" src="${esc(d.clinic.logo)}" alt=""><br>` : ''}
    <div class="b big">${esc(d.clinic?.name || '')}</div>
    ${inv.branch?.name ? `<div class="b">${esc(inv.branch.name)} Branch</div>` : ''}
    ${addr ? `<div class="sm">${esc(addr)}</div>` : ''}
    ${inv.branch?.phone || d.clinic?.phone ? `<div class="sm">Ph: ${esc(inv.branch?.phone || d.clinic?.phone)}</div>` : ''}
    ${inv.branch?.gstin || d.clinic?.gstin ? `<div class="sm">GSTIN: ${esc(inv.branch?.gstin || d.clinic?.gstin)}</div>` : ''}
  </div>
  <div class="hr"></div>
  <div class="c b">${inv.status === 'cancelled' ? 'CANCELLED BILL' : 'TAX INVOICE'}</div>
  <table class="sm">
    ${row('Bill No', esc(inv.invoiceNo))}
    ${row('Date', when(inv.createdAt))}
    ${row('Customer', esc(who))}
    ${phone ? row('Mobile', esc(phone)) : ''}
    ${inv.doctor?.name ? row('Doctor', esc(inv.doctor.name)) : ''}
  </table>
  <div class="hr"></div>
  <table>
    <tr class="b sm"><td>Item</td><td class="r">Amount</td></tr>
    ${inv.items.map((l) => `<tr class="item"><td colspan="2">${esc(l.description)}</td></tr>
      <tr class="sm"><td>&nbsp;${l.qty} x ${amt(l.rate)}${l.discountPct ? ` -${l.discountPct}%` : ''}${l.gstRate ? ` GST${l.gstRate}%` : ''}</td><td class="r">${amt(l.total)}</td></tr>`).join('')}
  </table>
  <div class="hr"></div>
  <table>
    ${row('Items total', amt(inv.subtotal))}
    ${itemDisc > 0.009 ? row('Discount', `-${amt(itemDisc)}`) : ''}
    ${inv.coupon?.discount ? row(`Coupon ${esc(inv.coupon.code)}`, `-${amt(inv.coupon.discount)}`) : ''}
    ${inv.loyalty?.redeemValue ? row(`Points (${inv.loyalty.redeemed})`, `-${amt(inv.loyalty.redeemValue)}`) : ''}
    ${inv.tax ? row('GST incl. (CGST+SGST)', amt(inv.tax), 'sm') : ''}
    ${inv.roundOff ? row('Round off', amt(inv.roundOff), 'sm') : ''}
  </table>
  <div class="hr"></div>
  <table>${row('TOTAL', `Rs ${amt(inv.grandTotal)}`, 'total')}</table>
  <div class="hr"></div>
  <table class="sm">
    ${(d.payments || []).map((p) => row(`${p.kind === 'refund' ? 'Refund' : p.kind === 'advance_adjust' ? 'Advance' : 'Paid'} ${String(p.mode).toUpperCase()}${p.reference ? ` ${esc(p.reference)}` : ''}`, `${p.kind === 'refund' ? '-' : ''}${amt(p.amount)}`)).join('')}
    ${row('Balance due', amt(inv.balance), 'b')}
  </table>
  ${inv.loyalty?.mobile && (inv.loyalty.earned || d.loyaltyBalance != null) ? `<div class="hr"></div><table class="sm">
    ${inv.loyalty.earned ? row('Points earned', `+${inv.loyalty.earned}`) : ''}
    ${d.loyaltyBalance != null ? row('Points balance', d.loyaltyBalance) : ''}</table>` : ''}
  <div class="hr"></div>
  ${d.qr?.image ? `<div class="c">${d.qr.kind === 'payment' ? '<div class="b">PAY BALANCE</div>' : ''}<img class="qr${d.qr.kind === 'payment' ? ' pay' : ''}" src="${d.qr.image}" alt="QR"><div class="b">${esc(d.qr.label || 'Scan to visit our website')}</div>${d.qr.sub ? `<div class="sm">${esc(d.qr.sub)}</div>` : ''}</div><div class="hr"></div>` : ''}
  ${d.print?.footer ? `<div class="c">${esc(d.print.footer)}</div>` : ''}
  <div class="c sm">${inv.createdBy?.name ? `Billed by ${esc(inv.createdBy.name)} · ` : ''}${when(new Date())}</div>
</body></html>`;
}

/** fetch + print a thermal receipt for an invoice */
export async function printThermal(invoiceId) {
  const d = await get(`/billing/invoices/${invoiceId}/thermal`);
  printHtml(thermalHtml(d));
}
