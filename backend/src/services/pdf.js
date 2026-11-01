import fs from 'node:fs';
import PDFDocument from 'pdfkit';

/**
 * PDF system — one letterhead for every document.
 * branding = { clinic, footer, logo (Buffer|null), color '#hex', rxFooter, showSignature }
 * Helvetica has no ₹ glyph → "Rs.".
 */
const A4 = { size: 'A4', margin: 40 };
const A5 = { size: 'A5', margin: 28 };
const GREY = '#5b6472';
const LIGHT = '#f3f6f8';
const LINE = '#dfe4ea';

const r2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const money = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateIN = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');
const timeIN = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const ymdIN = (ymd) => (ymd ? dateIN(`${ymd}T06:00:00Z`) : '');
const hhmm = (t = '') => {
  const [h, m] = t.split(':').map(Number);
  return Number.isFinite(h) ? `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` : '';
};
const ageOf = (p) => {
  if (!p) return '';
  if (p.dob) return `${Math.floor((Date.now() - new Date(p.dob)) / 31557600000)} Y`;
  return p.ageYears != null ? `${p.ageYears} Y` : '';
};
const sexOf = (g) => ({ male: 'M', female: 'F', other: 'O' })[g] || '';
const tint = (hex, a = 0.1) => {
  const h = String(hex || '#0f766e').replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (c) => Math.round(c + (255 - c) * (1 - a));
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
};

// ---------- amount in words (Indian system) ----------
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const three = (n) => `${n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' : ''}` : ''}${n % 100 ? two(n % 100) : ''}`;
export function inWords(amount) {
  let n = Math.floor(Math.abs(Number(amount) || 0));
  const paise = Math.round((Math.abs(Number(amount) || 0) - n) * 100);
  if (!n && !paise) return 'Zero Rupees Only';
  const parts = [];
  for (const [div, name] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']]) {
    if (n >= div) {
      parts.push(`${three(Math.floor(n / div))} ${name}`);
      n %= div;
    }
  }
  if (n) parts.push(three(n));
  return `${parts.join(' ')} Rupees${paise ? ` and ${two(paise)} Paise` : ''} Only`.trim();
}

// ---------- shared building blocks ----------
function newDoc(out, opts = A4, title) {
  const doc = new PDFDocument({ ...opts, bufferPages: true, info: { Title: title || 'Document', Author: 'Centre For Piles & Fistula' } });
  doc.pipe(out);
  return doc;
}

const W = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const L = (doc) => doc.page.margins.left;

/** letterhead: colour band, logo, clinic, branch, title pill + meta lines on the right */
function letterhead(doc, b, branch, title, metaLines = []) {
  const c = b.color || '#0f766e';
  const x0 = L(doc);
  const w = W(doc);
  const small = doc.page.width < 500;
  doc.rect(0, 0, doc.page.width, 6).fill(c);
  let x = x0;
  const top = small ? 18 : 24;
  const logoSize = small ? 40 : 54;
  if (b.logo) {
    try {
      doc.image(b.logo, x0, top, { fit: [logoSize, logoSize] });
      x = x0 + logoSize + 10;
    } catch {
      /* bad image → text header */
    }
  }
  const leftW = w * 0.62 - (x - x0);
  doc.fillColor(c).font('Helvetica-Bold').fontSize(small ? 12 : 16).text(b.clinic?.name || 'Centre For Piles & Fistula', x, top, { width: leftW });
  doc.fillColor(GREY).font('Helvetica').fontSize(small ? 6.5 : 8);
  if (b.clinic?.tagline) doc.text(b.clinic.tagline, x, doc.y + 1, { width: leftW });
  const addr = branch ? [branch.address?.line1, branch.address?.line2, branch.address?.city, branch.address?.pincode].filter(Boolean).join(', ') : b.clinic?.address;
  if (branch?.name) doc.font('Helvetica-Bold').fillColor('#333').text(`${branch.name} Branch`, x, doc.y + 2, { width: leftW }).font('Helvetica').fillColor(GREY);
  if (addr) doc.text(addr, x, doc.y + 1, { width: leftW });
  const contact = [branch?.phone || b.clinic?.phone ? `Ph: ${branch?.phone || b.clinic?.phone}` : null, b.clinic?.whatsapp ? `WhatsApp: ${b.clinic.whatsapp}` : null, branch?.email || b.clinic?.email].filter(Boolean).join('  |  ');
  if (contact) doc.text(contact, x, doc.y + 1, { width: leftW });
  const gst = branch?.gstin || b.clinic?.gstin;
  if (gst) doc.text(`GSTIN: ${gst}`, x, doc.y + 1, { width: leftW });
  const leftBottom = doc.y;

  // title pill
  const rx = x0 + w * 0.62;
  const rw = w * 0.38;
  doc.font('Helvetica-Bold').fontSize(small ? 9 : 11);
  const tw = doc.widthOfString(title) + 18;
  doc.roundedRect(x0 + w - tw, top, tw, small ? 16 : 20, 4).fill(c);
  doc.fillColor('#fff').text(title, x0 + w - tw, top + (small ? 4 : 5), { width: tw, align: 'center' });
  doc.fillColor('#222').font('Helvetica').fontSize(small ? 7 : 8.5);
  let y = top + (small ? 22 : 28);
  for (const [k, v] of metaLines) {
    if (!v) continue;
    doc.font('Helvetica-Bold').fillColor('#222').text(String(v), rx, y, { width: rw, align: 'right' });
    const vw = Math.min(doc.widthOfString(String(v)), rw);
    doc.font('Helvetica').fillColor(GREY).text(`${k}:`, rx, y, { width: rw - vw - 4, align: 'right' });
    y = doc.y + 1;
  }
  const bottom = Math.max(leftBottom, y, top + logoSize) + 8;
  doc.moveTo(x0, bottom).lineTo(x0 + w, bottom).lineWidth(1).strokeColor(c).stroke();
  doc.y = bottom + 10;
  doc.x = x0;
  doc.fillColor('#222').font('Helvetica').fontSize(9);
}

/** page footers on every page (after content, using bufferPages) */
function finalize(doc, b, note) {
  // QR → main website, bottom-right of the last page
  if (b.qr) {
    const small = doc.page.width < 500;
    const size = small ? 46 : 58;
    ensureSpace(doc, size + 10);
    const x0 = L(doc);
    const w = W(doc);
    const y = Math.max(doc.y + 6, 0);
    try {
      doc.image(b.qr, x0 + w - size, y, { width: size, height: size });
      const label = (b.qrUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
      doc.font('Helvetica-Bold').fontSize(small ? 6.5 : 7.5).fillColor('#222').text('Scan to visit our website', x0 + w - size - 170, y + size / 2 - 9, { width: 162, align: 'right' });
      doc.font('Helvetica').fontSize(small ? 6 : 7).fillColor(GREY).text(label, x0 + w - size - 170, doc.y + 1, { width: 162, align: 'right' });
      doc.y = y + size + 4;
    } catch {
      /* QR is optional */
    }
  }
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const small = doc.page.width < 500;
    const y = doc.page.height - (small ? 26 : 34);
    const x0 = L(doc);
    const w = W(doc);
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(x0, y - 6).lineTo(x0 + w, y - 6).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font('Helvetica').fontSize(small ? 6 : 7).fillColor(GREY);
    doc.text([note, b.clinic?.website?.replace(/^https?:\/\//, '')].filter(Boolean).join('  ·  '), x0, y, { width: w * 0.8, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, x0 + w * 0.8, y, { width: w * 0.2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = keep;
  }
  doc.end();
}

function ensureSpace(doc, h) {
  if (doc.y + h > doc.page.height - doc.page.margins.bottom - 40) doc.addPage();
}

/** two-column info box */
function infoBox(doc, b, left, right) {
  const x0 = L(doc);
  const w = W(doc);
  const top = doc.y;
  const pad = 8;
  const colW = w / 2 - pad * 2;
  const measure = (rows) => rows.filter(([, v]) => v).length * 12 + 16;
  const h = Math.max(measure(left.rows), measure(right.rows)) + 4;
  doc.roundedRect(x0, top, w, h, 4).fill(tint(b.color, 0.07));
  const col = (x, block) => {
    doc.fillColor(b.color).font('Helvetica-Bold').fontSize(7.5).text(block.title.toUpperCase(), x, top + pad, { width: colW });
    let y = top + pad + 12;
    for (const [k, v] of block.rows) {
      if (!v) continue;
      doc.font('Helvetica').fillColor(GREY).fontSize(8.5).text(k ? `${k}: ` : '', x, y, { width: colW, continued: Boolean(k) });
      doc.font(k ? 'Helvetica' : 'Helvetica-Bold').fillColor('#222').text(String(v), { width: colW });
      y += 12;
    }
  };
  col(x0 + pad, left);
  col(x0 + w / 2 + pad, right);
  doc.y = top + h + 10;
  doc.x = x0;
}

/** table with coloured header, zebra rows, page breaks repeat header */
function table(doc, b, cols, rows) {
  const x0 = L(doc);
  const w = W(doc);
  const totalFr = cols.reduce((a, c) => a + c.w, 0);
  const widths = cols.map((c) => (c.w / totalFr) * w);
  const xs = widths.reduce((a, cw, i) => [...a, i ? a[i - 1] + widths[i - 1] : x0], []);
  const header = () => {
    const y = doc.y;
    doc.rect(x0, y, w, 18).fill(b.color);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
    cols.forEach((c, i) => doc.text(c.label, xs[i] + 4, y + 5, { width: widths[i] - 8, align: c.align || 'left' }));
    doc.y = y + 18;
  };
  header();
  rows.forEach((r, ri) => {
    doc.font('Helvetica').fontSize(8.5);
    const cells = cols.map((c) => (typeof c.v === 'function' ? c.v(r, ri) : r[c.v]));
    const heights = cells.map((v, i) => doc.heightOfString(String(v ?? ''), { width: widths[i] - 8 }));
    const h = Math.max(...heights, 10) + 8;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom - 50) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    if (ri % 2) doc.rect(x0, y, w, h).fill(LIGHT);
    cells.forEach((v, i) => {
      const c = cols[i];
      doc.fillColor(c.color?.(r) || '#222').font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).text(String(v ?? ''), xs[i] + 4, y + 4, { width: widths[i] - 8, align: c.align || 'left' });
    });
    doc.y = y + h;
    doc.moveTo(x0, doc.y).lineTo(x0 + w, doc.y).lineWidth(0.4).strokeColor(LINE).stroke();
  });
  doc.y += 8;
  doc.x = x0;
}

function totalsBox(doc, b, rows, width = 220) {
  const x = L(doc) + W(doc) - width;
  ensureSpace(doc, rows.length * 15 + 20);
  let y = doc.y;
  for (const r of rows) {
    if (r.hide) continue;
    if (r.big) {
      doc.rect(x, y - 2, width, 20).fill(b.color);
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10).text(r.k, x + 8, y + 3, { width: width / 2 }).text(r.v, x + width / 2, y + 3, { width: width / 2 - 8, align: 'right' });
      y += 22;
    } else {
      doc.fillColor(r.color || '#333').font(r.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(r.k, x + 8, y, { width: width / 2 }).text(r.v, x + width / 2, y, { width: width / 2 - 8, align: 'right' });
      y += 14;
    }
  }
  return y;
}

function signature(doc, b, label, name, image) {
  ensureSpace(doc, image ? 90 : 60);
  const x = L(doc) + W(doc) - 170;
  let y = doc.y + 30;
  if (image) {
    try {
      doc.image(image, x + 25, doc.y + 4, { fit: [120, 50], align: 'center', valign: 'bottom' });
      y = doc.y + 58;
    } catch { /* missing / unreadable file → plain line */ }
  }
  doc.moveTo(x, y).lineTo(x + 170, y).lineWidth(0.6).strokeColor('#999').stroke();
  doc.fillColor('#222').font('Helvetica-Bold').fontSize(8.5).text(name || '', x, y + 4, { width: 170, align: 'center' });
  doc.font('Helvetica').fillColor(GREY).fontSize(7.5).text(label, x, doc.y, { width: 170, align: 'center' });
  doc.y += 6;
}

function section(doc, b, title, body) {
  if (!body) return;
  ensureSpace(doc, 30);
  doc.fillColor(b.color).font('Helvetica-Bold').fontSize(9).text(title, L(doc), doc.y);
  doc.fillColor('#222').font('Helvetica').fontSize(9).text(body, { width: W(doc) });
  doc.moveDown(0.5);
}

// ================================================================ INVOICE
export function renderInvoicePdf(inv, b, out) {
  const doc = newDoc(out, A4, inv.invoiceNo);
  const cancelled = inv.status === 'cancelled';
  letterhead(doc, b, inv.branch, cancelled ? 'INVOICE · CANCELLED' : 'TAX INVOICE', [
    ['Invoice No', inv.invoiceNo],
    ['Date', `${dateIN(inv.createdAt)} ${timeIN(inv.createdAt)}`],
    ['Status', String(inv.status).replace('_', ' ').toUpperCase()],
  ]);
  const p = inv.patient;
  infoBox(doc, b,
    { title: 'Billed to', rows: p ? [['', p.name], ['Patient ID', p.patientId], ['Age / Sex', [ageOf(p), sexOf(p.gender)].filter(Boolean).join(' / ')], ['Mobile', p.mobile]] : [['', inv.customer?.name || 'Walk-in customer'], ['Mobile', inv.customer?.phone]] },
    { title: 'Details', rows: [['Type', String(inv.type || '').replace(/^\w/, (c) => c.toUpperCase())], ['Doctor', inv.doctor?.name], ['Source', inv.source === 'pos' ? 'Pharmacy POS' : 'Billing'], ['Prepared by', inv.createdBy?.name]] }
  );
  table(doc, b, [
    { label: '#', w: 4, v: (_, i) => i + 1 },
    { label: 'Description', w: 34, v: (l) => `${l.description}${l.allocations?.length ? `\nBatch ${l.allocations.map((a) => `${a.batchNo} (exp ${String(a.expiry).slice(0, 7)})`).join(', ')}` : ''}${l.returnedQty ? `\nReturned: ${l.returnedQty}` : ''}` },
    { label: 'HSN', w: 8, v: (l) => l.hsn || '' },
    { label: 'Qty', w: 6, v: 'qty', align: 'right' },
    { label: 'Rate', w: 11, v: (l) => Number(l.rate).toFixed(2), align: 'right' },
    { label: 'Disc', w: 7, v: (l) => (l.discountPct ? `${l.discountPct}%` : '-'), align: 'right' },
    { label: 'GST', w: 7, v: (l) => `${l.gstRate}%`, align: 'right' },
    { label: 'Taxable', w: 11, v: (l) => Number(l.taxable).toFixed(2), align: 'right' },
    { label: 'Amount', w: 12, v: (l) => Number(l.total).toFixed(2), align: 'right', bold: true },
  ], inv.items);

  const startY = doc.y;
  // GST summary (left) + totals (right)
  const slabs = {};
  for (const l of inv.items) {
    const k = l.gstRate;
    slabs[k] ||= { taxable: 0, cgst: 0, sgst: 0 };
    slabs[k].taxable += l.taxable;
    slabs[k].cgst += l.cgst;
    slabs[k].sgst += l.sgst;
  }
  doc.fillColor(b.color).font('Helvetica-Bold').fontSize(8).text('GST SUMMARY', L(doc), startY);
  let gy = doc.y + 2;
  doc.font('Helvetica').fontSize(7.5).fillColor(GREY);
  for (const [rate, s] of Object.entries(slabs)) {
    doc.text(`${rate}%  Taxable ${s.taxable.toFixed(2)}  ·  CGST ${s.cgst.toFixed(2)}  ·  SGST ${s.sgst.toFixed(2)}`, L(doc), gy, { width: W(doc) - 240 });
    gy = doc.y + 1;
  }
  doc.y = startY;
  const endY = totalsBox(doc, b, [
    { k: 'Sub total', v: money(inv.subtotal) },
    { k: 'Discount', v: `- ${money(r2(inv.discount - (inv.coupon?.discount || 0) - (inv.loyalty?.redeemValue || 0)))}`, hide: !(inv.discount - (inv.coupon?.discount || 0) - (inv.loyalty?.redeemValue || 0) > 0.009) },
    { k: `Coupon ${inv.coupon?.code || ''}`, v: `- ${money(inv.coupon?.discount)}`, hide: !inv.coupon?.discount },
    { k: `Loyalty (${inv.loyalty?.redeemed || 0} pts)`, v: `- ${money(inv.loyalty?.redeemValue)}`, hide: !inv.loyalty?.redeemValue },
    { k: 'Taxable value', v: money(inv.taxable) },
    { k: 'CGST', v: money(inv.cgst) },
    { k: 'SGST', v: money(inv.sgst) },
    { k: 'Round off', v: money(inv.roundOff), hide: !inv.roundOff },
    { k: 'Grand Total', v: money(inv.grandTotal), big: true },
    { k: 'Paid', v: money(inv.paid) },
    { k: 'Refunded', v: money(inv.refunded), hide: !inv.refunded },
    { k: 'Balance due', v: money(inv.balance), bold: true, color: inv.balance > 0 ? '#b45309' : '#047857' },
  ]);
  doc.y = Math.max(endY, gy) + 6;
  doc.x = L(doc);
  doc.font('Helvetica-Oblique').fontSize(8).fillColor('#333').text(`Amount in words: ${inWords(inv.grandTotal)}`, { width: W(doc) });
  if (inv.taxInclusive) doc.font('Helvetica').fontSize(7).fillColor(GREY).text('Prices are inclusive of GST.');
  if (inv.loyalty?.earned && inv.status !== 'cancelled') doc.font('Helvetica-Bold').fontSize(8).fillColor('#047857').text(`Loyalty points earned on this bill: ${inv.loyalty.earned}`);
  if (inv.payments?.length) {
    doc.moveDown(0.6);
    doc.fillColor(b.color).font('Helvetica-Bold').fontSize(8).text('PAYMENTS');
    doc.font('Helvetica').fontSize(8).fillColor('#333');
    for (const pm of inv.payments) doc.text(`${dateIN(pm.createdAt)}  ·  ${pm.receiptNo}  ·  ${pm.kind === 'refund' ? 'Refund' : pm.kind === 'advance_adjust' ? 'Advance used' : 'Paid'} via ${String(pm.mode).toUpperCase()}${pm.reference ? ` (${pm.reference})` : ''}  ·  ${pm.kind === 'refund' ? '-' : ''}${money(pm.amount)}`);
  }
  if (inv.cancelReason) doc.moveDown(0.4).fillColor('#b91c1c').fontSize(8.5).text(`Cancelled: ${inv.cancelReason}`);
  if (inv.notes) section(doc, b, 'Notes', inv.notes);
  signature(doc, b, 'Authorised signatory', b.clinic?.name);
  if (cancelled) {
    doc.save().rotate(-30, { origin: [300, 420] }).fontSize(70).fillColor('#dc2626').opacity(0.12).text('CANCELLED', 90, 380).restore();
  }
  finalize(doc, b, b.footer || 'Thank you. Get well soon.');
}

// ================================================================ PRESCRIPTION
export function renderPrescriptionPdf(rx, b, out, images = []) {
  const doc = newDoc(out, A4, rx.rxNo);
  const d = rx.doctor || {};
  letterhead(doc, b, rx.branch, 'PRESCRIPTION', [['Rx No', rx.rxNo], ['Date', dateIN(rx.createdAt)], ['Time', timeIN(rx.createdAt)]]);
  // doctor block
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(12).text(d.name || '', L(doc), doc.y);
  doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text([d.qualification, d.specialization].filter(Boolean).join(' · '));
  if (d.regNo) doc.text(`Reg. No: ${d.regNo}`);
  doc.moveDown(0.6);
  const p = rx.patient || {};
  infoBox(doc, b,
    { title: 'Patient', rows: [['', p.name], ['Patient ID', p.patientId], ['Age / Sex', [ageOf(p), sexOf(p.gender)].filter(Boolean).join(' / ')], ['Mobile', p.mobile]] },
    { title: 'Visit', rows: [['Booking', rx.appointment?.bookingId], ['Allergies', p.allergies?.length ? p.allergies.join(', ') : 'None known'], ['Blood group', p.bloodGroup], ['Type', rx.templateName]] }
  );
  const v = rx.vitals || {};
  const vit = [v.bp && `BP ${v.bp}`, v.pulse && `Pulse ${v.pulse}/min`, v.temp && `Temp ${v.temp}°F`, v.weightKg && `Wt ${v.weightKg} kg`, v.spo2 && `SpO2 ${v.spo2}%`].filter(Boolean).join('    ');
  if (vit) {
    doc.roundedRect(L(doc), doc.y, W(doc), 18, 3).fill(LIGHT);
    doc.fillColor('#222').font('Helvetica').fontSize(8.5).text(vit, L(doc) + 8, doc.y + 5, { width: W(doc) - 16 });
    doc.y += 12;
    doc.x = L(doc);
  }
  section(doc, b, 'Chief complaints', rx.complaints);
  section(doc, b, 'Diagnosis', rx.diagnosis);

  if (rx.items?.length) {
    ensureSpace(doc, 60);
    doc.fillColor(b.color).font('Helvetica-Bold').fontSize(22).text('Rx', L(doc), doc.y);
    table(doc, b, [
      { label: '#', w: 4, v: (_, i) => i + 1 },
      { label: 'Medicine', w: 34, v: (i) => `${i.name}${i.notes ? `\n${i.notes}` : ''}`, bold: true },
      { label: 'Dose', w: 14, v: 'dose' },
      { label: 'Frequency', w: 12, v: 'frequency' },
      { label: 'When', w: 18, v: 'timing' },
      { label: 'Duration', w: 12, v: 'duration' },
      { label: 'Qty', w: 6, v: (i) => i.qty || '', align: 'right' },
    ], rx.items);
  }
  section(doc, b, 'Investigations advised', rx.investigations);
  section(doc, b, 'Advice', rx.advice);
  section(doc, b, 'Diet', rx.diet);
  if (rx.followUpDate) {
    ensureSpace(doc, 30);
    const y = doc.y;
    doc.roundedRect(L(doc), y, 230, 22, 4).fill(tint(b.color, 0.12));
    doc.fillColor(b.color).font('Helvetica-Bold').fontSize(9.5).text(`Next visit: ${ymdIN(rx.followUpDate)}`, L(doc) + 10, y + 6.5);
    doc.y = y + 30;
    doc.x = L(doc);
  }
  if (b.showSignature !== false) signature(doc, b, 'Signature', [d.name, d.regNo ? `Reg. No. ${d.regNo}` : ''].filter(Boolean).join(' · '), b.signatureImage && fs.existsSync(b.signatureImage) ? b.signatureImage : null);
  if (b.rxFooter) {
    doc.moveDown(0.4);
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(GREY).text(b.rxFooter, L(doc), doc.y, { width: W(doc) });
  }
  // handwritten / scanned prescription images: one per page, fitted
  for (const img of images) {
    try {
      const buf = Buffer.isBuffer(img) ? img : fs.readFileSync(img);
      doc.addPage();
      letterhead(doc, b, rx.branch, 'PRESCRIPTION', [['Rx No', rx.rxNo], ['Patient', p.name]]);
      const top = doc.y;
      doc.image(buf, L(doc), top, { fit: [W(doc), doc.page.height - top - 70], align: 'center' });
    } catch {
      /* unreadable image skipped */
    }
  }
  finalize(doc, b, 'This prescription is valid for the patient named above only.');
}

// ================================================================ RECEIPT (A5)
export function renderReceiptPdf(pm, b, out) {
  const doc = newDoc(out, A5, pm.receiptNo);
  const refund = pm.kind === 'refund';
  letterhead(doc, b, pm.branch, refund ? 'REFUND RECEIPT' : 'PAYMENT RECEIPT', [['Receipt', pm.receiptNo], ['Date', `${dateIN(pm.createdAt)} ${timeIN(pm.createdAt)}`]]);
  const p = pm.patient;
  infoBox(doc, b,
    { title: refund ? 'Refunded to' : 'Received from', rows: [['', p?.name || pm.invoice?.customer?.name || 'Customer'], ['Patient ID', p?.patientId], ['Mobile', p?.mobile || pm.invoice?.customer?.phone]] },
    { title: 'Against', rows: [['Invoice', pm.invoice?.invoiceNo], ['Kind', { payment: 'Payment', advance: 'Advance', advance_adjust: 'Advance adjusted', refund: 'Refund' }[pm.kind]], ['Mode', String(pm.mode).toUpperCase()], ['Ref', pm.reference]] }
  );
  const y = doc.y;
  doc.roundedRect(L(doc), y, W(doc), 46, 6).fill(tint(b.color, 0.12));
  doc.fillColor(GREY).font('Helvetica').fontSize(8).text(refund ? 'Amount refunded' : 'Amount received', L(doc) + 12, y + 8);
  doc.fillColor(b.color).font('Helvetica-Bold').fontSize(18).text(money(pm.amount), L(doc) + 12, y + 20);
  doc.y = y + 54;
  doc.x = L(doc);
  doc.font('Helvetica-Oblique').fontSize(8).fillColor('#333').text(inWords(pm.amount), { width: W(doc) });
  if (pm.invoice) {
    doc.moveDown(0.5).font('Helvetica').fontSize(8.5).fillColor('#333');
    doc.text(`Invoice total ${money(pm.invoice.grandTotal)}  ·  Paid ${money(pm.invoice.paid)}  ·  Balance ${money(pm.invoice.balance)}`);
  }
  if (pm.notes) doc.moveDown(0.3).fontSize(8).fillColor(GREY).text(pm.notes);
  signature(doc, b, 'Received by', pm.by?.name);
  finalize(doc, b, b.footer || 'Thank you.');
}

// ================================================================ APPOINTMENT SLIP (A5)
export function renderAppointmentSlipPdf(a, b, out) {
  const doc = newDoc(out, A5, a.bookingId);
  letterhead(doc, b, a.branch, 'APPOINTMENT', [['Booking', a.bookingId], ['Status', String(a.status).replace('_', ' ').toUpperCase()]]);
  const y = doc.y;
  const w = W(doc);
  doc.roundedRect(L(doc), y, w, 64, 6).fill(tint(b.color, 0.12));
  doc.fillColor(GREY).font('Helvetica').fontSize(8).text('Date & time', L(doc) + 12, y + 8);
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(14).text(`${ymdIN(a.date)}`, L(doc) + 12, y + 20).fontSize(12).text(hhmm(a.start), L(doc) + 12, y + 40);
  if (a.tokenNo) {
    doc.fillColor(GREY).font('Helvetica').fontSize(8).text('Token', L(doc) + w - 92, y + 8, { width: 80, align: 'right' });
    doc.fillColor(b.color).font('Helvetica-Bold').fontSize(30).text(String(a.tokenNo), L(doc) + w - 92, y + 20, { width: 80, align: 'right' });
  }
  doc.y = y + 74;
  doc.x = L(doc);
  const p = a.patient || {};
  infoBox(doc, b,
    { title: 'Patient', rows: [['', p.name], ['Patient ID', p.patientId], ['Age / Sex', [ageOf(p), sexOf(p.gender)].filter(Boolean).join(' / ')], ['Mobile', p.mobile]] },
    { title: 'Doctor', rows: [['', a.doctor?.name], ['', a.doctor?.qualification], ['Visit', a.visitType], ['Complaint', a.complaint]] }
  );
  section(doc, b, 'Please note', '• Arrive 10 minutes before your slot.\n• Carry previous reports and prescriptions.\n• Reschedule or cancel from the booking portal or by calling the branch.');
  if (a.branch?.address?.mapUrl) doc.font('Helvetica').fontSize(8).fillColor(b.color).text(`Map: ${a.branch.address.mapUrl}`, { link: a.branch.address.mapUrl });
  finalize(doc, b, `Generated ${dateIN(new Date())}`);
}

// ================================================================ IPD — admission sheet (face sheet + consent)
const dtIN = (d) => (d ? `${dateIN(d)}, ${timeIN(d)}` : '');
const PAYER = { self: 'Self pay', insurance: 'Insurance / TPA', corporate: 'Corporate', government: 'Government scheme' };

export function renderAdmissionPdf(a, b, out) {
  const doc = newDoc(out, A4, a.admissionNo);
  letterhead(doc, b, a.branch, 'ADMISSION', [['Adm. No', a.admissionNo], ['Admitted', dateIN(a.admittedAt)], ['Time', timeIN(a.admittedAt)]]);
  const p = a.patient || {};
  infoBox(doc, b,
    { title: 'Patient', rows: [['', p.name], ['Patient ID', p.patientId], ['Age / Sex', [ageOf(p), sexOf(p.gender)].filter(Boolean).join(' / ')], ['Mobile', p.mobile], ['Blood group', p.bloodGroup], ['Allergies', a.allergies || (p.allergies?.length ? p.allergies.join(', ') : 'None known')]] },
    { title: 'Admission', rows: [['Type', { planned: 'Planned', emergency: 'Emergency', day_care: 'Day care' }[a.type]], ['Consultant', a.doctor?.name], ['Ward / Bed', [a.ward?.name, a.bed?.number && `Bed ${a.bed.number}`].filter(Boolean).join(' · ')], ['Expected discharge', a.expectedDischargeAt && dateIN(a.expectedDischargeAt)], ['Payer', PAYER[a.payer?.type || 'self']], ['Estimate', a.estimate ? money(a.estimate) : '']] }
  );
  section(doc, b, 'Reason for admission', a.reason);
  section(doc, b, 'Provisional diagnosis', a.provisionalDiagnosis);
  section(doc, b, 'Planned procedure', a.plannedProcedure?.name);
  if (a.payer?.type && a.payer.type !== 'self') section(doc, b, 'Insurance / TPA', [a.payer.insurer, a.payer.tpa && `TPA: ${a.payer.tpa}`, a.payer.policyNo && `Policy: ${a.payer.policyNo}`, a.payer.cardNo && `Card: ${a.payer.cardNo}`, a.payer.preAuthNo && `Pre-auth: ${a.payer.preAuthNo} (${a.payer.preAuthStatus || 'pending'})`].filter(Boolean).join('  ·  '));
  section(doc, b, 'Attendant', [a.attendant?.name, a.attendant?.relation, a.attendant?.phone].filter(Boolean).join(' · '));
  ensureSpace(doc, 180);
  doc.moveDown(0.4);
  doc.fillColor(b.color).font('Helvetica-Bold').fontSize(10).text('Consent for admission & treatment', L(doc), doc.y);
  doc.fillColor('#333').font('Helvetica').fontSize(8.5).text(
    `I, the undersigned, consent to the admission of the above patient to ${b.clinic?.name || 'the hospital'} and to such investigations, anaesthesia, procedures and treatment as the treating doctor considers necessary. ` +
    'The nature of the illness, the proposed procedure, its expected benefits, common risks and alternatives have been explained to me in a language I understand, and I had the opportunity to ask questions. ' +
    'I understand that no guarantee has been given about the result. I agree to follow hospital rules and to pay the hospital charges as per the tariff.',
    { width: W(doc), align: 'justify', lineGap: 1.5 });
  doc.moveDown(2.2);
  const y = doc.y;
  const col = W(doc) / 3;
  [['Patient / guardian', a.consent?.signedBy], ['Relation', a.consent?.relation], ['Witness', a.consent?.witness]].forEach(([l, v], i) => {
    const x = L(doc) + col * i;
    doc.moveTo(x + 6, y).lineTo(x + col - 12, y).lineWidth(0.6).strokeColor('#999').stroke();
    doc.fillColor('#222').font('Helvetica-Bold').fontSize(8.5).text(v || '', x + 6, y + 4, { width: col - 18 });
    doc.font('Helvetica').fillColor(GREY).fontSize(7.5).text(l, x + 6, doc.y, { width: col - 18 });
  });
  doc.y = y + 40;
  doc.x = L(doc);
  finalize(doc, b, 'Please keep this sheet with the patient file.');
}

// ================================================================ IPD — discharge summary
export function renderDischargeSummaryPdf(a, b, out) {
  const doc = newDoc(out, A4, a.admissionNo);
  const d = a.discharge || {};
  letterhead(doc, b, a.branch, 'DISCHARGE SUMMARY', [['Adm. No', a.admissionNo], ['Admitted', dateIN(a.admittedAt)], ['Discharged', a.dischargedAt ? dateIN(a.dischargedAt) : 'Pending']]);
  const p = a.patient || {};
  const proc = (a.procedures || []).filter((x) => x.status === 'done');
  infoBox(doc, b,
    { title: 'Patient', rows: [['', p.name], ['Patient ID', p.patientId], ['Age / Sex', [ageOf(p), sexOf(p.gender)].filter(Boolean).join(' / ')], ['Mobile', p.mobile], ['Address', [p.address?.line1, p.address?.city].filter(Boolean).join(', ')]] },
    { title: 'Stay', rows: [['Consultant', a.doctor?.name], ['Ward / Bed', [a.ward?.name, a.bed?.number && `Bed ${a.bed.number}`].filter(Boolean).join(' · ')], ['Admitted', dtIN(a.admittedAt)], ['Discharged', dtIN(a.dischargedAt)], ['Discharge type', { normal: 'Normal / on advice', lama: 'LAMA', dama: 'DAMA', referred: 'Referred', death: 'Death', absconded: 'Absconded' }[d.type || 'normal']]] }
  );
  section(doc, b, 'Reason for admission', a.reason);
  section(doc, b, 'Final diagnosis', d.finalDiagnosis || a.provisionalDiagnosis);
  section(doc, b, 'Procedure(s) performed', d.procedureDone || proc.map((x) => `${x.name}${x.endedAt ? ` on ${dateIN(x.endedAt)}` : ''}${x.anaesthesia && x.anaesthesia !== 'none' ? ` under ${x.anaesthesia} anaesthesia` : ''}${x.surgeon?.name ? ` by ${x.surgeon.name}` : ''}`).join('\n'));
  if (proc.some((x) => x.findings)) section(doc, b, 'Operative findings', proc.map((x) => x.findings).filter(Boolean).join('\n'));
  section(doc, b, 'Course in hospital', d.courseInHospital);
  section(doc, b, 'Investigations', d.investigations);
  section(doc, b, 'Condition at discharge', d.conditionAtDischarge);
  if (d.medications?.length) {
    ensureSpace(doc, 60);
    doc.fillColor(b.color).font('Helvetica-Bold').fontSize(9).text('Medicines on discharge', L(doc), doc.y);
    doc.moveDown(0.2);
    table(doc, b, [
      { label: '#', w: 4, v: (_, i) => i + 1 },
      { label: 'Medicine', w: 36, v: 'name', bold: true },
      { label: 'Dose', w: 14, v: 'dose' },
      { label: 'Frequency', w: 14, v: 'frequency' },
      { label: 'Duration', w: 12, v: 'duration' },
      { label: 'Instructions', w: 20, v: 'instructions' },
    ], d.medications);
  }
  section(doc, b, 'Advice', d.advice);
  section(doc, b, 'Diet', d.diet);
  if (d.referredTo) section(doc, b, 'Referred to', d.referredTo);
  if (d.followUpDate) {
    ensureSpace(doc, 30);
    const y = doc.y;
    doc.roundedRect(L(doc), y, 300, 22, 4).fill(tint(b.color, 0.12));
    doc.fillColor(b.color).font('Helvetica-Bold').fontSize(9.5).text(`Follow-up: ${ymdIN(d.followUpDate)}${d.followUpNote ? ` — ${d.followUpNote}` : ''}`, L(doc) + 10, y + 6.5, { width: 280 });
    doc.y = y + 30;
    doc.x = L(doc);
  }
  ensureSpace(doc, 40);
  doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(GREY).text('In case of fever, bleeding, severe pain, inability to pass urine or any emergency, contact the hospital immediately or visit the nearest emergency.', L(doc), doc.y, { width: W(doc) });
  if (b.showSignature !== false) signature(doc, b, 'Consultant', [a.doctor?.name, a.doctor?.regNo ? `Reg. No. ${a.doctor.regNo}` : ''].filter(Boolean).join(' · '), b.signatureImage && fs.existsSync(b.signatureImage) ? b.signatureImage : null);
  finalize(doc, b, b.footer || 'Get well soon.');
}

// ================================================================ IPD — interim bill / estimate
export function renderIpdBillPdf(a, bill, b, out, kind = 'interim') {
  const est = kind === 'estimate';
  const doc = newDoc(out, A4, a.admissionNo);
  letterhead(doc, b, a.branch, est ? 'ESTIMATE' : 'INTERIM BILL', [['Adm. No', a.admissionNo], ['Date', dateIN(new Date())], ['Time', timeIN(new Date())]]);
  const p = a.patient || {};
  infoBox(doc, b,
    { title: 'Patient', rows: [['', p.name], ['Patient ID', p.patientId], ['Age / Sex', [ageOf(p), sexOf(p.gender)].filter(Boolean).join(' / ')], ['Mobile', p.mobile]] },
    { title: 'Stay', rows: [['Consultant', a.doctor?.name], ['Ward / Bed', [a.ward?.name, a.bed?.number && `Bed ${a.bed.number}`].filter(Boolean).join(' · ')], ['Admitted', dtIN(a.admittedAt)], [est ? 'Planned stay' : 'Days so far', est ? `${bill.days} day(s)` : `${bill.days}`], ['Payer', PAYER[a.payer?.type || 'self']]] }
  );
  if (est && a.plannedProcedure?.name) section(doc, b, 'Planned procedure', a.plannedProcedure.name);
  table(doc, b, [
    { label: '#', w: 4, v: (_, i) => i + 1 },
    ...(est ? [] : [{ label: 'Date', w: 11, v: (l) => (l.date ? dateIN(l.date) : '') }]),
    { label: 'Particulars', w: est ? 54 : 45, v: 'description', bold: true },
    { label: 'Qty', w: 7, v: 'qty', align: 'right' },
    { label: 'Rate', w: 14, v: (l) => money(l.rate), align: 'right' },
    { label: 'Amount', w: 16, v: (l) => (l.included ? 'Included' : money(l.amount)), align: 'right' },
  ], bill.lines);
  const rows = [{ k: 'Total', v: money(bill.total), bold: true, big: est }];
  if (!est) {
    if (bill.advance) rows.push({ k: 'Advance received', v: `- ${money(bill.advance)}` });
    if (bill.approved) rows.push({ k: 'Insurance approved', v: money(bill.approved) });
    rows.push({ k: 'Balance (approx.)', v: money(Math.max(0, bill.total - (bill.advance || 0))), big: true });
  }
  doc.y = totalsBox(doc, b, rows, 260) + 6;
  doc.x = L(doc);
  if (est) {
    if (bill.inclusions?.length) section(doc, b, 'Package includes', bill.inclusions.map((x) => `• ${x}`).join('\n'));
    if (bill.exclusions?.length) section(doc, b, 'Not included (charged extra if used)', bill.exclusions.map((x) => `• ${x}`).join('\n'));
    section(doc, b, 'Notes', 'This is an approximate estimate based on the planned treatment and expected length of stay. Actual charges may vary with the patient’s condition, length of stay, room change, medicines, consumables and investigations used. Estimate valid for 15 days.');
  } else {
    doc.moveDown(0.3);
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(GREY).text('Provisional bill for information. Room & nursing are charged per day; the final bill is issued at discharge.', L(doc), doc.y, { width: W(doc) });
  }
  signature(doc, b, 'Billing', b.clinic?.name);
  finalize(doc, b, b.footer || '');
}
