export const BED_TONE = {
  available: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  occupied: 'border-red-300 bg-red-50 text-red-800',
  reserved: 'border-sky-300 bg-sky-50 text-sky-800',
  cleaning: 'border-amber-300 bg-amber-50 text-amber-800',
  maintenance: 'border-slate-300 bg-slate-100 text-slate-500',
};
export const ADM_STATUS = { admitted: ['Admitted', 'danger'], discharge_initiated: ['Discharge pending', 'warning'], discharged: ['Discharged', 'success'], cancelled: ['Cancelled', 'secondary'] };
export const WARD_TYPES = { general: 'General ward', semi_private: 'Semi-private', private: 'Private room', deluxe: 'Deluxe / suite', icu: 'ICU / HDU', day_care: 'Day care', recovery: 'Recovery / post-op', emergency: 'Emergency' };
export const CHARGE_KINDS = { bed: 'Room rent', nursing: 'Nursing', procedure: 'Procedure', surgeon: 'Surgeon fee', anaesthesia: 'Anaesthesia', ot: 'OT charges', doctor_visit: 'Doctor visit', pharmacy: 'Pharmacy', consumable: 'Consumables', investigation: 'Investigations / lab', other: 'Other' };
export const PAYERS = { self: 'Self pay', insurance: 'Insurance / TPA', corporate: 'Corporate', government: 'Government scheme' };
export const daysSince = (d) => Math.max(0, Math.floor((Date.now() - new Date(d)) / 86_400_000));
export const stayLabel = (from, to) => {
  const h = Math.max(0, ((to ? new Date(to) : new Date()) - new Date(from)) / 3_600_000);
  return h < 24 ? `${Math.round(h)} h` : `${Math.floor(h / 24)} d ${Math.round(h % 24)} h`;
};
export const toLocalInput = (d) => { const x = new Date(d || Date.now()); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
export const DIETS = { normal: 'Normal', soft: 'Soft', liquid: 'Liquid', clear_liquid: 'Clear liquid', nbm: 'Nil by mouth (NBM)', high_fibre: 'High fibre', diabetic: 'Diabetic', low_salt: 'Low salt', custom: 'Custom' };
export const CLAIM_STATUS = {
  pre_auth_pending: ['Pre-auth pending', 'warning'], pre_auth_approved: ['Pre-auth approved', 'info'], pre_auth_rejected: ['Pre-auth rejected', 'danger'],
  ready_to_submit: ['Ready to submit', 'warning'], submitted: ['Submitted', 'info'], query: ['Query raised', 'danger'], approved: ['Approved', 'success'],
  settled: ['Settled', 'success'], rejected: ['Rejected', 'danger'], closed: ['Closed', 'secondary'],
};
export const FREQ_HOURS = { OD: 24, HS: 24, BD: 12, TDS: 8, QID: 6, '6 hourly': 6, '8 hourly': 8, '4 hourly': 4, '12 hourly': 12 };
export const LAB_TESTS = [['CBC', 350], ['Blood sugar (Random)', 150], ['Blood sugar (Fasting / PP)', 250], ['HbA1c', 500], ['KFT (Urea, Creatinine)', 600], ['LFT', 700], ['Serum electrolytes', 500], ['PT / INR', 450], ['BT / CT', 200], ['HIV I & II', 400], ['HBsAg', 350], ['HCV', 500], ['Urine routine', 200], ['ECG', 300], ['Chest X-ray', 500], ['USG abdomen', 1200], ['MRI fistulogram', 6500], ['Pus culture & sensitivity', 900], ['Biopsy / HPE', 1500]];
