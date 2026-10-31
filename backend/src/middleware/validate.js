import { ApiError } from '../utils/ApiError.js';

/** validate({ body, query, params }) with zod schemas; replaces req.* with parsed values */
export const validate = (schemas) => (req, _res, next) => {
  try {
    for (const key of ['params', 'query', 'body']) {
      if (!schemas[key]) continue;
      const r = schemas[key].safeParse(req[key]);
      if (!r.success) {
        throw ApiError.badRequest('Validation failed', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
      }
      if (key === 'query') Object.defineProperty(req, 'query', { value: r.data, writable: true });
      else req[key] = r.data;
    }
    next();
  } catch (e) {
    next(e);
  }
};
