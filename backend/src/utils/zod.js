import { z } from 'zod';
import mongoose from 'mongoose';

export const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm');
export const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const indianMobile = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter valid 10-digit mobile');
export const paging = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().trim().max(100).optional(),
  branch: objectId.optional(),
});
