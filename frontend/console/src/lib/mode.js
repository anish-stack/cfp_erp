/** One console build serves admin./clinic./crm. — mode decides landing page + visible groups. */
export function appMode() {
  const env = import.meta.env.VITE_APP_MODE;
  if (env) return env;
  const host = location.hostname.split('.')[0];
  if (['admin', 'clinic', 'crm'].includes(host)) return host;
  return 'admin';
}

export const MODE_GROUPS = {
  admin: null, // all
  clinic: ['General', 'Clinical', 'Finance', 'Pharmacy', 'Insights', 'Organization'],
  crm: ['General', 'CRM', 'Insights'],
};

export const MODE_TITLES = { admin: 'Super Admin', clinic: 'Clinic', crm: 'Sales CRM' };
