import QRCode from 'qrcode';
import { esc, printHtml } from '@/lib/printHtml';

const d = (x) => (x ? new Date(x).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

/**
 * Credit-card size attendant / visitor passes (85.6 × 54 mm), several per A4 with cut marks.
 * passes: [{ name, relation, phone }]
 */
export async function printAttendantPass({ admission: a, passes, validTill, clinic = {}, logo, visitingHours, rules, color = '#e21f26' }) {
  const p = a.patient || {};
  const cards = await Promise.all(passes.map(async (x, i) => {
    const code = `${a.admissionNo}-A${i + 1}`;
    const qr = await QRCode.toDataURL(`ATTENDANT PASS ${code} | ${p.name} | ${a.ward?.name || ''} ${a.bed?.number || ''} | ${x.name} (${x.relation || ''}) ${x.phone || ''}`, { margin: 0, width: 160 });
    return `<div class="card">
      <div class="band"><div class="cl">${logo ? `<img src="${esc(logo)}" alt="">` : ''}<span>${esc(clinic.name || '')}</span></div><b>ATTENDANT PASS</b></div>
      <div class="body">
        <div class="main">
          <div class="lbl">Patient</div><div class="big">${esc(p.name)}</div>
          <div class="row"><span>${esc(a.admissionNo)}</span><span class="bed">${esc(a.ward?.name || '')} · Bed ${esc(a.bed?.number || '')}</span></div>
          <div class="lbl" style="margin-top:1.4mm">Attendant</div>
          <div class="att">${esc(x.name || '________________')}${x.relation ? ` <small>(${esc(x.relation)})</small>` : ''}</div>
          ${x.phone ? `<div class="sm">📞 ${esc(x.phone)}</div>` : ''}
        </div>
        <div class="side"><img class="qr" src="${qr}" alt=""><div class="no">${esc(code)}</div></div>
      </div>
      <div class="foot"><span>Valid: ${d(a.admittedAt)} – ${validTill ? d(validTill) : 'discharge'}</span><span>${esc(visitingHours || '')}</span></div>
    </div>`;
  }));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Attendant pass — ${esc(a.admissionNo)}</title><style>
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; font: 9pt/1.25 Arial, Helvetica, sans-serif; color: #111; }
    .grid { display: grid; grid-template-columns: repeat(2, 85.6mm); gap: 8mm 10mm; justify-content: center; }
    .card { width: 85.6mm; height: 54mm; border: 0.3mm dashed #999; border-radius: 3mm; overflow: hidden; display: flex; flex-direction: column; page-break-inside: avoid; }
    .band { background: ${color}; color: #fff; padding: 1.6mm 3mm; display: flex; justify-content: space-between; align-items: center; font-size: 7.5pt; }
    .band b { font-size: 8.5pt; letter-spacing: .06em; } .cl { display: flex; align-items: center; gap: 1.5mm; font-weight: 700; max-width: 52mm; overflow: hidden; white-space: nowrap; }
    .cl img { height: 5mm; background: #fff; border-radius: 1mm; padding: .3mm; }
    .body { flex: 1; display: flex; gap: 2mm; padding: 2mm 3mm 1mm; }
    .main { flex: 1; min-width: 0; } .side { width: 22mm; text-align: center; }
    .lbl { font-size: 6pt; text-transform: uppercase; color: #666; letter-spacing: .05em; }
    .big { font-size: 10.5pt; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row { display: flex; gap: 2mm; font-size: 7.5pt; color: #333; } .bed { font-weight: 700; color: ${color}; }
    .att { font-size: 10pt; font-weight: 700; } .att small { font-weight: 400; font-size: 7.5pt; color: #444; } .sm { font-size: 7.5pt; }
    .qr { width: 20mm; height: 20mm; } .no { font-size: 6pt; font-family: monospace; }
    .foot { display: flex; justify-content: space-between; gap: 2mm; background: #f3f4f6; padding: 1.2mm 3mm; font-size: 6.3pt; color: #333; }
    .rules { margin: 8mm auto 0; width: 181mm; font-size: 8pt; color: #444; border-top: 0.3mm solid #ddd; padding-top: 3mm; }
  </style></head><body><div class="grid">${cards.join('')}</div>
  ${rules ? `<div class="rules"><b>Rules:</b> ${esc(rules)}. Cut along the dashed lines.</div>` : ''}</body></html>`;
  printHtml(html);
}
