import { Router } from 'express';
import { z } from 'zod';
import { permit } from '../middleware/permit.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, ok, paged, parsePaging, escapeRegex } from './asyncHandler.js';
import { ApiError } from './ApiError.js';
import { audit } from './audit.js';
import { objectId } from './zod.js';

/**
 * Small CRUD router for simple master data. Mount after auth + branchScope.
 * opts: { model, module, schema (zod object), search: [fields], populate, sort, branchField, softDelete, beforeCreate(req, data), filters(req) }
 */
export function crudRouter({ model, module, schema, search = ['name'], populate = [], sort = { createdAt: -1 }, branchField, softDelete = true, beforeCreate, filters }) {
  const r = Router();
  const idParam = z.object({ id: objectId });
  const name = model.modelName;

  const scope = (req) => (branchField ? req.branchFilter(branchField) : {});

  r.get('/', permit(`${module}.view`), asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePaging(req.query);
    const f = { ...scope(req), ...(filters ? filters(req) : {}) };
    if (req.query.q) {
      const rx = new RegExp(escapeRegex(String(req.query.q)), 'i');
      f.$or = search.map((k) => ({ [k]: rx }));
    }
    if (req.query.active !== undefined && model.schema.path('isActive')) f.isActive = req.query.active === 'true';
    if (req.query.all === 'true') return ok(res, await model.find(f).populate(populate).sort(sort).limit(1000).lean());
    const [items, total] = await Promise.all([model.find(f).populate(populate).sort(sort).skip(skip).limit(limit).lean(), model.countDocuments(f)]);
    paged(res, { items, total, page, limit });
  }));

  r.get('/:id', permit(`${module}.view`), validate({ params: idParam }), asyncHandler(async (req, res) => {
    const d = await model.findOne({ _id: req.params.id, ...scope(req) }).populate(populate);
    if (!d) throw ApiError.notFound(`${name} not found`);
    ok(res, d);
  }));

  r.post('/', permit(`${module}.create`), validate({ body: schema }), asyncHandler(async (req, res) => {
    const data = { ...req.body };
    if (branchField && data[branchField]) req.assertBranch(data[branchField]);
    if (branchField && !data[branchField]) {
      if (!req.activeBranch) throw ApiError.badRequest('Select a branch');
      data[branchField] = req.activeBranch;
    }
    if (beforeCreate) await beforeCreate(req, data);
    const d = await model.create(data);
    audit(req, { action: `${module}.create`, entity: name, entityId: d._id, branch: branchField ? d[branchField] : undefined, after: d });
    ok(res, d, 201);
  }));

  r.patch('/:id', permit(`${module}.edit`), validate({ params: idParam, body: schema.partial() }), asyncHandler(async (req, res) => {
    const d = await model.findOne({ _id: req.params.id, ...scope(req) });
    if (!d) throw ApiError.notFound(`${name} not found`);
    if (branchField && req.body[branchField]) req.assertBranch(req.body[branchField]);
    const before = d.toObject();
    Object.assign(d, req.body);
    await d.save();
    audit(req, { action: `${module}.edit`, entity: name, entityId: d._id, before, after: d });
    ok(res, d);
  }));

  r.delete('/:id', permit(`${module}.delete`), validate({ params: idParam }), asyncHandler(async (req, res) => {
    const d = await model.findOne({ _id: req.params.id, ...scope(req) });
    if (!d) throw ApiError.notFound(`${name} not found`);
    if (softDelete && model.schema.path('isActive')) {
      d.isActive = false;
      await d.save();
    } else await d.deleteOne();
    audit(req, { action: `${module}.delete`, entity: name, entityId: d._id, before: d });
    ok(res, { deleted: true });
  }));

  return r;
}
