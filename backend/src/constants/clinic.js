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
