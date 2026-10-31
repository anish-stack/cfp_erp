import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    _id: { type: String, default: 'global' },
    clinic: {
      name: { type: String, default: 'Centre for Piles & Fistula' },
      legalName: String,
      website: { type: String, default: 'https://centreforpilesandfistula.com' },
      phone: String,
      email: String,
      gstin: String,
      address: String,
      logoUrl: String, // public URL (website) — informational
      logoFile: String, // uploaded file name in UPLOAD_DIR/branding (used on PDFs + apps)
      logoUpdatedAt: Date,
      tagline: String,
      whatsapp: String,
    },
    billing: {
      gstEnabled: { type: Boolean, default: true },
      taxInclusive: { type: Boolean, default: true },
      consultationGst: { type: Number, default: 0 }, // healthcare services exempt
      invoiceFooter: { type: String, default: 'Thank you. Get well soon.' },
      allowNegativeStock: { type: Boolean, default: false },
      showLogoOnPdf: { type: Boolean, default: true },
    },
    inventory: { expiryAlertDays: { type: Number, default: 90 } },
    // colour palette (hex). console + booking portal + PDFs
    theme: {
      console: { primary: { type: String, default: '#e21f26' }, sidebar: { type: String, default: '#ffffff' }, radius: { type: Number, default: 10 } },
      booking: { primary: { type: String, default: '#e21f26' }, background: { type: String, default: '#fff5f5' } },
      pdf: { type: String, default: '' }, // empty → console primary
    },
    pdf: {
      rxFooter: { type: String, default: 'Take medicines as advised. In case of excessive bleeding or severe pain, contact the clinic immediately.' },
      showSignature: { type: Boolean, default: true },
    },
    notifications: {
      sms: { type: Boolean, default: true },
      whatsapp: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      // per-event WhatsApp switches
      welcome: { type: Boolean, default: true },
      appointmentUpdates: { type: Boolean, default: true }, // booked / rescheduled / cancelled
      checkinToken: { type: Boolean, default: true },
      noShow: { type: Boolean, default: true },
      reminders: { type: Boolean, default: true },
      prescription: { type: Boolean, default: true },
      invoice: { type: Boolean, default: true },
      paymentReceipt: { type: Boolean, default: true },
      refunds: { type: Boolean, default: true },
      followupReminders: { type: Boolean, default: true },
      leadAutoReply: { type: Boolean, default: true },
      staffLeadAlert: { type: Boolean, default: true },
      dailyStockAlerts: { type: Boolean, default: true },
    },
    crm: {
      autoAssign: { type: String, enum: ['none', 'round_robin'], default: 'none' },
      // inbound IVR: key pressed → branch (e.g. { "1": "<branchId>" })
      ivrMenu: [{ digit: String, label: String, branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' } }],
      // who receives inbound calls: owner of the lead → branch phone → sales pool
      inboundRouting: { type: String, enum: ['lead_owner', 'branch', 'sales_pool'], default: 'lead_owner' },
    },
  },
  { timestamps: true }
);

export const Settings = mongoose.model('Settings', schema);

let cache = null;
let cacheAt = 0;
export async function getSettings() {
  if (cache && Date.now() - cacheAt < 30_000) return cache;
  cache = (await Settings.findById('global').lean()) || (await Settings.create({ _id: 'global' })).toObject();
  cacheAt = Date.now();
  return cache;
}
export const clearSettingsCache = () => {
  cache = null;
};
