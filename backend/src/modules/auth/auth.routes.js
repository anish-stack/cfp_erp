import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { authLimiter, otpLimiter } from '../../middleware/rateLimit.js';
import * as c from './auth.controller.js';
import * as v from './auth.validation.js';

const r = Router();

// staff
r.post('/staff/login', authLimiter, validate({ body: v.staffLogin }), c.staffLogin);
r.post('/staff/refresh', c.staffRefresh);
r.post('/staff/logout', c.staffLogout);
r.post('/staff/logout-all', auth, c.staffLogoutAll);
r.get('/staff/me', auth, c.staffMe);
r.post('/staff/change-password', auth, validate({ body: v.changePassword }), c.changePassword);

// patient (OTP)
r.post('/patient/otp/send', otpLimiter, validate({ body: v.otpSend }), c.otpSend);
r.post('/patient/otp/verify', otpLimiter, validate({ body: v.otpVerify }), c.otpVerify);

export default r;
