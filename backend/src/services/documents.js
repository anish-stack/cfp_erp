import path from 'node:path';
import { Invoice, Payment } from '../models/Billing.js';
import { Prescription } from '../models/Clinical.js';
import { Appointment } from '../models/Appointment.js';
import { ApiError } from '../utils/ApiError.js';
import { pdfBranding } from './branding.js';
import { uploadRoot } from '../middleware/upload.js';
import { renderInvoicePdf, renderPrescriptionPdf, renderReceiptPdf, renderAppointmentSlipPdf, renderAdmissionPdf, renderDischargeSummaryPdf, renderIpdBillPdf } from './pdf.js';
import { Admission } from '../models/Ipd.js';

/**
 * Single entry point for every PDF: load (+populate) → brand → stream.
 * type: invoice | rx | receipt | slip
 */
async function loadAdm(id, label) {
  const a = await Admission.findById(id).populate('patient').populate('doctor', 'name qualification regNo signature').populate('branch').populate('bed', 'number').populate('ward', 'name dailyRate nursingRate').populate('procedures.surgeon', 'name').populate('plannedProcedure.product', 'name sellPrice').populate('package.package', 'inclusions exclusions').lean();
  if (!a) return null;
  return { doc: a, file: `${label}-${a.admissionNo}`, branch: a.branch?._id, patient: a.patient?._id };
}

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
  discharge: async (id) => loadAdm(id, 'Discharge-Summary'),
  interim: async (id) => loadAdm(id, 'Interim-Bill'),
  estimate: async (id) => loadAdm(id, 'Estimate'),
  admission: async (id) => loadAdm(id, 'Admission'),
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
  if (type === 'admission') return renderAdmissionPdf(d, b, res);
  if (type === 'interim') {
    const { billSummary } = await import('../modules/ipd/ipd.service.js');
    return renderIpdBillPdf(d, await billSummary(d), b, res, 'interim');
  }
  if (type === 'estimate') return renderIpdBillPdf(d, estimateOf(d), b, res, 'estimate');
  if (type === 'discharge') {
    const sig = d.doctor?.signature?.storedName ? path.join(uploadRoot, 'signatures', path.basename(d.doctor.signature.storedName)) : null;
    return renderDischargeSummaryPdf(d, { ...b, signatureImage: sig }, res);
  }
  const images = (d.images || []).filter((i) => /png|jpe?g/.test(i.mime || '')).map((i) => path.join(uploadRoot, 'rx', path.basename(i.storedName)));
  const sig = d.doctor?.signature?.storedName ? path.join(uploadRoot, 'signatures', path.basename(d.doctor.signature.storedName)) : null;
  return renderPrescriptionPdf(d, { ...b, signatureImage: sig }, res, images);
}

/** pre-admission estimate: package (with inclusions) or room × expected days + nursing + planned procedure; a.estimate overrides the total */
function estimateOf(a) {
  const days = Math.max(1, a.type === 'day_care' ? 1 : Math.ceil(((a.expectedDischargeAt ? new Date(a.expectedDischargeAt) : new Date(new Date(a.admittedAt).getTime() + 86_400_000)) - new Date(a.admittedAt) - 2 * 3_600_000) / 86_400_000));
  const lines = [];
  const pkg = a.package?.name ? a.package : null;
  const covers = new Set(pkg?.covers || []);
  if (pkg) lines.push({ description: `Package: ${pkg.name}${pkg.includedDays ? ` (incl. ${pkg.includedDays} day stay)` : ''}`, qty: 1, rate: pkg.price, amount: pkg.price });
  const extra = pkg && covers.has('bed') ? Math.max(0, days - (pkg.includedDays || 0)) : days;
  if (a.ward?.dailyRate && extra) lines.push({ description: `Room rent: ${a.ward.name}${pkg ? ' (beyond package)' : ''}`, qty: extra, rate: a.ward.dailyRate, amount: extra * a.ward.dailyRate });
  const extraN = pkg && covers.has('nursing') ? Math.max(0, days - (pkg.includedDays || 0)) : days;
  if (a.ward?.nursingRate && extraN) lines.push({ description: 'Nursing care', qty: extraN, rate: a.ward.nursingRate, amount: extraN * a.ward.nursingRate });
  const proc = a.plannedProcedure?.product;
  if (proc?.sellPrice && !(pkg && covers.has('procedure'))) lines.push({ description: proc.name, qty: 1, rate: proc.sellPrice, amount: proc.sellPrice });
  let total = lines.reduce((s, l) => s + l.amount, 0);
  if (a.estimate && a.estimate > total) {
    lines.push({ description: 'Medicines, consumables & other charges (approx.)', qty: 1, rate: a.estimate - total, amount: a.estimate - total });
    total = a.estimate;
  }
  return { lines, total, days, inclusions: a.package?.package?.inclusions, exclusions: a.package?.package?.exclusions };
}
