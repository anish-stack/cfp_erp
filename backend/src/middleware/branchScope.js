import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';

/**
 * Sets:
 *  req.allowedBranches  → null (all) | ObjectId[]
 *  req.activeBranch     → ObjectId | null  (from x-branch-id header or ?branch=)
 *  req.branchFilter(field='branch') → mongo filter object for list queries
 *  req.assertBranch(id) → throws 403 when user cannot touch that branch
 */
export function branchScope(req, _res, next) {
  const u = req.user;
  if (!u) return next(ApiError.unauthorized());

  const unrestricted = req.isSuperAdmin || u.allBranches;
  req.allowedBranches = unrestricted ? null : (u.branches || []).map((b) => new mongoose.Types.ObjectId(String(b)));

  const requested = req.query.branch || req.get('x-branch-id'); // explicit query wins over console's global header
  if (requested) {
    if (!mongoose.isValidObjectId(requested)) return next(ApiError.badRequest('Invalid branch id'));
    const id = new mongoose.Types.ObjectId(String(requested));
    if (req.allowedBranches && !req.allowedBranches.some((b) => b.equals(id))) {
      return next(ApiError.forbidden('No access to this branch'));
    }
    req.activeBranch = id;
  } else {
    req.activeBranch = req.allowedBranches?.length === 1 ? req.allowedBranches[0] : null;
  }

  req.branchFilter = (field = 'branch') => {
    if (req.activeBranch) return { [field]: req.activeBranch };
    if (req.allowedBranches) return { [field]: { $in: req.allowedBranches } };
    return {};
  };

  req.canAccessBranch = (id) =>
    !req.allowedBranches || (id && req.allowedBranches.some((b) => b.equals(String(id))));

  req.assertBranch = (id) => {
    if (!req.canAccessBranch(id)) throw ApiError.forbidden('No access to this branch');
  };

  next();
}
