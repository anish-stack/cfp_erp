import { z } from 'zod';
import { objectId, indianMobile } from '../../utils/zod.js';

export const profile = z
  .object({
    name: z.string().trim().min(2).max(80),
    relation: z.enum(['self', 'spouse', 'child', 'parent', 'sibling', 'other']).default('self'),
    gender: z.enum(['male', 'female', 'other']),
    dob: z.coerce.date().max(new Date(), 'DOB in future').optional(),
    ageYears: z.number().int().min(0).max(120).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    altPhone: indianMobile.optional(),
    address: z.object({
      line1: z.string().max(200).optional(),
      city: z.string().max(60).optional(),
      state: z.string().max(60).optional(),
      pincode: z.string().regex(/^\d{6}$/).optional(),
    }).optional(),
    bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
    allergies: z.array(z.string().trim().max(60)).max(20).optional(),
    emergencyContact: z.object({ name: z.string().max(80), phone: indianMobile, relation: z.string().max(30).optional() }).optional(),
    registeredBranch: objectId.optional(),
  });

export const profileCreate = profile.refine((d) => d.dob || d.ageYears !== undefined, 'DOB or age required');

export const staffCreate = profile
  .extend({ mobile: indianMobile, registeredBranch: objectId })
  .refine((d) => d.dob || d.ageYears !== undefined, 'DOB or age required');

export const profileUpdate = profile.partial().omit({ registeredBranch: true });
