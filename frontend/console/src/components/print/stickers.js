import JsBarcode from 'jsbarcode';
import { esc, printHtml } from '@/lib/printHtml';

/** label stock presets: page size, label size, grid */
export const STICKER_LAYOUTS = {
  'a4-24': { label: 'A4 sheet · 24 labels (63.5 × 33.9 mm, 3 × 8)', page: 'A4', w: 63.5, h: 33.9, cols: 3, rows: 8, mt: 13.1, ml: 7.2, gapX: 2.5, gapY: 0 },
  'a4-40': { label: 'A4 sheet · 40 labels (48.5 × 25.4 mm, 4 × 10)', page: 'A4', w: 48.5, h: 25.4, cols: 4, rows: 10, mt: 21.5, ml: 8, gapX: 0, gapY: 0 },
  'a4-65': { label: 'A4 sheet · 65 small labels (38.1 × 21.2 mm, 5 × 13)', page: 'A4', w: 38.1, h: 21.2, cols: 5, rows: 13, mt: 10.7, ml: 4.7, gapX: 2.5, gapY: 0 },
  'roll-50x25': { label: 'Label printer roll · 50 × 25 mm', page: '50mm 25mm', w: 50, h: 25, cols: 1, rows: 1, mt: 0, ml: 0, gapX: 0, gapY: 0, roll: true },
  'roll-38x25': { label: 'Label printer roll · 38 × 25 mm', page: '38mm 25mm', w: 38, h: 25, cols: 1, rows: 1, mt: 0, ml: 0, gapX: 0, gapY: 0, roll: true },
};

const barcodeSvg = (text) => {
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, text, { format: 'CODE128', displayValue: false, margin: 0, height: 40, width: 1.6 });
    svg.setAttribute('preserveAspectRatio', 'none');
    return svg.outerHTML;
  } catch {
    return '';
  }
};

/**
 * Patient stickers for files, sample tubes, slips.
 * data: { name, ageSex, patientId, line2 (adm no / bed or booking), line3 (doctor / date), barcode }
 */
export function printStickers(data, { layout = 'a4-24', count = 24, skip = 0 } = {}) {
  const L = STICKER_LAYOUTS[layout] || STICKER_LAYOUTS['a4-24'];
  const small = L.h < 24;
  const code = data.barcode || data.patientId || '';
  const one = `<div class="lab">
      <div class="n">${esc(data.name)}</div>
      <div class="m"><span>${esc(data.ageSex || '')}</span><b>${esc(data.patientId || '')}</b></div>
      ${data.line2 ? `<div class="m">${esc(data.line2)}</div>` : ''}
      ${data.line3 && !small ? `<div class="m">${esc(data.line3)}</div>` : ''}
      ${code ? `<div class="bc">${barcodeSvg(code)}</div>` : ''}
    </div>`;
  const blank = '<div class="lab empty"></div>';
  const per = L.cols * L.rows;
  const cells = [...Array(L.roll ? 0 : Math.min(skip, per - 1)).fill(blank), ...Array(Math.max(1, count)).fill(one)];
  const pages = [];
  for (let i = 0; i < cells.length; i += per) pages.push(cells.slice(i, i + per));
  const fs = L.h >= 30 ? 8.5 : L.h >= 25 ? 7.5 : 6.5;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Stickers — ${esc(data.name)}</title><style>
    @page { size: ${L.page}; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; } body { font: ${fs}pt/1.15 Arial, Helvetica, sans-serif; color: #000; }
    .page { ${L.roll ? '' : `padding: ${L.mt}mm 0 0 ${L.ml}mm;`} display: grid; grid-template-columns: repeat(${L.cols}, ${L.w}mm); grid-auto-rows: ${L.h}mm; column-gap: ${L.gapX}mm; row-gap: ${L.gapY}mm; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .lab { width: ${L.w}mm; height: ${L.h}mm; padding: 1.2mm 2mm; overflow: hidden; display: flex; flex-direction: column; gap: .2mm; ${L.roll ? '' : 'outline: 0.1mm dotted #ccc; outline-offset: -0.1mm;'} }
    .n { font-weight: 700; font-size: ${fs + 1.5}pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .m { display: flex; justify-content: space-between; gap: 1mm; white-space: nowrap; overflow: hidden; }
    .bc { flex: 1; min-height: 3mm; } .bc svg { width: 100%; height: 100%; display: block; }
    @media print { .lab { outline: none; } }
  </style></head><body>${pages.map((pg) => `<div class="page">${pg.join('')}</div>`).join('')}</body></html>`;
  printHtml(html);
}
