import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { permit } from '../../middleware/permit.js';
import { branchScope } from '../../middleware/branchScope.js';
import { validate } from '../../middleware/validate.js';
import { withTransaction } from '../../config/db.js';
import { asyncHandler, ok, paged, parsePaging, escapeRegex } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { crudRouter } from '../../utils/crud.js';
import { objectId, ymd } from '../../utils/zod.js';
import { nextDocNo } from '../../utils/counter.js';
import { Category, Supplier, Product, Batch, StockMovement, PurchaseOrder, StockTransfer, STOCK_TYPES } from '../../models/Inventory.js';
import { Branch } from '../../models/Branch.js';
import { getSettings } from '../../models/Settings.js';
import * as stock from './stock.service.js';

const r = Router();
r.use(auth, branchScope);

const idParam = z.object({ id: objectId });
const money = z.number().min(0);
const branchMatch = (req) => req.branchFilter('branch');

// ---------- masters ----------
r.use('/categories', crudRouter({
  model: Category, module: 'inventory', sort: { name: 1 },
  schema: z.object({ name: z.string().trim().min(2).max(60), description: z.string().max(200).optional(), isActive: z.boolean().optional() }),
}));

r.use('/suppliers', crudRouter({
  model: Supplier, module: 'suppliers', sort: { name: 1 }, search: ['name', 'phone', 'gstin', 'contactPerson'],
  schema: z.object({
    name: z.string().trim().min(2).max(120), contactPerson: z.string().max(80).optional(), phone: z.string().max(15).optional(),
    email: z.string().email().optional().or(z.literal('')), gstin: z.string().max(15).optional(), drugLicense: z.string().max(60).optional(),
    address: z.string().max(300).optional(), paymentTermsDays: z.number().int().min(0).max(365).optional(), isActive: z.boolean().optional(),
  }),
}));

const productSchema = z.object({
  sku: z.string().trim().min(2).max(40),
  barcode: z.string().trim().max(60).optional().or(z.literal('')).transform((v) => v || undefined),
  name: z.string().trim().min(2).max(160),
  genericName: z.string().max(160).optional(),
  manufacturer: z.string().max(120).optional(),
  category: objectId.optional().nullable(),
  type: z.enum(['medicine', 'consumable', 'product', 'service']).default('medicine'),
  serviceKind: z.enum(['consultation', 'procedure', 'treatment', 'other']).nullable().optional(),
  unit: z.string().max(20).optional(),
  packSize: z.number().int().min(1).optional(),
  hsn: z.string().max(10).optional(),
  gstRate: z.union([z.literal(0), z.literal(5), z.literal(12), z.literal(18), z.literal(28)]).default(12),
  mrp: money.default(0),
  sellPrice: money.default(0),
  purchasePrice: money.default(0),
  reorderLevel: z.number().int().min(0).default(10),
  prescriptionRequired: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

/** product search for POS/billing — includes branch stock */
r.get('/products/search', permit.any('pos.view', 'billing.view', 'inventory.view', 'ipd.view'), validate({ query: z.object({ q: z.string().trim().max(60).default(''), branch: objectId.optional(), type: z.string().optional(), inStock: z.enum(['true']).optional() }) }), asyncHandler(async (req, res) => {
  const q = req.query.q;
  const f = { isActive: true };
  if (q) {
    // every word must match name / generic / sku ("arsh vati", "lido gel")
    const words = q.split(/\s+/).filter(Boolean).slice(0, 5);
    f.$or = [{ barcode: q }, { sku: q.toUpperCase() }, { $and: words.map((w) => { const rx = new RegExp(escapeRegex(w), 'i'); return { $or: [{ name: rx }, { genericName: rx }, { sku: rx }] }; }) }];
  }
  if (req.query.type) f.type = { $in: req.query.type.split(',') };
  const products = await Product.find(f).sort({ name: 1 }).limit(q ? 25 : 60).lean();
  const branch = req.activeBranch;
  let stockMap = new Map();
  if (branch && products.length) {
    const rows = await stock.stockSummary({ branch }, { productIds: products.map((p) => p._id) });
    stockMap = new Map(rows.map((s) => [String(s.product._id), s.qty]));
  }
  ok(res, products.map((p) => ({ ...p, stock: STOCK_TYPES.includes(p.type) ? stockMap.get(String(p._id)) || 0 : null })));
}));

r.use('/products', crudRouter({
  model: Product, module: 'inventory', sort: { name: 1 }, search: ['name', 'sku', 'barcode', 'genericName'], populate: [{ path: 'category', select: 'name' }],
  schema: productSchema,
  filters: (req) => (req.query.type ? { type: { $in: String(req.query.type).split(',') } } : {}),
}));

// ---------- stock views ----------
r.get('/stock', permit('inventory.view'), asyncHandler(async (req, res) => {
  ok(res, await stock.stockSummary(branchMatch(req), { lowOnly: req.query.low === 'true' }));
}));

r.get('/batches', permit('inventory.view'), validate({ query: z.object({ product: objectId.optional(), branch: objectId.optional(), inStock: z.string().optional() }) }), asyncHandler(async (req, res) => {
  const f = { ...branchMatch(req) };
  if (req.query.product) f.product = req.query.product;
  if (req.query.inStock === 'true') f.qty = { $gt: 0 };
  ok(res, await Batch.find(f).populate('product', 'name sku unit').populate('branch', 'name code').populate('supplier', 'name').sort({ expiry: 1 }).limit(1000).lean());
}));

r.get('/movements', permit('inventory.view'), validate({ query: z.object({ product: objectId.optional(), type: z.string().optional(), page: z.coerce.number().optional(), limit: z.coerce.number().optional(), branch: objectId.optional() }) }), asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const f = { ...branchMatch(req) };
  if (req.query.product) f.product = req.query.product;
  if (req.query.type) f.type = { $in: req.query.type.split(',') };
  const [items, total] = await Promise.all([
    StockMovement.find(f).populate('product', 'name sku').populate('branch', 'code').populate('by', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    StockMovement.countDocuments(f),
  ]);
  paged(res, { items, total, page, limit });
}));

r.get('/alerts', permit('inventory.view'), asyncHandler(async (req, res) => {
  const s = await getSettings();
  const days = Number(req.query.days) || s.inventory?.expiryAlertDays || 90;
  const [low, expiring] = await Promise.all([stock.stockSummary(branchMatch(req), { lowOnly: true }), stock.expiringBatches(branchMatch(req), days)]);
  // products tracked but never stocked at this branch
  if (req.activeBranch) {
    const stocked = await Batch.distinct('product', { branch: req.activeBranch });
    const never = await Product.find({ isActive: true, type: { $in: STOCK_TYPES }, _id: { $nin: stocked }, reorderLevel: { $gt: 0 } }).select('name sku unit reorderLevel type').limit(200).lean();
    low.push(...never.map((p) => ({ product: p, qty: 0, expiredQty: 0, value: 0, nearestExpiry: null, low: true })));
  }
  ok(res, { low, expiring, days });
}));

// ---------- direct receive (GRN without PO) ----------
const receiveLine = z.object({
  product: objectId, batchNo: z.string().trim().min(1).max(40), expiry: ymd, qty: z.number().positive(),
  purchasePrice: money.optional(), mrp: money.optional(), sellPrice: money.optional(),
});

r.post('/receive', permit('inventory.create'), validate({ body: z.object({ branch: objectId, supplier: objectId.optional(), invoiceNo: z.string().max(40).optional(), lines: z.array(receiveLine).min(1).max(200) }) }), asyncHandler(async (req, res) => {
  req.assertBranch(req.body.branch);
  const out = await withTransaction(async (session) => {
    const res2 = [];
    for (const l of req.body.lines) {
      res2.push(await stock.receive({ ...l, branch: req.body.branch, supplier: req.body.supplier, type: 'purchase', refType: 'GRN', refNo: req.body.invoiceNo, by: req.user._id }, session));
    }
    return res2;
  });
  audit(req, { action: 'inventory.receive', entity: 'Batch', branch: req.body.branch, after: req.body });
  ok(res, out, 201);
}));

r.post('/adjust', permit('inventory.edit'), validate({ body: z.object({ batch: objectId, delta: z.number().int().refine((v) => v !== 0, 'non-zero'), reason: z.string().min(3).max(200) }) }), asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.body.batch).lean();
  if (!batch) throw ApiError.notFound('Batch not found');
  req.assertBranch(batch.branch);
  const b = await withTransaction((s) => stock.adjust({ ...req.body, by: req.user._id }, s));
  audit(req, { action: 'inventory.adjust', entity: 'Batch', entityId: b._id, branch: b.branch, before: { qty: batch.qty }, after: { qty: b.qty, reason: req.body.reason } });
  ok(res, b);
}));

// ---------- purchase orders ----------
const poItem = z.object({ product: objectId, qty: z.number().int().positive(), rate: money.default(0), gstRate: z.number().min(0).max(28).default(12) });
const poBody = z.object({ supplier: objectId, branch: objectId, items: z.array(poItem).min(1).max(200), expectedDate: ymd.optional(), notes: z.string().max(500).optional() });

r.get('/purchase-orders', permit('purchases.view'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const f = { ...branchMatch(req) };
  if (req.query.status) f.status = { $in: String(req.query.status).split(',') };
  if (req.query.supplier) f.supplier = req.query.supplier;
  const [items, total] = await Promise.all([
    PurchaseOrder.find(f).populate('supplier', 'name').populate('branch', 'name code').populate('createdBy', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    PurchaseOrder.countDocuments(f),
  ]);
  paged(res, { items, total, page, limit });
}));

r.get('/purchase-orders/:id', permit('purchases.view'), validate({ params: idParam }), asyncHandler(async (req, res) => {
  const po = await PurchaseOrder.findById(req.params.id).populate('supplier').populate('branch', 'name code').populate('items.product', 'name sku unit').populate('createdBy', 'name');
  if (!po) throw ApiError.notFound();
  req.assertBranch(po.branch._id);
  ok(res, po);
}));

async function poItems(items) {
  const prods = await Product.find({ _id: { $in: items.map((i) => i.product) } }).select('name').lean();
  const names = new Map(prods.map((p) => [String(p._id), p.name]));
  if (names.size !== new Set(items.map((i) => i.product)).size) throw ApiError.badRequest('Unknown product in items');
  return items.map((i) => ({ ...i, name: names.get(i.product), receivedQty: 0 }));
}
const poTotal = (items) => Math.round(items.reduce((a, i) => a + i.qty * i.rate * (1 + i.gstRate / 100), 0) * 100) / 100;

r.post('/purchase-orders', permit('purchases.create'), validate({ body: poBody }), asyncHandler(async (req, res) => {
  req.assertBranch(req.body.branch);
  const branch = await Branch.findById(req.body.branch).select('code').lean();
  const items = await poItems(req.body.items);
  const po = await PurchaseOrder.create({ ...req.body, items, total: poTotal(items), poNo: await nextDocNo('PO', branch.code), createdBy: req.user._id });
  audit(req, { action: 'purchases.create', entity: 'PurchaseOrder', entityId: po._id, branch: po.branch, after: po });
  ok(res, po, 201);
}));

r.patch('/purchase-orders/:id', permit('purchases.edit'), validate({ params: idParam, body: poBody.partial().omit({ branch: true }) }), asyncHandler(async (req, res) => {
  const po = await PurchaseOrder.findById(req.params.id);
  if (!po) throw ApiError.notFound();
  req.assertBranch(po.branch);
  if (po.status !== 'draft') throw ApiError.badRequest('Only draft POs can be edited');
  if (req.body.items) {
    po.items = await poItems(req.body.items);
    po.total = poTotal(po.items);
  }
  for (const k of ['supplier', 'expectedDate', 'notes']) if (req.body[k] !== undefined) po[k] = req.body[k];
  await po.save();
  ok(res, po);
}));

r.post('/purchase-orders/:id/status', permit('purchases.approve'), validate({ params: idParam, body: z.object({ status: z.enum(['ordered', 'cancelled']) }) }), asyncHandler(async (req, res) => {
  const po = await PurchaseOrder.findById(req.params.id);
  if (!po) throw ApiError.notFound();
  req.assertBranch(po.branch);
  const allowed = { draft: ['ordered', 'cancelled'], ordered: ['cancelled'] };
  if (!(allowed[po.status] || []).includes(req.body.status)) throw ApiError.badRequest(`Cannot move ${po.status} → ${req.body.status}`);
  if (req.body.status === 'cancelled' && po.items.some((i) => i.receivedQty > 0)) throw ApiError.badRequest('Already partly received');
  po.status = req.body.status;
  if (req.body.status === 'ordered') po.approvedBy = req.user._id;
  await po.save();
  audit(req, { action: `purchases.${req.body.status}`, entity: 'PurchaseOrder', entityId: po._id, branch: po.branch });
  ok(res, po);
}));

r.post('/purchase-orders/:id/receive', permit('purchases.edit'), validate({ params: idParam, body: z.object({ invoiceNo: z.string().max(40).optional(), lines: z.array(receiveLine).min(1).max(200) }) }), asyncHandler(async (req, res) => {
  const po = await PurchaseOrder.findById(req.params.id);
  if (!po) throw ApiError.notFound();
  req.assertBranch(po.branch);
  if (!['ordered', 'partial'].includes(po.status)) throw ApiError.badRequest('PO must be ordered before receiving');
  const out = await withTransaction(async (session) => {
    const fresh = await PurchaseOrder.findById(po._id).session(session);
    for (const l of req.body.lines) {
      const item = fresh.items.find((i) => String(i.product) === l.product);
      if (!item) throw ApiError.badRequest('Line product not on PO');
      if (item.receivedQty + l.qty > item.qty) throw ApiError.badRequest(`Receiving more than ordered for ${item.name}`);
      item.receivedQty += l.qty;
      await stock.receive({ ...l, purchasePrice: l.purchasePrice ?? item.rate, branch: fresh.branch, supplier: fresh.supplier, type: 'purchase', refType: 'PurchaseOrder', refId: fresh._id, refNo: fresh.poNo, by: req.user._id }, session);
    }
    fresh.receipts.push({ at: new Date(), by: req.user._id, invoiceNo: req.body.invoiceNo, lines: req.body.lines });
    if (req.body.invoiceNo) fresh.supplierInvoiceNo = req.body.invoiceNo;
    fresh.status = fresh.items.every((i) => i.receivedQty >= i.qty) ? 'received' : 'partial';
    await fresh.save({ session });
    return fresh;
  });
  audit(req, { action: 'purchases.receive', entity: 'PurchaseOrder', entityId: po._id, branch: po.branch, after: req.body });
  ok(res, out);
}));

// ---------- stock transfers ----------
r.get('/transfers', permit('inventory.view'), asyncHandler(async (req, res) => {
  const f = {};
  const scope = req.activeBranch ? [req.activeBranch] : req.allowedBranches;
  if (scope) f.$or = [{ fromBranch: { $in: scope } }, { toBranch: { $in: scope } }];
  if (req.query.status) f.status = req.query.status;
  ok(res, await StockTransfer.find(f).populate('fromBranch toBranch', 'name code').populate('createdBy receivedBy', 'name').sort({ createdAt: -1 }).limit(300).lean());
}));

r.post('/transfers', permit('inventory.create'), validate({ body: z.object({ fromBranch: objectId, toBranch: objectId, items: z.array(z.object({ product: objectId, qty: z.number().int().positive() })).min(1).max(100), notes: z.string().max(300).optional() }) }), asyncHandler(async (req, res) => {
  req.assertBranch(req.body.fromBranch);
  if (req.body.fromBranch === req.body.toBranch) throw ApiError.badRequest('Same branch');
  const from = await Branch.findById(req.body.fromBranch).select('code').lean();
  const tr = await withTransaction(async (session) => {
    const transferNo = await nextDocNo('TR', from.code, session);
    const [doc] = await StockTransfer.create([{ transferNo, fromBranch: req.body.fromBranch, toBranch: req.body.toBranch, notes: req.body.notes, createdBy: req.user._id, items: [] }], { session });
    for (const it of req.body.items) {
      const p = await Product.findById(it.product).select('name type').lean();
      if (!p || !STOCK_TYPES.includes(p.type)) throw ApiError.badRequest('Invalid stock product');
      const allocations = await stock.issueFEFO({ branch: req.body.fromBranch, product: it.product, qty: it.qty, type: 'transfer_out', refType: 'StockTransfer', refId: doc._id, refNo: transferNo, by: req.user._id }, session);
      doc.items.push({ product: it.product, name: p.name, qty: it.qty, allocations });
    }
    await doc.save({ session });
    return doc;
  });
  audit(req, { action: 'inventory.transfer', entity: 'StockTransfer', entityId: tr._id, branch: tr.fromBranch, after: tr });
  ok(res, tr, 201);
}));

r.post('/transfers/:id/:action', permit('inventory.edit'), validate({ params: z.object({ id: objectId, action: z.enum(['receive', 'cancel']) }) }), asyncHandler(async (req, res) => {
  const tr = await StockTransfer.findById(req.params.id);
  if (!tr) throw ApiError.notFound();
  if (tr.status !== 'in_transit') throw ApiError.badRequest(`Transfer already ${tr.status}`);
  const receiving = req.params.action === 'receive';
  req.assertBranch(receiving ? tr.toBranch : tr.fromBranch);
  const out = await withTransaction(async (session) => {
    const target = receiving ? tr.toBranch : tr.fromBranch;
    for (const it of tr.items) {
      for (const a of it.allocations) {
        await stock.receive({ branch: target, product: it.product, batchNo: a.batchNo, expiry: a.expiry, qty: a.qty, purchasePrice: a.purchasePrice, mrp: a.mrp, sellPrice: a.sellPrice, type: receiving ? 'transfer_in' : 'cancel', refType: 'StockTransfer', refId: tr._id, refNo: tr.transferNo, by: req.user._id }, session);
      }
    }
    const upd = await StockTransfer.findOneAndUpdate(
      { _id: tr._id, status: 'in_transit' },
      { status: receiving ? 'received' : 'cancelled', receivedBy: req.user._id, receivedAt: new Date() },
      { new: true, session }
    );
    if (!upd) throw ApiError.conflict('Transfer already processed');
    return upd;
  });
  audit(req, { action: `inventory.transfer_${req.params.action}`, entity: 'StockTransfer', entityId: tr._id, branch: out.toBranch });
  ok(res, out);
}));

export default r;
