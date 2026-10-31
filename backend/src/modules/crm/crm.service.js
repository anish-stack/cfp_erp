import mongoose from 'mongoose';
import { Lead, LeadStage, LeadActivity, Campaign } from '../../models/Crm.js';
import { User } from '../../models/User.js';
import { Role } from '../../models/Role.js';
import { getSettings } from '../../models/Settings.js';
import { redis } from '../../config/redis.js';
import { ApiError } from '../../utils/ApiError.js';
import * as notify from '../../services/notify.js';

export const DUP_WINDOW_DAYS = 90;

export const normPhone = (p = '') => {
  const d = String(p).replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
};

export async function defaultStage() {
  const s = (await LeadStage.findOne({ isDefault: true }).lean()) || (await LeadStage.findOne().sort({ order: 1 }).lean());
  if (!s) throw ApiError.badRequest('No lead stages configured. Run seed');
  return s;
}

export async function findDuplicate(phone, excludeId) {
  const since = new Date(Date.now() - DUP_WINDOW_DAYS * 86_400_000);
  const closed = await LeadStage.find({ $or: [{ isWon: true }, { isLost: true }] }).distinct('_id');
  return Lead.findOne({ phone: normPhone(phone), createdAt: { $gte: since }, stage: { $nin: closed }, isActive: true, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
    .select('name phone stage assignedTo createdAt')
    .populate('stage', 'name')
    .populate('assignedTo', 'name')
    .lean();
}

/** Round-robin over active sales executives (Redis cursor) */
export async function autoAssignee() {
  const s = await getSettings();
  if (s.crm?.autoAssign !== 'round_robin') return null;
  const roles = await Role.find({ slug: { $in: ['sales_executive'] } }).distinct('_id');
  const users = await User.find({ role: { $in: roles }, isActive: true }).sort({ _id: 1 }).select('_id').lean();
  if (!users.length) return null;
  const i = await redis.incr('crm:rr');
  return users[(i - 1) % users.length]._id;
}

export async function resolveCampaign(utm) {
  if (!utm?.campaign) return null;
  const c = await Campaign.findOne({ utmCampaign: utm.campaign, isActive: true }).select('_id').lean();
  return c?._id || null;
}

const sourceFromUtm = (utm) => {
  const s = `${utm?.source || ''} ${utm?.medium || ''}`.toLowerCase();
  if (utm?.gclid || /google|adwords|cpc/.test(s)) return 'google_ads';
  if (utm?.fbclid || /facebook|fb|meta/.test(s)) return 'facebook_ads';
  if (/instagram|ig/.test(s)) return 'instagram';
  if (/whatsapp|wa/.test(s)) return 'whatsapp';
  return null;
};

/**
 * Create lead with dedupe. force=true creates anyway, linked as duplicateOf.
 * Returns { lead, duplicate }.
 */
export async function createLead(data, { by, force = false, allowDuplicate = false, autoReply = false } = {}) {
  const phone = normPhone(data.phone);
  if (!/^[6-9]\d{9}$/.test(phone)) throw ApiError.badRequest('Invalid mobile number');
  const dup = await findDuplicate(phone);
  if (dup && !force && !allowDuplicate) throw ApiError.conflict('Duplicate lead (same phone, open, last 90 days)', { duplicate: dup });

  const stage = data.stage || (await defaultStage())._id;
  const assignedTo = data.assignedTo || (await autoAssignee());
  const campaign = data.campaign || (await resolveCampaign(data.utm));
  const source = data.source || sourceFromUtm(data.utm) || 'manual';

  const lead = await Lead.create({ ...data, phone, stage, assignedTo, assignedAt: assignedTo ? new Date() : undefined, campaign, source, duplicateOf: dup?._id, createdBy: by });
  await LeadActivity.create({ lead: lead._id, type: 'system', text: `Lead created via ${source}${dup ? ' (possible duplicate)' : ''}`, by });
  if (assignedTo) notify.enqueue('lead.assigned', { leadId: String(lead._id), userId: String(assignedTo) });
  notify.emitWebhook('lead.created', { id: String(lead._id), name: lead.name, phone: lead.phone, source });
  // website / landing-page enquiries get an instant WhatsApp acknowledgement (skip repeat enquiries)
  if (autoReply && !dup) notify.enqueue('lead.autoreply', { leadId: String(lead._id) });
  return { lead, duplicate: dup };
}

export async function changeStage(lead, stageId, { by, lostReason }) {
  const stage = await LeadStage.findById(stageId).lean();
  if (!stage) throw ApiError.badRequest('Stage not found');
  if (stage.isLost && !lostReason && !lead.lostReason) throw ApiError.badRequest('Lost reason required');
  const from = lead.stage;
  lead.stage = stage._id;
  if (stage.isLost) lead.lostReason = lostReason || lead.lostReason;
  if (stage.isWon && !lead.convertedAt) lead.convertedAt = new Date();
  await lead.save();
  await LeadActivity.create({ lead: lead._id, type: 'stage_change', text: `Stage → ${stage.name}${lostReason ? ` (${lostReason})` : ''}`, meta: { from, to: stage._id }, by });
  return lead;
}

export const stageByKey = (key) => LeadStage.findOne({ key }).lean();

export const oid = (v) => new mongoose.Types.ObjectId(String(v));
