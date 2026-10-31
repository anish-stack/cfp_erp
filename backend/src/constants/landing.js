import { CLINIC, BRANCHES } from './clinic.js';

/** Ready-made CPF landing page (drag & drop builder template). Images are left empty — pick from Media library. */
let n = 0;
const id = (t) => `${t}-${(++n).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fmtHrs = (b) => `${b.settings.openTime} – ${b.settings.closeTime}`;

export function cpfLandingTemplate() {
  const wa = `https://wa.me/91${CLINIC.whatsapp}`;
  return [
    { id: id('header'), type: 'header', props: { logo: CLINIC.logoUrl, title: CLINIC.name, phone: CLINIC.phone, ctaText: 'Appointment', ctaLink: '#form', sticky: true } },
    { id: id('hero'), type: 'hero', props: { eyebrow: '', title: 'Expert Care for Piles & Fistula Treatment', subtitle: 'Providing Advanced, Compassionate Solutions for Lasting Relief', image: '', style: 'light', ctaText: 'Book Free Consultation', ctaLink: '#form', ctaText2: 'Call Now', ctaLink2: `tel:${CLINIC.phone}` } },
    { id: id('form'), type: 'form', props: { title: 'Book An Appointment', subtitle: '', layout: 'inline', bg: 'brand', buttonText: 'SUBMIT NOW' } },
    { id: id('gallery'), type: 'gallery', props: { eyebrow: 'Success Story', heading: 'Patient Success Story', columns: 3, items: [{ image: '', video: '', caption: 'Testimonial — Piles' }, { image: '', video: '', caption: 'Testimonial — Fistula' }, { image: '', video: '', caption: 'Testimonial — Fissure' }] } },
    { id: id('features'), type: 'features', props: { heading: 'We provide a wide range of medical services', subheading: '', columns: 3, items: [
      { icon: 'Award', title: 'Trusted Expertise', text: 'Over 22 years of experience in treating piles, fissures, and fistula.' },
      { icon: 'Zap', title: 'Advanced Laser Technology', text: 'Painless, stitchless laser treatment with minimal downtime.' },
      { icon: 'Leaf', title: 'Ayurvedic & Herbal Care', text: 'Customized herbal and Ayurvedic medicine for long-term relief.' },
      { icon: 'Clock', title: 'Same-Day Discharge', text: 'Walk in and walk out — quick recovery, same-day discharge.' },
      { icon: 'Wallet', title: 'Affordable Treatment Plans', text: 'Free consultation, EMI options, and transparent pricing for all.' },
      { icon: 'Car', title: 'Pickup & Drop Facility', text: 'Doorstep pickup & drop available for select patients in Delhi NCR.' },
      { icon: 'MapPin', title: 'Multi-location Clinics', text: 'Easily accessible piles clinics across Delhi NCR.' },
      { icon: 'HeartHandshake', title: 'Personalized Patient Care', text: 'Each case is handled with compassion and custom treatment plans.' },
    ] } },
    { id: id('text'), type: 'text', props: { heading: 'Laser + Ayurvedic Surgery = Complete Relief', body: 'We offer a unique blend of modern laser techniques and ancient Ayurvedic therapy to treat piles, fissures, fistulas, and pilonidal sinus — ensuring long-term results without complications. Also available: Ayurvedic procedures like Kshar Sutra and Kshar Karma for non-surgical healing. Mediclaim, cash not required at select hospitals — insurance-friendly care made easy.', align: 'left', bg: 'white' } },
    { id: id('list'), type: 'list', props: { heading: 'Conditions We Treat', intro: 'Each treatment plan is tailored by our expert piles doctors in Delhi, based on your condition’s severity and medical history.', bg: 'tint', items: [
      { title: 'Piles (Hemorrhoids)', text: 'Treated using advanced Laser Surgery, Ayurvedic Kshar Karma, and Infrared Coagulation (IRC) depending on the stage and severity.' },
      { title: 'Fistula-in-Ano', text: 'Managed effectively with Laser Fistula Surgery and the time-tested Ayurvedic Kshar Sutra Therapy, offering high success rates with minimal recurrence.' },
      { title: 'Anal Fissure', text: 'A combination of Ayurvedic herbal care and Laser Sphincterotomy to reduce pain, promote healing, and restore normal bowel movements.' },
      { title: 'Pilonidal Sinus', text: 'A painful and recurring skin infection near the tailbone, treated through scarless laser surgery for smooth recovery.' },
    ] } },
    { id: id('imageText'), type: 'imageText', props: { heading: 'Our Treatments', intro: 'All treatments are conducted by highly experienced piles specialists in our fully equipped, state-of-the-art clinics.', image: '', imageSide: 'right', items: [
      { title: 'Laser Treatment for Piles', text: 'A modern, pain-free, stitchless solution with quick recovery and minimal downtime.' },
      { title: 'Kshar Sutra Therapy', text: 'An ancient Ayurvedic technique that uses medicated threads for effective and natural fistula healing.' },
      { title: 'Infrared Coagulation (IRC)', text: 'A non-invasive and quick procedure ideal for early-stage piles, offering relief without surgery.' },
      { title: 'Kshara Karma & Herbal Medicines', text: 'Ayurvedic alkaline application therapy combined with herbal formulations for deep-rooted healing.' },
    ] } },
    { id: id('cta'), type: 'cta', props: { eyebrow: 'Book Appointment', heading: 'Get a call in 30 mins, and visit our Delhi clinic or opt for a video consult.', text: '', bgColor: '#4f46e5', buttons: [{ label: 'Get Appointment', link: '#form', style: 'light' }, { label: 'WhatsApp Us', link: wa, style: 'outline' }] } },
    { id: id('footer'), type: 'footer', props: { logo: CLINIC.logoUrl, about: `${CLINIC.name} is the most trusted piles clinic in Delhi, offering advanced care by the best doctors for piles. With a focus on painless recovery and lasting relief.`, phone: CLINIC.phone, email: CLINIC.email, addresses: BRANCHES.map((b) => ({ title: `${b.name} Clinic`, text: `${fmtHrs(b)} | ${[b.address.line1, b.address.city].filter(Boolean).join(', ')}` })), copyright: `© ${new Date().getFullYear()} ${CLINIC.name}. All rights reserved.` } },
  ];
}

export const DEFAULT_DESIGN = { primary: '#e21f26', accent: '#d4a017', dark: '#0f172a', tint: '#fff1f1', cta: '#14b8a6', font: 'Inter', showHeader: true };

export const AI_ICONS = ['Award', 'Zap', 'Leaf', 'Clock', 'Wallet', 'Car', 'MapPin', 'HeartHandshake', 'Stethoscope', 'Star', 'Phone', 'CheckCircle2', 'Users', 'ShieldCheck', 'Syringe', 'Pill', 'Activity', 'ThumbsUp', 'Sparkles', 'Hospital', 'CalendarCheck2', 'BadgePercent', 'Ambulance'];

const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const arr = (v, n, map) => (Array.isArray(v) ? v.slice(0, n).map(map).filter(Boolean) : []);
const tt = (x) => (str(x?.title, 120) ? { title: str(x.title, 120), text: str(x.text, 400) } : null);

/** AI content spec → full page blocks (header/footer/contact data always from clinic constants) */
export function buildLandingFromAi(ai) {
  const base = cpfLandingTemplate();
  const by = Object.fromEntries(base.map((b) => [b.type, b]));
  const out = [by.header];
  out.push({ ...by.hero, props: { ...by.hero.props, eyebrow: str(ai.hero?.eyebrow, 60), title: str(ai.hero?.title, 140) || by.hero.props.title, subtitle: str(ai.hero?.subtitle, 240) || by.hero.props.subtitle, ctaText: str(ai.hero?.ctaText, 40) || 'Book Free Consultation' } });
  out.push({ ...by.form, props: { ...by.form.props, title: str(ai.formTitle, 80) || by.form.props.title, buttonText: str(ai.formButton, 30) || by.form.props.buttonText } });
  const stats = arr(ai.stats, 4, (s) => (str(s?.value, 20) && str(s?.label, 60) ? { value: str(s.value, 20), label: str(s.label, 60) } : null));
  if (stats.length >= 2) out.push({ id: `stats-${Math.random().toString(36).slice(2, 7)}`, type: 'stats', props: { bg: 'brand', items: stats } });
  const features = arr(ai.features, 9, (f) => (str(f?.title, 80) ? { icon: AI_ICONS.includes(f.icon) ? f.icon : 'CheckCircle2', title: str(f.title, 80), text: str(f.text, 220) } : null));
  out.push({ ...by.features, props: { ...by.features.props, heading: str(ai.featuresHeading, 120) || by.features.props.heading, items: features.length ? features : by.features.props.items } });
  out.push({ ...by.gallery, props: { ...by.gallery.props, heading: str(ai.galleryHeading, 80) || by.gallery.props.heading } });
  if (str(ai.about?.heading) || str(ai.about?.body)) out.push({ ...by.text, props: { ...by.text.props, heading: str(ai.about?.heading, 140), body: str(ai.about?.body, 1500) } });
  const conditions = arr(ai.conditions, 6, tt);
  out.push({ ...by.list, props: { ...by.list.props, heading: str(ai.conditionsHeading, 100) || by.list.props.heading, intro: str(ai.conditionsIntro, 300), items: conditions.length ? conditions : by.list.props.items } });
  const treatments = arr(ai.treatments, 6, tt);
  out.push({ ...by.imageText, props: { ...by.imageText.props, heading: str(ai.treatmentsHeading, 100) || by.imageText.props.heading, intro: str(ai.treatmentsIntro, 300), items: treatments.length ? treatments : by.imageText.props.items } });
  const faq = arr(ai.faq, 8, (f) => (str(f?.q, 200) && str(f?.a, 800) ? { q: str(f.q, 200), a: str(f.a, 800) } : null));
  if (faq.length) out.push({ id: `faq-${Math.random().toString(36).slice(2, 7)}`, type: 'faq', props: { heading: 'Frequently asked questions', bg: 'tint', items: faq } });
  out.push({ ...by.cta, props: { ...by.cta.props, heading: str(ai.ctaHeading, 160) || by.cta.props.heading, text: str(ai.ctaText, 200), bgColor: DEFAULT_DESIGN.primary } });
  out.push(by.footer);
  return out;
}
