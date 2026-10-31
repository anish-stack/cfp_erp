import path from 'node:path';
import { Invoice, Payment } from '../models/Billing.js';
import { Prescription } from '../models/Clinical.js';
import { Appointment } from '../models/Appointment.js';
import { ApiError } from '../utils/ApiError.js';
import { pdfBranding } from './branding.js';
import { uploadRoot } from '../middleware/upload.js';
import { renderInvoicePdf, renderPrescriptionPdf, renderReceiptPdf, renderAppointmentSlipPdf } from './pdf.js';

/**
 * Single entry point for every PDF: load (+populate) → brand → stream.
 * type: invoice | rx | receipt | slip
 */
const LOADERS = {
  invoice: async (id) => {
    const inv = await Invoice.findById(id).populate('patient').populate('branch').populate('doctor', 'name').populate('createdBy', 'name').lean();
    if (!inv) return null;
    inv.payments = await Payment.find({ invoice: inv._id }).sort({ createdAt: 1 }).lean();
    return { doc: inv, file: `Invoice-${inv.invoiceNo}`, branch: inv.branch?._id, patient: inv.patient?._id };
  },
  rx: async (id) => {
    const rx = await Prescription.findById(id).populate('patient').populate('doctor').populate('branch').populate('appointment', 'bookingId').lean();
    if (!rx) return null;
    return { doc: rx, file: `Prescription-${rx.rxNo}`, branch: rx.branch?._id, patient: rx.patient?._id };
  },
  receipt: async (id) => {
    const pm = await Payment.findById(id).populate('patient').populate('branch').populate('invoice', 'invoiceNo grandTotal paid balance customer').populate('by', 'name').lean();
    if (!pm) return null;
    return { doc: pm, file: `Receipt-${pm.receiptNo}`, branch: pm.branch?._id, patient: pm.patient?._id };
  },
  slip: async (id) => {
    const a = await Appointment.findById(id).populate('patient').populate('doctor', 'name qualification').populate('branch').lean();
    if (!a) return null;
    return { doc: a, file: `Appointment-${a.bookingId}`, branch: a.branch?._id, patient: a.patient?._id };
  },
};

/** load only (for access checks before streaming) */
export async function loadDocument(type, id) {
  const fn = LOADERS[type];
  if (!fn) throw ApiError.badRequest('Unknown document type');
  const out = await fn(id);
  if (!out) throw ApiError.notFound('Document not found');
  return out;
}

export async function streamDocument(res, type, idOrLoaded, { download = false } = {}) {
  const loaded = typeof idOrLoaded === 'object' && idOrLoaded?.doc ? idOrLoaded : await loadDocument(type, idOrLoaded);
  const b = await pdfBranding();
  const name = loaded.file.replace(/[^A-Za-z0-9_-]+/g, '-');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${name}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  const d = loaded.doc;
  if (type === 'invoice') return renderInvoicePdf(d, b, res);
  if (type === 'receipt') return renderReceiptPdf(d, b, res);
  if (type === 'slip') return renderAppointmentSlipPdf(d, b, res);
  const images = (d.images || []).filter((i) => /png|jpe?g/.test(i.mime || '')).map((i) => path.join(uploadRoot, 'rx', path.basename(i.storedName)));
  const sig = d.doctor?.signature?.storedName ? path.join(uploadRoot, 'signatures', path.basename(d.doctor.signature.storedName)) : null;
  return renderPrescriptionPdf(d, { ...b, signatureImage: sig }, res, images);
}
