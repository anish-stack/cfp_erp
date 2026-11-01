import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { branchScope } from '../../middleware/branchScope.js';
import { permit } from '../../middleware/permit.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok, paged, parsePaging } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { objectId } from '../../utils/zod.js';
import { logger } from '../../config/logger.js';
import { OnlinePayment } from '../../models/OnlinePayment.js';
import { getSettings } from '../../models/Settings.js';
import * as rzp from '../../services/razorpay.js';
import * as svc from './payments.service.js';

const r = Router();
const idParam = z.object({ id: objectId });

/** Razorpay webhook (no auth — HMAC signature). Dashboard → Webhooks → URL: <API>/api/v1/payments/webhook */
r.post('/webhook', asyncHandler(async (req, res) => {
  if (!rzp.verifyWebhook(req.rawBody, req.headers['x-razorpay-signature'])) {
    logger.warn('Razorpay webhook with bad signature');
    return res.status(400).json({ success: false, message: 'bad signature' });
  }
  try {
    await svc.onWebhook(req.body?.event, req.body?.payload);
  } catch (e) {
    logger.error({ err: e.message, event: req.body?.event }, 'razorpay webhook failed');
    return res.status(500).json({ success: false }); // Razorpay retries
  }
  res.json({ success: true });
}));

r.use(auth, branchScope);

r.get('/config', asyncHandler(async (_req, res) => {
  const s = await getSettings();
  ok(res, { configured: rzp.razorpayConfigured(), enabled: !!s.payments?.onlineEnabled && rzp.razorpayConfigured(), keyId: rzp.publicKey(), sendLinkOnWhatsapp: s.payments?.sendLinkOnWhatsapp !== false, upiId: s.payments?.upiId || '' });
}));

r.post('/online', permit.any('billing.create', 'pos.create', 'ipd.edit'), validate({
  body: z.object({
    kind: z.enum(['link', 'qr']), purpose: z.enum(['invoice', 'advance']), invoice: objectId.optional(), patient: objectId.optional(), branch: objectId.optional(), admission: objectId.optional(),
    amount: z.number().positive().max(10_000_000).optional(), phone: z.string().max(15).optional(), send: z.boolean().default(false), description: z.string().max(200).optional(),
  }).refine((d) => (d.purpose === 'invoice' ? d.invoice : d.patient && d.amount), 'invoice, or patient + amount, required'),
}), asyncHandler(async (req, res) => {
  if (req.body.branch) req.assertBranch?.(req.body.branch);
  const op = await svc.create(req.body, req.user);
  audit(req, { action: 'payments.online_create', entity: 'OnlinePayment', entityId: op._id, after: { kind: op.kind, amount: op.amount, purpose: op.purpose } });
  let sent = null;
  if (req.body.send && op.kind === 'link') sent = await svc.sendLink(op, req.body.phone).catch((e) => ({ sent: false, error: e.message }));
  ok(res, { ...op.toObject(), sent }, 201);
}));

r.get('/online', permit.any('billing.view', 'pos.view'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const f = {};
  for (const k of ['status', 'purpose', 'kind']) if (req.query[k]) f[k] = String(req.query[k]);
  for (const k of ['invoice', 'patient', 'admission', 'branch']) if (req.query[k] && /^[a-f0-9]{24}$/.test(req.query[k])) f[k] = req.query[k];
  if (req.branchFilter) Object.assign(f, req.branchFilter());
  const [items, total] = await Promise.all([
    OnlinePayment.find(f).populate('invoice', 'invoiceNo').populate('patient', 'name patientId').populate('appointment', 'bookingId date start').populate('createdBy', 'name').populate('receipt', 'receiptNo').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    OnlinePayment.countDocuments(f),
  ]);
  paged(res, { items, total, page, limit });
}));

const load = async (req) => {
  const op = await OnlinePayment.findById(req.params.id);
  if (!op) throw ApiError.notFound('Payment request not found');
  return op;
};
r.get('/online/:id', permit.any('billing.view', 'pos.view'), validate({ params: idParam }), asyncHandler(async (req, res) => ok(res, await load(req))));
/** poll Razorpay (POS screen polls this every few seconds while the QR is shown) */
r.post('/online/:id/check', permit.any('billing.view', 'pos.view'), validate({ params: idParam }), asyncHandler(async (req, res) => ok(res, await svc.sync(await load(req)))));
r.post('/online/:id/cancel', permit.any('billing.create', 'pos.create'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const op = await svc.cancel(await load(req));
  audit(req, { action: 'payments.online_cancel', entity: 'OnlinePayment', entityId: op._id });
  ok(res, op);
}));
r.post('/online/:id/send', permit.any('billing.create', 'pos.create', 'ipd.edit'), validate({ params: idParam, body: z.object({ phone: z.string().max(15).optional() }) }), asyncHandler(async (req, res) => ok(res, await svc.sendLink(await load(req), req.body.phone))));

export default r;
