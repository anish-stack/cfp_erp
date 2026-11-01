import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { branchScope } from '../../middleware/branchScope.js';
import { hasPerm } from '../../middleware/permit.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok, escapeRegex } from '../../utils/asyncHandler.js';
import { audit } from '../../utils/audit.js';
import { verifyDocLink } from '../../utils/signedLink.js';
import { Patient } from '../../models/Patient.js';
import { Appointment, ACTIVE_STATUS } from '../../models/Appointment.js';
import { Invoice, Payment, CreditNote } from '../../models/Billing.js';
import { Prescription, FollowUp } from '../../models/Clinical.js';
import { Product, Batch } from '../../models/Inventory.js';
import { Lead } from '../../models/Crm.js';
import { featureOn } from '../../models/Settings.js';
import { advanceBalance } from '../billing/billing.service.js';
import { loyaltyBalance } from '../billing/promo.service.js';
import { todayIST } from '../../utils/time.js';

/**
 * Universal scanner lookup (console header scanner): QR / barcode / typed text → what it is + everything about it.
 * Recognises: patient ID, mobile, admission no, attendant pass, sticker barcodes, invoice / receipt / credit note no,
 * booking ID, prescription no, signed PDF links, UPI pay QR, spin-wheel / coupon codes, product barcode / SKU / batch no.
 */
const r = Router();
r.use(auth, branchScope);

const exact = (v) => new RegExp(`^${escapeRegex(v)}$`, 'i');
const can = (req, ...perms) => perms.some((p) => hasPerm(req, p));
const inBranch = (req, b) => !b || req.canAccessBranch(b?._id || b);

/** pull a lookup key out of whatever was scanned */
export function normalise(raw) {
  let s = String(raw || '').trim();
  const out = { raw: s, keys: [s] };
  const pass = s.match(/ATTENDANT PASS\s+(\S+?)-A\d+/i);
  if (pass) return { ...out, kind: 'pass', keys: [pass[1]] };
  if (/^upi:\/\//i.test(s)) {
    try {
      const u = new URL(s.replace(/^upi:\/\//i, 'https://upi/'));
      return { ...out, kind: 'upi', upi: { pa: u.searchParams.get('pa'), pn: u.searchParams.get('pn'), am: u.searchParams.get('am'), tn: u.searchParams.get('tn') }, keys: [u.searchParams.get('tn')].filter(Boolean) };
    } catch { return { ...out, kind: 'upi' }; }
  }
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      // our signed PDF links: /public/docs/<type>/<id>/<exp>/<sig>/<name>.pdf  or  /public/docs/<type>/<id>.pdf?e=&s=
      const m = u.pathname.match(/\/docs\/(\w+)\/([a-f0-9]{24})(?:\/(\d+)\/([a-f0-9]+))?/i);
      if (m) {
        const [, type, id, e = u.searchParams.get('e'), sig = u.searchParams.get('s')] = m;
        return { ...out, kind: 'doc', doc: { type, id, valid: verifyDocLink(type, id, e, sig) } };
      }
      const f = u.pathname.match(/\/f\/([a-z0-9-]+)/);
      return { ...out, kind: 'url', url: s, landing: f?.[1] };
    } catch { return { ...out, kind: 'url', url: s }; }
  }
  s = s.replace(/\s+/g, '');
  const digits = s.replace(/\D/g, '');
  if (/^(\+?91)?[6-9]\d{9}$/.test(s.replace(/[-]/g, ''))) return { ...out, kind: 'mobile', mobile: digits.slice(-10), keys: [s] };
  return { ...out, keys: [s] };
}

// ---------------------------------------------------------------- patient 360°
async function patient360(req, p) {
  // branch-limited staff: only patients registered at / visiting their branches
  if (req.allowedBranches) {
    const ids = [p.registeredBranch?._id || p.registeredBranch, ...(p.branchesVisited || [])].filter(Boolean);
    if (!ids.some((b) => req.canAccessBranch(b?._id || b))) return { patient: { _id: p._id, name: p.name, patientId: p.patientId }, limited: true };
  }
  const id = p._id;
  const today = todayIST();
  const ipdOn = (await featureOn('ipd')) && can(req, 'ipd.view');
  const { Admission } = ipdOn ? await import('../../models/Ipd.js') : {};
  const [family, upcoming, recent, invoices, rx, followups, admission, admissions, advance, loyalty, leads] = await Promise.all([
    Patient.find({ mobile: p.mobile, _id: { $ne: id }, isActive: true }).select('name patientId relation gender ageYears dob').lean(),
    can(req, 'appointments.view') ? Appointment.find({ patient: id, date: { $gte: today }, status: { $in: ACTIVE_STATUS } }).populate('doctor', 'name').populate('branch', 'name code').sort({ date: 1, start: 1 }).limit(5).lean() : [],
    can(req, 'appointments.view') ? Appointment.find({ patient: id, $or: [{ date: { $lt: today } }, { status: { $nin: ACTIVE_STATUS } }] }).populate('doctor', 'name').populate('branch', 'code').sort({ date: -1, start: -1 }).limit(6).lean() : [],
    can(req, 'billing.view', 'pos.view') ? Invoice.find({ patient: id }).select('invoiceNo grandTotal paid balance status createdAt type source branch').populate('branch', 'code').sort({ createdAt: -1 }).limit(8).lean() : [],
    can(req, 'medical_records.view', 'patients.view') ? Prescription.find({ patient: id }).select('rxNo diagnosis createdAt doctor followUpDate items.name').populate('doctor', 'name').sort({ createdAt: -1 }).limit(3).lean() : [],
    FollowUp.find({ patient: id, status: { $in: ['pending', 'contacted'] } }).select('dueDate reason status').sort({ dueDate: 1 }).limit(3).lean(),
    Admission ? Admission.findOne({ patient: id, status: { $in: ['admitted', 'discharge_initiated'] } }).select('admissionNo admittedAt status ward bed doctor attendant payer.type').populate('ward', 'name').populate('bed', 'number').populate('doctor', 'name').lean() : null,
    Admission ? Admission.countDocuments({ patient: id }) : 0,
    can(req, 'billing.view', 'pos.view') ? advanceBalance(id) : null,
    can(req, 'billing.view', 'pos.view') ? loyaltyBalance(p.mobile).catch(() => null) : null,
    can(req, 'leads.view') ? Lead.find({ phone: p.mobile }).select('name stage source createdAt').populate('stage', 'name').sort({ createdAt: -1 }).limit(2).lean() : [],
  ]);
  const due = invoices.filter((i) => !['cancelled', 'refunded'].includes(i.status)).reduce((a, i) => a + (i.balance || 0), 0);
  return {
    patient: p, family, upcoming, recent, invoices, prescriptions: rx, followups, admission, admissionsCount: admissions,
    money: { due: Math.round(due * 100) / 100, advance, loyalty: loyalty?.balance ?? null },
    leads,
  };
}

const PATIENT_FIELDS = 'patientId name gender dob ageYears mobile email relation bloodGroup allergies address registeredBranch branchesVisited createdAt marketingOptOut';

r.get('/', validate({ query: z.object({ q: z.string().trim().min(2).max(500) }) }), asyncHandler(async (req, res) => {
  const n = normalise(req.query.q);
  const results = [];
  const push = (type, data, extra = {}) => results.push({ type, data, ...extra });

  if (n.kind === 'url' && !n.doc) push('url', { url: n.url, landing: n.landing });
  if (n.kind === 'upi') push('upi', n.upi || {});

  // signed PDF link → the underlying record
  if (n.kind === 'doc') {
    const { type, id, valid } = n.doc;
    if (['invoice', 'receipt'].includes(type) && can(req, 'billing.view', 'pos.view')) {
      if (type === 'invoice') { const i = await Invoice.findById(id).populate('patient', 'name patientId mobile').populate('branch', 'name code').lean(); if (i && inBranch(req, i.branch)) push('invoice', i, { verified: valid }); }
      else { const pm = await Payment.findById(id).populate('patient', 'name patientId mobile').populate('invoice', 'invoiceNo').populate('branch', 'name code').lean(); if (pm && inBranch(req, pm.branch)) push('receipt', pm, { verified: valid }); }
    } else if (type === 'rx') { const x = await Prescription.findById(id).populate('patient', 'name patientId mobile').populate('doctor', 'name').lean(); if (x) push('prescription', x, { verified: valid }); }
    else if (type === 'slip') { const a = await Appointment.findById(id).populate('patient', 'name patientId mobile').populate('doctor', 'name').populate('branch', 'name code').lean(); if (a) push('appointment', a, { verified: valid }); }
    else if (['discharge', 'interim', 'estimate', 'admission'].includes(type) && can(req, 'ipd.view')) { const { Admission } = await import('../../models/Ipd.js'); const a = await Admission.findById(id).populate('patient', 'name patientId mobile').populate('ward', 'name').populate('bed', 'number').lean(); if (a) push('admission', a, { verified: valid }); }
  }

  const keys = [...new Set(n.keys.filter(Boolean))].slice(0, 3);
  for (const key of keys) {
    if (n.kind === 'url' || n.kind === 'doc') break;
    const rx = exact(key);
    const ipdOn = (await featureOn('ipd')) && can(req, 'ipd.view');
    const Ipd = ipdOn ? await import('../../models/Ipd.js') : null;
    const { SpinEntry } = await import('../../models/Spin.js');
    const { Coupon } = await import('../../models/Loyalty.js');
    const [pt, adm, inv, rcpt, cn, appt, presc, prod, batch, spin, coupon] = await Promise.all([
      can(req, 'patients.view') ? Patient.findOne({ patientId: rx }).select(PATIENT_FIELDS).populate('registeredBranch', 'name code').lean() : null,
      Ipd ? Ipd.Admission.findOne({ admissionNo: rx }).populate('patient', PATIENT_FIELDS).populate('ward', 'name').populate('bed', 'number').populate('doctor', 'name').populate('branch', 'name code').lean() : null,
      can(req, 'billing.view', 'pos.view') ? Invoice.findOne({ invoiceNo: rx }).populate('patient', 'name patientId mobile').populate('branch', 'name code').lean() : null,
      can(req, 'billing.view', 'pos.view') ? Payment.findOne({ receiptNo: rx }).populate('patient', 'name patientId mobile').populate('invoice', 'invoiceNo').populate('branch', 'name code').lean() : null,
      can(req, 'billing.view') ? CreditNote.findOne({ creditNoteNo: rx }).populate('invoice', 'invoiceNo').lean() : null,
      can(req, 'appointments.view') ? Appointment.findOne({ bookingId: rx }).populate('patient', 'name patientId mobile gender ageYears dob').populate('doctor', 'name').populate('branch', 'name code').lean() : null,
      can(req, 'patients.view', 'medical_records.view') ? Prescription.findOne({ rxNo: rx }).populate('patient', 'name patientId mobile').populate('doctor', 'name').lean() : null,
      can(req, 'inventory.view', 'pos.view', 'billing.view') ? Product.findOne({ $or: [{ barcode: key }, { sku: key.toUpperCase() }] }).populate('category', 'name').lean() : null,
      can(req, 'inventory.view', 'pos.view') ? Batch.findOne({ batchNo: key.toUpperCase(), ...(req.branchFilter ? req.branchFilter() : {}) }).populate('product', 'name sku').populate('branch', 'code').lean() : null,
      can(req, 'cms.view') ? SpinEntry.findOne({ code: key.toUpperCase() }).populate('wheel', 'name').lean() : null,
      can(req, 'pos.view', 'billing.view') ? Coupon.findOne({ code: key.toUpperCase() }).lean() : null,
    ]);
    if (pt) push('patient', await patient360(req, pt));
    if (adm && inBranch(req, adm.branch)) {
      push('admission', adm, { pass: n.kind === 'pass' });
      if (adm.patient && can(req, 'patients.view')) push('patient', await patient360(req, adm.patient));
    }
    if (inv && inBranch(req, inv.branch)) push('invoice', inv);
    if (rcpt && inBranch(req, rcpt.branch)) push('receipt', rcpt);
    if (cn) push('creditNote', cn);
    if (appt && inBranch(req, appt.branch)) push('appointment', appt);
    if (presc) push('prescription', presc);
    if (prod) {
      const stock = await Batch.aggregate([{ $match: { product: prod._id, qty: { $gt: 0 }, ...(req.branchFilter ? req.branchFilter() : {}) } }, { $group: { _id: '$branch', qty: { $sum: '$qty' }, nextExpiry: { $min: '$expiry' } } }, { $lookup: { from: 'branches', localField: '_id', foreignField: '_id', as: 'b' } }, { $project: { qty: 1, nextExpiry: 1, branch: { $first: '$b.code' } } }]);
      push('product', { ...prod, stock });
    }
    if (batch) push('batch', batch);
    if (spin) push('spin', spin);
    if (coupon) push('coupon', coupon);
    if (results.length) break;
  }

  // a mobile number → every patient profile on it (+ 360° of the first)
  if (n.kind === 'mobile' && can(req, 'patients.view')) {
    const list = await Patient.find({ mobile: n.mobile, isActive: true }).select(PATIENT_FIELDS).populate('registeredBranch', 'name code').sort({ relation: 1, createdAt: 1 }).lean();
    if (list.length) push('patient', await patient360(req, list[0]), { others: list.slice(1) });
    else if (can(req, 'leads.view')) {
      const lead = await Lead.findOne({ phone: n.mobile }).populate('stage', 'name').lean();
      if (lead) push('lead', lead);
    }
  }

  // the same patient may be reached twice (admission + patient ID) → keep one
  const seen = new Set();
  const unique = results.filter((x) => { const k = `${x.type}:${x.data?._id || x.data?.patient?._id || JSON.stringify(x.data).slice(0, 40)}`; if (seen.has(k)) return false; seen.add(k); return true; });
  audit(req, { action: 'scanner.lookup', entity: unique[0]?.type || 'none', meta: { q: n.raw.slice(0, 120), found: unique.map((u) => u.type) } });
  ok(res, { query: n.raw, kind: n.kind || 'text', results: unique });
}));

export default r;
