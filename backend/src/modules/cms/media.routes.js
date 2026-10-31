import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { permit } from '../../middleware/permit.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, ok, paged, escapeRegex } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { objectId } from '../../utils/zod.js';
import { Media } from '../../models/Media.js';
import * as storage from '../../services/storage.js';

// SVG deliberately excluded (script injection)
const TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/webm': '.webm' };
const MAX_IMG = 5 * 1024 * 1024;
const MAX_VID = 40 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VID, files: 10 },
  fileFilter: (_req, f, cb) => (TYPES[f.mimetype] ? cb(null, true) : cb(ApiError.badRequest('Only JPG, PNG, WEBP, GIF, MP4, WEBM allowed'))),
});

/** cheap magic-byte check so a renamed file can't pass as an image */
const looksRight = (buf, mime) => {
  const h = buf.subarray(0, 12);
  if (mime === 'image/jpeg') return h[0] === 0xff && h[1] === 0xd8;
  if (mime === 'image/png') return h[0] === 0x89 && h[1] === 0x50;
  if (mime === 'image/gif') return h.toString('ascii', 0, 3) === 'GIF';
  if (mime === 'image/webp') return h.toString('ascii', 0, 4) === 'RIFF' && h.toString('ascii', 8, 12) === 'WEBP';
  if (mime === 'video/mp4') return h.toString('ascii', 4, 8) === 'ftyp';
  if (mime === 'video/webm') return h[0] === 0x1a && h[1] === 0x45;
  return false;
};

const r = Router();
r.use(auth);

r.get('/status', permit('cms.view'), (_req, res) => ok(res, storage.storageStatus()));

r.get('/', permit('cms.view'), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 48);
  const f = {};
  if (req.query.q) f.name = new RegExp(escapeRegex(String(req.query.q)), 'i');
  if (['image', 'video'].includes(req.query.type)) f.resourceType = req.query.type;
  const [items, total] = await Promise.all([Media.find(f).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Media.countDocuments(f)]);
  paged(res, { items, total, page, limit });
}));

r.post('/', permit('cms.create'), upload.array('files', 10), asyncHandler(async (req, res) => {
  if (!req.files?.length) throw ApiError.badRequest('No file');
  const out = [];
  for (const f of req.files) {
    const isVideo = f.mimetype.startsWith('video/');
    if (!isVideo && f.size > MAX_IMG) throw ApiError.badRequest(`${f.originalname}: images max 5 MB`);
    if (!looksRight(f.buffer, f.mimetype)) throw ApiError.badRequest(`${f.originalname}: file content does not match its type`);
    const s = await storage.put({ buffer: f.buffer, mime: f.mimetype, ext: TYPES[f.mimetype], folder: String(req.body.folder || 'cms').replace(/[^a-z0-9-]/gi, '').slice(0, 30) || 'cms' });
    out.push(await Media.create({ name: f.originalname.slice(0, 120), url: s.url, key: s.key, driver: s.driver, resourceType: isVideo ? 'video' : 'image', mime: f.mimetype, size: f.size, width: s.width, height: s.height, folder: req.body.folder || 'cms', uploadedBy: req.user._id }));
  }
  audit(req, { action: 'cms.media_upload', entity: 'Media', meta: { n: out.length, driver: out[0]?.driver } });
  ok(res, out, 201);
}));

r.patch('/:id', permit('cms.edit'), validate({ params: z.object({ id: objectId }), body: z.object({ name: z.string().trim().min(1).max(120) }) }), asyncHandler(async (req, res) => {
  const m = await Media.findByIdAndUpdate(req.params.id, { name: req.body.name }, { new: true });
  if (!m) throw ApiError.notFound('Media not found');
  ok(res, m);
}));

r.delete('/:id', permit('cms.delete'), validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
  const m = await Media.findById(req.params.id);
  if (!m) throw ApiError.notFound('Media not found');
  await storage.del(m);
  await m.deleteOne();
  audit(req, { action: 'cms.media_delete', entity: 'Media', entityId: m._id, before: m });
  ok(res, { deleted: true });
}));

export default r;
