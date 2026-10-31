import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

export const LEAD_SOURCES = ['website', 'google_ads', 'facebook_ads', 'instagram', 'whatsapp', 'phone', 'walkin', 'manual', 'import', 'referral', 'landing_page'];

// ---------- Stage ----------
const stageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true, unique: true, lowercase: true },
    order: { type: Number, default: 0 },
    color: { type: String, default: '#64748b' },
    isWon: { type: Boolean, default: false },
    isLost: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false }, // new leads land here
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true }
);
export const LeadStage = mongoose.model('LeadStage', stageSchema);

export const DEFAULT_STAGES = [
  { key: 'new', name: 'New', order: 1, color: '#3b82f6', isDefault: true },
  { key: 'contacted', name: 'Contacted', order: 2, color: '#06b6d4' },
  { key: 'interested', name: 'Interested', order: 3, color: '#8b5cf6' },
  { key: 'follow_up', name: 'Follow-up', order: 4, color: '#f59e0b' },
  { key: 'appointment_scheduled', name: 'Appointment Scheduled', order: 5, color: '#0ea5e9' },
  { key: 'visited', name: 'Visited', order: 6, color: '#14b8a6' },
  { key: 'converted', name: 'Converted', order: 7, color: '#22c55e', isWon: true },
  { key: 'lost', name: 'Lost', order: 8, color: '#ef4444', isLost: true },
];

// ---------- Campaign ----------
const campaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    channel: { type: String, enum: ['google_ads', 'facebook_ads', 'instagram', 'whatsapp', 'sms', 'email', 'seo', 'offline', 'other'], default: 'google_ads' },
    utmCampaign: { type: String, trim: true, index: true },
    branch: { type: ObjectId, ref: 'Branch' },
    budget: { type: Number, default: 0 },
    spend: { type: Number, default: 0 },
    startDate: String,
    endDate: String,
    status: { type: String, enum: ['draft', 'active', 'paused', 'ended'], default: 'active' },
    notes: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
export const Campaign = mongoose.model('Campaign', campaignSchema);

// ---------- Lead ----------
const leadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    altPhone: String,
    email: { type: String, lowercase: true, trim: true },
    city: String,
    condition: String, // piles / fistula / fissure / pilonidal ...
    source: { type: String, enum: LEAD_SOURCES, default: 'manual' },
    sourceDetail: String,
    campaign: { type: ObjectId, ref: 'Campaign' },
    form: { type: ObjectId, ref: 'EnquiryForm' },
    formData: mongoose.Schema.Types.Mixed,
    utm: { source: String, medium: String, campaign: String, term: String, content: String, gclid: String, fbclid: String, landingUrl: String },
    branch: { type: ObjectId, ref: 'Branch' },
    stage: { type: ObjectId, ref: 'LeadStage', required: true },
    assignedTo: { type: ObjectId, ref: 'User' },
    assignedAt: Date,
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    value: { type: Number, default: 0 },
    tags: [String],
    lostReason: String,
    nextFollowUpAt: Date,
    lastContactAt: Date,
    callCount: { type: Number, default: 0 },
    duplicateOf: { type: ObjectId, ref: 'Lead' },
    convertedPatient: { type: ObjectId, ref: 'Patient' },
    convertedAt: Date,
    appointment: { type: ObjectId, ref: 'Appointment' },
    createdBy: { type: ObjectId, ref: 'User' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
leadSchema.index({ phone: 1, createdAt: -1 });
leadSchema.index({ assignedTo: 1, stage: 1 });
leadSchema.index({ stage: 1, createdAt: -1 });
leadSchema.index({ nextFollowUpAt: 1 });
leadSchema.index({ campaign: 1 });
leadSchema.index({ name: 'text', phone: 'text', email: 'text' });
export const Lead = mongoose.model('Lead', leadSchema);

// ---------- Activity ----------
const activitySchema = new mongoose.Schema(
  {
    lead: { type: ObjectId, ref: 'Lead', required: true, index: true },
    type: { type: String, enum: ['note', 'call', 'whatsapp', 'sms', 'email', 'stage_change', 'assign', 'followup', 'system', 'conversion'], required: true },
    text: String,
    call: { direction: { type: String, enum: ['outbound', 'inbound'] }, outcome: { type: String, enum: ['connected', 'no_answer', 'busy', 'switched_off', 'wrong_number', 'callback'] }, durationSec: Number },
    meta: mongoose.Schema.Types.Mixed,
    by: { type: ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
activitySchema.index({ by: 1, type: 1, createdAt: -1 });
export const LeadActivity = mongoose.model('LeadActivity', activitySchema);

// ---------- Task ----------
const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: String,
    lead: { type: ObjectId, ref: 'Lead' },
    assignedTo: { type: ObjectId, ref: 'User', required: true },
    dueAt: Date,
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    status: { type: String, enum: ['open', 'in_progress', 'done', 'cancelled'], default: 'open' },
    completedAt: Date,
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
taskSchema.index({ assignedTo: 1, status: 1, dueAt: 1 });
export const Task = mongoose.model('Task', taskSchema);

// ---------- Sales target ----------
const targetSchema = new mongoose.Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true },
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    leadsTarget: { type: Number, default: 0 },
    conversionsTarget: { type: Number, default: 0 },
    appointmentsTarget: { type: Number, default: 0 },
    revenueTarget: { type: Number, default: 0 },
    setBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
targetSchema.index({ user: 1, month: 1 }, { unique: true });
export const SalesTarget = mongoose.model('SalesTarget', targetSchema);

// ---------- Enquiry form / landing page (CMS) ----------
const fieldSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, match: /^[a-z][a-z0-9_]*$/ },
    label: { type: String, required: true },
    type: { type: String, enum: ['text', 'tel', 'email', 'number', 'textarea', 'select', 'radio', 'checkbox', 'date'], default: 'text' },
    required: { type: Boolean, default: false },
    options: [String],
    placeholder: String,
    mapTo: { type: String, enum: ['name', 'phone', 'email', 'city', 'condition', 'branch', null], default: null },
  },
  { _id: false }
);
const formSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, lowercase: true, match: /^[a-z0-9-]+$/ },
    kind: { type: String, enum: ['form', 'landing_page'], default: 'form' },
    // landing page content
    page: { headline: String, subheadline: String, body: String, heroImage: String, ctaText: { type: String, default: 'Book Free Consultation' }, bullets: [String], seoTitle: String, seoDescription: String },
    fields: { type: [fieldSchema], default: [] },
    campaign: { type: ObjectId, ref: 'Campaign' },
    branch: { type: ObjectId, ref: 'Branch' },
    defaultSource: { type: String, enum: LEAD_SOURCES, default: 'website' },
    assignTo: { type: ObjectId, ref: 'User' },
    successMessage: { type: String, default: 'Thank you! Our team will call you shortly.' },
    redirectUrl: String,
    submissions: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
export const EnquiryForm = mongoose.model('EnquiryForm', formSchema);

// ---------- Call (Exotel click-to-call + inbound IVR) ----------
const callSchema = new mongoose.Schema(
  {
    sid: { type: String, index: { unique: true, sparse: true } }, // Exotel CallSid
    direction: { type: String, enum: ['outbound', 'inbound'], required: true },
    provider: { type: String, default: 'exotel' },
    lead: { type: ObjectId, ref: 'Lead', index: true },
    patient: { type: ObjectId, ref: 'Patient' },
    agent: { type: ObjectId, ref: 'User', index: true }, // staff who placed / answered
    branch: { type: ObjectId, ref: 'Branch' },
    from: String, // outbound: agent phone; inbound: caller
    to: String, // outbound: customer; inbound: ExoPhone
    callerId: String,
    status: { type: String, enum: ['queued', 'ringing', 'in-progress', 'completed', 'busy', 'no-answer', 'failed', 'canceled'], default: 'queued' },
    outcome: { type: String, enum: ['connected', 'no_answer', 'busy', 'switched_off', 'wrong_number', 'callback', null], default: null },
    durationSec: { type: Number, default: 0 }, // talk time
    recordingUrl: String,
    ivrDigits: String,
    ivrLabel: String,
    startedAt: Date,
    endedAt: Date,
    notes: String,
    raw: mongoose.Schema.Types.Mixed, // last provider payload (debug)
  },
  { timestamps: true }
);
callSchema.index({ createdAt: -1 });
callSchema.index({ from: 1, createdAt: -1 });
export const Call = mongoose.model('Call', callSchema);
