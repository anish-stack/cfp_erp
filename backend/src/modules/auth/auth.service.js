import { env } from '../../config/env.js';
import { User } from '../../models/User.js';
import { PatientAccount } from '../../models/PatientAccount.js';
import { Patient } from '../../models/Patient.js';
import { ApiError } from '../../utils/ApiError.js';
import { signAccess, signRefresh, signPatient, verify } from '../../utils/tokens.js';
import { MODULES, MODULE_KEYS } from '../../constants/permissions.js';

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;

export async function staffLogin(login) {
  const id = String(login.login).trim();
  // email, or mobile typed any way (+91 98xx-xxxxxx, 098…) → last 10 digits
  const q = id.includes('@') ? { email: id.toLowerCase() } : { phone: id.replace(/\D/g, '').slice(-10) };
  const user = await User.findOne(q).select('+passwordHash +tokenVersion +failedLogins +lockUntil');
  if (!user || !user.isActive) throw ApiError.unauthorized('Invalid credentials');
  if (user.lockUntil && user.lockUntil > new Date()) throw ApiError.tooMany('Account locked. Try again later');

  if (!(await user.checkPassword(login.password))) {
    user.failedLogins = (user.failedLogins || 0) + 1;
    if (user.failedLogins >= LOCK_AFTER) {
      user.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
      user.failedLogins = 0;
    }
    await user.save();
    throw ApiError.unauthorized('Invalid credentials');
  }

  user.failedLogins = 0;
  user.lockUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();

  return { user, accessToken: signAccess(user), refreshToken: signRefresh(user) };
}

export async function refresh(token) {
  if (!token) throw ApiError.unauthorized('No refresh token');
  let p;
  try {
    p = verify(token, env.JWT_REFRESH_SECRET);
  } catch {
    throw ApiError.unauthorized('Invalid refresh token');
  }
  if (p.typ !== 'refresh') throw ApiError.unauthorized('Invalid token type');
  const user = await User.findById(p.sub).select('+tokenVersion');
  if (!user || !user.isActive || user.tokenVersion !== p.tv) throw ApiError.unauthorized('Session revoked');
  return { accessToken: signAccess(user), refreshToken: signRefresh(user) };
}

export const revokeAll = (userId) => User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });

export async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await User.findById(userId).select('+passwordHash +tokenVersion');
  if (!(await user.checkPassword(currentPassword))) throw ApiError.badRequest('Current password incorrect');
  await user.setPassword(newPassword);
  user.tokenVersion += 1;
  await user.save();
  return { accessToken: signAccess(user), refreshToken: signRefresh(user) };
}

/** Profile + flat permissions + menu modules (frontend sidebar source) */
export async function staffProfile(reqUser, perms) {
  const user = await User.findById(reqUser._id).populate('role', 'name slug scope').populate('branches', 'name code slug');
  const all = perms.has('*');
  const modules = MODULE_KEYS.filter((k) => all || perms.has(`${k}.view`)).map((k) => ({ key: k, ...MODULES[k] }));
  const { getSettings } = await import('../../models/Settings.js');
  const f = (await getSettings()).features || {};
  return {
    user,
    permissions: all ? ['*'] : [...perms],
    modules,
    features: { ipd: f.ipd === true, exotel: f.exotel === true, marketing: f.marketing === true },
  };
}

// ---------- patient ----------

export async function patientLoginAfterOtp(mobile) {
  const account = await PatientAccount.findOneAndUpdate(
    { mobile },
    { $set: { isVerified: true, lastLoginAt: new Date() }, $setOnInsert: { mobile } },
    { upsert: true, new: true }
  );
  if (account.isBlocked) throw ApiError.forbidden('Account blocked. Contact clinic');
  const profiles = await Patient.find({ account: account._id, isActive: true }).sort({ createdAt: 1 });
  return { token: signPatient(account), account, profiles, isNew: profiles.length === 0 };
}
