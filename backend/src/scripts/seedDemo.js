/* Demo dataset for training / UAT.   npm run seed:demo  [-- --force]
 *  Runs the base seed first, then adds: demo staff for every role, a sample doctor rota, holidays/leave,
 *  suppliers + stock (FEFO batches incl. low / near-expiry), POs, 40 patients (with families),
 *  3 weeks of appointments, medical records, prescriptions, invoices & payments, follow-ups,
 *  campaigns, landing page, 45 leads with activities, tasks, targets, Exotel-style call log, expenses.
 *
 *  Safety: refuses on NODE_ENV=production or a DB that already has patients (unless --force).
 *  All demo phone numbers are in 9000000000–9000009999 — WhatsApp & Exotel never contact that range,
 *  and CPF_SILENT=1 stops any notification being queued while seeding.
 */
process.env.CPF_SILENT = '1';

const mongoose = (await import('mongoose')).default;
const { env } = await import('../config/env.js');
const { connectDB, withTransaction } = await import('../config/db.js');
const { baseSeed } = await import('./seed.js');
const { Role } = await import('../models/Role.js');
const { Branch } = await import('../models/Branch.js');
const { User } = await import('../models/User.js');
const { Doctor } = await import('../models/Doctor.js');
const { DoctorSchedule } = await import('../models/DoctorSchedule.js');
const { ScheduleException } = await import('../models/ScheduleException.js');
const { Patient } = await import('../models/Patient.js');
const { Appointment } = await import('../models/Appointment.js');
const { MedicalRecord, Prescription, FollowUp } = await import('../models/Clinical.js');
const { Product, Category, Supplier, PurchaseOrder, StockMovement } = await import('../models/Inventory.js');
const { Invoice, Payment } = await import('../models/Billing.js');
const { Lead, LeadStage, LeadActivity, Task, SalesTarget, Campaign, EnquiryForm, Call } = await import('../models/Crm.js');
const { Expense } = await import('../models/Misc.js');
const { Settings, clearSettingsCache } = await import('../models/Settings.js');
const { createPatient } = await import('../modules/patients/patients.service.js');
const { book, setStatus, walkin } = await import('../modules/appointments/appointments.service.js');
const { createInvoice, addPayment } = await import('../modules/billing/billing.service.js');
const stock = await import('../modules/inventory/stock.service.js');
const { nextBookingId, nextDocNo } = await import('../utils/counter.js');
const { todayIST, addDays, weekdayOf, istToDate } = await import('../utils/time.js');
const { generateSlots } = await import('../utils/slots.js');

const FORCE = process.argv.includes('--force');
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
  if ((await Patient.countDocuments()) > 0 && !FORCE) throw new Error('Database already has patients — demo seed is for an empty DB. Re-run with --force to add anyway.');

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
  const U = {};
  for (const [name, email, phone, slug, branches, designation] of STAFF) {
    let u = await User.findOne({ email });
    if (!u) {
      u = new User({ name, email, phone, role: role[slug], designation, allBranches: branches === 'ALL', branches: branches === 'ALL' ? [] : branches.map((c) => B[c]._id) });
      await u.setPassword(PASS);
      await u.save();
    }
    U[email] = u;
  }
  log(`✔ ${STAFF.length} demo staff (password ${PASS})`);

  // ---------------------------------------------------------------- doctors + rota
  const rakesh = await Doctor.findOne({ name: 'Dr. Rakesh Gupta' });
  const ruchi = await Doctor.findOne({ name: 'Dr. Ruchi Gupta' });
  rakesh.user = U['rakesh.gupta@demo.cpf']._id;
  ruchi.user = U['ruchi.gupta@demo.cpf']._id;
  rakesh.branches = [B.PVH._id, B.ROH._id];
  ruchi.branches = [B.PVH._id, B.ROH._id];
  await rakesh.save();
  await ruchi.save();
  await User.updateOne({ _id: rakesh.user }, { doctor: rakesh._id });
  await User.updateOne({ _id: ruchi.user }, { doctor: ruchi._id });
  const mkDoc = async (name, codes) => (await Doctor.findOne({ name })) || Doctor.create({ name, qualification: 'B.A.M.S.', specialization: 'Ayurvedic Anorectal Surgeon (demo profile)', branches: codes.map((c) => B[c]._id), consultationFee: 0, followUpFee: 0, acceptsOnlineBooking: true });
  const aman = await mkDoc('Dr. Aman Verma (Demo)', ['TLN', 'DWK']);
  const sana = await mkDoc('Dr. Sana Khan (Demo)', ['DWK', 'IND', 'TLN']);

  // sample rota — no doctor is in two places at once
  const ROTA = [
    [rakesh, 'PVH', [0, 1, 3, 5], [['11:00', '20:00']]],
    [rakesh, 'ROH', [2, 4, 6], [['10:00', '20:00']]],
    [ruchi, 'ROH', [0, 1, 3, 5], [['10:00', '20:00']]],
    [ruchi, 'PVH', [2, 4, 6], [['11:00', '20:00']]],
    [aman, 'TLN', [0, 1, 2, 3, 4, 5, 6], [['08:00', '14:00']]],
    [aman, 'DWK', [0, 1, 2, 3, 4, 5, 6], [['14:30', '20:00']]],
    [sana, 'DWK', [0, 1, 2, 3, 4, 5, 6], [['08:00', '14:00']]],
    [sana, 'TLN', [0, 2, 4, 5], [['14:30', '20:00']]],
    [sana, 'IND', [1, 3, 6], [['19:00', '20:30']]], // Indirapuram opens Mon/Wed/Sat evenings only
  ];
  for (const [doc, code, days, sessions] of ROTA) {
    for (const wd of days) {
      await DoctorSchedule.updateOne(
        { doctor: doc._id, branch: B[code]._id, weekday: wd },
        { $set: { sessions: sessions.map(([start, end]) => ({ start, end })), slotMinutes: 15, capacityPerSlot: 1, isActive: true } },
        { upsert: true }
      );
    }
  }
  await ScheduleException.updateOne({ type: 'holiday', branch: null, doctor: null, date: addDays(today, 9) }, { $setOnInsert: { reason: 'Holiday (demo)', status: 'approved' } }, { upsert: true });
  await ScheduleException.updateOne({ type: 'leave', doctor: aman._id, date: addDays(today, 4) }, { $setOnInsert: { branch: B.TLN._id, reason: 'Personal leave (demo)', status: 'approved' } }, { upsert: true });
  await ScheduleException.updateOne({ type: 'leave', doctor: sana._id, date: addDays(today, 12) }, { $setOnInsert: { branch: B.DWK._id, reason: 'Conference (demo, pending approval)', status: 'pending', createdBy: U['dwarka.reception@demo.cpf']._id } }, { upsert: true });
  log('✔ doctor rota for all 5 branches + holiday + leave');

  // ---------------------------------------------------------------- inventory
  const cats = Object.fromEntries((await Category.find().lean()).map((c) => [c.name, c._id]));
  const SVC_PRICES = { 'SRV-KSHAR': 18000, 'SRV-LASER-PILES': 35000, 'SRV-LASER-FIST': 40000, 'SRV-LASER-FISS': 30000, 'SRV-PNS': 35000, 'SRV-IRC': 6000, 'SRV-DRESSING': 500 };
  for (const [sku, price] of Object.entries(SVC_PRICES)) await Product.updateOne({ sku, sellPrice: 0 }, { $set: { sellPrice: price } });

  const PRODUCTS = [
    ['MED-ARSH', 'Arshoghni Vati (60 tab)', 'Ayurvedic Medicines', 'medicine', 'bottle', 12, 180, 110, 15],
    ['MED-KANK', 'Kankayan Vati (60 tab)', 'Ayurvedic Medicines', 'medicine', 'bottle', 12, 190, 115, 15],
    ['MED-TRIP', 'Triphala Churna 100 g', 'Laxatives & Fibre', 'medicine', 'pack', 12, 120, 70, 20],
    ['MED-HARI', 'Haritaki Tablets (60 tab)', 'Ayurvedic Medicines', 'medicine', 'bottle', 12, 150, 90, 10],
    ['MED-ABHA', 'Abhayarishta 450 ml', 'Ayurvedic Medicines', 'medicine', 'bottle', 12, 220, 140, 10],
    ['MED-ISAB', 'Isabgol Husk 100 g', 'Laxatives & Fibre', 'medicine', 'pack', 5, 95, 55, 20],
    ['MED-JATY', 'Jatyadi Taila 100 ml', 'Ointments & Creams', 'medicine', 'bottle', 12, 210, 130, 10],
    ['MED-KASI', 'Kasisadi Taila 50 ml', 'Ointments & Creams', 'medicine', 'bottle', 12, 160, 95, 10],
    ['MED-LIDO', 'Lidocaine 2% Gel 30 g', 'Ointments & Creams', 'medicine', 'tube', 12, 85, 45, 15],
    ['MED-SITZ', 'Sitz Bath Powder 100 g', 'Ointments & Creams', 'medicine', 'pack', 12, 150, 80, 15],
    ['CON-KSHT', 'Kshar Sutra Thread (pack)', 'Consumables', 'consumable', 'pack', 12, 600, 320, 5],
    ['CON-GAUZ', 'Sterile Gauze Pad (pack of 10)', 'Consumables', 'consumable', 'pack', 5, 60, 30, 30],
    ['CON-GLOV', 'Surgical Gloves (pair)', 'Consumables', 'consumable', 'pair', 12, 25, 12, 50],
  ];
  const P = {};
  for (const [sku, name, cat, type, unit, gst, mrp, cost, reorder] of PRODUCTS) {
    P[sku] = await Product.findOneAndUpdate({ sku }, { $setOnInsert: { sku, name, category: cats[cat], type, unit, gstRate: gst, mrp, sellPrice: mrp, purchasePrice: cost, reorderLevel: reorder, barcode: `89${String(PRODUCTS.findIndex((p) => p[0] === sku) + 1).padStart(11, '0')}` } }, { upsert: true, new: true });
  }
  const sup1 = (await Supplier.findOne({ name: 'Delhi Ayurveda Distributors (Demo)' })) || (await Supplier.create({ name: 'Delhi Ayurveda Distributors (Demo)', contactPerson: 'Mr. Bansal', phone: '9000000201', gstin: '07AAAAA0000A1Z5', paymentTermsDays: 30, address: 'Khari Baoli, Delhi' }));
  const sup2 = (await Supplier.findOne({ name: 'MediSurg Supplies (Demo)' })) || (await Supplier.create({ name: 'MediSurg Supplies (Demo)', contactPerson: 'Ms. Kaur', phone: '9000000202', paymentTermsDays: 15, address: 'Bhagirath Palace, Delhi' }));
  const admin = await User.findOne({ email: env.SEED_ADMIN_EMAIL?.toLowerCase() }) || U['rohini.admin@demo.cpf'];

  await withTransaction(async (session) => {
    for (const code of Object.keys(B)) {
      for (const [sku, , , type, , , mrp, cost] of PRODUCTS) {
        const big = ['ROH', 'PVH'].includes(code);
        let qty = big ? int(40, 90) : int(15, 40);
        if (sku === 'MED-KASI' && code === 'ROH') qty = 4; // low stock
        if (sku === 'CON-KSHT' && code === 'IND') qty = 2;
        await stock.receive({ branch: B[code]._id, product: P[sku]._id, batchNo: `${sku.slice(4)}${code}A`, expiry: addDays(today, int(240, 700)), qty, purchasePrice: cost, mrp, sellPrice: mrp, supplier: type === 'consumable' ? sup2._id : sup1._id, type: 'purchase', refType: 'GRN', refNo: 'OPENING-STOCK', by: admin._id }, session);
      }
      // near-expiry + expired batches for alert screens
      await stock.receive({ branch: B[code]._id, product: P['MED-TRIP']._id, batchNo: `TRIP${code}OLD`, expiry: addDays(today, 40), qty: 6, purchasePrice: 70, mrp: 120, sellPrice: 120, supplier: sup1._id, type: 'purchase', refNo: 'OPENING-STOCK', by: admin._id }, session);
      if (code === 'ROH') await stock.receive({ branch: B[code]._id, product: P['MED-ABHA']._id, batchNo: 'ABHAROHEXP', expiry: addDays(today, -10), qty: 3, purchasePrice: 140, mrp: 220, sellPrice: 220, supplier: sup1._id, type: 'purchase', refNo: 'OPENING-STOCK', by: admin._id }, session);
    }
  });
  if (!(await PurchaseOrder.exists({ notes: /demo/i }))) {
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
  const patients = [];
  for (let i = 0; i < NAMES.length; i++) {
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
  log(`✔ ${patients.length} patients (incl. family members on shared mobiles)`);

  // ---------------------------------------------------------------- past visits (raw history, 14 days)
  const schedules = await DoctorSchedule.find({ isActive: true }).lean();
  const COMPLAINTS = ['Bleeding during stools', 'Pain while passing stool', 'Swelling near anus', 'Discharge / pus near anal region', 'Itching and irritation', 'Hard stools, constipation', 'Painful lump at tailbone'];
  const DX = [
    ['Grade II internal haemorrhoids', 'SRV-IRC'], ['Grade III haemorrhoids', 'SRV-LASER-PILES'], ['Chronic anal fissure', 'SRV-LASER-FISS'],
    ['Low anal fistula (fistula-in-ano)', 'SRV-KSHAR'], ['Pilonidal sinus', 'SRV-PNS'], ['External thrombosed pile', null], ['Acute fissure', null],
  ];
  const MEDS = ['MED-ARSH', 'MED-KANK', 'MED-TRIP', 'MED-ISAB', 'MED-JATY', 'MED-LIDO', 'MED-SITZ', 'MED-HARI'];
  const RXDOSE = { 'MED-ARSH': ['2 tab', '1-0-1', 'After food', '15 days'], 'MED-KANK': ['2 tab', '1-0-1', 'After food', '15 days'], 'MED-TRIP': ['1 tsp', '0-0-1', 'With warm water at bedtime', '30 days'], 'MED-ISAB': ['2 tsp', '0-0-1', 'With milk/water at bedtime', '30 days'], 'MED-JATY': ['Local application', '1-0-1', 'After sitz bath', '15 days'], 'MED-LIDO': ['Local application', 'SOS', 'Before stools', '10 days'], 'MED-SITZ': ['1 sachet in warm water', '1-0-1', '10 minutes', '15 days'], 'MED-HARI': ['1 tab', '0-0-1', 'Bedtime', '15 days'] };
  const svc = Object.fromEntries((await Product.find({ type: 'service' }).lean()).map((p) => [p.sku, p]));
  const docUser = (d) => (String(d) === String(rakesh._id) ? rakesh.user : String(d) === String(ruchi._id) ? ruchi.user : U['rohini.admin@demo.cpf']._id);

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
          const rx = await Prescription.create({
            rxNo: await nextDocNo('RX', code), patient: patient._id, branch: branch._id, doctor: sch.doctor, appointment: a._id, record: rec._id, diagnosis: dx,
            items: meds.map((m) => { const [dose, frequency, timing, duration] = RXDOSE[m]; return { product: P[m]._id, name: P[m].name, dose, frequency, timing, duration }; }),
            advice: 'Sitz bath twice daily · high-fibre diet · 3-4 L water · avoid spicy food and long sitting', followUpDate: fu, createdBy: doctorUser,
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

  // ---------------------------------------------------------------- today & upcoming (real booking engine)
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

  // ---------------------------------------------------------------- CRM
  const stages = Object.fromEntries((await LeadStage.find().lean()).map((s) => [s.key, s]));
  const camp = async (name, channel, utmCampaign, budget, spend) => (await Campaign.findOne({ name })) || Campaign.create({ name, channel, utmCampaign, budget, spend, startDate: addDays(today, -30), status: 'active' });
  const C1 = await camp('Google Ads — Laser Piles Delhi', 'google_ads', 'laser_piles_delhi', 60000, 38500);
  const C2 = await camp('Facebook — Fistula Kshar Sutra', 'facebook_ads', 'fb_fistula_ksharsutra', 30000, 17200);
  const C3 = await camp('Instagram — Fissure Awareness', 'instagram', 'ig_fissure_awareness', 15000, 6400);
  if (!(await EnquiryForm.exists({ slug: 'laser-piles-treatment-delhi' }))) {
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
  const sales = [U['sales1@demo.cpf'], U['sales2@demo.cpf']];
  const LEADN = ['Aditya Rao', 'Bhavna Sethi', 'Chetan Arora', 'Divya Nair', 'Eshan Gill', 'Farhan Ali', 'Gunjan Mittal', 'Himanshu Goel', 'Isha Chawla', 'Jatin Bhalla', 'Kriti Anand', 'Lalit Sharma', 'Mansi Khurana', 'Nitin Dua', 'Ojas Taneja', 'Pallavi Batra', 'Qasim Raza', 'Rahul Nagpal', 'Sakshi Juneja', 'Tushar Wadhwa', 'Urmila Devi', 'Varun Oberoi', 'Waseem Akhtar', 'Yamini Bajaj', 'Zubin Talwar', 'Ankit Chopra', 'Bindu Rawal', 'Chirag Vohra', 'Dimple Narang', 'Ekta Luthra', 'Firoz Khan', 'Gagan Sachdeva', 'Hema Puri', 'Inder Jeet', 'Jasleen Kaur', 'Kunal Dhingra', 'Lovely Sharma', 'Mukesh Garg', 'Nidhi Chandna', 'Om Prakash', 'Preeti Uppal', 'Rajat Midha', 'Sneha Popli', 'Tanvi Aggarwal', 'Uday Kalra'];
  const STAGE_MIX = ['new', 'new', 'new', 'new', 'contacted', 'contacted', 'contacted', 'interested', 'interested', 'follow_up', 'follow_up', 'follow_up', 'appointment_scheduled', 'appointment_scheduled', 'visited', 'converted', 'converted', 'lost'];
  const LOST = ['Too expensive', 'Chose another hospital', 'Not reachable', 'Will decide later'];
  let leadsMade = 0;
  let callsMade = 0;
  for (let i = 0; i < LEADN.length; i++) {
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
  for (const u of sales) await SalesTarget.updateOne({ user: u._id, month }, { $setOnInsert: { leadsTarget: 80, appointmentsTarget: 40, conversionsTarget: 20, revenueTarget: 400000, setBy: U['sales.manager@demo.cpf']._id } }, { upsert: true });
  log(`✔ 3 campaigns, landing page /f/laser-piles-treatment-delhi, ${leadsMade} leads, ${callsMade} call records, tasks, monthly targets`);

  // ---------------------------------------------------------------- expenses
  if (!(await Expense.exists({ note: /demo/i }))) {
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

  await Settings.updateOne({ _id: 'global' }, { $set: { demoSeededAt: new Date() } }, { strict: false });
  clearSettingsCache();

  // ---------------------------------------------------------------- credentials
  const pad = (s, n) => String(s).padEnd(n);
  log('\n================ DEMO LOGINS (console: admin. / clinic. / crm.) ================');
  log(`${pad('Role', 22)}${pad('Email', 30)}${pad('Mobile', 13)}Password`);
  if (env.SEED_ADMIN_EMAIL) log(`${pad('Super Admin', 22)}${pad(env.SEED_ADMIN_EMAIL, 30)}${pad(env.SEED_ADMIN_PHONE || '—', 13)}(SEED_ADMIN_PASSWORD)`);
  for (const [name, email, phone, slug] of STAFF) log(`${pad(slug, 22)}${pad(email, 30)}${pad(phone, 13)}${PASS}   ${name}`);
  log('\nPatient portal: any demo patient mobile 9000001000–9000001034 (OTP printed in API log when OTP_DEV_LOG=true).');
  log('Demo numbers 90000xxxxx are never sent WhatsApp or dialled by Exotel.');
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
