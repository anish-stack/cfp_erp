import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const signAccess = (user) =>
  jwt.sign({ sub: String(user._id), tv: user.tokenVersion, typ: 'staff' }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
  });

export const signRefresh = (user) =>
  jwt.sign({ sub: String(user._id), tv: user.tokenVersion, typ: 'refresh' }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL,
  });

export const signPatient = (account) =>
  jwt.sign({ sub: String(account._id), tv: account.tokenVersion, typ: 'patient' }, env.JWT_PATIENT_SECRET, {
    expiresIn: env.JWT_PATIENT_TTL,
  });

export const verify = (token, secret) => jwt.verify(token, secret);

export const REFRESH_COOKIE = 'cpf_rt';

export const refreshCookieOpts = () => ({
  httpOnly: true,
  secure: env.isProd,
  sameSite: env.isProd ? 'strict' : 'lax',
  domain: env.COOKIE_DOMAIN || undefined,
  path: '/api/v1/auth/staff',
  maxAge: 7 * 24 * 60 * 60 * 1000,
});
