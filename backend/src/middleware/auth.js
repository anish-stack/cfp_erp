import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { PatientAccount } from '../models/PatientAccount.js';
import { ApiError } from '../utils/ApiError.js';
import { verify } from '../utils/tokens.js';

const bearer = (req) => {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};

/** Staff JWT → req.user (with populated role) + req.perms (Set) */
export async function auth(req, _res, next) {
  try {
    const token = bearer(req);
    if (!token) throw ApiError.unauthorized('Missing token');
    let payload;
    try {
      payload = verify(token, env.JWT_ACCESS_SECRET);
    } catch {
      throw ApiError.unauthorized('Invalid or expired token');
    }
    if (payload.typ !== 'staff') throw ApiError.unauthorized('Invalid token type');

    const user = await User.findById(payload.sub).select('+tokenVersion').populate('role').lean();
    if (!user || !user.isActive) throw ApiError.unauthorized('Account inactive');
    if (user.tokenVersion !== payload.tv) throw ApiError.unauthorized('Session revoked');
    if (!user.role) throw ApiError.forbidden('No role assigned');

    req.user = user;
    req.perms = new Set(user.role.permissions);
    req.isSuperAdmin = req.perms.has('*');
    next();
  } catch (e) {
    next(e);
  }
}

/** Patient OTP JWT → req.patientAccount */
export async function patientAuth(req, _res, next) {
  try {
    const token = bearer(req);
    if (!token) throw ApiError.unauthorized('Missing token');
    let payload;
    try {
      payload = verify(token, env.JWT_PATIENT_SECRET);
    } catch {
      throw ApiError.unauthorized('Invalid or expired token');
    }
    if (payload.typ !== 'patient') throw ApiError.unauthorized('Invalid token type');
    const acc = await PatientAccount.findById(payload.sub).lean();
    if (!acc || acc.isBlocked) throw ApiError.unauthorized('Account unavailable');
    if (acc.tokenVersion !== payload.tv) throw ApiError.unauthorized('Session revoked');
    req.patientAccount = acc;
    next();
  } catch (e) {
    next(e);
  }
}
