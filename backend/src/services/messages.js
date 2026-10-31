/**
 * WhatsApp message bodies (plain text, WhatsApp *bold* markup). Pure functions → unit-testable.
 * ctx = { clinic: { name }, bookingUrl }
 */
const fmtDate = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtTime = (hhmm = '') => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const first = (name = '') => name.trim().split(/\s+/)[0] || 'there';
const lines = (...a) => a.filter((x) => x !== null && x !== undefined && x !== false && x !== '').join('\n');
const sign = (ctx) => `— ${ctx.clinic?.name || 'Centre for Piles & Fistula'}`;
const branchLine = (b) => (b ? `📍 ${b.name}${b.address?.line1 ? `, ${b.address.line1}` : ''}${b.address?.city ? `, ${b.address.city}` : ''}` : null);
const callLine = (b) => (b?.phone ? `📞 ${b.phone}` : null);
const mapLine = (b) => (b?.address?.mapUrl ? `🗺️ ${b.address.mapUrl}` : null);

export const M = {
  otp: ({ otp, minutes }, ctx) =>
    lines(`*${otp}* is your OTP to sign in to ${ctx.clinic?.name || 'Centre for Piles & Fistula'}.`, `Valid for ${minutes} minutes. Do not share it with anyone.`),

  welcome: ({ patient }, ctx) =>
    lines(
      `Hello ${first(patient.name)}, welcome to ${ctx.clinic?.name || 'Centre for Piles & Fistula'}.`,
      `Patient ID: *${patient.patientId}*${patient.relation && patient.relation !== 'self' ? ` (${patient.relation})` : ''}`,
      'Quote this ID at the reception for faster check-in.',
      ctx.bookingUrl && `Book / manage appointments: ${ctx.bookingUrl}`
    ),

  booked: ({ a }, ctx) =>
    lines(
      `✅ *Appointment confirmed*`,
      `Hello ${first(a.patient.name)}, your appointment is booked.`,
      '',
      `🆔 Booking: *${a.bookingId}*`,
      `📅 ${fmtDate(a.date)} · ${fmtTime(a.start)}`,
      `👨‍⚕️ ${a.doctor?.name || 'Doctor'}`,
      branchLine(a.branch),
      mapLine(a.branch),
      '',
      'Please arrive 10 minutes early and carry previous reports, if any.',
      ctx.bookingUrl && `Reschedule / cancel: ${ctx.bookingUrl}/appointments`,
      callLine(a.branch),
      sign(ctx)
    ),

  rescheduled: ({ a }, ctx) =>
    lines(
      `🔁 *Appointment rescheduled*`,
      `Hello ${first(a.patient.name)}, your new slot:`,
      `🆔 *${a.bookingId}*`,
      `📅 ${fmtDate(a.date)} · ${fmtTime(a.start)}`,
      `👨‍⚕️ ${a.doctor?.name || 'Doctor'}`,
      branchLine(a.branch),
      callLine(a.branch),
      sign(ctx)
    ),

  cancelled: ({ a }, ctx) =>
    lines(
      `❌ *Appointment cancelled*`,
      `Hello ${first(a.patient.name)}, appointment ${a.bookingId} on ${fmtDate(a.date)} at ${fmtTime(a.start)} has been cancelled${a.cancelReason ? ` (${a.cancelReason})` : ''}.`,
      ctx.bookingUrl && `Book a new slot anytime: ${ctx.bookingUrl}`,
      callLine(a.branch),
      sign(ctx)
    ),

  noShow: ({ a }, ctx) =>
    lines(
      `Hello ${first(a.patient.name)}, we missed you today at ${a.branch?.name || 'the clinic'} (${fmtTime(a.start)}).`,
      'Piles & fistula get worse when left untreated — please book a new slot at your convenience.',
      ctx.bookingUrl && `Book: ${ctx.bookingUrl}`,
      callLine(a.branch),
      sign(ctx)
    ),

  checkedIn: ({ a }, ctx) =>
    lines(
      `Hello ${first(a.patient.name)}, you are checked in at ${a.branch?.name || 'the clinic'}.`,
      a.tokenNo ? `🎫 Your token number: *${a.tokenNo}*` : null,
      `👨‍⚕️ ${a.doctor?.name || 'Doctor'}`,
      'Please wait in the reception, you will be called shortly.',
      sign(ctx)
    ),

  reminder: ({ a, label }, ctx) =>
    lines(
      `⏰ *Reminder: appointment ${label === '2h' ? 'in 2 hours' : 'tomorrow'}*`,
      `Hello ${first(a.patient.name)},`,
      `📅 ${fmtDate(a.date)} · ${fmtTime(a.start)}`,
      `👨‍⚕️ ${a.doctor?.name || 'Doctor'}`,
      branchLine(a.branch),
      mapLine(a.branch),
      `🆔 ${a.bookingId}`,
      ctx.bookingUrl && `Can't make it? Reschedule: ${ctx.bookingUrl}/appointments`,
      sign(ctx)
    ),

  prescription: ({ rx }, ctx) =>
    lines(
      `💊 *Prescription*`,
      `Hello ${first(rx.patient.name)}, here is your prescription from ${rx.doctor?.name || 'the doctor'} (${rx.rxNo}).`,
      rx.items?.length ? '' : null,
      ...(rx.items || []).slice(0, 15).map((i, n) => `${n + 1}. ${i.name}${[i.dose, i.frequency, i.timing, i.duration && `× ${i.duration}`].filter(Boolean).length ? ` — ${[i.dose, i.frequency, i.timing, i.duration && `× ${i.duration}`].filter(Boolean).join(', ')}` : ''}`),
      rx.advice ? `\nAdvice: ${rx.advice}` : null,
      rx.followUpDate ? `\n📅 Follow-up on *${fmtDate(rx.followUpDate)}*${ctx.bookingUrl ? ` — book: ${ctx.bookingUrl}` : ''}` : null,
      '',
      'PDF attached. Take medicines exactly as advised.',
      sign(ctx)
    ),

  invoice: ({ inv }, ctx) =>
    lines(
      `🧾 *Invoice ${inv.invoiceNo}*`,
      `Hello ${first(inv.patient?.name || inv.customer?.name)}, thank you for visiting ${inv.branch?.name || ctx.clinic?.name || 'us'}.`,
      `Amount: *${inr(inv.grandTotal)}*`,
      `Paid: ${inr(inv.paid)}${inv.balance > 0 ? ` · Balance due: *${inr(inv.balance)}*` : ' ✅'}`,
      'Invoice PDF attached.',
      sign(ctx)
    ),

  payment: ({ inv, payment }, ctx) =>
    lines(
      `✅ *Payment received*`,
      `${inr(payment.amount)} received via ${payment.mode === 'advance' ? 'advance balance' : String(payment.mode).toUpperCase()} against invoice ${inv.invoiceNo}.`,
      `Receipt: ${payment.receiptNo}`,
      inv.balance > 0 ? `Balance due: *${inr(inv.balance)}*` : 'Invoice fully paid. Thank you!',
      sign(ctx)
    ),

  refund: ({ inv, cn, refunded }, ctx) =>
    lines(
      `↩️ *Return processed*`,
      `Credit note ${cn.creditNoteNo} against invoice ${inv.invoiceNo}: ${inr(cn.amount)}.`,
      refunded > 0 ? `Refunded: *${inr(refunded)}* via ${String(cn.refundMode || 'cash').toUpperCase()}.` : null,
      sign(ctx)
    ),

  advance: ({ p, balance }, ctx) =>
    lines(
      p.kind === 'refund' ? `↩️ *Advance refunded*: ${inr(p.amount)} via ${String(p.mode).toUpperCase()}.` : `✅ *Advance received*: ${inr(p.amount)} via ${String(p.mode).toUpperCase()}.`,
      `Receipt: ${p.receiptNo}`,
      `Available advance balance: *${inr(balance)}*`,
      sign(ctx)
    ),

  followup: ({ f }, ctx) =>
    lines(
      `📅 *Follow-up due*`,
      `Hello ${first(f.patient.name)}, your follow-up visit at ${f.branch?.name || 'the clinic'} is due today${f.doctor?.name ? ` with ${f.doctor.name}` : ''}.`,
      f.reason ? `Reason: ${f.reason}` : null,
      ctx.bookingUrl && `Book your slot: ${ctx.bookingUrl}`,
      callLine(f.branch),
      sign(ctx)
    ),

  leadAutoReply: ({ lead }, ctx) =>
    lines(
      `Hello ${first(lead.name)}, thank you for contacting ${ctx.clinic?.name || 'Centre for Piles & Fistula'}.`,
      'Our care team will call you shortly.',
      ctx.bookingUrl && `Prefer to pick a time yourself? Book here: ${ctx.bookingUrl}`,
      '5 branches: Rohini · Paschim Vihar · Indirapuram · Tilak Nagar · Dwarka',
      sign(ctx)
    ),

  leadAssigned: ({ lead, user }) =>
    lines(
      `🎯 New lead assigned to you, ${first(user.name)}`,
      `*${lead.name}* · ${lead.phone}`,
      [lead.condition, lead.city, String(lead.source || '').replace(/_/g, ' ')].filter(Boolean).join(' · '),
      'Please call within 15 minutes.'
    ),

  stockAlert: ({ branch, low, expiring }) =>
    lines(
      `📦 *${branch.name} — stock alert*`,
      low.length ? `Low stock (${low.length}):` : null,
      ...low.slice(0, 10).map((x) => `• ${x.product.name}: ${x.qty} (reorder ${x.product.reorderLevel})`),
      low.length > 10 ? `…and ${low.length - 10} more` : null,
      expiring.length ? `\nExpiring soon (${expiring.length}):` : null,
      ...expiring.slice(0, 10).map((x) => `• ${x.product?.name} [${x.batchNo}] exp ${x.expiry} · qty ${x.qty}`),
      expiring.length > 10 ? `…and ${expiring.length - 10} more` : null
    ),
};
