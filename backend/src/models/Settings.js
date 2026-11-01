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
    // loyalty points: earned on every bill (keyed by mobile, so family members share one wallet)
    loyalty: {
      enabled: { type: Boolean, default: false },
      earnPer100: { type: Number, default: 2 }, // points per ₹100 billed
      pointValue: { type: Number, default: 1 }, // ₹ value of one point when redeemed
      minRedeem: { type: Number, default: 50 }, // need at least this many points to redeem
      maxRedeemPct: { type: Number, default: 50 }, // max % of the bill payable with points
      expiryDays: { type: Number, default: 365 }, // 0 = never expire
      earnOnServices: { type: Boolean, default: true },
    },
    // online payments (Razorpay)
    payments: {
      onlineEnabled: { type: Boolean, default: false }, // payment links / UPI QR in the console
      linkExpiryHours: { type: Number, default: 48 },
      sendLinkOnWhatsapp: { type: Boolean, default: true },
      upiId: { type: String, default: '' }, // fallback static UPI QR on thermal receipts when Razorpay is off
      upiName: { type: String, default: '' },
      appointment: {
        required: { type: Boolean, default: false }, // booking portal: pay before the appointment is confirmed
        amountMode: { type: String, enum: ['doctor_fee', 'fixed'], default: 'doctor_fee' },
        amount: { type: Number, default: 500 }, // fixed amount, or fallback when the doctor has no fee / "any doctor"
        note: { type: String, default: 'Adjusted in your consultation bill. Refundable if you cancel 2 hours before.' },
      },
    },
    // receipt / QR
    print: {
      qrUrl: { type: String, default: '' }, // QR on bills & PDFs → main website ('' = clinic website)
      showQr: { type: Boolean, default: true },
      thermalWidth: { type: String, enum: ['58', '80'], default: '80' },
      thermalQr: { type: String, enum: ['payment', 'website', 'none'], default: 'payment' }, // payment = scan-to-pay QR when a balance is due
      thermalFooter: { type: String, default: 'Thank you! Get well soon.' },
    },
    // optional modules — only the Super Admin can switch these on; off = hidden in every console + API returns 403
    features: {
      ipd: { type: Boolean, default: false },
      exotel: { type: Boolean, default: false },
      marketing: { type: Boolean, default: false },
    },
    ipd: {
      doctorVisitRate: { type: Number, default: 500 },
      autoChargeRounds: { type: Boolean, default: true }, // each doctor-round note posts a visit charge
      otRooms: { type: [String], default: ['OT-1', 'OT-2'] },
      graceHours: { type: Number, default: 2 },
      visitingHours: { type: String, default: 'Morning 10:00–12:00 · Evening 17:00–19:00' },
      passRules: { type: String, default: 'One attendant at a time · Carry this pass always · Not transferable · Return at discharge' },
    },
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
      ipd: { type: Boolean, default: true }, // admission + discharge summary
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
export const FEATURES = ['ipd', 'exotel', 'marketing'];
export const featureOn = async (key) => (await getSettings()).features?.[key] === true;
