import { ApiError } from '../utils/ApiError.js';

export const hasPerm = (req, perm) => req.perms?.has('*') || req.perms?.has(perm);

/** permit('patients.view') — all listed required. permit.any(...) — any one. */
export const permit = (...perms) => (req, _res, next) => {
  if (perms.every((p) => hasPerm(req, p))) return next();
  next(ApiError.forbidden(`Missing permission: ${perms.filter((p) => !hasPerm(req, p)).join(', ')}`));
};

permit.any = (...perms) => (req, _res, next) => {
  if (perms.some((p) => hasPerm(req, p))) return next();
  next(ApiError.forbidden(`Requires one of: ${perms.join(', ')}`));
};
