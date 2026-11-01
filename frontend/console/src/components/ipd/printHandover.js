import { esc, printHtml } from '@/lib/printHtml';
import { DIETS, stayLabel } from './ipdUtils';
import { ageOf } from '@/lib/utils';

const dt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const tm = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '');

/** A4 landscape nursing handover sheet + diet list (separate page) */
export function printHandover(list, { clinic = 'Clinic', branch = '' } = {}) {
  const rows = [...list].sort((a, b) => String(a.bed?.number || '').localeCompare(String(b.bed?.number || ''), undefined, { numeric: true }));
  const now = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const patient = (a) => `<b>${esc(a.patient?.name)}</b><br><small>${esc([ageOf(a.patient) && `${ageOf(a.patient)}y`, a.patient?.gender?.[0]?.toUpperCase()].filter(Boolean).join('/'))} · ${esc(a.admissionNo || '')}</small>${a.allergies ? `<br><span class="red">Allergy: ${esc(a.allergies)}</span>` : ''}`;
  const meds = (a) => (a.meds?.length ? a.meds.map((m) => `<div class="${m.overdue ? 'red b' : m.due ? 'b' : ''}">${esc(m.name)} ${esc(m.dose || '')} ${esc(m.route || '')} <small>${esc(m.frequency || '')}${m.nextAt ? ` · ${m.overdue ? 'OVERDUE ' : 'next '}${tm(m.nextAt)}` : ''}</small></div>`).join('') : '<small>—</small>');
  const vit = (a) => (a.lastVitalsAt ? `${a.vitalsDue ? '<span class="red b">DUE</span><br>' : ''}BP ${esc(a.lastVitals?.bp || '—')} · P ${esc(a.lastVitals?.pulse ?? '—')} · T ${esc(a.lastVitals?.temp ?? '—')}${a.lastVitals?.spo2 ? ` · SpO₂ ${esc(a.lastVitals.spo2)}` : ''}<br><small>${dt(a.lastVitalsAt)}</small>` : '<span class="red b">Not recorded</span>');
  const plan = (a) => [
    a.status === 'discharge_initiated' && '<b>Discharge in progress</b>',
    a.nextProcedure && `${esc(a.nextProcedure.name)} ${a.nextProcedure.scheduledAt ? dt(a.nextProcedure.scheduledAt) : ''} · pre-op ${a.preOpPending ? `${a.preOpPending} pending` : '✓'}`,
    a.labsPending > 0 && `Lab pending: ${a.labsPending}`,
    a.expectedDischargeAt && `Exp. discharge ${dt(a.expectedDischargeAt)}`,
  ].filter(Boolean).join('<br>') || '—';

  const diets = {};
  rows.forEach((a) => { const k = a.diet?.type || 'not_set'; (diets[k] ||= []).push(a); });

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Nursing handover — ${esc(now)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font: 11px/1.35 Arial, Helvetica, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 16px; margin: 0; } h2 { font-size: 14px; margin: 0 0 6px; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 8px; }
  .muted { color: #555; } small { color: #444; font-size: 10px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 4px 5px; vertical-align: top; text-align: left; }
  th { background: #eee; font-size: 10px; text-transform: uppercase; letter-spacing: .02em; }
  thead { display: table-header-group; } tr { page-break-inside: avoid; }
  .red { color: #c00; } .b { font-weight: 700; }
  .notes { min-width: 120px; }
  .sign { display: flex; gap: 40px; margin-top: 18px; } .sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; }
  .page { page-break-before: always; }
  .stats { display: flex; gap: 14px; font-size: 11px; }
</style></head><body>
  <div class="head">
    <div><h1>${esc(clinic)} — Nursing handover</h1><div class="muted">${esc(branch)}</div></div>
    <div class="stats"><span>In-patients: <b>${rows.length}</b></span><span>Meds due: <b>${rows.reduce((s, a) => s + (a.medsDue || 0), 0)}</b></span><span>Vitals due: <b>${rows.filter((a) => a.vitalsDue).length}</b></span><span>Printed: ${esc(now)}</span></div>
  </div>
  <table>
    <thead><tr><th style="width:52px">Bed</th><th style="width:150px">Patient</th><th style="width:120px">Doctor / stay</th><th style="width:90px">Diet</th><th>Medicines</th><th style="width:150px">Last vitals</th><th style="width:70px">I/O 24h (ml)</th><th style="width:150px">Plan / pending</th><th class="notes">Handover notes</th></tr></thead>
    <tbody>${rows.map((a) => `<tr>
      <td class="b">${esc(a.bed?.number || '—')}<br><small>${esc(a.ward?.name || '')}</small></td>
      <td>${patient(a)}</td>
      <td>${esc(a.doctor?.name || '—')}<br><small>${esc(stayLabel(a.admittedAt))}</small></td>
      <td class="${a.diet?.type === 'nbm' ? 'red b' : ''}">${esc(DIETS[a.diet?.type] || '—')}${a.diet?.notes ? `<br><small>${esc(a.diet.notes)}</small>` : ''}</td>
      <td>${meds(a)}</td>
      <td>${vit(a)}</td>
      <td>${esc(a.io24?.intake ?? 0)} / ${esc(a.io24?.output ?? 0)}</td>
      <td>${plan(a)}</td>
      <td></td>
    </tr>`).join('') || '<tr><td colspan="9">No in-patients</td></tr>'}</tbody>
  </table>
  <div class="sign"><div>Handed over by (name / sign / time)</div><div>Taken over by (name / sign / time)</div><div>Nursing in-charge</div></div>

  <div class="page">
    <div class="head"><div><h1>${esc(clinic)} — Diet list</h1><div class="muted">${esc(branch)}</div></div><div class="muted">Printed: ${esc(now)}</div></div>
    <table>
      <thead><tr><th style="width:160px">Diet</th><th style="width:60px">Bed</th><th>Patient</th><th>Diet notes</th><th style="width:150px">Next procedure</th><th style="width:90px">Served ✓</th></tr></thead>
      <tbody>${Object.entries(diets).map(([k, arr]) => arr.map((a, i) => `<tr>
        ${i === 0 ? `<td rowspan="${arr.length}" class="b ${k === 'nbm' ? 'red' : ''}">${esc(DIETS[k] || 'Not set')} (${arr.length})</td>` : ''}
        <td class="b">${esc(a.bed?.number || '—')}</td><td>${esc(a.patient?.name)}${a.allergies ? ` <span class="red">· Allergy: ${esc(a.allergies)}</span>` : ''}</td>
        <td>${esc(a.diet?.notes || '')}</td><td>${a.nextProcedure ? `${esc(a.nextProcedure.name)}<br><small>${dt(a.nextProcedure.scheduledAt)}</small>` : ''}</td><td></td></tr>`).join('')).join('')}</tbody>
    </table>
  </div>
</body></html>`;
  printHtml(html);
}
