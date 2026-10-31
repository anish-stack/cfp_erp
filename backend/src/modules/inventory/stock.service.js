import mongoose from 'mongoose';
import { Batch, StockMovement, Product } from '../../models/Inventory.js';
import { ApiError } from '../../utils/ApiError.js';
import { todayIST, addDays } from '../../utils/time.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/** Add stock to (product, branch, batchNo). Creates batch if new. */
export async function receive({ branch, product, batchNo, expiry, qty, purchasePrice, mrp, sellPrice, supplier, type = 'purchase', refType, refId, refNo, by, reason }, session) {
  if (qty <= 0) throw ApiError.badRequest('Qty must be positive');
  const set = { expiry };
  if (purchasePrice != null) set.purchasePrice = purchasePrice;
  if (mrp != null) set.mrp = mrp;
  if (sellPrice != null) set.sellPrice = sellPrice;
  if (supplier) set.supplier = supplier;
  const b = await Batch.findOneAndUpdate(
    { product, branch, batchNo: String(batchNo).toUpperCase() },
    { $inc: { qty }, $set: set },
    { upsert: true, new: true, session, setDefaultsOnInsert: true }
  );
  await StockMovement.create([{ product, batch: b._id, batchNo: b.batchNo, branch, type, qty, balanceAfter: b.qty, refType, refId, refNo, by, reason }], { session });
  return b;
}

/**
 * First-Expiry-First-Out issue. Skips expired batches. Each decrement is conditional (qty ≥ take)
 * so concurrent sales can't push a batch negative; on a lost race the transaction aborts.
 * @returns allocations [{ batch, batchNo, expiry, qty }]
 */
export async function issueFEFO({ branch, product, qty, type = 'sale', refType, refId, refNo, by }, session) {
  const today = todayIST();
  const batches = await Batch.find({ product, branch, qty: { $gt: 0 }, expiry: { $gte: today } })
    .sort({ expiry: 1, createdAt: 1 })
    .session(session);
  const available = batches.reduce((a, b) => a + b.qty, 0);
  if (available < qty) {
    const p = await Product.findById(product).select('name').lean();
    throw ApiError.conflict(`Insufficient stock for ${p?.name || 'product'}: need ${qty}, have ${available}`);
  }
  let left = qty;
  const allocations = [];
  for (const b of batches) {
    if (left <= 0) break;
    const take = Math.min(left, b.qty);
    const upd = await Batch.findOneAndUpdate({ _id: b._id, qty: { $gte: take } }, { $inc: { qty: -take } }, { new: true, session });
    if (!upd) throw ApiError.conflict('Stock changed, please retry');
    await StockMovement.create([{ product, batch: b._id, batchNo: b.batchNo, branch, type, qty: -take, balanceAfter: upd.qty, refType, refId, refNo, by }], { session });
    allocations.push({ batch: b._id, batchNo: b.batchNo, expiry: b.expiry, qty: take, purchasePrice: b.purchasePrice, mrp: b.mrp, sellPrice: b.sellPrice });
    left -= take;
  }
  return allocations;
}

/** Put qty back into a specific batch (returns / cancellations) */
export async function restockBatch({ batch, qty, type = 'return', refType, refId, refNo, by, reason }, session) {
  const b = await Batch.findByIdAndUpdate(batch, { $inc: { qty } }, { new: true, session });
  if (!b) throw ApiError.notFound('Batch not found for restock');
  await StockMovement.create([{ product: b.product, batch: b._id, batchNo: b.batchNo, branch: b.branch, type, qty, balanceAfter: b.qty, refType, refId, refNo, by, reason }], { session });
  return b;
}

/** Manual adjustment (+/-) on a batch */
export async function adjust({ batch, delta, reason, by }, session) {
  const cond = delta < 0 ? { _id: batch, qty: { $gte: -delta } } : { _id: batch };
  const b = await Batch.findOneAndUpdate(cond, { $inc: { qty: delta } }, { new: true, session });
  if (!b) throw ApiError.badRequest('Batch not found or adjustment exceeds stock');
  await StockMovement.create([{ product: b.product, batch: b._id, batchNo: b.batchNo, branch: b.branch, type: 'adjust', qty: delta, balanceAfter: b.qty, reason, by }], { session });
  return b;
}

/** Stock per product for branch filter (non-expired + expired split) */
export async function stockSummary(branchMatch, { lowOnly = false, productIds } = {}) {
  const today = todayIST();
  const match = { ...branchMatch };
  if (productIds) match.product = { $in: productIds.map(oid) };
  const rows = await Batch.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$product',
        qty: { $sum: { $cond: [{ $gte: ['$expiry', today] }, '$qty', 0] } },
        expiredQty: { $sum: { $cond: [{ $lt: ['$expiry', today] }, '$qty', 0] } },
        value: { $sum: { $multiply: [{ $cond: [{ $gte: ['$expiry', today] }, '$qty', 0] }, '$purchasePrice'] } },
        nearestExpiry: { $min: { $cond: [{ $and: [{ $gt: ['$qty', 0] }, { $gte: ['$expiry', today] }] }, '$expiry', null] } },
      },
    },
    { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
    { $unwind: '$product' },
    { $project: { _id: 0, product: { _id: 1, name: 1, sku: 1, unit: 1, reorderLevel: 1, type: 1, mrp: 1, sellPrice: 1 }, qty: 1, expiredQty: 1, value: { $round: ['$value', 2] }, nearestExpiry: 1, low: { $lte: ['$qty', '$product.reorderLevel'] } } },
    ...(lowOnly ? [{ $match: { low: true } }] : []),
    { $sort: { 'product.name': 1 } },
  ]);
  return rows;
}

export async function expiringBatches(branchMatch, days = 90) {
  const today = todayIST();
  return Batch.find({ ...branchMatch, qty: { $gt: 0 }, expiry: { $lte: addDays(today, days) } })
    .populate('product', 'name sku unit')
    .populate('branch', 'name code')
    .sort({ expiry: 1 })
    .lean();
}
