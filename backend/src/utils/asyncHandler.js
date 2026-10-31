export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

export const paged = (res, { items, total, page, limit }) =>
  res.json({ success: true, data: items, meta: { total, page, limit, pages: Math.ceil(total / limit) || 1 } });

export function parsePaging(q) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(q.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

export const escapeRegex = (s = '') => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
