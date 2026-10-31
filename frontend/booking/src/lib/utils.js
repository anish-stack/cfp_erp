import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...a) => twMerge(clsx(a));

export const inr = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export const fmtDate = (d) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtTime = (hhmm) => {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** IST today YYYY-MM-DD */
export const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
export const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const ageOf = (p) => {
  if (!p) return '';
  if (p.age != null) return p.age;
  if (p.dob) return Math.floor((Date.now() - new Date(p.dob)) / 31557600000);
  return p.ageYears ?? '';
};
export const titleCase = (s = '') => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const errMsg = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';
export const errDetails = (e) => e?.response?.data?.details;

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
