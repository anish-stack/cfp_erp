/**
 * Real clinic details, taken from https://centreforpilesandfistula.com (Oct 2026).
 * Base seed only FILLS EMPTY fields with these — anything edited in the console is never overwritten.
 * Weekly doctor rota is not published, so base seed creates doctors without schedules (demo seed adds a sample rota).
 */
export const CLINIC = {
  name: 'Centre For Piles & Fistula',
  tagline: 'Ayurvedic Kshar Sutra & Laser care for Piles, Fistula, Fissure & Pilonidal Sinus',
  website: 'https://centreforpilesandfistula.com',
  phone: '9212395788',
  whatsapp: '8826312357',
  email: 'centreforpiles@gmail.com',
  address: 'A-8 Shubham Enclave, Opp. Radisson Blu Hotel, Outer Ring Road, Paschim Vihar, Delhi 110063',
  logoUrl: 'https://centreforpilesandfistula.com/public/assets/ban/logo.jpg',
};

// weeklyOff: 0=Sun … 6=Sat
export const BRANCHES = [
  {
    code: 'PVH', name: 'Paschim Vihar', phone: '9212395788', whatsapp: '8826312357', email: 'centreforpiles@gmail.com',
    address: { line1: 'A-8 Shubham Enclave, Opp. Radisson Blu Hotel, Outer Ring Road', line2: 'Near Western Blue Hotel', city: 'Paschim Vihar, Delhi', state: 'Delhi', pincode: '110063' },
    settings: { openTime: '11:00', closeTime: '20:00', weeklyOff: [], breaks: [] },
  },
  {
    code: 'ROH', name: 'Rohini', phone: '9870365644', whatsapp: '8826312357', email: 'centreforpiles@gmail.com',
    address: { line1: 'A1/30, 1st Floor, Sector-15', line2: 'Near Junior Sachdeva Public School, near Rohini West Metro Station', city: 'Rohini, Delhi', state: 'Delhi' },
    settings: { openTime: '10:00', closeTime: '20:00', weeklyOff: [], breaks: [] },
  },
  {
    code: 'IND', name: 'Indirapuram', phone: '9910881571', whatsapp: '8826312357', email: 'centreforpiles@gmail.com',
    address: { line1: 'A-203, Rajhans Plaza', line2: 'Opp. Aditya Mall', city: 'Indirapuram, Ghaziabad', state: 'Uttar Pradesh', pincode: '201014' },
    // open Mon, Wed, Sat evenings only
    settings: { openTime: '19:00', closeTime: '20:30', weeklyOff: [0, 2, 4, 5], breaks: [] },
  },
  {
    code: 'TLN', name: 'Tilak Nagar', phone: '7042452308', whatsapp: '8826312357', email: 'centreforpiles@gmail.com',
    address: { line1: 'B-14, First Floor, WZ-6/7', line2: 'Ganesh Nagar', city: 'Tilak Nagar, Delhi', state: 'Delhi', pincode: '110018' },
    settings: { openTime: '08:00', closeTime: '20:00', weeklyOff: [], breaks: [] },
  },
  {
    code: 'DWK', name: 'Dwarka', phone: '7303909004', whatsapp: '8826312357', email: 'centreforpiles@gmail.com',
    address: { line1: 'D-418, Ground Floor, Sector-7', line2: 'Harijan Basti, Palam', city: 'Dwarka, Delhi', state: 'Delhi', pincode: '110077' },
    settings: { openTime: '08:00', closeTime: '20:00', weeklyOff: [], breaks: [] },
  },
];

export const DOCTORS = [
  {
    name: 'Dr. Rakesh Gupta',
    qualification: 'B.A.M.S. (Delhi Univ.), NDDY',
    specialization: 'Sr. Ayurvedic Physician & Surgeon — Anorectal & GI disorders',
    bio: 'Senior Ayurvedic physician and surgeon specialising in anorectal and gastrointestinal disorders — Kshar Sutra and laser treatment for piles, fistula, fissure and pilonidal sinus.',
  },
  {
    name: 'Dr. Ruchi Gupta',
    qualification: 'B.A.M.S. (Delhi Univ.), NDDY',
    specialization: 'Sr. Ayurvedic Physician & Surgeon — Anorectal & GI disorders',
    bio: 'Former House Surgeon, A&U Tibbia Medical College & Hospital. Senior Ayurvedic physician and surgeon specialising in anorectal and gastrointestinal disorders.',
  },
];

/** Billable services (site advertises free consultation → ₹0; procedure prices set by admin) */
export const SERVICES = [
  { sku: 'SRV-CONSULT', name: 'Consultation', serviceKind: 'consultation', sellPrice: 0 },
  { sku: 'SRV-FOLLOWUP', name: 'Follow-up Consultation', serviceKind: 'consultation', sellPrice: 0 },
  { sku: 'SRV-KSHAR', name: 'Kshar Sutra Therapy', serviceKind: 'procedure', sellPrice: 0 },
  { sku: 'SRV-LASER-PILES', name: 'Laser Treatment — Piles', serviceKind: 'procedure', sellPrice: 0 },
  { sku: 'SRV-LASER-FIST', name: 'Laser Treatment — Fistula', serviceKind: 'procedure', sellPrice: 0 },
  { sku: 'SRV-LASER-FISS', name: 'Laser Treatment — Fissure', serviceKind: 'procedure', sellPrice: 0 },
  { sku: 'SRV-PNS', name: 'Pilonidal Sinus Treatment', serviceKind: 'procedure', sellPrice: 0 },
  { sku: 'SRV-IRC', name: 'IRC (Infrared Coagulation) — Piles Gr. 1-2', serviceKind: 'procedure', sellPrice: 0 },
  { sku: 'SRV-DRESSING', name: 'Dressing / Kshar Sutra Change', serviceKind: 'treatment', sellPrice: 0 },
  { sku: 'SRV-PROCEDURE', name: 'Procedure Charges', serviceKind: 'procedure', sellPrice: 0 },
];

export const IVR_MENU = [
  { digit: '1', label: 'Rohini', code: 'ROH' },
  { digit: '2', label: 'Paschim Vihar', code: 'PVH' },
  { digit: '3', label: 'Indirapuram', code: 'IND' },
  { digit: '4', label: 'Tilak Nagar', code: 'TLN' },
  { digit: '5', label: 'Dwarka', code: 'DWK' },
];

/**
 * Starter pharmacy catalogue used across piles / fistula / fissure / pilonidal care.
 * Prices are indicative MRPs — edit in Console → Products. Base seed creates products only (no stock).
 * [sku, name, generic/composition, category, type, unit, gst%, mrp, cost, reorderLevel, rxRequired]
 */
export const MEDICINES = [
  // Ayurvedic — piles / bleeding / constipation
  ['MED-ARSH', 'Arshoghni Vati (60 tab)', 'Ayurvedic polyherbal', 'Ayurvedic Medicines', 'medicine', 'bottle', 12, 180, 110, 15, false],
  ['MED-KANK', 'Kankayan Vati (60 tab)', 'Ayurvedic polyherbal', 'Ayurvedic Medicines', 'medicine', 'bottle', 12, 190, 115, 15, false],
  ['MED-ABHA', 'Abhayarishta 450 ml', 'Ayurvedic arishta', 'Ayurvedic Medicines', 'medicine', 'bottle', 12, 220, 140, 10, false],
  ['MED-TRIP', 'Triphala Churna 100 g', 'Amalaki, Bibhitaki, Haritaki', 'Laxatives & Fibre', 'medicine', 'pack', 12, 120, 70, 20, false],
  ['MED-TRGU', 'Triphala Guggulu (60 tab)', 'Triphala + Guggulu', 'Ayurvedic Medicines', 'medicine', 'bottle', 12, 210, 125, 10, false],
  ['MED-HARI', 'Haritaki Tablets (60 tab)', 'Terminalia chebula', 'Ayurvedic Medicines', 'medicine', 'bottle', 12, 150, 90, 10, false],
  ['MED-NAGK', 'Nagkesar Churna 50 g', 'Mesua ferrea (bleeding piles)', 'Ayurvedic Medicines', 'medicine', 'pack', 12, 140, 80, 10, false],
  ['MED-BOLP', 'Bol Parpati (10 g)', 'Ayurvedic haemostatic', 'Ayurvedic Medicines', 'medicine', 'pack', 12, 160, 95, 8, false],
  ['MED-AROG', 'Arogyavardhini Vati (40 tab)', 'Ayurvedic', 'Ayurvedic Medicines', 'medicine', 'bottle', 12, 170, 100, 8, false],
  ['MED-KAIS', 'Kaishore Guggulu (60 tab)', 'Ayurvedic (wound healing, fistula)', 'Ayurvedic Medicines', 'medicine', 'bottle', 12, 200, 120, 10, false],
  ['MED-GAND', 'Gandhak Rasayan (40 tab)', 'Ayurvedic (infection / pus)', 'Ayurvedic Medicines', 'medicine', 'bottle', 12, 180, 105, 8, false],
  ['MED-AVIP', 'Avipattikar Churna 100 g', 'Ayurvedic (acidity)', 'Ayurvedic Medicines', 'medicine', 'pack', 12, 130, 75, 8, false],
  ['MED-PILX', 'Pilex Tablets (60 tab)', 'Himalaya polyherbal', 'Ayurvedic Medicines', 'medicine', 'strip', 12, 165, 100, 15, false],
  ['MED-ISAB', 'Isabgol Husk 100 g', 'Psyllium husk', 'Laxatives & Fibre', 'medicine', 'pack', 5, 95, 55, 20, false],
  ['MED-LACT', 'Lactulose Syrup 200 ml', 'Lactulose 10 g/15 ml', 'Laxatives & Fibre', 'medicine', 'bottle', 12, 240, 150, 10, true],
  ['MED-CREM', 'Cremaffin Plus Syrup 225 ml', 'Liquid paraffin + milk of magnesia + sodium picosulfate', 'Laxatives & Fibre', 'medicine', 'bottle', 12, 260, 165, 10, false],
  // local applications / sitz bath
  ['MED-JATY', 'Jatyadi Taila 100 ml', 'Ayurvedic wound oil', 'Ointments & Creams', 'medicine', 'bottle', 12, 210, 130, 10, false],
  ['MED-KASI', 'Kasisadi Taila 50 ml', 'Ayurvedic (piles mass)', 'Ointments & Creams', 'medicine', 'bottle', 12, 160, 95, 10, false],
  ['MED-PANC', 'Panchavalkal Kwath Churna 100 g', 'Ayurvedic sitz bath decoction', 'Ointments & Creams', 'medicine', 'pack', 12, 140, 80, 10, false],
  ['MED-SITZ', 'Sitz Bath Powder 100 g', 'Potassium permanganate free herbal', 'Ointments & Creams', 'medicine', 'pack', 12, 150, 80, 15, false],
  ['MED-PXOI', 'Pilex Ointment 30 g', 'Himalaya polyherbal', 'Ointments & Creams', 'medicine', 'tube', 12, 135, 80, 15, false],
  ['MED-LIDO', 'Lidocaine 2% Gel 30 g', 'Lignocaine hydrochloride 2%', 'Ointments & Creams', 'medicine', 'tube', 12, 85, 45, 15, true],
  ['MED-ANOV', 'Anovate Cream 20 g', 'Beclomethasone + phenylephrine + lidocaine', 'Ointments & Creams', 'medicine', 'tube', 12, 165, 100, 10, true],
  ['MED-DILT', 'Diltiazem 2% Cream 30 g', 'Diltiazem hydrochloride 2% (fissure)', 'Ointments & Creams', 'medicine', 'tube', 12, 220, 135, 10, true],
  ['MED-SOFR', 'Soframycin Skin Cream 30 g', 'Framycetin sulphate 1%', 'Ointments & Creams', 'medicine', 'tube', 12, 95, 55, 10, false],
  // allopathic adjuncts
  ['MED-DAFL', 'Daflon 500 (15 tab)', 'Diosmin 450 mg + Hesperidin 50 mg', 'Allopathic', 'medicine', 'strip', 12, 395, 260, 10, true],
  ['MED-PARA', 'Paracetamol 650 (15 tab)', 'Paracetamol 650 mg', 'Allopathic', 'medicine', 'strip', 12, 35, 18, 20, false],
  ['MED-DICL', 'Diclofenac 50 (10 tab)', 'Diclofenac sodium 50 mg', 'Allopathic', 'medicine', 'strip', 12, 30, 15, 15, true],
  ['MED-METR', 'Metronidazole 400 (15 tab)', 'Metronidazole 400 mg', 'Allopathic', 'medicine', 'strip', 12, 28, 14, 15, true],
  ['MED-AUGM', 'Amoxicillin + Clavulanate 625 (10 tab)', 'Amoxicillin 500 mg + clavulanic acid 125 mg', 'Allopathic', 'medicine', 'strip', 12, 210, 130, 10, true],
  ['MED-PANT', 'Pantoprazole 40 (15 tab)', 'Pantoprazole 40 mg', 'Allopathic', 'medicine', 'strip', 12, 110, 60, 15, true],
  // procedure consumables
  ['CON-KSHT', 'Kshar Sutra Thread (pack)', 'Medicated seton thread', 'Consumables', 'consumable', 'pack', 12, 600, 320, 5, false],
  ['CON-GAUZ', 'Sterile Gauze Pad (pack of 10)', 'Cotton gauze', 'Consumables', 'consumable', 'pack', 5, 60, 30, 30, false],
  ['CON-GLOV', 'Surgical Gloves (pair)', 'Latex sterile', 'Consumables', 'consumable', 'pair', 12, 25, 12, 50, false],
  ['CON-BAND', 'Bandage Roll 10 cm', 'Cotton crepe', 'Consumables', 'consumable', 'roll', 12, 45, 22, 20, false],
  ['CON-BETA', 'Povidone Iodine 5% Solution 100 ml', 'Povidone iodine', 'Consumables', 'consumable', 'bottle', 12, 95, 55, 10, false],
  ['CON-H2O2', 'Hydrogen Peroxide 6% 100 ml', 'Hydrogen peroxide', 'Consumables', 'consumable', 'bottle', 12, 40, 20, 10, false],
  ['CON-PADS', 'Maternity / Dressing Pad (pack of 10)', 'Absorbent pad (post-procedure)', 'Consumables', 'consumable', 'pack', 12, 120, 70, 15, false],
];

/** Default weekly rota for the clinic's own doctors (no doctor in two places at once). weekday 0=Sun */
export const DEFAULT_ROTA = {
  'Dr. Rakesh Gupta': [
    [[1, 3, 5], 'PVH', [['11:00', '15:00']]], [[1, 3, 5], 'TLN', [['16:00', '20:00']]],
    [[2, 4, 6], 'ROH', [['10:00', '14:00']]], [[2, 4, 6], 'DWK', [['15:00', '20:00']]],
    [[0], 'PVH', [['11:00', '20:00']]],
  ],
  'Dr. Ruchi Gupta': [
    [[1, 3], 'ROH', [['10:00', '14:00']]], [[1, 3], 'DWK', [['15:00', '18:30']]], [[1, 3, 6], 'IND', [['19:00', '20:30']]],
    [[5], 'ROH', [['10:00', '14:00']]], [[5], 'DWK', [['15:00', '20:00']]],
    [[2, 4], 'PVH', [['11:00', '15:00']]], [[2, 4], 'TLN', [['16:00', '20:00']]],
    [[6], 'PVH', [['11:00', '15:00']]], [[6], 'TLN', [['15:30', '18:30']]],
    [[0], 'ROH', [['10:00', '20:00']]],
  ],
};

/** Prescription types (templates) */
export const RX_TEMPLATES = [
  {
    name: 'Piles Grade I–II — conservative', condition: 'Piles', diagnosis: 'Internal haemorrhoids Grade I–II', followUpDays: 15,
    items: [['MED-ARSH', '2 tab', '1-0-1', 'After food', '15 days'], ['MED-TRIP', '1 tsp', '0-0-1', 'Bedtime with warm water', '30 days'], ['MED-PXOI', 'Local application', '1-0-1', 'After sitz bath', '15 days'], ['MED-SITZ', '1 sachet in warm water', '1-0-1', '10 minutes', '15 days']],
    advice: 'Sitz bath twice daily · 3–4 L water · avoid straining & long sitting · no spicy / fried food', diet: 'High-fibre: fruits, salads, whole grains, buttermilk',
  },
  {
    name: 'Bleeding piles', condition: 'Piles', diagnosis: 'Bleeding internal haemorrhoids', followUpDays: 10,
    items: [['MED-NAGK', '1/2 tsp', '1-0-1', 'With water after food', '10 days'], ['MED-BOLP', '125 mg', '1-0-1', 'With honey', '10 days'], ['MED-DAFL', '1 tab', '1-0-1', 'After food', '10 days'], ['MED-ISAB', '2 tsp', '0-0-1', 'Bedtime with water', '30 days']],
    advice: 'Report if bleeding is heavy or with dizziness · sitz bath · avoid constipation', diet: 'High-fibre, plenty of water; avoid alcohol & spicy food',
  },
  {
    name: 'Fissure-in-ano — acute', condition: 'Fissure', diagnosis: 'Acute anal fissure', followUpDays: 14, investigations: '',
    items: [['MED-DILT', 'Local application', '1-0-1', 'Inside anal verge with finger', '6 weeks'], ['MED-LIDO', 'Local application', 'SOS', '10 min before stools', '14 days'], ['MED-CREM', '15 ml', '0-0-1', 'Bedtime', '14 days'], ['MED-SITZ', '1 sachet in warm water', '1-0-1', '10 minutes', '14 days']],
    advice: 'Warm sitz bath after every stool · do not strain · keep stools soft', diet: 'High-fibre, 3–4 L water, papaya, avoid maida & spicy food',
  },
  {
    name: 'Fistula-in-ano — pre Kshar Sutra', condition: 'Fistula', diagnosis: 'Fistula-in-ano', followUpDays: 7, investigations: 'CBC, Blood sugar (F/PP), HIV, HBsAg, HCV · MRI fistulogram (if complex)',
    items: [['MED-KAIS', '2 tab', '1-0-1', 'After food', '15 days'], ['MED-GAND', '1 tab', '1-0-1', 'After food', '15 days'], ['MED-TRGU', '2 tab', '1-0-1', 'After food', '15 days'], ['MED-PANC', '2 tsp boiled in water', '1-0-1', 'Sitz bath', '15 days']],
    advice: 'Keep area clean & dry · sitz bath twice daily · bring reports on next visit', diet: 'Light diet, avoid oily / spicy food',
  },
  {
    name: 'Kshar Sutra — post-procedure', condition: 'Fistula', diagnosis: 'Fistula-in-ano — Kshar Sutra applied', followUpDays: 7,
    items: [['MED-PARA', '1 tab', 'SOS', 'For pain', '5 days'], ['MED-METR', '1 tab', '1-1-1', 'After food', '5 days'], ['MED-JATY', 'Local application', '1-0-1', 'After sitz bath', '15 days'], ['MED-PANC', '2 tsp boiled in water', '1-0-1', 'Sitz bath', '15 days'], ['CON-PADS', '1 pad', 'As needed', '', '7 days']],
    advice: 'Weekly thread change at clinic · sitz bath twice daily · do not pull the thread · normal activities allowed', diet: 'Normal light diet, plenty of fluids',
  },
  {
    name: 'Pilonidal sinus', condition: 'Pilonidal sinus', diagnosis: 'Pilonidal sinus', followUpDays: 7, investigations: 'CBC, Blood sugar',
    items: [['MED-AUGM', '1 tab', '1-0-1', 'After food', '5 days'], ['MED-KAIS', '2 tab', '1-0-1', 'After food', '15 days'], ['MED-JATY', 'Local application', '1-0-1', 'On wound', '15 days']],
    advice: 'Keep natal cleft clean & hair-free · avoid long sitting · wear loose cotton clothes', diet: 'Normal diet',
  },
  {
    name: 'Laser procedure — post-op', condition: 'Post-op', diagnosis: 'Post laser haemorrhoidoplasty / fissurectomy', followUpDays: 7,
    items: [['MED-DICL', '1 tab', '1-0-1', 'After food', '3 days'], ['MED-PANT', '1 tab', '1-0-0', 'Before breakfast', '5 days'], ['MED-AUGM', '1 tab', '1-0-1', 'After food', '5 days'], ['MED-LACT', '15 ml', '0-0-1', 'Bedtime', '15 days'], ['MED-SITZ', '1 sachet in warm water', '1-1-1', '10 minutes', '15 days']],
    advice: 'Mild bleeding/discharge for a few days is normal · contact clinic if heavy bleeding, fever or urine retention', diet: 'Liquid/soft diet for 2 days, then high-fibre',
  },
  {
    name: 'Chronic constipation', condition: 'Constipation', diagnosis: 'Chronic functional constipation', followUpDays: 30,
    items: [['MED-ABHA', '20 ml with equal water', '0-0-1', 'After dinner', '30 days'], ['MED-ISAB', '2 tsp', '0-0-1', 'Bedtime', '30 days'], ['MED-HARI', '1 tab', '0-0-1', 'Bedtime', '30 days']],
    advice: 'Fixed toilet time · daily 30 min walk · 3–4 L water', diet: 'High-fibre, avoid maida, tea/coffee in excess',
  },
];
