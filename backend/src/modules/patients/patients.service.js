import { withTransaction } from '../../config/db.js';
import { Patient } from '../../models/Patient.js';
import { PatientAccount } from '../../models/PatientAccount.js';
import { ApiError } from '../../utils/ApiError.js';
import { nextPatientId } from '../../utils/counter.js';
import { escapeRegex } from '../../utils/asyncHandler.js';
import * as notify from '../../services/notify.js';

export const MAX_FAMILY = 10;

/** Create patient under account (creates account for mobile if missing). Atomic id + insert. */
export async function createPatient({ mobile, accountId, createdBy, source, ...data }) {
  return withTransaction(async (session) => {
    let account;
    if (accountId) account = await PatientAccount.findById(accountId).session(session);
    else {
      account = await PatientAccount.findOneAndUpdate(
        { mobile },
        { $setOnInsert: { mobile } },
        { upsert: true, new: true, session }
      );
    }
    if (!account) throw ApiError.notFound('Account not found');

    const count = await Patient.countDocuments({ account: account._id, isActive: true }).session(session);
    if (count >= MAX_FAMILY) throw ApiError.badRequest(`Max ${MAX_FAMILY} profiles per mobile number`);
    if (data.relation === 'self') {
      const self = await Patient.exists({ account: account._id, relation: 'self', isActive: true }).session(session);
      if (self) throw ApiError.conflict('A "self" profile already exists for this mobile');
    }

    const patientId = await nextPatientId(session);
    const [p] = await Patient.create(
      [{
        ...data,
        patientId,
        account: account._id,
        mobile: account.mobile,
        source,
        createdBy,
        branchesVisited: data.registeredBranch ? [data.registeredBranch] : [],
      }],
      { session }
    );
    return p;
  }).then((p) => {
    notify.enqueue('patient.welcome', { patientId: String(p._id) });
    return p;
  });
}

/** Staff list — restricted users only see patients registered at / visiting their branches. */
export async function listForStaff(req, { page, limit, skip, q }) {
  const filter = { isActive: true };
  const scope = req.activeBranch ? [req.activeBranch] : req.allowedBranches;
  if (scope) filter.$or = [{ registeredBranch: { $in: scope } }, { branchesVisited: { $in: scope } }];
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const search = /^\d{10}$/.test(q) ? [{ mobile: q }] : [{ name: rx }, { patientId: rx }, { mobile: rx }];
    filter.$and = [{ $or: search }];
  }
  const [items, total] = await Promise.all([
    Patient.find(filter).populate('registeredBranch', 'name code').sort({ createdAt: -1 }).skip(skip).limit(limit),
    Patient.countDocuments(filter),
  ]);
  return { items, total, page, limit };
}

export async function getForStaff(req, id) {
  const p = await Patient.findById(id).populate('registeredBranch', 'name code').populate('branchesVisited', 'name code');
  if (!p) throw ApiError.notFound('Patient not found');
  if (req.allowedBranches) {
    const ids = [p.registeredBranch?._id, ...p.branchesVisited.map((b) => b._id)].filter(Boolean);
    if (!ids.some((b) => req.canAccessBranch(b))) throw ApiError.forbidden('Patient not registered at your branch');
  }
  return p;
}

/** Cross-branch lookup by exact mobile — minimal fields only (reception walk-in). */
export async function lookupByMobile(mobile) {
  return Patient.find({ mobile, isActive: true })
    .select('patientId name gender dob ageYears relation registeredBranch')
    .populate('registeredBranch', 'name code')
    .sort({ createdAt: 1 });
}

export async function linkBranch(patientId, branchId) {
  await Patient.updateOne({ _id: patientId }, { $addToSet: { branchesVisited: branchId } });
}
