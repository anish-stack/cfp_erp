import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { permit, hasPerm } from '../../middleware/permit.js';
import { branchScope } from '../../middleware/branchScope.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { ymd } from '../../utils/zod.js';
import { toCsv } from '../../utils/csv.js';
import { todayIST, addDays, istDayRange, istToDate } from '../../utils/time.js';
import { Appointment } from '../../models/Appointment.js';
import { Patient } from '../../models/Patient.js';
import { Invoice, Payment } from '../../models/Billing.js';
import { Batch, StockMovement, PurchaseOrder } from '../../models/Inventory.js';
import { Expense } from '../../models/Misc.js';
import { Lead, LeadStage } from '../../models/Crm.js';
import { FollowUp } from '../../models/Clinical.js';
import { stockSummary } from '../inventory/stock.service.js';

const r = Router();
r.use(auth, branchScope);

const IST = '+05:30';
const range = z.object({ from: ymd.optional(), to: ymd.optional(), format: z.enum(['json', 'csv']).optional() });
const dates = (q) => {
  const to = q.to || todayIST();
  const from = q.from || addDays(to, -29);
  if (from > to) throw ApiError.badRequest('from after to');
  return { from, to, created: { $gte: istToDate(from, '00:00'), $lt: istToDate(addDays(to, 1), '00:00') } };
};
const dayExpr = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: IST } };

/** JSON or CSV output */
function send(req, res, name, rows, cols) {
  if (req.query.format === 'csv') {
    audit(req, { action: 'reports.export', entity: 'Report', meta: { name } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${todayIST()}.csv"`);
    return res.send(toCsv(rows, cols));
  }
  return ok(res, rows);
}
const needExport = (req, _res, next) => (req.query.format === 'csv' && !hasPerm(req, 'reports.export') ? next(ApiError.forbidden('Export not permitted')) : next());

// ---------- dashboard ----------
r.get('/dashboard', permit('dashboard.view'), asyncHandler(async (req, res) => {
  const bf = req.branchFilter('branch');
  const today = todayIST();
  const tr = istDayRange(today);
  const from14 = addDays(today, -13);
  const created14 = { $gte: istToDate(from14, '00:00'), $lt: tr.$lt };
  const pf = (k) => hasPerm(req, k);

  const tasks = {
    apptToday: pf('appointments.view') ? Appointment.aggregate([{ $match: { ...bf, date: today } }, { $group: { _id: '$status', n: { $sum: 1 } } }]) : [],
    apptSeries: pf('appointments.view') ? Appointment.aggregate([{ $match: { ...bf, date: { $gte: from14, $lte: today }, status: { $ne: 'rescheduled' } } }, { $group: { _id: '$date', n: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } }, { $sort: { _id: 1 } }]) : [],
    upcoming: pf('appointments.view') ? Appointment.find({ ...bf, date: today, status: { $in: ['booked', 'confirmed', 'checked_in', 'in_consultation'] }, ...(req.user.doctor && !pf('appointments.assign') ? { doctor: req.user.doctor } : {}) }).populate('patient', 'name patientId').populate('doctor', 'name').sort({ start: 1 }).limit(10).lean() : [],
    revenueToday: pf('billing.view') ? Payment.aggregate([{ $match: { ...bf, createdAt: tr, kind: { $in: ['payment', 'advance', 'refund'] } } }, { $group: { _id: '$kind', amt: { $sum: '$amount' } } }]) : [],
    revenueSeries: pf('billing.view') ? Payment.aggregate([{ $match: { ...bf, createdAt: created14, kind: { $in: ['payment', 'advance', 'refund'] } } }, { $group: { _id: dayExpr, amt: { $sum: { $cond: [{ $eq: ['$kind', 'refund'] }, { $multiply: ['$amount', -1] }, '$amount'] } } } }, { $sort: { _id: 1 } }]) : [],
    outstanding: pf('billing.view') ? Invoice.aggregate([{ $match: { ...bf, status: { $in: ['unpaid', 'partial'] } } }, { $group: { _id: null, amt: { $sum: '$balance' }, n: { $sum: 1 } } }]) : [],
    newPatients: pf('patients.view') ? Patient.countDocuments({ ...(req.activeBranch ? { registeredBranch: req.activeBranch } : req.allowedBranches ? { registeredBranch: { $in: req.allowedBranches } } : {}), createdAt: tr }) : 0,
    followupsDue: pf('followups.view') ? FollowUp.countDocuments({ ...bf, dueDate: { $lte: today }, status: { $in: ['pending', 'contacted'] } }) : 0,
    leadsToday: pf('leads.view') ? Lead.countDocuments({ createdAt: tr, isActive: true }) : 0,
    lowStock: pf('inventory.view') ? stockSummary(bf, { lowOnly: true }).then((x) => x.length) : 0,
    expiring: pf('inventory.view') ? Batch.countDocuments({ ...bf, qty: { $gt: 0 }, expiry: { $lte: addDays(today, 60) } }) : 0,
    byBranch: pf('billing.view') && !req.activeBranch ? Payment.aggregate([{ $match: { ...bf, createdAt: { $gte: istToDate(`${today.slice(0, 7)}-01`, '00:00') }, kind: { $in: ['payment', 'advance', 'refund'] } } }, { $group: { _id: '$branch', amt: { $sum: { $cond: [{ $eq: ['$kind', 'refund'] }, { $multiply: ['$amount', -1] }, '$amount'] } } } }, { $lookup: { from: 'branches', localField: '_id', foreignField: '_id', as: 'b' } }, { $project: { amt: 1, name: { $first: '$b.name' } } }, { $sort: { amt: -1 } }]) : [],
  };
  const keys = Object.keys(tasks);
  const vals = await Promise.all(Object.values(tasks));
  const d = Object.fromEntries(keys.map((k, i) => [k, vals[i]]));

  const rt = Object.fromEntries((d.revenueToday || []).map((x) => [x._id, x.amt]));
  // fill series gaps
  const days = Array.from({ length: 14 }, (_, i) => addDays(from14, i));
  const am = new Map(d.apptSeries.map((x) => [x._id, x]));
  const rm = new Map(d.revenueSeries.map((x) => [x._id, x.amt]));
  ok(res, {
    today,
    appointments: { byStatus: Object.fromEntries(d.apptToday.map((x) => [x._id, x.n])), total: d.apptToday.reduce((a, x) => a + x.n, 0) },
    upcoming: d.upcoming,
    collectionToday: Math.round(((rt.payment || 0) + (rt.advance || 0) - (rt.refund || 0)) * 100) / 100,
    outstanding: d.outstanding[0] || { amt: 0, n: 0 },
    newPatients: d.newPatients,
    followupsDue: d.followupsDue,
    leadsToday: d.leadsToday,
    lowStock: d.lowStock,
    expiring: d.expiring,
    series: days.map((day) => ({ date: day, appointments: am.get(day)?.n || 0, completed: am.get(day)?.completed || 0, revenue: Math.round((rm.get(day) || 0) * 100) / 100 })),
    byBranch: d.byBranch,
    access: { appointments: pf('appointments.view'), billing: pf('billing.view'), inventory: pf('inventory.view'), leads: pf('leads.view') },
  });
}));

// ---------- revenue ----------
r.get('/revenue', permit('reports.view'), validate({ query: range.extend({ groupBy: z.enum(['day', 'branch', 'mode', 'month']).default('day') }) }), needExport, asyncHandler(async (req, res) => {
  if (!hasPerm(req, 'billing.view')) throw ApiError.forbidden('Billing access required');
  const { created } = dates(req.query);
  const g = req.query.groupBy;
  const key = g === 'day' ? dayExpr : g === 'month' ? { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: IST } } : g === 'branch' ? '$branch' : '$mode';
  const rows = await Payment.aggregate([
    { $match: { ...req.branchFilter('branch'), createdAt: created } },
    { $group: { _id: key, collected: { $sum: { $cond: [{ $in: ['$kind', ['payment', 'advance']] }, '$amount', 0] } }, refunds: { $sum: { $cond: [{ $eq: ['$kind', 'refund'] }, '$amount', 0] } }, advanceUsed: { $sum: { $cond: [{ $eq: ['$kind', 'advance_adjust'] }, '$amount', 0] } }, n: { $sum: 1 } } },
    ...(g === 'branch' ? [{ $lookup: { from: 'branches', localField: '_id', foreignField: '_id', as: 'b' } }, { $set: { label: { $first: '$b.name' } } }, { $unset: 'b' }] : [{ $set: { label: '$_id' } }]),
    { $set: { net: { $round: [{ $subtract: ['$collected', '$refunds'] }, 2] } } },
    { $sort: { _id: 1 } },
  ]);
  const billed = await Invoice.aggregate([
    { $match: { ...req.branchFilter('branch'), createdAt: created, status: { $ne: 'cancelled' } } },
    { $group: { _id: '$type', billed: { $sum: '$grandTotal' }, tax: { $sum: '$tax' }, discount: { $sum: '$discount' }, n: { $sum: 1 } } },
  ]);
  if (req.query.format === 'csv') return send(req, res, `revenue-${g}`, rows, [['Group', 'label'], ['Collected', 'collected'], ['Refunds', 'refunds'], ['Net', 'net'], ['Advance used', 'advanceUsed'], ['Txns', 'n']]);
  ok(res, { rows, billedByType: billed });
}));

// ---------- appointments ----------
r.get('/appointments', permit('reports.view'), validate({ query: range }), needExport, asyncHandler(async (req, res) => {
  const { from, to } = dates(req.query);
  const m = { ...req.branchFilter('branch'), date: { $gte: from, $lte: to }, status: { $ne: 'rescheduled' } };
  const [byStatus, byDoctor, byType, byBranch] = await Promise.all([
    Appointment.aggregate([{ $match: m }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Appointment.aggregate([{ $match: m }, { $group: { _id: '$doctor', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, noShow: { $sum: { $cond: [{ $eq: ['$status', 'no_show'] }, 1, 0] } }, cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } } } }, { $lookup: { from: 'doctors', localField: '_id', foreignField: '_id', as: 'd' } }, { $set: { name: { $first: '$d.name' } } }, { $unset: 'd' }, { $sort: { total: -1 } }]),
    Appointment.aggregate([{ $match: m }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
    Appointment.aggregate([{ $match: m }, { $group: { _id: '$branch', n: { $sum: 1 }, noShow: { $sum: { $cond: [{ $eq: ['$status', 'no_show'] }, 1, 0] } } } }, { $lookup: { from: 'branches', localField: '_id', foreignField: '_id', as: 'b' } }, { $set: { name: { $first: '$b.name' } } }, { $unset: 'b' }]),
  ]);
  if (req.query.format === 'csv') return send(req, res, 'appointments-by-doctor', byDoctor, [['Doctor', 'name'], ['Total', 'total'], ['Completed', 'completed'], ['No-show', 'noShow'], ['Cancelled', 'cancelled']]);
  const total = byStatus.reduce((a, x) => a + x.n, 0);
  const ns = byStatus.find((x) => x._id === 'no_show')?.n || 0;
  ok(res, { total, noShowRate: total ? Math.round((ns / total) * 1000) / 10 : 0, byStatus, byDoctor, byType, byBranch });
}));

// ---------- patients ----------
r.get('/patients', permit('reports.view'), validate({ query: range }), needExport, asyncHandler(async (req, res) => {
  const { created } = dates(req.query);
  const scope = req.activeBranch ? { registeredBranch: req.activeBranch } : req.allowedBranches ? { registeredBranch: { $in: req.allowedBranches } } : {};
  const m = { ...scope, createdAt: created };
  const [byDay, bySource, byBranch, byGender] = await Promise.all([
    Patient.aggregate([{ $match: m }, { $group: { _id: dayExpr, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Patient.aggregate([{ $match: m }, { $group: { _id: '$source', n: { $sum: 1 } } }]),
    Patient.aggregate([{ $match: m }, { $group: { _id: '$registeredBranch', n: { $sum: 1 } } }, { $lookup: { from: 'branches', localField: '_id', foreignField: '_id', as: 'b' } }, { $set: { name: { $first: '$b.name' } } }, { $unset: 'b' }]),
    Patient.aggregate([{ $match: m }, { $group: { _id: '$gender', n: { $sum: 1 } } }]),
  ]);
  if (req.query.format === 'csv') return send(req, res, 'new-patients', byDay, [['Date', '_id'], ['New patients', 'n']]);
  ok(res, { byDay, bySource, byBranch, byGender, total: byDay.reduce((a, x) => a + x.n, 0) });
}));

// ---------- inventory ----------
r.get('/inventory', permit('reports.view'), validate({ query: range }), needExport, asyncHandler(async (req, res) => {
  if (!hasPerm(req, 'inventory.view')) throw ApiError.forbidden('Inventory access required');
  const { created } = dates(req.query);
  const bf = req.branchFilter('branch');
  const [valuation, topSelling, stock] = await Promise.all([
    Batch.aggregate([{ $match: { ...bf, qty: { $gt: 0 }, expiry: { $gte: todayIST() } } }, { $group: { _id: '$branch', cost: { $sum: { $multiply: ['$qty', '$purchasePrice'] } }, mrp: { $sum: { $multiply: ['$qty', '$mrp'] } }, units: { $sum: '$qty' } } }, { $lookup: { from: 'branches', localField: '_id', foreignField: '_id', as: 'b' } }, { $set: { name: { $first: '$b.name' } } }, { $unset: 'b' }]),
    StockMovement.aggregate([{ $match: { ...bf, type: 'sale', createdAt: created } }, { $group: { _id: '$product', qty: { $sum: { $multiply: ['$qty', -1] } } } }, { $sort: { qty: -1 } }, { $limit: 20 }, { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'p' } }, { $set: { name: { $first: '$p.name' }, sku: { $first: '$p.sku' } } }, { $unset: 'p' }]),
    stockSummary(bf),
  ]);
  if (req.query.format === 'csv') return send(req, res, 'stock', stock, [['SKU', 'product.sku'], ['Product', 'product.name'], ['Qty', 'qty'], ['Expired qty', 'expiredQty'], ['Value (cost)', 'value'], ['Nearest expiry', 'nearestExpiry'], ['Reorder level', 'product.reorderLevel'], ['Low', (s) => (s.low ? 'YES' : '')]]);
  ok(res, { valuation, topSelling, stock });
}));

// ---------- expenses & P&L ----------
r.get('/pnl', permit('reports.view'), validate({ query: range }), needExport, asyncHandler(async (req, res) => {
  if (!hasPerm(req, 'billing.view') || !hasPerm(req, 'expenses.view')) throw ApiError.forbidden('Billing + expenses access required');
  const { from, to, created } = dates(req.query);
  const bf = req.branchFilter('branch');
  const [income, expenses, expByCat, purchases] = await Promise.all([
    Payment.aggregate([{ $match: { ...bf, createdAt: created } }, { $group: { _id: '$branch', inflow: { $sum: { $cond: [{ $in: ['$kind', ['payment', 'advance']] }, '$amount', 0] } }, refunds: { $sum: { $cond: [{ $eq: ['$kind', 'refund'] }, '$amount', 0] } } } }]),
    Expense.aggregate([{ $match: { ...bf, date: { $gte: from, $lte: to }, status: 'approved', isActive: true } }, { $group: { _id: '$branch', amt: { $sum: '$amount' } } }]),
    Expense.aggregate([{ $match: { ...bf, date: { $gte: from, $lte: to }, status: 'approved', isActive: true } }, { $group: { _id: '$category', amt: { $sum: '$amount' } } }, { $sort: { amt: -1 } }]),
    StockMovement.aggregate([{ $match: { ...bf, type: 'purchase', createdAt: created } }, { $lookup: { from: 'batches', localField: 'batch', foreignField: '_id', as: 'b' } }, { $group: { _id: '$branch', amt: { $sum: { $multiply: ['$qty', { $ifNull: [{ $first: '$b.purchasePrice' }, 0] }] } } } }]),
  ]);
  const { Branch } = await import('../../models/Branch.js');
  const branches = await Branch.find(req.allowedBranches ? { _id: { $in: req.allowedBranches } } : {}).select('name').lean();
  const get = (arr, id, k) => arr.find((x) => String(x._id) === String(id))?.[k] || 0;
  const rows = branches
    .filter((b) => !req.activeBranch || String(b._id) === String(req.activeBranch))
    .map((b) => {
      const inflow = get(income, b._id, 'inflow');
      const refunds = get(income, b._id, 'refunds');
      const exp = get(expenses, b._id, 'amt');
      const pur = Math.round(get(purchases, b._id, 'amt') * 100) / 100;
      return { branch: b.name, inflow, refunds, expenses: exp, purchases: pur, net: Math.round((inflow - refunds - exp - pur) * 100) / 100 };
    });
  if (req.query.format === 'csv') return send(req, res, 'pnl', rows, [['Branch', 'branch'], ['Collections', 'inflow'], ['Refunds', 'refunds'], ['Expenses', 'expenses'], ['Purchases', 'purchases'], ['Net', 'net']]);
  ok(res, { rows, expByCat, from, to });
}));

// ---------- leads ----------
r.get('/leads', permit('reports.view'), validate({ query: range }), needExport, asyncHandler(async (req, res) => {
  if (!hasPerm(req, 'leads.view')) throw ApiError.forbidden('Lead access required');
  const { created } = dates(req.query);
  const m = { createdAt: created, isActive: true };
  const [stages, byStage, bySource, byCampaign, byDay] = await Promise.all([
    LeadStage.find().sort({ order: 1 }).lean(),
    Lead.aggregate([{ $match: m }, { $group: { _id: '$stage', n: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: m }, { $group: { _id: '$source', n: { $sum: 1 }, converted: { $sum: { $cond: [{ $ifNull: ['$convertedAt', false] }, 1, 0] } } } }, { $sort: { n: -1 } }]),
    Lead.aggregate([{ $match: { ...m, campaign: { $ne: null } } }, { $group: { _id: '$campaign', n: { $sum: 1 }, converted: { $sum: { $cond: [{ $ifNull: ['$convertedAt', false] }, 1, 0] } } } }, { $lookup: { from: 'campaigns', localField: '_id', foreignField: '_id', as: 'c' } }, { $set: { name: { $first: '$c.name' }, spend: { $first: '$c.spend' } } }, { $unset: 'c' }, { $sort: { n: -1 } }]),
    Lead.aggregate([{ $match: m }, { $group: { _id: dayExpr, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
  ]);
  const counts = new Map(byStage.map((s) => [String(s._id), s.n]));
  const lostReasons = await Lead.aggregate([{ $match: { ...m, lostReason: { $nin: [null, ''] } } }, { $group: { _id: '$lostReason', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }]);
  if (req.query.format === 'csv') return send(req, res, 'leads-by-source', bySource, [['Source', '_id'], ['Leads', 'n'], ['Converted', 'converted']]);
  ok(res, { funnel: stages.map((s) => ({ name: s.name, color: s.color, count: counts.get(String(s._id)) || 0 })), bySource, byCampaign: byCampaign.map((c) => ({ ...c, cpl: c.spend && c.n ? Math.round((c.spend / c.n) * 100) / 100 : null })), byDay, lostReasons });
}));

// ---------- purchases ----------
r.get('/purchases', permit('reports.view'), validate({ query: range }), needExport, asyncHandler(async (req, res) => {
  if (!hasPerm(req, 'purchases.view')) throw ApiError.forbidden();
  const { created } = dates(req.query);
  const rows = await PurchaseOrder.aggregate([
    { $match: { ...req.branchFilter('branch'), createdAt: created, status: { $ne: 'cancelled' } } },
    { $group: { _id: '$supplier', orders: { $sum: 1 }, total: { $sum: '$total' } } },
    { $lookup: { from: 'suppliers', localField: '_id', foreignField: '_id', as: 's' } }, { $set: { supplier: { $first: '$s.name' } } }, { $unset: 's' }, { $sort: { total: -1 } },
  ]);
  send(req, res, 'purchases-by-supplier', rows, [['Supplier', 'supplier'], ['Orders', 'orders'], ['Total', 'total']]);
}));

export default r;
