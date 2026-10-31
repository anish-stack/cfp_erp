/* Idempotent base seed — safe for production. Run on first deploy AND after every update:  npm run seed
 *  - builds every index (prod runs autoIndex:false; slotKey unique index = double-booking guard)
 *  - real clinic + 5 branches + 2 doctors from the website (fills EMPTY fields only)
 *  - clinic logo (downloaded once from the website if none uploaded)
 *  - lead stages, service catalogue, system roles (permissions refreshed), IVR menu, super admin
 */
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDB } from '../config/db.js';
import '../models/index.js';
import { Role } from '../models/Role.js';
import { Branch } from '../models/Branch.js';
import { User } from '../models/User.js';
import { DEFAULT_ROLES } from '../constants/permissions.js';
import { CLINIC, BRANCHES, DOCTORS, SERVICES, IVR_MENU, MEDICINES, DEFAULT_ROTA, RX_TEMPLATES } from '../constants/clinic.js';
import { DoctorSchedule } from '../models/DoctorSchedule.js';
import { PrescriptionTemplate } from '../models/Clinical.js';
import { LeadStage, DEFAULT_STAGES } from '../models/Crm.js';
import { Product, Category } from '../models/Inventory.js';
import { Settings, clearSettingsCache } from '../models/Settings.js';
import { Doctor } from '../models/Doctor.js';
import '../models/Appointment.js';
import '../models/Patient.js';

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const empty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);

/** $set only keys that are currently empty in doc (dot paths) */
function fillMissing(doc, values, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const cur = path.split('.').reduce((o, p) => o?.[p], doc);
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, fillMissing(doc, v, path));
    else if (empty(cur)) out[path] = v;
  }
  return out;
}

async function downloadLogo() {
  const { saveLogo } = await import('../services/branding.js');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(CLINIC.logoUrl, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return saveLogo(Buffer.from(await res.arrayBuffer()));
  } finally {
    clearTimeout(t);
  }
}

export async function baseSeed({ log = console.log } = {}) {
  await Promise.all([
    import('../models/Counter.js'), import('../models/AuditLog.js'), import('../models/Otp.js'), import('../models/PatientAccount.js'),
    import('../models/DoctorSchedule.js'), import('../models/ScheduleException.js'),
    import('../models/Clinical.js'), import('../models/Billing.js'), import('../models/Misc.js'),
  ]);
  for (const name of mongoose.modelNames()) {
    await mongoose.model(name).createCollection().catch(() => {});
    await mongoose.model(name).syncIndexes();
  }
  log(`✔ indexes synced for ${mongoose.modelNames().length} collections`);

  // ---- roles
  for (const r of DEFAULT_ROLES) {
    await Role.updateOne({ slug: r.slug }, { $set: { name: r.name, permissions: r.permissions, scope: r.scope, isSystem: true } }, { upsert: true });
  }
  log(`✔ ${DEFAULT_ROLES.length} system roles`);

  // ---- branches (real details, fill-missing only)
  const branchIds = {};
  for (const b of BRANCHES) {
    const cur = await Branch.findOne({ code: b.code }).lean();
    if (!cur) {
      const created = await Branch.create({ ...b, slug: slugify(b.name), settings: { slotMinutes: 15, gapMinutes: 0, bookingWindowDays: 30, minLeadMinutes: 30, ...b.settings } });
      branchIds[b.code] = created._id;
    } else {
      const set = fillMissing(cur, { phone: b.phone, whatsapp: b.whatsapp, email: b.email, address: b.address });
      // hours: replace only the untouched phase-1 defaults
      if (cur.settings?.openTime === '10:00' && cur.settings?.closeTime === '19:00') {
        Object.assign(set, { 'settings.openTime': b.settings.openTime, 'settings.closeTime': b.settings.closeTime, 'settings.weeklyOff': b.settings.weeklyOff, 'settings.breaks': b.settings.breaks });
      }
      if (Object.keys(set).length) await Branch.updateOne({ _id: cur._id }, { $set: set });
      branchIds[b.code] = cur._id;
    }
  }
  log(`✔ ${BRANCHES.length} branches (real addresses, phones, hours)`);

  // ---- clinic settings
  const sdoc = (await Settings.findById('global').lean()) || (await Settings.create({ _id: 'global' })).toObject();
  const ivr = IVR_MENU.map((m) => ({ digit: m.digit, label: m.label, branch: branchIds[m.code] }));
  const set = fillMissing(sdoc, { clinic: { name: CLINIC.name, tagline: CLINIC.tagline, website: CLINIC.website, phone: CLINIC.phone, whatsapp: CLINIC.whatsapp, email: CLINIC.email, address: CLINIC.address, logoUrl: CLINIC.logoUrl } });
  if (sdoc.clinic?.name === 'Centre for Piles & Fistula') set['clinic.name'] = CLINIC.name; // schema default → official casing
  if (empty(sdoc.crm?.ivrMenu)) set['crm.ivrMenu'] = ivr;
  // brand palette: CPF logo red — replaces only the untouched old teal defaults
  if (!sdoc.theme?.console?.primary || sdoc.theme.console.primary === '#137a6f') set['theme.console.primary'] = '#e21f26';
  if (!sdoc.theme?.booking?.primary || sdoc.theme.booking.primary === '#137a6f') set['theme.booking.primary'] = '#e21f26';
  if (!sdoc.theme?.booking?.background || sdoc.theme.booking.background === '#f0fdfa') set['theme.booking.background'] = '#fff5f5';
  if (Object.keys(set).length) await Settings.updateOne({ _id: 'global' }, { $set: set });
  if (!sdoc.clinic?.logoFile) {
    try {
      const file = await downloadLogo();
      await Settings.updateOne({ _id: 'global' }, { $set: { 'clinic.logoFile': file, 'clinic.logoUpdatedAt': new Date() } });
      log(`✔ clinic logo downloaded (${file})`);
    } catch (e) {
      log(`⚠ logo download failed (${e.message}) — upload it in Console → Settings → Clinic`);
    }
  }
  clearSettingsCache();
  log('✔ clinic profile, IVR menu (1-5 → branches)');

  // ---- doctors (no rota: set weekly schedules in Console → Doctors)
  const noDoctors = !(await Doctor.exists({}));
  for (const d of noDoctors ? DOCTORS : []) {
    const exists = await Doctor.findOne({ name: d.name });
    if (!exists) await Doctor.create({ ...d, branches: Object.values(branchIds), consultationFee: 0, followUpFee: 0, acceptsOnlineBooking: true });
  }
  log(noDoctors ? `✔ doctors: ${DOCTORS.map((d) => d.name).join(', ')}` : '· Doctors already has data — skipped');

  // ---- default rota (only for doctors with no schedule yet) → every branch bookable
  for (const [docName, rows] of Object.entries(DEFAULT_ROTA)) {
    const d = await Doctor.findOne({ name: docName });
    if (!d || (await DoctorSchedule.exists({ doctor: d._id }))) continue;
    for (const [days, code, sessions] of rows) {
      for (const weekday of days) {
        await DoctorSchedule.updateOne({ doctor: d._id, branch: branchIds[code], weekday }, { $set: { sessions: sessions.map(([start, end]) => ({ start, end })), slotMinutes: 15, capacityPerSlot: 1, isActive: true } }, { upsert: true });
      }
    }
    log(`✔ default weekly rota for ${docName} (edit in Console → Doctors → Weekly schedule)`);
  }

  // ---- CRM stages
  for (const st of DEFAULT_STAGES) await LeadStage.updateOne({ key: st.key }, { $setOnInsert: { ...st, isSystem: true } }, { upsert: true });
  log(`✔ ${DEFAULT_STAGES.length} lead stages`);

  // ---- categories + services
  const cat = await Category.findOneAndUpdate({ name: 'Services' }, { $setOnInsert: { name: 'Services' } }, { upsert: true, new: true });
  for (const c of ['Ayurvedic Medicines', 'Ointments & Creams', 'Laxatives & Fibre', 'Allopathic', 'Consumables']) await Category.updateOne({ name: c }, { $setOnInsert: { name: c } }, { upsert: true });
  for (const sv of SERVICES) {
    await Product.updateOne({ sku: sv.sku }, { $setOnInsert: { ...sv, type: 'service', gstRate: 0, category: cat._id, unit: 'service', reorderLevel: 0 } }, { upsert: true });
  }
  log(`✔ ${SERVICES.length} services (prices ₹0 — set in Console → Products)`);

  // ---- medicines & consumables catalogue (no stock — receive stock in Console → Stock)
  const catIds = Object.fromEntries((await Category.find().lean()).map((c) => [c.name, c._id]));
  if (!catIds.Allopathic) catIds.Allopathic = (await Category.create({ name: 'Allopathic' }))._id;
  const MED = {};
  const noStockProducts = !(await Product.exists({ type: { $in: ['medicine', 'consumable', 'product'] } }));
  for (const [i, [sku, name, genericName, cat, type, unit, gstRate, mrp, cost, reorderLevel, prescriptionRequired]] of MEDICINES.entries()) {
    if (!noStockProducts) { MED[sku] = await Product.findOne({ sku }).lean(); continue; }
    MED[sku] = await Product.findOneAndUpdate(
      { sku },
      { $setOnInsert: { sku, name, genericName, category: catIds[cat], type, unit, gstRate, mrp, sellPrice: mrp, purchasePrice: cost, reorderLevel, prescriptionRequired, barcode: `890${String(i + 1).padStart(10, '0')}` } },
      { upsert: true, new: true }
    ).lean();
  }
  log(noStockProducts ? `✔ ${MEDICINES.length} medicines & consumables in catalogue` : '· Products (medicines) already has data — skipped');

  // ---- prescription types
  const noTpl = !(await PrescriptionTemplate.exists({}));
  for (const t of noTpl ? RX_TEMPLATES : []) {
    if (await PrescriptionTemplate.exists({ name: t.name })) continue;
    await PrescriptionTemplate.create({
      ...t,
      items: t.items.map(([sku, dose, frequency, timing, duration]) => ({ product: MED[sku]?._id, name: MED[sku]?.name || sku, dose, frequency, timing, duration })),
    });
  }
  log(`✔ ${RX_TEMPLATES.length} prescription types`);

  // ---- super admin
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    log('⚠ SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — super admin skipped');
  } else {
    const role = await Role.findOne({ slug: 'super_admin' });
    let u = await User.findOne({ email: env.SEED_ADMIN_EMAIL.toLowerCase() });
    if (!u) {
      u = new User({ name: env.SEED_ADMIN_NAME, email: env.SEED_ADMIN_EMAIL, role: role._id, allBranches: true, designation: 'Owner' });
      if (env.SEED_ADMIN_PHONE && !(await User.exists({ phone: env.SEED_ADMIN_PHONE }))) u.phone = env.SEED_ADMIN_PHONE;
      await u.setPassword(env.SEED_ADMIN_PASSWORD);
      await u.save();
      log(`✔ super admin created: ${u.email}${u.phone ? ` / ${u.phone}` : ''}`);
    } else {
      if (env.SEED_ADMIN_PHONE && !u.phone && !(await User.exists({ phone: env.SEED_ADMIN_PHONE }))) {
        u.phone = env.SEED_ADMIN_PHONE;
        await u.save();
      }
      log(`✔ super admin exists: ${u.email}${u.phone ? ` / ${u.phone}` : ''}`);
    }
  }
  return { branchIds };
}

// CLI
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  connectDB()
    .then(() => baseSeed())
    .then(() => mongoose.disconnect())
    .catch(async (e) => {
      console.error(e);
      await mongoose.disconnect();
      process.exit(1);
    });
}
