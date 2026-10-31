import { asyncHandler, ok } from '../../utils/asyncHandler.js';
import { REFRESH_COOKIE, refreshCookieOpts } from '../../utils/tokens.js';
import { audit } from '../../utils/audit.js';
import * as svc from './auth.service.js';
import * as otp from './otp.service.js';

const setRefresh = (res, t) => res.cookie(REFRESH_COOKIE, t, refreshCookieOpts());
const clearRefresh = (res) => res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOpts(), maxAge: undefined });

export const staffLogin = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await svc.staffLogin(req.body);
  setRefresh(res, refreshToken);
  req.user = user;
  audit(req, { action: 'auth.login', entity: 'User', entityId: user._id });
  ok(res, { accessToken });
});

export const staffRefresh = asyncHandler(async (req, res) => {
  const { accessToken, refreshToken } = await svc.refresh(req.cookies?.[REFRESH_COOKIE]);
  setRefresh(res, refreshToken);
  ok(res, { accessToken });
});

export const staffLogout = asyncHandler(async (_req, res) => {
  clearRefresh(res);
  ok(res, { loggedOut: true });
});

export const staffLogoutAll = asyncHandler(async (req, res) => {
  await svc.revokeAll(req.user._id);
  clearRefresh(res);
  audit(req, { action: 'auth.logout_all', entity: 'User', entityId: req.user._id });
  ok(res, { loggedOut: true });
});

export const staffMe = asyncHandler(async (req, res) => ok(res, await svc.staffProfile(req.user, req.perms)));

export const changePassword = asyncHandler(async (req, res) => {
  const { accessToken, refreshToken } = await svc.changePassword(req.user._id, req.body);
  setRefresh(res, refreshToken);
  audit(req, { action: 'auth.change_password', entity: 'User', entityId: req.user._id });
  ok(res, { accessToken });
});

export const otpSend = asyncHandler(async (req, res) => ok(res, await otp.sendOtp(req.body.mobile)));

export const otpVerify = asyncHandler(async (req, res) => {
  await otp.verifyOtp(req.body.mobile, req.body.otp);
  const out = await svc.patientLoginAfterOtp(req.body.mobile);
  req.patientAccount = out.account;
  audit(req, { action: 'patient.login', entity: 'PatientAccount', entityId: out.account._id });
  ok(res, { token: out.token, mobile: out.account.mobile, isNew: out.isNew, profiles: out.profiles });
});
