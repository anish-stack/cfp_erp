import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const usePatient = create(
  persist(
    (set) => ({
      token: null,
      mobile: '',
      login: (token, mobile) => set({ token, mobile }),
      logout: () => set({ token: null, mobile: '' }),
    }),
    { name: 'cpf-patient' }
  )
);

/** UTM captured on first landing, kept for the session */
const KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
export function captureUtm() {
  const p = new URLSearchParams(location.search);
  if (!KEYS.some((k) => p.get(k))) return;
  const utm = { source: p.get('utm_source') || undefined, medium: p.get('utm_medium') || undefined, campaign: p.get('utm_campaign') || undefined, term: p.get('utm_term') || undefined, content: p.get('utm_content') || undefined, gclid: p.get('gclid') || undefined, fbclid: p.get('fbclid') || undefined, landingUrl: location.href.slice(0, 500) };
  try { sessionStorage.setItem('cpf-utm', JSON.stringify(utm)); } catch { /* ignore */ }
}
export function getUtm() {
  try { return JSON.parse(sessionStorage.getItem('cpf-utm') || 'null') || undefined; } catch { return undefined; }
}
