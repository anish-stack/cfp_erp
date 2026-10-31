import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { permit } from '../../middleware/permit.js';
import { branchScope } from '../../middleware/branchScope.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, paged, parsePaging } from '../../utils/asyncHandler.js';
import { objectId, paging } from '../../utils/zod.js';
import { AuditLog } from '../../models/AuditLog.js';

const query = paging.extend({
  user: objectId.optional(),
  entity: z.string().max(40).optional(),
  entityId: objectId.optional(),
  action: z.string().max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const r = Router();
r.use(auth, branchScope);

r.get('/', permit('audit_logs.view'), validate({ query }), asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query);
  const f = {};
  if (req.allowedBranches || req.activeBranch) Object.assign(f, req.branchFilter('branch'));
  for (const k of ['user', 'entity', 'entityId']) if (req.query[k]) f[k] = req.query[k];
  if (req.query.action) f.action = { $regex: `^${req.query.action.replace(/[^a-z_.]/gi, '')}` };
  if (req.query.from || req.query.to) {
    f.createdAt = {};
    if (req.query.from) f.createdAt.$gte = req.query.from;
    if (req.query.to) f.createdAt.$lte = req.query.to;
  }
  const [items, total] = await Promise.all([
    AuditLog.find(f).populate('user', 'name email').populate('branch', 'name code').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(f),
  ]);
  paged(res, { items, total, page, limit });
}));

export default r;
