const esc = (v) => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // CSV injection guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** cols: [[header, key | (row)=>value], ...] */
export function toCsv(rows, cols) {
  const head = cols.map(([h]) => esc(h)).join(',');
  const body = rows.map((r) => cols.map(([, k]) => esc(typeof k === 'function' ? k(r) : k.split('.').reduce((o, p) => o?.[p], r))).join(','));
  return '﻿' + [head, ...body].join('\r\n');
}
