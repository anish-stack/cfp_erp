import { z } from 'zod';

export const mobile = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter valid 10-digit mobile');

export const staffLogin = z.object({
  login: z.string().trim().min(3), // email or phone
  password: z.string().min(1),
});

export const changePassword = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8, 'Min 8 characters')
    .regex(/[A-Z]/, 'Needs an uppercase letter')
    .regex(/[a-z]/, 'Needs a lowercase letter')
    .regex(/\d/, 'Needs a number'),
});

export const otpSend = z.object({ mobile });
export const otpVerify = z.object({ mobile, otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits') });
