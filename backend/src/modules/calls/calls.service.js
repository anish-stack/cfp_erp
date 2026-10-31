import { Call, Lead, LeadActivity, LeadStage } from '../../models/Crm.js';
import { User } from '../../models/User.js';
import { Role } from '../../models/Role.js';
import { Branch } from '../../models/Branch.js';
import { Patient } from '../../models/Patient.js';
import { getSettings } from '../../models/Settings.js';
import { logger } from '../../config/logger.js';
import { outcomeFor, tenDigits } from '../../services/exotel.js';
import { createLead } from '../crm/crm.service.js';

/** Write the finished call onto the lead timeline (once). */
export async function logCallOnLead(call) {
  if (!call.lead || call.loggedActivity) return;
  const exists = await LeadActivity.exists({ lead: call.lead, 'meta.callId': String(call._id) });
  if (exists) return;
  await LeadActivity.create({
    lead: call.lead,
    type: 'call',
    text: call.direction === 'inbound' ? `Inbound call${call.ivrLabel ? ` (IVR: ${call.ivrLabel})` : ''}` : 'Outbound call (Exotel)',
    call: { direction: call.direction, outcome: call.outcome || undefined, durationSec: call.durationSec },
    meta: { callId: String(call._id), recordingUrl: call.recordingUrl || undefined, status: call.status },
    by: call.agent,
  });
  const upd = { $set: { lastContactAt: new Date() }, $inc: { callCount: 1 } };
  await Lead.updateOne({ _id: call.lead }, upd);
  // first connected contact moves New → Contacted
  if (call.outcome === 'connected') {
    const lead = await Lead.findById(call.lead).populate('stage', 'key').lean();
    if (lead?.stage?.key === 'new') {
      const contacted = await LeadStage.findOne({ key: 'contacted' }).lean();
      if (contacted) {
        await Lead.updateOne({ _id: lead._id }, { stage: contacted._id });
        await LeadActivity.create({ lead: lead._id, type: 'stage_change', text: 'Stage → Contacted (call connected)', meta: { from: lead.stage._id, to: contacted._id }, by: call.agent });
      }
    }
  }
}

/** Apply terminal status to a call doc */
export async function finishCall(call, { status, durationSec, recordingUrl, startedAt, endedAt, raw }) {
  call.status = status || call.status;
  call.durationSec = durationSec ?? call.durationSec;
  if (recordingUrl) call.recordingUrl = recordingUrl;
  if (startedAt) call.startedAt = startedAt;
  call.endedAt = endedAt || new Date();
  if (!call.outcome) call.outcome = outcomeFor(call.status, call.durationSec);
  if (raw) call.raw = raw;
  await call.save();
  await logCallOnLead(call).catch((e) => logger.error({ err: e.message }, 'call→lead log failed'));
  return call;
}

/** Inbound: find who is calling (open lead → patient → new lead) */
export async function resolveCaller(phone, { ivr } = {}) {
  const ten = tenDigits(phone);
  if (!/^\d{10}$/.test(ten)) return {};
  const lead = await Lead.findOne({ phone: ten, isActive: true }).sort({ createdAt: -1 }).lean();
  const patient = await Patient.findOne({ mobile: ten, isActive: true }).sort({ createdAt: 1 }).select('_id name').lean();
  if (lead) return { lead, patient };
  if (patient) return { patient };
  if (!/^[6-9]/.test(ten)) return {};
  const { lead: created } = await createLead(
    { name: 'Inbound caller', phone: ten, source: 'phone', sourceDetail: ivr?.label ? `IVR: ${ivr.label}` : 'IVR', branch: ivr?.branch || undefined },
    { allowDuplicate: true }
  );
  return { lead: created.toObject(), created: true };
}

export async function ivrOption(digits) {
  if (!digits) return null;
  const s = await getSettings();
  return (s.crm?.ivrMenu || []).find((m) => String(m.digit) === String(digits)) || null;
}

/** Numbers Exotel should ring for an inbound call */
export async function inboundTargets({ lead, ivr }) {
  const s = await getSettings();
  const mode = s.crm?.inboundRouting || 'lead_owner';
  const nums = [];
  const push = (p) => {
    const t = tenDigits(p);
    if (/^\d{10}$/.test(t) && !nums.includes(t)) nums.push(t);
  };
  if (mode === 'lead_owner' && lead?.assignedTo) {
    const u = await User.findOne({ _id: lead.assignedTo, isActive: true }).select('phone').lean();
    if (u?.phone) push(u.phone);
  }
  if ((mode !== 'sales_pool' || !nums.length) && ivr?.branch) {
    const b = await Branch.findById(ivr.branch).select('phone').lean();
    if (b?.phone) push(b.phone);
  }
  if (!nums.length) {
    const roles = await Role.find({ slug: { $in: ['sales_executive', 'sales_manager'] } }).distinct('_id');
    const users = await User.find({ role: { $in: roles }, isActive: true, phone: { $type: 'string' } }).select('phone').limit(5).lean();
    users.forEach((u) => push(u.phone));
  }
  return nums;
}

export const agentByPhone = (phone) => {
  const t = tenDigits(phone);
  return /^\d{10}$/.test(t) ? User.findOne({ phone: t }).select('_id').lean() : null;
};
