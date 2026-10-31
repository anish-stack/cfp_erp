import { AuditLog } from '../models/AuditLog.js';
import { logger } from '../config/logger.js';

const strip = (o) => {
  if (!o) return undefined;
  const obj = typeof o.toObject === 'function' ? o.toObject() : { ...o };
  delete obj.passwordHash;
  delete obj.codeHash;
  delete obj.__v;
  return obj;
};

/** Fire-and-forget audit write. Never blocks or fails the request. */
export function audit(req, { action, entity, entityId, branch, before, after, meta }) {
  const actor = req.user
    ? { user: req.user._id, actorType: 'staff' }
    : req.patientAccount
      ? { patientAccount: req.patientAccount._id, actorType: 'patient' }
      : { actorType: 'system' };
  AuditLog.create({
    ...actor,
    action,
    entity,
    entityId,
    branch,
    before: strip(before),
    after: strip(after),
    meta,
    ip: req.ip,
    ua: req.get?.('user-agent'),
  }).catch((e) => logger.error({ err: e.message }, 'audit write failed'));
}
