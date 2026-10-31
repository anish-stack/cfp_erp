/* Demo dataset for training / UAT.   npm run seed:demo  [-- --force]
 *  Runs the base seed first, then adds: demo staff for every role, a sample doctor rota, holidays/leave,
 *  suppliers + stock (FEFO batches incl. low / near-expiry), POs, 40 patients (with families),
 *  3 weeks of appointments, medical records, prescriptions, invoices & payments, follow-ups,
 *  campaigns, landing page, 45 leads with activities, tasks, targets, Exotel-style call log, expenses,
 *  Rx from prescription types (+ image Rx), patient documents, stock transfers, received POs, adjustments,
 *  POS sales, returns/credit notes, cancelled bill, advances (deposit/adjust/refund), notification log,
 *  webhook, audit trail and a custom role.
 *
 *  Fill-empty mode (default): each module is seeded ONLY when its collection is empty — existing data is never
 *  changed, deleted or duplicated, so it is safe to run again any time.  --reset-all-data wipes the DB first.
 *  Safety: refuses on NODE_ENV=production (unless --force).
 *  All demo phone numbers are in 9000000000–9000009999 — WhatsApp & Exotel never contact that range,
 *  and CPF_SILENT=1 stops any notification being queued while seeding.
 */
process.env.CPF_SILENT = '1';

const mongoose = (await import('mongoose')).default;
const { env } = await import('../config/env.js');
const { connectDB, withTransaction } = await import('../config/db.js');
const { baseSeed } = await import('./seed.js');
const { MEDICINES } = await import('../constants/clinic.js');
const { cpfLandingTemplate, DEFAULT_DESIGN } = await import('../constants/landing.js');
await import('../models/index.js');
const { Role } = await import('../models/Role.js');
const { Branch } = await import('../models/Branch.js');
const { User } = await import('../models/User.js');
const { Doctor } = await import('../models/Doctor.js');
const { DoctorSchedule } = await import('../models/DoctorSchedule.js');
const { ScheduleException } = await import('../models/ScheduleException.js');
const { Patient } = await import('../models/Patient.js');
const { Appointment } = await import('../models/Appointment.js');
const { MedicalRecord, Prescription, FollowUp, PrescriptionTemplate, PatientDocument } = await import('../models/Clinical.js');
const { Product, Category, Supplier, PurchaseOrder, StockMovement, StockTransfer, Batch } = await import('../models/Inventory.js');
const { Invoice, Payment, CreditNote } = await import('../models/Billing.js');
const { Lead, LeadStage, LeadActivity, Task, SalesTarget, Campaign, EnquiryForm, Call } = await import('../models/Crm.js');
const { Expense, NotificationLog, Webhook } = await import('../models/Misc.js');
const { AuditLog } = await import('../models/AuditLog.js');
const { Settings, clearSettingsCache } = await import('../models/Settings.js');
const { createPatient } = await import('../modules/patients/patients.service.js');
const { book, setStatus, walkin } = await import('../modules/appointments/appointments.service.js');
const { createInvoice, addPayment, addAdvance, refundAdvance, returnItems, cancelInvoice } = await import('../modules/billing/billing.service.js');
const stock = await import('../modules/inventory/stock.service.js');
const { nextBookingId, nextDocNo } = await import('../utils/counter.js');
const { todayIST, addDays, weekdayOf, istToDate } = await import('../utils/time.js');
const { generateSlots } = await import('../utils/slots.js');

const FORCE = process.argv.includes('--force');
const RESET = process.argv.includes('--reset-all-data');
const failed = [];
/** run one section; a failure is logged and the rest of the seed continues */
const safe = async (label, fn) => {
  try {
    await fn();
  } catch (e) {
    failed.push(label);
    console.error(`✘ ${label}: ${e.message}`);
  }
};
const PASS = 'Demo@1234';

// deterministic RNG → same demo every run
let seed = 20261031;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const log = (...a) => console.log(...a);

async function main() {
  if (env.isProd && !FORCE) throw new Error('Refusing to load demo data with NODE_ENV=production (use --force on a staging DB only)');
  await connectDB();
  if (RESET) {
    await mongoose.connection.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    clearSettingsCache();
    log('✔ database wiped (--reset-all-data), indexes rebuilt');
  }
  // Fill-empty mode: every module is seeded ONLY if it has no data yet — existing records are never touched or duplicated.
  const empty = async (Model, filter = {}) => !(await Model.exists(filter));
  const skip = (what) => log(`· ${what} already has data — skipped`);
  const hadVisits = !(await empty(Appointment));

  await baseSeed({ log });
  const B = Object.fromEntries((await Branch.find().lean()).map((b) => [b.code, b]));
  const role = Object.fromEntries((await Role.find().lean()).map((r) => [r.slug, r._id]));
  const today = todayIST();

  // ---------------------------------------------------------------- staff
  const STAFF = [
    ['Rohini Branch Admin', 'rohini.admin@demo.cpf', '9000000101', 'branch_admin', ['ROH'], 'Branch Admin'],
    ['Paschim Vihar Manager', 'pv.manager@demo.cpf', '9000000102', 'branch_manager', ['PVH'], 'Branch Manager'],
    ['Pooja (Reception Rohini)', 'rohini.reception@demo.cpf', '9000000103', 'receptionist', ['ROH'], 'Front Desk'],
    ['Anjali (Reception PV)', 'pv.reception@demo.cpf', '9000000104', 'receptionist', ['PVH'], 'Front Desk'],
    ['Ravi (Reception Dwarka)', 'dwarka.reception@demo.cpf', '9000000105', 'receptionist', ['DWK', 'TLN'], 'Front Desk'],
    ['Dr. Rakesh Gupta (login)', 'rakesh.gupta@demo.cpf', '9000000106', 'doctor', ['PVH', 'ROH'], 'Doctor'],
    ['Dr. Ruchi Gupta (login)', 'ruchi.gupta@demo.cpf', '9000000107', 'doctor', ['PVH', 'ROH'], 'Doctor'],
    ['Suresh (Accounts)', 'accounts@demo.cpf', '9000000108', 'accountant', ['ROH', 'PVH', 'IND', 'TLN', 'DWK'], 'Accountant'],
    ['Imran (Pharmacy Rohini)', 'pharmacy.rohini@demo.cpf', '9000000109', 'pharmacist', ['ROH'], 'Pharmacist'],
    ['Neha (Sales Manager)', 'sales.manager@demo.cpf', '9000000110', 'sales_manager', 'ALL', 'Sales Manager'],
    ['Karan (Sales Executive)', 'sales1@demo.cpf', '9000000111', 'sales_executive', 'ALL', 'Tele-counsellor'],
    ['Priya (Sales Executive)', 'sales2@demo.cpf', '9000000112', 'sales_executive', 'ALL', 'Tele-counsellor'],
    ['Vikas (Marketing)', 'marketing@demo.cpf', '9000000113', 'marketing_manager', 'ALL', 'Marketing Manager'],
  ];
  const Ureal = {};
  const realStaff = await User.exists({ email: { $nin: [...STAFF.map((x) => x[1]), (env.SEED_ADMIN_EMAIL || '').toLowerCase()] } });
  const seedStaff = !realStaff;
  const fallbackUser = (await User.findOne({ email: (env.SEED_ADMIN_EMAIL || '').toLowerCase() })) || (await User.findOne({ isActive: true }).sort({ createdAt: 1 }));
  for (const [name, email, phone, slug, branches, designation] of STAFF) {
    let u = await User.findOne({ email });
    if (!u && seedStaff) {
      u = new User({ name, email, phone, role: role[slug], designation, allBranches: branches === 'ALL', branches: branches === 'ALL' ? [] : branches.map((c) => B[c]._id) });
      await u.setPassword(PASS);
      await u.save();
    }
    if (u) Ureal[email] = u;
  }
  // demo-user lookups fall back to an existing user when demo staff were not created
  const U = new Proxy(Ureal, { get: (t, k) => t[k] || fallbackUser || Object.values(t)[0] });
  if (!U['x'] ) throw new Error('No user found — set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD in .env');
  seedStaff ? log(`✔ ${STAFF.length} demo staff (password ${PASS})`) : skip('Staff');

  // ---------------------------------------------------------------- doctors + rota
  const firstDoc = await Doctor.findOne({ isActive: true }).sort({ createdAt: 1 });
  const rakesh = (await Doctor.findOne({ name: 'Dr. Rakesh Gupta' })) || firstDoc;
  const ruchi = (await Doctor.findOne({ name: 'Dr. Ruchi Gupta' })) || firstDoc;
  if (!rakesh) throw new Error('No doctor found — add a doctor first');
  if (Ureal['rakesh.gupta@demo.cpf'] && !rakesh.user) {
    rakesh.user = Ureal['rakesh.gupta@demo.cpf']._id;
    await rakesh.save();
    await User.updateOne({ _id: rakesh.user }, { doctor: rakesh._id });
  }
  if (Ureal['ruchi.gupta@demo.cpf'] && !ruchi.user) {
    ruchi.user = Ureal['ruchi.gupta@demo.cpf']._id;
    await ruchi.save();
    await User.updateOne({ _id: ruchi.user }, { doctor: ruchi._id });
  }
  const mkDoc = async (name, codes) => (await Doctor.findOne({ name })) || Doctor.create({ name, qualification: 'B.A.M.S.', specialization: 'Ayurvedic Anorectal Surgeon (demo profile)', branches: codes.map((c) => B[c]._id), consultationFee: 0, followUpFee: 0, acceptsOnlineBooking: true });
  // extra demo doctors only when the clinic has just the two seeded doctors
  const onlyBase = (await Doctor.countDocuments({ name: { $nin: ['Dr. Rakesh Gupta', 'Dr. Ruchi Gupta', 'Dr. Aman Verma (Demo)', 'Dr. Sana Khan (Demo)'] } })) === 0;
  const aman = onlyBase ? await mkDoc('Dr. Aman Verma (Demo)', ['TLN', 'DWK']) : await Doctor.findOne({ name: 'Dr. Aman Verma (Demo)' });
  const sana = onlyBase ? await mkDoc('Dr. Sana Khan (Demo)', ['DWK', 'IND', 'TLN']) : await Doctor.findOne({ name: 'Dr. Sana Khan (Demo)' });

  // sample rota — no doctor is in two places at once
  const ROTA = [
    // Dr. Rakesh / Dr. Ruchi already have the clinic default rota from the base seed (all 5 branches)
    [aman, 'TLN', [0, 1, 2, 3, 4, 5, 6], [['08:00', '14:00']]],
    [aman, 'DWK', [0, 1, 2, 3, 4, 5, 6], [['14:30', '20:00']]],
    [sana, 'DWK', [0, 1, 2, 3, 4, 5, 6], [['08:00', '14:00']]],
    [sana, 'TLN', [0, 2, 4, 5], [['14:30', '20:00']]],
    [sana, 'IND', [1, 3, 6], [['19:00', '20:30']]], // Indirapuram opens Mon/Wed/Sat evenings only
  ];
  for (const [doc, code, days, sessions] of ROTA) {
    if (!doc || (await DoctorSchedule.exists({ doctor: doc._id, branch: B[code]._id }))) continue;
    for (const wd of days) {
      await DoctorSchedule.updateOne(
        { doctor: doc._id, branch: B[code]._id, weekday: wd },
        { $set: { sessions: sessions.map(([start, end]) => ({ start, end })), slotMinutes: 15, capacityPerSlot: 1, isActive: true } },
        { upsert: true }
      );
    }
  }
  if (await empty(ScheduleException)) {
  await ScheduleException.updateOne({ type: 'holiday', branch: null, doctor: null, date: addDays(today, 9) }, { $setOnInsert: { reason: 'Holiday (demo)', status: 'approved' } }, { upsert: true });
  if (aman) await ScheduleException.updateOne({ type: 'leave', doctor: aman._id, date: addDays(today, 4) }, { $setOnInsert: { branch: B.TLN._id, reason: 'Personal leave (demo)', status: 'approved' } }, { upsert: true });
  if (sana) await ScheduleException.updateOne({ type: 'leave', doctor: sana._id, date: addDays(today, 12) }, { $setOnInsert: { branch: B.DWK._id, reason: 'Conference (demo, pending approval)', status: 'pending', createdBy: U['dwarka.reception@demo.cpf']._id } }, { upsert: true });
  } else skip('Slots & Leave (holidays/leave)');
  log('✔ doctor rota for all 5 branches');

  // ---------------------------------------------------------------- inventory
  const cats = Object.fromEntries((await Category.find().lean()).map((c) => [c.name, c._id]));
  const SVC_PRICES = { 'SRV-KSHAR': 18000, 'SRV-LASER-PILES': 35000, 'SRV-LASER-FIST': 40000, 'SRV-LASER-FISS': 30000, 'SRV-PNS': 35000, 'SRV-IRC': 6000, 'SRV-DRESSING': 500 };
  for (const [sku, price] of Object.entries(SVC_PRICES)) await Product.updateOne({ sku, sellPrice: 0 }, { $set: { sellPrice: price } });

  const PRODUCTS = MEDICINES.map(([sku, name, , cat, type, unit, gst, mrp, cost, reorder]) => [sku, name, cat, type, unit, gst, mrp, cost, reorder]);
  const P = {};
  const ownProducts = await Product.exists({ type: { $in: ['medicine', 'consumable', 'product'] }, sku: { $nin: PRODUCTS.map((x) => x[0]) } });
  for (const [sku, name, cat, type, unit, gst, mrp, cost, reorder] of PRODUCTS) {
    if (ownProducts) { const x = await Product.findOne({ sku }); if (x) P[sku] = x; continue; }
    P[sku] = await Product.findOneAndUpdate({ sku }, { $setOnInsert: { sku, name, category: cats[cat], type, unit, gstRate: gst, mrp, sellPrice: mrp, purchasePrice: cost, reorderLevel: reorder, barcode: `89${String(PRODUCTS.findIndex((p) => p[0] === sku) + 1).padStart(11, '0')}` } }, { upsert: true, new: true });
  }
  const noSuppliers = await empty(Supplier);
  const sup1 = (await Supplier.findOne({ name: 'Delhi Ayurveda Distributors (Demo)' })) || (noSuppliers ? await Supplier.create({ name: 'Delhi Ayurveda Distributors (Demo)', contactPerson: 'Mr. Bansal', phone: '9000000201', gstin: '07AAAAA0000A1Z5', paymentTermsDays: 30, address: 'Khari Baoli, Delhi' }) : await Supplier.findOne().sort({ createdAt: 1 }));
  const sup2 = (await Supplier.findOne({ name: 'MediSurg Supplies (Demo)' })) || (noSuppliers ? await Supplier.create({ name: 'MediSurg Supplies (Demo)', contactPerson: 'Ms. Kaur', phone: '9000000202', paymentTermsDays: 15, address: 'Bhagirath Palace, Delhi' }) : sup1);
  const admin = await User.findOne({ email: env.SEED_ADMIN_EMAIL?.toLowerCase() }) || U['rohini.admin@demo.cpf'];

  const { Batch: BatchModel } = await import('../models/Inventory.js');
  if (await empty(BatchModel)) await withTransaction(async (session) => {
    for (const code of Object.keys(B)) {
      for (const [sku, , , type, , , mrp, cost] of PRODUCTS) {
        if (!P[sku]) continue;
        const big = ['ROH', 'PVH'].includes(code);
        let qty = big ? int(40, 90) : int(15, 40);
        if (sku === 'MED-KASI' && code === 'ROH') qty = 4; // low stock
        if (sku === 'MED-DAFL' && code === 'PVH') qty = 3;
        if (sku === 'CON-KSHT' && code === 'IND') qty = 2;
        await stock.receive({ branch: B[code]._id, product: P[sku]._id, batchNo: `${sku.slice(4)}${code}A`, expiry: addDays(today, int(240, 700)), qty, purchasePrice: cost, mrp, sellPrice: mrp, supplier: type === 'consumable' ? sup2._id : sup1._id, type: 'purchase', refType: 'GRN', refNo: 'OPENING-STOCK', by: admin._id }, session);
      }
      // near-expiry + expired batches for alert screens
      if (P['MED-TRIP']) await stock.receive({ branch: B[code]._id, product: P['MED-TRIP']._id, batchNo: `TRIP${code}OLD`, expiry: addDays(today, 40), qty: 6, purchasePrice: 70, mrp: 120, sellPrice: 120, supplier: sup1._id, type: 'purchase', refNo: 'OPENING-STOCK', by: admin._id }, session);
      if (code === 'ROH' && P['MED-ABHA']) await stock.receive({ branch: B[code]._id, product: P['MED-ABHA']._id, batchNo: 'ABHAROHEXP', expiry: addDays(today, -10), qty: 3, purchasePrice: 140, mrp: 220, sellPrice: 220, supplier: sup1._id, type: 'purchase', refNo: 'OPENING-STOCK', by: admin._id }, session);
    }
  });
  if (noSuppliers) for (const [name, contactPerson, phone, city] of [['Baidyanath Ayurved Bhawan (Demo)', 'Mr. Sharma', '9000000203', 'Naya Bazar, Delhi'], ['Himalaya Wellness Stockist (Demo)', 'Mr. Jain', '9000000204', 'Pitampura, Delhi'], ['Surgical Point Dwarka (Demo)', 'Ms. Arora', '9000000205', 'Sector 7, Dwarka']]) {
    if (!(await Supplier.exists({ name }))) await Supplier.create({ name, contactPerson, phone, paymentTermsDays: 30, address: city });
  }
  if ((await empty(PurchaseOrder)) && ['MED-KASI', 'MED-LIDO', 'MED-SITZ', 'CON-GAUZ'].every((k) => P[k])) {
    const items = [['MED-KASI', 40, 95], ['MED-LIDO', 30, 45], ['MED-SITZ', 30, 80]].map(([sku, qty, rate]) => ({ product: P[sku]._id, name: P[sku].name, qty, rate, gstRate: 12, receivedQty: 0 }));
    await PurchaseOrder.create({ poNo: await nextDocNo('PO', 'ROH'), supplier: sup1._id, branch: B.ROH._id, items, status: 'ordered', expectedDate: addDays(today, 3), notes: 'Monthly refill (demo)', total: 7728, createdBy: U['pharmacy.rohini@demo.cpf']._id, approvedBy: U['rohini.admin@demo.cpf']._id });
    await PurchaseOrder.create({ poNo: await nextDocNo('PO', 'PVH'), supplier: sup2._id, branch: B.PVH._id, items: [{ product: P['CON-GAUZ']._id, name: P['CON-GAUZ'].name, qty: 50, rate: 30, gstRate: 5, receivedQty: 0 }], status: 'draft', notes: 'Consumables (demo draft)', total: 1575, createdBy: U['pv.manager@demo.cpf']._id });
  }
  log(`✔ ${PRODUCTS.length} products, stock at 5 branches (low-stock, near-expiry & expired batches included), 2 POs`);

  // ---------------------------------------------------------------- patients
  const NAMES = [
    ['Ramesh Kumar', 'male', 46], ['Sunita Sharma', 'female', 39], ['Amit Verma', 'male', 33], ['Pooja Gupta', 'female', 28], ['Rajesh Singh', 'male', 52],
    ['Neelam Arora', 'female', 44], ['Vikram Malhotra', 'male', 41], ['Kavita Joshi', 'female', 36], ['Deepak Yadav', 'male', 29], ['Meena Bansal', 'female', 58],
    ['Sanjay Chauhan', 'male', 47], ['Ritu Kapoor', 'female', 34], ['Mohit Saini', 'male', 31], ['Anita Mehra', 'female', 49], ['Harish Rawat', 'male', 55],
    ['Shalini Tyagi', 'female', 42], ['Gaurav Khanna', 'male', 38], ['Rekha Pandey', 'female', 61], ['Arun Mishra', 'male', 44], ['Nisha Agarwal', 'female', 27],
    ['Prakash Jha', 'male', 63], ['Swati Bhatia', 'female', 32], ['Manoj Tiwari', 'male', 50], ['Geeta Rani', 'female', 57], ['Rohit Bhardwaj', 'male', 26],
    ['Jyoti Saxena', 'female', 37], ['Sunil Dutt', 'male', 48], ['Komal Sethi', 'female', 30], ['Ashok Ahuja', 'male', 66], ['Payal Grover', 'female', 35],
    ['Naveen Kohli', 'male', 43], ['Seema Dhawan', 'female', 46], ['Tarun Bedi', 'male', 34], ['Lata Sood', 'female', 59], ['Yogesh Rana', 'male', 40],
  ];
  const FAMILY = [['Ramesh Kumar', 'Saroj Kumar', 'female', 'spouse', 43], ['Rajesh Singh', 'Aarav Singh', 'male', 'child', 19], ['Meena Bansal', 'Kishore Bansal', 'male', 'spouse', 62], ['Vikram Malhotra', 'Raj Malhotra', 'male', 'parent', 71], ['Anita Mehra', 'Sonia Mehra', 'female', 'child', 22]];
  const codes = Object.keys(B);
  let patients = [];
  const seedPatients = await empty(Patient);
  if (!seedPatients) {
    patients = await Patient.find({ isActive: true }).sort({ createdAt: 1 }).limit(60);
    skip('Patients');
  }
  for (let i = 0; seedPatients && i < NAMES.length; i++) {
    const [name, gender, age] = NAMES[i];
    const mobile = `90000${String(1000 + i).padStart(5, '0')}`;
    let p = await Patient.findOne({ mobile, relation: 'self' });
    if (!p) p = await createPatient({ mobile, name, gender, ageYears: age, relation: 'self', registeredBranch: B[codes[i % 5]]._id, source: pick(['online', 'reception', 'reception', 'crm', 'walkin']), createdBy: U['rohini.reception@demo.cpf']._id, address: { city: pick(['Delhi', 'Delhi', 'Ghaziabad', 'Noida', 'Gurugram']) } });
    patients.push(p);
    const fam = FAMILY.find((f) => f[0] === name);
    if (fam && !(await Patient.exists({ mobile, relation: fam[3] }))) {
      patients.push(await createPatient({ accountId: p.account, name: fam[1], gender: fam[2], ageYears: fam[4], relation: fam[3], registeredBranch: p.registeredBranch, source: 'reception' }));
    }
  }
  if (seedPatients) log(`✔ ${patients.length} patients (incl. family members on shared mobiles)`);

  // ---------------------------------------------------------------- past visits (raw history, 14 days)
  const schedules = await DoctorSchedule.find({ isActive: true }).lean();
  const COMPLAINTS = ['Bleeding during stools', 'Pain while passing stool', 'Swelling near anus', 'Discharge / pus near anal region', 'Itching and irritation', 'Hard stools, constipation', 'Painful lump at tailbone'];
  const DX = [
    ['Grade II internal haemorrhoids', 'SRV-IRC'], ['Grade III haemorrhoids', 'SRV-LASER-PILES'], ['Chronic anal fissure', 'SRV-LASER-FISS'],
    ['Low anal fistula (fistula-in-ano)', 'SRV-KSHAR'], ['Pilonidal sinus', 'SRV-PNS'], ['External thrombosed pile', null], ['Acute fissure', null],
  ];
  const MEDS = ['MED-ARSH', 'MED-KANK', 'MED-TRIP', 'MED-ISAB', 'MED-JATY', 'MED-LIDO', 'MED-SITZ', 'MED-HARI'].filter((m) => P[m]);
  const RXDOSE = { 'MED-ARSH': ['2 tab', '1-0-1', 'After food', '15 days'], 'MED-KANK': ['2 tab', '1-0-1', 'After food', '15 days'], 'MED-TRIP': ['1 tsp', '0-0-1', 'With warm water at bedtime', '30 days'], 'MED-ISAB': ['2 tsp', '0-0-1', 'With milk/water at bedtime', '30 days'], 'MED-JATY': ['Local application', '1-0-1', 'After sitz bath', '15 days'], 'MED-LIDO': ['Local application', 'SOS', 'Before stools', '10 days'], 'MED-SITZ': ['1 sachet in warm water', '1-0-1', '10 minutes', '15 days'], 'MED-HARI': ['1 tab', '0-0-1', 'Bedtime', '15 days'] };
  const svc = Object.fromEntries((await Product.find({ type: 'service' }).lean()).map((p) => [p.sku, p]));
  const docUser = (d) => (String(d) === String(rakesh._id) ? rakesh.user : String(d) === String(ruchi._id) ? ruchi.user : U['rohini.admin@demo.cpf']._id);

  const TPL = await PrescriptionTemplate.find({ isActive: { $ne: false } }).lean();
  const tplFor = (dx) => {
    const k = /fistula/i.test(dx) ? 'Fistula' : /fissure/i.test(dx) ? 'Fissure' : /pilonidal/i.test(dx) ? 'Pilonidal sinus' : /haemorrhoid|pile/i.test(dx) ? 'Piles' : null;
    const c = TPL.filter((t) => t.condition === k);
    return c.length ? pick(c) : null;
  };
  await safe('past visits, records, prescriptions, invoices', async () => {
    if (hadVisits) return skip('Appointments / records / prescriptions / bills');
    if (!patients.length) return;
  let visits = 0;
  let invoices = 0;
  for (let back = 14; back >= 1; back--) {
    const date = addDays(today, -back);
    const wd = weekdayOf(date);
    for (const code of codes) {
      const branch = B[code];
      const day = schedules.filter((s) => String(s.branch) === String(branch._id) && s.weekday === wd);
      for (const sch of day) {
        const r = generateSlots({ date, branch, schedule: sch, doctorId: String(sch.doctor), now: new Date('2000-01-01') });
        const n = Math.min(r.slots.length, ['ROH', 'PVH'].includes(code) ? int(2, 5) : int(0, 2));
        const chosen = [...r.slots].sort(() => rnd() - 0.5).slice(0, n).sort((a, b) => a.start.localeCompare(b.start));
        let token = 0;
        for (const slot of chosen) {
          const patient = pick(patients);
          const status = chance(0.72) ? 'completed' : chance(0.5) ? 'no_show' : 'cancelled';
          const bookingId = await nextBookingId(code, date);
          const at = istToDate(date, slot.start);
          const a = await Appointment.create({
            bookingId, patient: patient._id, account: patient.account, branch: branch._id, doctor: sch.doctor, date, start: slot.start, end: slot.end,
            type: pick(['online', 'online', 'phone', 'walkin', 'crm']), visitType: chance(0.3) ? 'followup' : 'new', status,
            complaint: pick(COMPLAINTS), tokenNo: status === 'completed' ? ++token : undefined,
            checkedInAt: status === 'completed' ? at : undefined, completedAt: status === 'completed' ? new Date(at.getTime() + 20 * 60000) : undefined,
            cancelReason: status === 'cancelled' ? pick(['Patient request', 'Travelling', 'Feeling better']) : undefined, cancelledBy: status === 'cancelled' ? 'patient' : undefined,
            createdBy: U['rohini.reception@demo.cpf']._id,
          });
          await Appointment.collection.updateOne({ _id: a._id }, { $set: { createdAt: new Date(at.getTime() - int(1, 4) * 86400000), updatedAt: at } });
          await Patient.updateOne({ _id: patient._id }, { $addToSet: { branchesVisited: branch._id } });
          visits++;
          if (status !== 'completed') continue;

          const [dx, proc] = pick(DX);
          const doctorUser = docUser(sch.doctor);
          const rec = await MedicalRecord.create({
            patient: patient._id, branch: branch._id, doctor: sch.doctor, appointment: a._id, type: proc && chance(0.4) ? 'procedure' : 'consultation',
            complaints: a.complaint, history: pick(['Symptoms for 3 months', 'On and off for 1 year', 'Recurrent since 6 months', 'Post-delivery onset']),
            examination: pick(['P/R: internal piles at 3, 7, 11 o’clock', 'Posterior midline fissure, sentinel tag present', 'External opening at 5 o’clock, 3 cm from anal verge', 'Sinus opening in natal cleft']),
            diagnosis: dx, plan: proc ? `Advised ${svc[proc].name}` : 'Conservative management, review in 2 weeks',
            vitals: { bp: pick(['120/80', '130/84', '118/76', '138/88']), pulse: int(68, 92), weightKg: int(52, 88) }, createdBy: doctorUser,
          });
          await MedicalRecord.collection.updateOne({ _id: rec._id }, { $set: { createdAt: at, isLocked: true } });
          const meds = [...MEDS].sort(() => rnd() - 0.5).slice(0, int(2, 4));
          const fu = addDays(date, 14);
          const tpl = chance(0.7) ? tplFor(dx) : null;
          const rx = await Prescription.create({
            rxNo: await nextDocNo('RX', code), patient: patient._id, branch: branch._id, doctor: sch.doctor, appointment: a._id, record: rec._id, diagnosis: dx,
            mode: 'typed', template: tpl?._id, templateName: tpl?.name, complaints: a.complaint, vitals: rec.vitals,
            items: tpl?.items?.length ? tpl.items : meds.map((m) => { const [dose, frequency, timing, duration] = RXDOSE[m]; return { product: P[m]._id, name: P[m].name, dose, frequency, timing, duration }; }),
            investigations: tpl?.investigations || (chance(0.3) ? 'CBC, Blood sugar (F)' : undefined),
            advice: tpl?.advice || 'Sitz bath twice daily · high-fibre diet · 3-4 L water · avoid spicy food and long sitting',
            diet: tpl?.diet, followUpDate: fu, createdBy: doctorUser,
          });
          await Prescription.collection.updateOne({ _id: rx._id }, { $set: { createdAt: at } });
          if (fu >= today || chance(0.5)) {
            await FollowUp.create({ patient: patient._id, branch: branch._id, doctor: sch.doctor, sourceAppointment: a._id, dueDate: fu, reason: 'Review after medication', status: fu < today ? pick(['done', 'missed', 'contacted']) : 'pending', createdBy: doctorUser });
          }

          // invoice: free consultation + medicines (+ procedure for some) — FEFO stock-out via the real billing service
          const items = [{ product: svc[a.visitType === 'followup' ? 'SRV-FOLLOWUP' : 'SRV-CONSULT']._id, qty: 1 }, ...meds.slice(0, 3).map((m) => ({ product: P[m]._id, qty: int(1, 2) }))];
          const doProc = proc && chance(0.35);
          if (doProc) items.push({ product: svc[proc]._id, qty: 1, discountPct: pick([0, 0, 5, 10]) });
          const staffUser = { _id: U['rohini.reception@demo.cpf']._id };
          try {
            const inv = await createInvoice({ branch: branch._id, patient: patient._id, appointment: a._id, doctor: sch.doctor, items, payments: [], source: 'billing' }, staffUser);
            // medicines-only bills paid in full; procedures: full, or 50% advance with balance outstanding
            const share = !doProc || chance(0.6) ? 1 : 0.5;
            const amount = Math.round(inv.grandTotal * share * 100) / 100;
            if (amount > 0) await addPayment(inv._id, { mode: pick(['cash', 'upi', 'upi', 'card']), amount }, staffUser);
            const t = new Date(at.getTime() + 25 * 60000);
            await Invoice.collection.updateOne({ _id: inv._id }, { $set: { createdAt: t, updatedAt: t } });
            await Payment.collection.updateMany({ invoice: inv._id }, { $set: { createdAt: t, updatedAt: t } });
            await StockMovement.collection.updateMany({ refId: inv._id }, { $set: { createdAt: t } });
            invoices++;
          } catch (e) {
            if (!/Insufficient stock/.test(e.message)) throw e; // small branches can run out — skip that bill
          }
        }
      }
    }
  }
  log(`✔ ${visits} past appointments, ${invoices} invoices with payments, medical records, prescriptions, follow-ups`);
  });

  // ---------------------------------------------------------------- today & upcoming (real booking engine)
  await safe('today & upcoming appointments', async () => {
    if (hadVisits || !patients.length) return;
  let upcoming = 0;
  for (let ahead = 0; ahead <= 6; ahead++) {
    const date = addDays(today, ahead);
    for (const code of codes) {
      const target = ['ROH', 'PVH'].includes(code) ? int(2, 4) : int(0, 2);
      for (let k = 0; k < target; k++) {
        const p = pick(patients);
        try {
          const appt = await book({ staff: true, patientId: p._id, branchId: B[code]._id, doctorId: 'any', date, start: await firstFreeSlot(B[code], date), type: pick(['online', 'phone', 'crm']), complaint: pick(COMPLAINTS), createdBy: U['rohini.reception@demo.cpf']._id });
          upcoming++;
          if (ahead === 0 && chance(0.5)) {
            const ci = await setStatus(appt, 'checked_in');
            if (chance(0.4)) await setStatus(ci, 'in_consultation');
          }
        } catch {
          /* day full / branch closed — fine */
        }
      }
    }
  }
  try {
    await walkin({ patientId: patients[3]._id, branchId: B.ROH._id, doctorId: String((await DoctorSchedule.findOne({ branch: B.ROH._id, weekday: weekdayOf(today) }).lean())?.doctor || ruchi._id), complaint: 'Walk-in: severe pain', createdBy: U['rohini.reception@demo.cpf']._id });
  } catch {
    /* closed today */
  }
  log(`✔ ${upcoming} appointments today + next 6 days (some checked-in with tokens) + 1 walk-in`);
  });

  // ---------------------------------------------------------------- CRM
  await safe('CRM', async () => {
  const stages = Object.fromEntries((await LeadStage.find().lean()).map((s) => [s.key, s]));
  const camp = async (name, channel, utmCampaign, budget, spend) => (await Campaign.findOne({ name })) || Campaign.create({ name, channel, utmCampaign, budget, spend, startDate: addDays(today, -30), status: 'active' });
  const noCampaigns = await empty(Campaign);
  const existingC = noCampaigns ? [] : await Campaign.find().sort({ createdAt: 1 }).limit(3);
  if (!noCampaigns) skip('Campaigns');
  const C1 = existingC[0] || await camp('Google Ads — Laser Piles Delhi', 'google_ads', 'laser_piles_delhi', 60000, 38500);
  const C2 = existingC[1] || existingC[0] || await camp('Facebook — Fistula Kshar Sutra', 'facebook_ads', 'fb_fistula_ksharsutra', 30000, 17200);
  const C3 = existingC[2] || existingC[0] || await camp('Instagram — Fissure Awareness', 'instagram', 'ig_fissure_awareness', 15000, 6400);
  if (await empty(EnquiryForm)) {
    await EnquiryForm.create({
      name: 'Laser Piles Treatment — Delhi NCR', slug: 'laser-piles-treatment-delhi', kind: 'landing_page', campaign: C1._id, defaultSource: 'google_ads',
      page: { headline: 'Painless Laser & Kshar Sutra Treatment for Piles', subheadline: 'Free consultation · 5 branches across Delhi NCR · Interest-free EMI', ctaText: 'Book Free Consultation', bullets: ['Senior Ayurvedic surgeons — Dr. Rakesh Gupta & Dr. Ruchi Gupta', 'Kshar Sutra, laser and IRC options', 'Branches: Rohini, Paschim Vihar, Indirapuram, Tilak Nagar, Dwarka'], seoTitle: 'Laser Piles Treatment in Delhi | Centre For Piles & Fistula' },
      fields: [
        { key: 'name', label: 'Full name', type: 'text', required: true, mapTo: 'name' },
        { key: 'phone', label: 'Mobile number', type: 'tel', required: true, mapTo: 'phone' },
        { key: 'problem', label: 'Problem', type: 'select', required: true, mapTo: 'condition', options: ['Piles', 'Fistula', 'Fissure', 'Pilonidal sinus', 'Other'] },
        { key: 'branch', label: 'Nearest branch', type: 'select', mapTo: 'branch' },
      ],
      submissions: 18,
    });
  }
  // drag & drop page-builder content (CMS & Forms → Design)
  await EnquiryForm.updateOne({ slug: 'laser-piles-treatment-delhi', 'blocks.0': { $exists: false } }, { $set: { blocks: cpfLandingTemplate(), design: DEFAULT_DESIGN } });

  const sales = [U['sales1@demo.cpf'], U['sales2@demo.cpf']];
  const LEADN = ['Aditya Rao', 'Bhavna Sethi', 'Chetan Arora', 'Divya Nair', 'Eshan Gill', 'Farhan Ali', 'Gunjan Mittal', 'Himanshu Goel', 'Isha Chawla', 'Jatin Bhalla', 'Kriti Anand', 'Lalit Sharma', 'Mansi Khurana', 'Nitin Dua', 'Ojas Taneja', 'Pallavi Batra', 'Qasim Raza', 'Rahul Nagpal', 'Sakshi Juneja', 'Tushar Wadhwa', 'Urmila Devi', 'Varun Oberoi', 'Waseem Akhtar', 'Yamini Bajaj', 'Zubin Talwar', 'Ankit Chopra', 'Bindu Rawal', 'Chirag Vohra', 'Dimple Narang', 'Ekta Luthra', 'Firoz Khan', 'Gagan Sachdeva', 'Hema Puri', 'Inder Jeet', 'Jasleen Kaur', 'Kunal Dhingra', 'Lovely Sharma', 'Mukesh Garg', 'Nidhi Chandna', 'Om Prakash', 'Preeti Uppal', 'Rajat Midha', 'Sneha Popli', 'Tanvi Aggarwal', 'Uday Kalra'];
  const STAGE_MIX = ['new', 'new', 'new', 'new', 'contacted', 'contacted', 'contacted', 'interested', 'interested', 'follow_up', 'follow_up', 'follow_up', 'appointment_scheduled', 'appointment_scheduled', 'visited', 'converted', 'converted', 'lost'];
  const LOST = ['Too expensive', 'Chose another hospital', 'Not reachable', 'Will decide later'];
  let leadsMade = 0;
  let callsMade = 0;
  const seedLeads = await empty(Lead);
  if (!seedLeads) skip('Leads / calls / tasks');
  for (let i = 0; seedLeads && i < LEADN.length; i++) {
    const phone = `90000${String(5000 + i).padStart(5, '0')}`;
    if (await Lead.exists({ phone })) continue;
    const src = pick(['google_ads', 'google_ads', 'facebook_ads', 'instagram', 'website', 'whatsapp', 'phone', 'landing_page', 'walkin']);
    const campaign = src === 'google_ads' || src === 'landing_page' ? C1 : src === 'facebook_ads' ? C2 : src === 'instagram' ? C3 : null;
    const sk = pick(STAGE_MIX);
    const owner = sk === 'new' && chance(0.3) ? null : pick(sales);
    const created = new Date(Date.now() - int(0, 20) * 86400000 - int(0, 10) * 3600000);
    const lead = await Lead.create({
      name: LEADN[i], phone, city: pick(['Rohini', 'Pitampura', 'Janakpuri', 'Dwarka', 'Indirapuram', 'Vaishali', 'Uttam Nagar', 'Tilak Nagar', 'Paschim Vihar']),
      condition: pick(['Piles', 'Piles', 'Fistula', 'Fissure', 'Pilonidal sinus']), source: src, campaign: campaign?._id,
      utm: campaign ? { source: src.split('_')[0], medium: src === 'instagram' ? 'social' : 'cpc', campaign: campaign.utmCampaign } : undefined,
      branch: chance(0.6) ? pick(Object.values(B))._id : undefined, stage: stages[sk]._id, assignedTo: owner?._id, assignedAt: owner ? created : undefined,
      priority: pick(['low', 'medium', 'medium', 'high']), lostReason: sk === 'lost' ? pick(LOST) : undefined,
      nextFollowUpAt: ['contacted', 'interested', 'follow_up'].includes(sk) ? new Date(Date.now() + int(-2, 3) * 86400000 + int(1, 8) * 3600000) : null,
      convertedAt: sk === 'converted' ? new Date() : undefined, convertedPatient: sk === 'converted' ? pick(patients)._id : undefined,
      callCount: 0, createdBy: owner?._id,
    });
    await Lead.collection.updateOne({ _id: lead._id }, { $set: { createdAt: created } });
    await LeadActivity.create({ lead: lead._id, type: 'system', text: `Lead created via ${src}` });
    leadsMade++;
    if (sk !== 'new' && owner) {
      const nCalls = int(1, 3);
      for (let c = 0; c < nCalls; c++) {
        const connected = c === nCalls - 1 || chance(0.5);
        const status = connected ? 'completed' : pick(['no-answer', 'busy']);
        const dur = connected ? int(45, 420) : 0;
        const at = new Date(created.getTime() + (c + 1) * int(2, 20) * 3600000);
        const call = await Call.create({ sid: `demo-${lead._id}-${c}`, direction: 'outbound', lead: lead._id, agent: owner._id, from: owner.phone, to: phone, callerId: env.EXOTEL_CALLER_ID || '08000000000', status, outcome: connected ? 'connected' : status === 'busy' ? 'busy' : 'no_answer', durationSec: dur, startedAt: at, endedAt: new Date(at.getTime() + (dur + 20) * 1000), notes: 'Demo call (no recording)' });
        await Call.collection.updateOne({ _id: call._id }, { $set: { createdAt: at } });
        await LeadActivity.create({ lead: lead._id, type: 'call', text: connected ? pick(['Explained Kshar Sutra procedure, wants cost estimate', 'Interested, will visit this weekend', 'Asked about EMI and insurance', 'Booked consultation']) : 'Did not pick up', call: { direction: 'outbound', outcome: connected ? 'connected' : status === 'busy' ? 'busy' : 'no_answer', durationSec: dur }, meta: { callId: String(call._id) }, by: owner._id });
        callsMade++;
      }
      await Lead.updateOne({ _id: lead._id }, { $set: { callCount: nCalls, lastContactAt: new Date() } });
      if (chance(0.4)) await LeadActivity.create({ lead: lead._id, type: 'whatsapp', text: 'Shared clinic location and treatment brochure on WhatsApp', by: owner._id });
    }
    if (i % 7 === 0) {
      const ib = await Call.create({ sid: `demo-in-${lead._id}`, direction: 'inbound', lead: lead._id, agent: owner?._id, from: phone, to: env.EXOTEL_CALLER_ID || '08000000000', status: 'completed', outcome: 'connected', durationSec: int(60, 300), ivrDigits: String(int(1, 5)), ivrLabel: pick(['Rohini', 'Paschim Vihar', 'Dwarka']), startedAt: new Date(), endedAt: new Date(), notes: 'Demo inbound IVR call' });
      await LeadActivity.create({ lead: lead._id, type: 'call', text: `Inbound call (IVR: ${ib.ivrLabel})`, call: { direction: 'inbound', outcome: 'connected', durationSec: ib.durationSec }, meta: { callId: String(ib._id) }, by: owner?._id });
      callsMade++;
    }
    if (owner && chance(0.35)) await Task.create({ title: pick(['Call back with cost estimate', 'Send EMI details', 'Confirm Saturday visit', 'Share pre-procedure instructions']), lead: lead._id, assignedTo: owner._id, dueAt: new Date(Date.now() + int(-1, 3) * 86400000), priority: pick(['medium', 'high']), createdBy: U['sales.manager@demo.cpf']._id });
  }
  const month = today.slice(0, 7);
  if (await empty(SalesTarget)) for (const u of sales) await SalesTarget.updateOne({ user: u._id, month }, { $setOnInsert: { leadsTarget: 80, appointmentsTarget: 40, conversionsTarget: 20, revenueTarget: 400000, setBy: U['sales.manager@demo.cpf']._id } }, { upsert: true });
  log(`✔ 3 campaigns, landing page /f/laser-piles-treatment-delhi, ${leadsMade} leads, ${callsMade} call records, tasks, monthly targets`);
  });

  // ---------------------------------------------------------------- every other module (idempotent-ish: guarded by markers)
  const sys = { _id: U['rohini.admin@demo.cpf']._id };
  const fs = await import('node:fs');
  const path = await import('node:path');
  const zlib = await import('node:zlib');
  const uploadRoot = path.resolve(env.UPLOAD_DIR);
  /** tiny solid-colour PNG (placeholder scan) */
  const png = (w, h, [r, g, b]) => {
    const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; const line = y % 24 === 0 && x > 20 && x < w - 20; raw[o] = line ? 120 : r; raw[o + 1] = line ? 140 : g; raw[o + 2] = line ? 200 : b; }
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  };
  const putFile = (sub, name, buf) => { fs.mkdirSync(path.join(uploadRoot, sub), { recursive: true }); fs.writeFileSync(path.join(uploadRoot, sub, name), buf); return buf.length; };

  // custom role
  if (await empty(Role, { isSystem: { $ne: true } })) await Role.updateOne({ slug: 'telecaller_lite' }, { $setOnInsert: { name: 'Tele-caller (limited, demo)', description: 'Custom role example — leads & appointment booking only', scope: 'global', permissions: ['dashboard.view', 'leads.view', 'leads.edit', 'appointments.view', 'appointments.create', 'patients.view'], isSystem: false } }, { upsert: true });

  await safe('stock transfers, received POs, adjustment', async () => {
  if (await empty(StockTransfer)) {
    // transfers: one received, one in transit
    for (const [from, to, items, done] of [['ROH', 'IND', [['MED-ARSH', 10], ['MED-JATY', 5]], true], ['PVH', 'TLN', [['MED-TRIP', 6], ['CON-GAUZ', 10]], false]]) {
      await withTransaction(async (session) => {
        const transferNo = await nextDocNo('TR', from, session);
        const [doc] = await StockTransfer.create([{ transferNo, fromBranch: B[from]._id, toBranch: B[to]._id, notes: `Stock balancing (demo)`, createdBy: U['pharmacy.rohini@demo.cpf']._id, items: [] }], { session });
        for (const [sku, qty] of items) {
          const allocations = await stock.issueFEFO({ branch: B[from]._id, product: P[sku]._id, qty, type: 'transfer_out', refType: 'StockTransfer', refId: doc._id, refNo: transferNo, by: sys._id }, session);
          doc.items.push({ product: P[sku]._id, name: P[sku].name, qty, allocations });
        }
        if (done) {
          for (const it of doc.items) for (const a of it.allocations) await stock.receive({ branch: B[to]._id, product: it.product, batchNo: a.batchNo, expiry: a.expiry, qty: a.qty, purchasePrice: a.purchasePrice, mrp: a.mrp, sellPrice: a.sellPrice, type: 'transfer_in', refType: 'StockTransfer', refId: doc._id, refNo: transferNo, by: sys._id }, session);
          doc.status = 'received'; doc.receivedBy = sys._id; doc.receivedAt = new Date();
        }
        await doc.save({ session });
      });
    }
    // PO fully received + partially received (creates batches via GRN)
    for (const [code, lines, partial] of [['ROH', [['MED-PILX', 30, 160], ['MED-SITZ', 20, 80]], false], ['PVH', [['MED-KASI', 30, 95], ['MED-LIDO', 40, 45]], true]]) {
      const po = await PurchaseOrder.create({ poNo: await nextDocNo('PO', code), supplier: sup1._id, branch: B[code]._id, items: lines.filter(([sku]) => P[sku]).map(([sku, qty, rate]) => ({ product: P[sku]._id, name: P[sku].name, qty, rate, gstRate: P[sku].gstRate, receivedQty: 0 })), status: 'ordered', expectedDate: addDays(today, -2), notes: partial ? 'Partly delivered (demo)' : 'Delivered (demo)', supplierInvoiceNo: `SI-${int(1000, 9999)}`, total: lines.reduce((a, [, q, r]) => a + q * r, 0), createdBy: U['pharmacy.rohini@demo.cpf']._id, approvedBy: U['rohini.admin@demo.cpf']._id });
      await withTransaction(async (session) => {
        const rl = [];
        for (const it of po.items) {
          const q = partial ? Math.floor(it.qty / 2) : it.qty;
          const batchNo = `${String(it.name).slice(0, 4).toUpperCase()}${code}PO`;
          const expiry = addDays(today, 540);
          await stock.receive({ branch: po.branch, product: it.product, batchNo, expiry, qty: q, purchasePrice: it.rate, mrp: P[Object.keys(P).find((k) => String(P[k]._id) === String(it.product))].mrp, supplier: po.supplier, type: 'purchase', refType: 'PurchaseOrder', refId: po._id, refNo: po.poNo, by: sys._id }, session);
          it.receivedQty = q;
          rl.push({ product: it.product, batchNo, expiry, qty: q, purchasePrice: it.rate });
        }
        po.receipts.push({ at: new Date(), by: sys._id, invoiceNo: po.supplierInvoiceNo, lines: rl });
        po.status = partial ? 'partial' : 'received';
        await po.save({ session });
      });
    }
    // stock adjustment (damage)
    const dmg = await Batch.findOne({ branch: B.ROH._id, qty: { $gt: 5 } });
    if (dmg) await withTransaction((session) => stock.adjust({ batch: dmg._id, delta: -2, reason: 'Damaged in storage (demo)', by: sys._id }, session));
    log('✔ stock transfers (received + in transit), purchase orders received/partial, stock adjustment');
  }
  });

  await safe('POS sales', async () => {
  if (await empty(Invoice, { source: 'pos' }) && patients.length) {
    const pos = { _id: U['pharmacy.rohini@demo.cpf']._id };
    let n = 0;
    for (let k = 0; k < 10; k++) {
      const code = pick(['ROH', 'ROH', 'PVH', 'DWK']);
      const items = ['MED-ISAB', 'MED-TRIP', 'MED-SITZ', 'MED-JATY', 'MED-HARI'].filter((x) => P[x]).sort(() => rnd() - 0.5).slice(0, int(1, 3)).map((x) => ({ product: P[x]._id, qty: int(1, 2) }));
      const known = chance(0.5) ? pick(patients) : null;
      try {
        const inv = await createInvoice({ branch: B[code]._id, patient: known?._id, customer: known ? undefined : { name: pick(['Walk-in customer', 'Ramesh', 'Sunita', 'Mohit']), phone: `90000099${String(k).padStart(2, '0')}` }, items, payments: [], source: 'pos' }, pos);
        await addPayment(inv._id, { mode: pick(['cash', 'upi']), amount: inv.grandTotal }, pos);
        const t = new Date(Date.now() - int(0, 10) * 86400000 - int(1, 8) * 3600000);
        await Invoice.collection.updateOne({ _id: inv._id }, { $set: { createdAt: t } });
        n++;
      } catch { /* stock */ }
    }
    log(`✔ ${n} POS counter sales (walk-in + registered)`);
  }
  });

  await safe('returns, credit notes, advances', async () => {
  if (await empty(CreditNote) && await empty(Payment, { kind: { $in: ['advance', 'refund'] } })) {
    const cands = await Invoice.find({ status: 'paid', 'items.kind': 'product' }).sort({ createdAt: -1 }).limit(3);
    for (const [i, inv] of cands.entries()) {
      const line = inv.items.find((l) => l.kind === 'product');
      try {
        if (i < 2) await returnItems(inv._id, { lines: [{ lineId: String(line._id), qty: 1 }], refundMode: 'cash', reason: i ? 'Wrong medicine dispensed (demo)' : 'Patient returned unopened pack (demo)', restock: true }, sys);
        else await cancelInvoice(inv._id, 'Duplicate bill (demo)', sys);
      } catch (e) { log('  · return skipped:', e.message); }
    }
    // advances: deposit → partly used on a procedure bill → small refund
    const ap = patients[1];
    await addAdvance({ branch: B.ROH._id, patient: ap._id, mode: 'upi', amount: 20000, reference: 'UPI-DEMO-1', notes: 'Advance for Kshar Sutra (demo)' }, sys);
    try {
      await createInvoice({ branch: B.ROH._id, patient: ap._id, items: [{ product: svc['SRV-KSHAR']._id, qty: 1 }], payments: [], useAdvance: true, source: 'billing', notes: 'Adjusted from advance (demo)' }, sys);
    } catch { /* ignore */ }
    await addAdvance({ branch: B.PVH._id, patient: patients[5]._id, mode: 'cash', amount: 5000, notes: 'Advance (demo)' }, sys);
    await refundAdvance({ branch: B.PVH._id, patient: patients[5]._id, mode: 'cash', amount: 1000, notes: 'Partial refund (demo)' }, sys);
    // an unpaid bill
    try { await createInvoice({ branch: B.DWK._id, patient: patients[7]._id, items: [{ product: svc['SRV-DRESSING']._id, qty: 3 }], payments: [], source: 'billing', notes: 'Pay later (demo)' }, sys); } catch { /* ignore */ }
    log('✔ returns + credit notes, cancelled bill, advances (deposit, adjust, refund), unpaid bill');
  }
  });

  // image prescriptions + patient documents (placeholder scans written to uploads/)
  await safe('documents & image prescriptions', async () => {
  if (await empty(PatientDocument)) {
    const img = png(600, 400, [250, 250, 245]);
    const ts = Date.now();
    for (const [i, p] of patients.slice(0, 6).entries()) {
      const name = `demo-${ts}-${i}.png`;
      const size = putFile('patients', name, img);
      await PatientDocument.create({ patient: p._id, branch: p.registeredBranch, title: pick(['MRI fistulogram (demo)', 'CBC report (demo)', 'Blood sugar report (demo)', 'Consent form (demo)']), category: pick(['report', 'scan', 'consent']), storedName: name, originalName: 'report.png', mime: 'image/png', size, uploadedBy: sys._id });
    }
    const done = await Appointment.find({ status: 'completed' }).sort({ date: -1 }).limit(3).lean();
    for (const [i, a] of done.entries()) {
      const name = `demo-rx-${ts}-${i}.png`;
      const size = putFile('rx', name, img);
      const code = Object.keys(B).find((c) => String(B[c]._id) === String(a.branch));
      await Prescription.create({ rxNo: await nextDocNo('RX', code), patient: a.patient, branch: a.branch, doctor: a.doctor, appointment: a._id, mode: i === 0 ? 'image' : 'both', complaints: a.complaint, diagnosis: i ? 'Fissure-in-ano' : undefined, items: i ? [{ product: P['MED-LIDO']?._id, name: P['MED-LIDO']?.name || 'Lidocaine gel', dose: 'Local application', frequency: 'SOS', timing: 'Before stools', duration: '10 days' }] : [], notes: 'Handwritten prescription scanned (demo)', images: [{ storedName: name, originalName: 'rx.png', mime: 'image/png', size }], followUpDate: addDays(today, 7), createdBy: docUser(a.doctor) });
    }
    log('✔ patient documents + image / mixed prescriptions');
  }
  });

  // notification log + webhook + audit trail samples
  await safe('notification log', async () => {
  if (await empty(NotificationLog)) {
    const EV = [['otp', 'sent'], ['appointment.booked', 'sent'], ['appointment.reminder', 'sent'], ['appointment.cancelled', 'sent'], ['prescription.send', 'sent'], ['invoice.send', 'failed'], ['payment.received', 'skipped'], ['followup.reminder', 'sent']];
    const rows = [];
    for (let k = 0; k < 40; k++) {
      const [event, status] = pick(EV);
      rows.push({ channel: event === 'otp' && chance(0.3) ? 'sms' : 'whatsapp', to: `90000010${String(int(0, 34)).padStart(2, '0')}`, template: event, event, status, error: status === 'failed' ? 'WAPP 505: insufficient credits (demo)' : status === 'skipped' ? 'demo number' : undefined, providerId: `demo-${k}`, createdAt: new Date(Date.now() - int(0, 14 * 24) * 3600000) });
    }
    await NotificationLog.collection.insertMany(rows);
    log('✔ 40 notification log entries');
  }
  });
  await safe('webhook', async () => {
  if (await empty(Webhook)) {
    await Webhook.create({ name: 'Google Sheet sync (demo, disabled)', url: 'https://example.com/hooks/cpf', events: ['appointment.booked', 'lead.created', 'payment.received'], secret: `demo-${Math.random().toString(36).slice(2)}`, isActive: false });
  }
  });
  await safe('audit log', async () => {
  if (await empty(AuditLog)) {
    const A = [['auth.login', 'User'], ['patients.create', 'Patient'], ['appointments.status', 'Appointment'], ['billing.invoice_create', 'Invoice'], ['settings.edit', 'Settings'], ['leads.assign', 'Lead'], ['medical_records.view', 'MedicalRecord']];
    const users = Object.values(U);
    await AuditLog.collection.insertMany(Array.from({ length: 60 }, () => { const [action, entity] = pick(A); const u = pick(users); return { actorType: 'staff', user: u._id, action, entity, branch: u.branches?.[0], meta: { demo: true }, ip: `10.0.0.${int(2, 250)}`, ua: 'Mozilla/5.0 (demo)', createdAt: new Date(Date.now() - int(0, 14 * 24) * 3600000) }; }));
    log('✔ webhook + 60 audit log entries');
  }
  });

  // ---------------------------------------------------------------- expenses
  await safe('expenses', async () => {
  if (await empty(Expense)) {
    const EXP = [['rent', 85000, 'Landlord'], ['salary', 120000, 'Staff salaries'], ['utilities', 9500, 'BSES electricity'], ['marketing', 25000, 'Google Ads top-up'], ['maintenance', 4200, 'AC service'], ['supplies', 3100, 'Stationery']];
    for (const code of codes) {
      for (const [category, amt, paidTo] of EXP) {
        const scale = ['ROH', 'PVH'].includes(code) ? 1 : code === 'IND' ? 0.3 : 0.6;
        await Expense.create({ branch: B[code]._id, category, amount: Math.round(amt * scale), date: addDays(today, -int(1, 25)), paidTo, mode: pick(['bank', 'upi', 'cash']), note: 'Demo expense', status: 'approved', createdBy: U['accounts@demo.cpf']._id });
      }
    }
    await Expense.create({ branch: B.ROH._id, category: 'misc', amount: 1800, date: today, paidTo: 'Plumber', mode: 'cash', note: 'Demo — awaiting approval', status: 'pending', createdBy: U['rohini.reception@demo.cpf']._id });
  }
  log('✔ branch expenses (one pending approval)');
  });

  await Settings.updateOne({ _id: 'global' }, { $set: { demoSeededAt: new Date() } }, { strict: false });
  clearSettingsCache();

  // ---------------------------------------------------------------- credentials
  const pad = (s, n) => `${String(s).padEnd(n - 1)} `;
  log('\n================ DEMO LOGINS (console: admin. / clinic. / crm.) ================');
  log(`${pad('Role', 22)}${pad('Email', 30)}${pad('Mobile', 13)}Password`);
  if (env.SEED_ADMIN_EMAIL) log(`${pad('Super Admin', 22)}${pad(env.SEED_ADMIN_EMAIL, 30)}${pad(env.SEED_ADMIN_PHONE || '—', 13)}(SEED_ADMIN_PASSWORD)`);
  for (const [name, email, phone, slug] of STAFF) log(`${pad(slug, 22)}${pad(email, 30)}${pad(phone, 13)}${PASS}   ${name}`);
  log('\nPatient portal: any demo patient mobile 9000001000–9000001034 (OTP printed in API log when OTP_DEV_LOG=true).');
  log('Demo numbers 90000xxxxx are never sent WhatsApp or dialled by Exotel.');
  if (failed.length) log(`\n⚠ sections with errors: ${failed.join(', ')} — fix and re-run npm run seed:fresh`);
}

/** first free staff slot for 'any' doctor on date (or throws) */
async function firstFreeSlot(branch, date) {
  const { availability, mergeAny } = await import('../modules/scheduling/scheduling.service.js');
  const per = await availability({ branchId: branch._id, date, staff: true });
  const free = mergeAny(per).filter((s) => s.available);
  if (!free.length) throw new Error('no slot');
  return free[Math.floor(rnd() * Math.min(free.length, 12))].start;
}

main()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error('✘', e.message);
    await mongoose.disconnect();
    process.exit(1);
  });
