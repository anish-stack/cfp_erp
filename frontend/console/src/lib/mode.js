/**
 * One console build serves the admin / clinic / crm hosts — mode decides landing page + visible groups.
 * Detected from the first label of the host name, by prefix:
 *   admin.example.com · admincfp.hovermessage.com  → admin
 *   clinic.example.com · cliniccfp.hovermessage.com → clinic
 *   crm.example.com · crmcfp.hovermessage.com       → crm
 * VITE_APP_MODE overrides (local dev).
 */
export function appMode() {
  const env = import.meta.env.VITE_APP_MODE;
  if (env) return env;
  const label = location.hostname.split('.')[0].toLowerCase();
  const m = label.match(/^(admin|clinic|crm)/);
  return m ? m[1] : 'admin';
}

export const MODE_GROUPS = {
  admin: null, // all
  clinic: ['General', 'Clinical', 'IPD', 'Finance', 'Pharmacy', 'Insights', 'Organization'],
  crm: ['General', 'CRM', 'Insights'],
};

export const MODE_TITLES = { admin: 'Super Admin', clinic: 'Clinic', crm: 'Sales CRM' };
