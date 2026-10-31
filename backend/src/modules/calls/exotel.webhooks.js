import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { Call } from '../../models/Crm.js';
import * as exotel from '../../services/exotel.js';
import { finishCall, resolveCaller, ivrOption, inboundTargets, agentByPhone } from './calls.service.js';

/**
 * Exotel → us. Every URL carries ?t=EXOTEL_WEBHOOK_TOKEN.
 *   POST /status   — StatusCallback for click-to-call (terminal event)
 *   GET  /inbound  — Passthru applet (call start, after IVR, and after Connect → recording)
 *   GET  /connect  — Connect applet "dial whom" dynamic URL → numbers to ring
 * Always answer 200 quickly so Exotel's flow never stalls.
 */
const r = Router();

r.use((req, res, next) => {
  if (!exotel.verifyWebhookToken(req.query.t)) {
    logger.warn({ path: req.path, ip: req.ip }, 'Exotel webhook bad token');
    return res.status(403).send('forbidden');
  }
  next();
});

r.post('/status', asyncHandler(async (req, res) => {
  const p = exotel.parseStatusCallback(req.body || {});
  res.status(200).send('ok');
  try {
    let call = null;
    if (p.callId && /^[a-f0-9]{24}$/.test(p.callId)) call = await Call.findById(p.callId);
    if (!call && p.sid) call = await Call.findOne({ sid: p.sid });
    if (!call) return logger.warn({ sid: p.sid }, 'Exotel status for unknown call');
    if (!call.sid && p.sid) call.sid = p.sid;
    await finishCall(call, { ...p, raw: req.body });
  } catch (e) {
    logger.error({ err: e.message }, 'Exotel status handling failed');
  }
}));

r.get('/inbound', asyncHandler(async (req, res) => {
  const p = exotel.parsePassthru(req.query);
  try {
    if (!p.sid) return res.status(200).send('ok');
    let call = await Call.findOne({ sid: p.sid });
    const ivr = await ivrOption(p.digits);
    if (!call) {
      const who = await resolveCaller(p.from, { ivr });
      call = await Call.create({ sid: p.sid, direction: 'inbound', from: p.from, to: p.to, callerId: p.to, lead: who.lead?._id, patient: who.patient?._id, branch: ivr?.branch || who.lead?.branch, status: 'in-progress', startedAt: new Date(), ivrDigits: p.digits, ivrLabel: ivr?.label });
    } else if (p.digits && !call.ivrDigits) {
      call.ivrDigits = p.digits;
      call.ivrLabel = ivr?.label;
      if (ivr?.branch) call.branch = ivr.branch;
      await call.save();
    }
    if (p.ended) {
      if (p.dialWhom && !call.agent) call.agent = (await agentByPhone(p.dialWhom))?._id;
      const status = /completed/.test(p.dialStatus) && p.durationSec > 0 ? 'completed' : /busy/.test(p.dialStatus) ? 'busy' : p.durationSec > 0 ? 'completed' : 'no-answer';
      await finishCall(call, { status, durationSec: p.durationSec, recordingUrl: p.recordingUrl, raw: req.query });
    }
  } catch (e) {
    logger.error({ err: e.message }, 'Exotel passthru failed');
  }
  res.status(200).send('ok');
}));

r.get('/connect', asyncHandler(async (req, res) => {
  const p = exotel.parsePassthru(req.query);
  let numbers = [];
  try {
    const call = p.sid ? await Call.findOne({ sid: p.sid }).populate('lead', 'assignedTo').lean() : null;
    const ivr = await ivrOption(p.digits || call?.ivrDigits);
    numbers = await inboundTargets({ lead: call?.lead, ivr });
  } catch (e) {
    logger.error({ err: e.message }, 'Exotel connect routing failed');
  }
  res.json({
    fetch_after_attempt: false,
    destination: { numbers: numbers.map((n) => `+91${n}`) },
    outgoing_phone_number: env.EXOTEL_CALLER_ID || undefined,
    record: true,
    recording_channels: 'dual',
    max_ringing_duration: 30,
    max_conversation_duration: 3600,
  });
}));

export default r;
