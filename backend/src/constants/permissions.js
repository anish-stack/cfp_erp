export const ACTIONS = ['view', 'create', 'edit', 'delete', 'import', 'export', 'assign', 'approve', 'manage_settings'];

// key → label + group (group drives sidebar sections in frontends)
export const MODULES = {
  dashboard: { label: 'Dashboard', group: 'General' },
  branches: { label: 'Branches', group: 'Organization' },
  staff: { label: 'Staff', group: 'Organization' },
  roles: { label: 'Roles & Permissions', group: 'Organization' },
  doctors: { label: 'Doctors', group: 'Clinical' },
  patients: { label: 'Patients', group: 'Clinical' },
  medical_records: { label: 'Medical Records', group: 'Clinical' },
  appointments: { label: 'Appointments', group: 'Clinical' },
  walkins: { label: 'Walk-ins', group: 'Clinical' },
  ipd: { label: 'IPD / Admissions & Beds', group: 'IPD' },
  slots: { label: 'Slot Management', group: 'Clinical' },
  billing: { label: 'Billing & Invoices', group: 'Finance' },
  pos: { label: 'POS', group: 'Finance' },
  expenses: { label: 'Expenses', group: 'Finance' },
  inventory: { label: 'Inventory', group: 'Pharmacy' },
  purchases: { label: 'Purchases', group: 'Pharmacy' },
  suppliers: { label: 'Suppliers', group: 'Pharmacy' },
  leads: { label: 'Leads', group: 'CRM' },
  followups: { label: 'Follow-ups', group: 'CRM' },
  tasks: { label: 'Tasks', group: 'CRM' },
  campaigns: { label: 'Campaigns', group: 'CRM' },
  sales: { label: 'Sales & Targets', group: 'CRM' },
  cms: { label: 'CMS & Forms', group: 'CRM' },
  marketing: { label: 'Marketing (bulk WhatsApp)', group: 'CRM' },
  reports: { label: 'Reports', group: 'Insights' },
  notifications: { label: 'Notifications', group: 'System' },
  settings: { label: 'Settings', group: 'System' },
  audit_logs: { label: 'Audit Logs', group: 'System' },
};

export const MODULE_KEYS = Object.keys(MODULES);

export const ALL_PERMISSIONS = MODULE_KEYS.flatMap((m) => ACTIONS.map((a) => `${m}.${a}`));

export const isValidPermission = (p) => p === '*' || ALL_PERMISSIONS.includes(p);

const all = (m) => ACTIONS.map((a) => `${m}.${a}`);
const crud = (m) => ['view', 'create', 'edit', 'delete'].map((a) => `${m}.${a}`);
const v = (m) => `${m}.view`;

export const DEFAULT_ROLES = [
  { slug: 'super_admin', name: 'Super Admin', scope: 'global', permissions: ['*'] },
  {
    slug: 'branch_admin', name: 'Branch Admin', scope: 'branch',
    permissions: [
      v('dashboard'), ...crud('staff'), ...crud('doctors'), ...all('patients'), ...all('medical_records'),
      ...all('appointments'), ...all('walkins'), ...all('slots'), ...all('ipd'), ...all('billing'), ...all('pos'),
      ...all('expenses'), ...all('inventory'), ...all('purchases'), ...crud('suppliers'),
      v('reports'), 'reports.export', v('leads'), v('notifications'), v('audit_logs'),
      'branches.view', 'branches.manage_settings', v('marketing'), 'marketing.create',
    ],
  },
  {
    slug: 'branch_manager', name: 'Branch Manager', scope: 'branch',
    permissions: [
      v('dashboard'), v('staff'), v('doctors'), ...crud('patients'), ...crud('appointments'), ...crud('walkins'), ...all('ipd'),
      ...crud('slots'), ...crud('billing'), ...crud('pos'), ...crud('expenses'), ...crud('inventory'),
      ...crud('purchases'), v('suppliers'), v('reports'), 'branches.view',
    ],
  },
  {
    slug: 'receptionist', name: 'Receptionist', scope: 'branch',
    permissions: [
      v('dashboard'), v('doctors'), v('patients'), 'patients.create', 'patients.edit',
      ...crud('appointments'), ...crud('walkins'), v('slots'), v('ipd'), 'ipd.create', 'ipd.edit', v('billing'), 'billing.create',
      v('pos'), 'pos.create', v('followups'), 'followups.create', 'followups.edit',
    ],
  },
  {
    slug: 'doctor', name: 'Doctor', scope: 'branch',
    permissions: [
      v('dashboard'), v('patients'), 'patients.edit', ...crud('medical_records'),
      v('appointments'), 'appointments.edit', v('slots'), v('followups'), 'followups.create', v('ipd'), 'ipd.create', 'ipd.edit',
    ],
  },
  {
    slug: 'accountant', name: 'Accountant', scope: 'branch',
    permissions: [
      v('dashboard'), v('patients'), ...all('billing'), v('pos'), ...all('expenses'), v('ipd'), 'ipd.edit',
      v('purchases'), v('suppliers'), v('reports'), 'reports.export',
    ],
  },
  {
    slug: 'pharmacist', name: 'Pharmacist', scope: 'branch',
    permissions: [
      v('dashboard'), v('patients'), ...all('pos'), ...crud('inventory'), 'inventory.import', 'inventory.export',
      ...crud('purchases'), ...crud('suppliers'), v('billing'), 'billing.create', v('ipd'), 'ipd.edit',
    ],
  },
  {
    slug: 'nurse', name: 'Nurse / Ward staff', scope: 'branch',
    permissions: [v('dashboard'), v('patients'), v('doctors'), v('appointments'), v('medical_records'), v('ipd'), 'ipd.create', 'ipd.edit'],
  },
  {
    slug: 'sales_manager', name: 'Sales Manager', scope: 'global',
    permissions: [
      v('dashboard'), ...all('leads'), ...all('followups'), ...all('tasks'), ...all('campaigns'),
      ...all('sales'), v('cms'), ...all('marketing'), v('reports'), 'reports.export', v('appointments'), 'appointments.create',
    ],
  },
  {
    slug: 'sales_executive', name: 'Sales Executive', scope: 'global',
    permissions: [
      v('dashboard'), v('leads'), 'leads.create', 'leads.edit', ...crud('followups'), ...crud('tasks'),
      v('sales'), v('appointments'), 'appointments.create',
    ],
  },
  {
    slug: 'marketing_manager', name: 'Marketing Manager', scope: 'global',
    permissions: [
      v('dashboard'), v('leads'), 'leads.import', 'leads.export', ...all('campaigns'), ...all('cms'), ...all('marketing'),
      v('reports'), 'reports.export',
    ],
  },
];

export const INITIAL_BRANCHES = [
  { name: 'Rohini', code: 'ROH' },
  { name: 'Paschim Vihar', code: 'PVH' },
  { name: 'Indirapuram', code: 'IND' },
  { name: 'Tilak Nagar', code: 'TLN' },
  { name: 'Dwarka', code: 'DWK' },
];
