/* GO-LIVE seed — only what the software needs to work. No demo patients, staff, bills, leads or campaigns.
 *
 *   npm run seed:live                       first deploy (and safe to re-run after every update)
 *   npm run seed:live -- --with-catalogue   + sample medicines & consumables list (prices to be edited)
 *   npm run seed:live -- --with-wards       + sample wards & beds per branch
 *   npm run seed:live -- --with-packages    + sample IPD packages (needs services)
 *   npm run seed:live -- --no-doctors       skip the 2 doctors from the website
 *   npm run seed:live -- --wipe --yes-wipe-everything   DROP the whole database first (e.g. after demo testing)
 *
 * Creates / refreshes:
 *   indexes · system roles & permissions · clinic profile, logo, theme · 5 real branches · lead stages
 *   product categories · service list (₹0 — set prices) · default doctors + weekly rota · super admin (from .env)
 *   optional modules (IPD / Exotel / Marketing) stay OFF until the Super Admin enables them.
 * Never changes data you already entered (fills empty fields only).
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDB } from '../config/db.js';
import '../models/index.js';
import { baseSeed } from './seed.js';
import { Settings, clearSettingsCache } from '../models/Settings.js';

const has = (f) => process.argv.includes(f);
const log = (...a) => console.log(...a);

async function main() {
  await connectDB();
  if (has('--wipe')) {
    if (!has('--yes-wipe-everything')) throw new Error('--wipe deletes EVERYTHING. Re-run with: --wipe --yes-wipe-everything');
    await mongoose.connection.dropDatabase();
    log('✔ database wiped');
  }
  const demo = await Settings.findById('global').select('demoSeededAt').lean();
  if (demo?.demoSeededAt && !has('--wipe')) {
    log('⚠ This database contains DEMO data (npm run seed was used). For a clean go-live run:');
    log('    npm run seed:live -- --wipe --yes-wipe-everything');
  }

  await baseSeed({
    log,
    catalogue: has('--with-catalogue'),
    wards: has('--with-wards'),
    packages: has('--with-packages'),
    rxTemplates: has('--with-catalogue'),
    doctors: !has('--no-doctors'),
  });

  // first run only: optional modules off, sane defaults
  const s = await Settings.findById('global').lean();
  const set = {};
  if (s?.features == null) Object.assign(set, { 'features.ipd': false, 'features.exotel': false, 'features.marketing': false });
  if (s?.loyalty == null) Object.assign(set, { 'loyalty.enabled': false });
  if (Object.keys(set).length) await Settings.updateOne({ _id: 'global' }, { $set: set });
  clearSettingsCache();

  log('\n================ GO-LIVE CHECKLIST ================');
  log('1. Login as super admin:', env.SEED_ADMIN_EMAIL || '(set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD in .env and re-run)');
  log('2. Settings → Clinic: logo, GSTIN, address · Settings → Integrations: WhatsApp, storage, SMTP');
  log('3. Products: set service prices · receive medicine stock');
  log('4. Doctors: photo, signature, fees, weekly schedule · Users: create staff per branch');
  log('5. Settings → Modules: switch on IPD / Exotel / Marketing if this clinic uses them');
  log('6. Settings → Loyalty, POS → Coupons (optional)');
}

main()
  .then(() => mongoose.disconnect())
  .catch(async (e) => {
    console.error('✖', e.message);
    await mongoose.disconnect();
    process.exit(1);
  });
