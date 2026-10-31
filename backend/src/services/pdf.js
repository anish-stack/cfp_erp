import PDFDocument from 'pdfkit';

const inr = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const BRAND = '#0f766e';

function header(doc, clinic, branch, title, logo) {
  let x = 40;
  if (logo) {
    try {
      doc.image(logo, 40, 34, { fit: [56, 56] });
      x = 104;
    } catch {
      /* corrupt image → text-only header */
    }
  }
  doc.fillColor(BRAND).fontSize(16).font('Helvetica-Bold').text(clinic?.name || 'Centre for Piles & Fistula', x, 40, { width: 330 });
  doc.fillColor('#333').fontSize(9).font('Helvetica');
  if (clinic?.tagline) doc.text(clinic.tagline, x, doc.y, { width: 330 });
  const addr = [branch?.address?.line1, branch?.address?.line2, branch?.address?.city, branch?.address?.pincode].filter(Boolean).join(', ');
  doc.text(`${branch?.name || ''} Branch${addr ? ` · ${addr}` : ''}`, x, doc.y, { width: 330 });
  doc.text([branch?.phone && `Ph: ${branch.phone}`, branch?.email || clinic?.email, (branch?.gstin || clinic?.gstin) && `GSTIN: ${branch?.gstin || clinic?.gstin}`].filter(Boolean).join('  ·  '), x, doc.y, { width: 330 });
  doc.fillColor(BRAND).fontSize(13).font('Helvetica-Bold').text(title, 40, 40, { align: 'right' });
  const lineY = Math.max(100, doc.y + 6);
  doc.moveTo(40, lineY).lineTo(555, lineY).strokeColor(BRAND).lineWidth(1).stroke();
  doc.fillColor('#000').font('Helvetica').fontSize(9);
  doc.y = lineY + 10;
}

const age = (p) => {
  if (!p) return '';
  if (p.dob) return `${Math.floor((Date.now() - new Date(p.dob)) / 31557600000)}y`;
  return p.ageYears != null ? `${p.ageYears}y` : '';
};

/** Stream invoice PDF into writable (res). inv populated: branch, patient, doctor, createdBy */
export function renderInvoicePdf(inv, clinic, footer, out, logo) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(out);
  header(doc, clinic, inv.branch, inv.status === 'cancelled' ? 'TAX INVOICE (CANCELLED)' : 'TAX INVOICE', logo);

  const top = doc.y;
  doc.font('Helvetica-Bold').text('Bill To', 40, top);
  doc.font('Helvetica');
  if (inv.patient) {
    doc.text(`${inv.patient.name} (${inv.patient.patientId})`);
    doc.text(`${[inv.patient.gender, age(inv.patient)].filter(Boolean).join(' / ')}  ·  ${inv.patient.mobile}`);
  } else doc.text(`${inv.customer?.name || 'Walk-in customer'}${inv.customer?.phone ? ` · ${inv.customer.phone}` : ''}`);
  if (inv.doctor) doc.text(`Doctor: ${inv.doctor.name}`);

  doc.font('Helvetica-Bold').text(`Invoice No: ${inv.invoiceNo}`, 330, top, { align: 'right' });
  doc.font('Helvetica').text(`Date: ${new Date(inv.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`, { align: 'right' });
  doc.text(`Status: ${inv.status.toUpperCase()}`, { align: 'right' });

  // table
  const cols = [
    ['#', 40, 20], ['Description', 60, 190], ['HSN', 250, 40], ['Qty', 290, 35], ['Rate', 325, 55],
    ['Disc%', 380, 35], ['GST%', 415, 35], ['Taxable', 450, 50], ['Total', 500, 55],
  ];
  let y = Math.max(doc.y, top + 60) + 10;
  doc.rect(40, y - 3, 515, 16).fill('#e6f2f1');
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(8);
  cols.forEach(([t, x, w]) => doc.text(t, x, y, { width: w, align: ['Description', '#'].includes(t) ? 'left' : 'right' }));
  y += 18;
  doc.font('Helvetica').fontSize(8);
  inv.items.forEach((l, i) => {
    const desc = l.description + (l.allocations?.length ? `\nBatch: ${l.allocations.map((a) => `${a.batchNo} (exp ${a.expiry?.slice(0, 7)})`).join(', ')}` : '') + (l.returnedQty ? `\nReturned: ${l.returnedQty}` : '');
    const h = Math.max(doc.heightOfString(desc, { width: 190 }), 10);
    if (y + h > 740) {
      doc.addPage();
      y = 40;
    }
    const vals = [i + 1, desc, l.hsn || '', l.qty, l.rate.toFixed(2), l.discountPct || 0, l.gstRate, l.taxable.toFixed(2), l.total.toFixed(2)];
    cols.forEach(([t, x, w], k) => doc.text(String(vals[k]), x, y, { width: w, align: ['Description', '#'].includes(t) ? 'left' : 'right' }));
    y += h + 6;
    doc.moveTo(40, y - 3).lineTo(555, y - 3).strokeColor('#ddd').lineWidth(0.5).stroke();
  });

  // totals
  y += 6;
  const row = (label, val, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 9);
    doc.text(label, 340, y, { width: 120, align: 'right' });
    doc.text(val, 460, y, { width: 95, align: 'right' });
    y += bold ? 16 : 13;
  };
  row('Sub total', inr(inv.subtotal));
  if (inv.discount) row('Discount', `- ${inr(inv.discount)}`);
  row('Taxable value', inr(inv.taxable));
  row('CGST', inr(inv.cgst));
  row('SGST', inr(inv.sgst));
  if (inv.roundOff) row('Round off', inr(inv.roundOff));
  row('Grand Total', inr(inv.grandTotal), true);
  row('Paid', inr(inv.paid));
  if (inv.refunded) row('Refunded', inr(inv.refunded));
  row('Balance', inr(inv.balance), true);
  if (inv.taxInclusive) {
    doc.font('Helvetica-Oblique').fontSize(7).text('Prices inclusive of GST', 40, y);
    y += 10;
  }

  doc.font('Helvetica').fontSize(8).fillColor('#555').text(footer || '', 40, 780, { align: 'center', width: 515 });
  doc.text(`Generated by ${inv.createdBy?.name || 'system'} · This is a computer generated invoice`, 40, 792, { align: 'center', width: 515 });
  doc.end();
}

/** rx populated: patient, doctor, branch */
export function renderPrescriptionPdf(rx, out, clinic, logo) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(out);
  header(doc, clinic, rx.branch, 'PRESCRIPTION', logo);
  const top = doc.y;
  doc.font('Helvetica-Bold').fontSize(11).text(`Dr. ${rx.doctor?.name?.replace(/^Dr\.?\s*/i, '') || ''}`, 40, top);
  doc.font('Helvetica').fontSize(9).text([rx.doctor?.qualification, rx.doctor?.regNo && `Reg: ${rx.doctor.regNo}`].filter(Boolean).join(' · '));
  doc.text(`Rx No: ${rx.rxNo}`, 330, top, { align: 'right' });
  doc.text(`Date: ${new Date(rx.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`, { align: 'right' });

  doc.y = top + 40;
  doc.rect(40, doc.y, 515, 30).fill('#f4f8f8');
  doc.fillColor('#000').font('Helvetica-Bold').text(`${rx.patient.name}`, 48, doc.y + 6, { continued: true }).font('Helvetica').text(`   ${rx.patient.patientId}  ·  ${[rx.patient.gender, age(rx.patient)].filter(Boolean).join('/')}  ·  ${rx.patient.mobile}`);
  doc.moveDown(1.5);
  if (rx.diagnosis) doc.font('Helvetica-Bold').text('Diagnosis: ', 40, doc.y, { continued: true }).font('Helvetica').text(rx.diagnosis);
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(BRAND).text('Rx', 40);
  doc.fillColor('#000').fontSize(9);

  rx.items.forEach((it, i) => {
    doc.font('Helvetica-Bold').text(`${i + 1}. ${it.name}`, 50);
    const meta = [it.dose, it.frequency, it.timing, it.duration && `x ${it.duration}`, it.qty && `Qty ${it.qty}`].filter(Boolean).join('  |  ');
    doc.font('Helvetica').text(meta, 65);
    if (it.notes) doc.font('Helvetica-Oblique').text(it.notes, 65);
    doc.moveDown(0.4);
  });
  if (rx.advice) {
    doc.moveDown(0.5).font('Helvetica-Bold').text('Advice', 40).font('Helvetica').text(rx.advice);
  }
  if (rx.diet) {
    doc.moveDown(0.5).font('Helvetica-Bold').text('Diet', 40).font('Helvetica').text(rx.diet);
  }
  if (rx.followUpDate) doc.moveDown(0.5).font('Helvetica-Bold').text(`Follow-up: ${rx.followUpDate}`, 40);
  doc.font('Helvetica').fontSize(9).text('Signature', 450, 740, { width: 105, align: 'center' });
  doc.moveTo(450, 736).lineTo(555, 736).strokeColor('#999').stroke();
  doc.end();
}
