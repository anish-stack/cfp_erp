import { lazy } from 'react';
import {
  LayoutDashboard, CalendarDays, Users, Stethoscope, CalendarClock, BellRing, Receipt, ShoppingCart, Wallet, Banknote,
  Package, Boxes, Truck, ArrowLeftRight, Building2, Target, ListTodo, Megaphone, FileText, BarChart3, UserCog, ShieldCheck,
  ScrollText, Settings, Bell, Contact, Gauge, PhoneCall, UserPlus, FileStack,
} from 'lucide-react';

const L = (f) => lazy(f);

/** perm = required permission to see + open. group drives sidebar sections + subdomain mode filter. */
export const ROUTES = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'General', perm: 'dashboard.view', el: L(() => import('@/pages/Dashboard')) },
  { path: '/crm', label: 'Sales Home', icon: Gauge, group: 'CRM', perm: 'leads.view', el: L(() => import('@/pages/crm/CrmHome')) },

  { path: '/appointments', label: 'Appointments', icon: CalendarDays, group: 'Clinical', perm: 'appointments.view', el: L(() => import('@/pages/appointments/Appointments')) },
  { path: '/appointments/:id', group: 'Clinical', perm: 'appointments.view', el: L(() => import('@/pages/appointments/AppointmentPage')), hidden: true },
  { path: '/walkin', label: 'Walk-in Registration', icon: UserPlus, group: 'Clinical', perm: 'walkins.create', el: L(() => import('@/pages/appointments/Walkin')) },
  { path: '/patients', label: 'Patients', icon: Users, group: 'Clinical', perm: 'patients.view', el: L(() => import('@/pages/patients/Patients')) },
  { path: '/patients/:id', group: 'Clinical', perm: 'patients.view', el: L(() => import('@/pages/patients/PatientDetail')), hidden: true },
  { path: '/followups', label: 'Follow-ups', icon: BellRing, group: 'Clinical', perm: 'followups.view', el: L(() => import('@/pages/clinical/FollowUps')) },
  { path: '/rx-templates', label: 'Prescription Types', icon: FileStack, group: 'Clinical', perm: 'medical_records.view', el: L(() => import('@/pages/clinical/RxTemplates')) },
  { path: '/doctors', label: 'Doctors', icon: Stethoscope, group: 'Clinical', perm: 'doctors.view', el: L(() => import('@/pages/clinical/Doctors')) },
  { path: '/slots', label: 'Slots & Leave', icon: CalendarClock, group: 'Clinical', perm: 'slots.view', el: L(() => import('@/pages/clinical/Slots')) },

  { path: '/billing', label: 'Invoices', icon: Receipt, group: 'Finance', perm: 'billing.view', el: L(() => import('@/pages/billing/Invoices')) },
  { path: '/billing/new', group: 'Finance', perm: 'billing.create', el: L(() => import('@/pages/billing/NewInvoice')), hidden: true },
  { path: '/billing/:id', group: 'Finance', perm: ['billing.view', 'pos.view'], el: L(() => import('@/pages/billing/InvoiceDetail')), hidden: true },
  { path: '/pos', label: 'POS', icon: ShoppingCart, group: 'Finance', perm: 'pos.view', el: L(() => import('@/pages/billing/Pos')) },
  { path: '/payments', label: 'Payments', icon: Banknote, group: 'Finance', perm: 'billing.view', el: L(() => import('@/pages/billing/Payments')) },
  { path: '/expenses', label: 'Expenses', icon: Wallet, group: 'Finance', perm: 'expenses.view', el: L(() => import('@/pages/billing/Expenses')) },

  { path: '/inventory', label: 'Stock', icon: Boxes, group: 'Pharmacy', perm: 'inventory.view', el: L(() => import('@/pages/inventory/Stock')) },
  { path: '/products', label: 'Products', icon: Package, group: 'Pharmacy', perm: 'inventory.view', el: L(() => import('@/pages/inventory/Products')) },
  { path: '/purchases', label: 'Purchase Orders', icon: Truck, group: 'Pharmacy', perm: 'purchases.view', el: L(() => import('@/pages/inventory/Purchases')) },
  { path: '/transfers', label: 'Transfers', icon: ArrowLeftRight, group: 'Pharmacy', perm: 'inventory.view', el: L(() => import('@/pages/inventory/Transfers')) },
  { path: '/suppliers', label: 'Suppliers', icon: Contact, group: 'Pharmacy', perm: 'suppliers.view', el: L(() => import('@/pages/inventory/Suppliers')) },

  { path: '/leads', label: 'Leads', icon: Target, group: 'CRM', perm: 'leads.view', el: L(() => import('@/pages/crm/Leads')) },
  { path: '/leads/:id', group: 'CRM', perm: 'leads.view', el: L(() => import('@/pages/crm/LeadDetail')), hidden: true },
  { path: '/calls', label: 'Calls & Dialer', icon: PhoneCall, group: 'CRM', perm: 'leads.view', el: L(() => import('@/pages/crm/Calls')) },
  { path: '/tasks', label: 'Tasks', icon: ListTodo, group: 'CRM', perm: 'tasks.view', el: L(() => import('@/pages/crm/Tasks')) },
  { path: '/campaigns', label: 'Campaigns', icon: Megaphone, group: 'CRM', perm: 'campaigns.view', el: L(() => import('@/pages/crm/Campaigns')) },
  { path: '/sales', label: 'Targets & Performance', icon: BarChart3, group: 'CRM', perm: 'sales.view', el: L(() => import('@/pages/crm/Sales')) },
  { path: '/forms/:id/design', group: 'CRM', perm: 'cms.view', el: L(() => import('@/pages/crm/PageDesigner')), hidden: true },
  { path: '/forms', label: 'CMS & Forms', icon: FileText, group: 'CRM', perm: 'cms.view', el: L(() => import('@/pages/crm/Forms')) },

  { path: '/reports', label: 'Reports', icon: BarChart3, group: 'Insights', perm: 'reports.view', el: L(() => import('@/pages/Reports')) },

  { path: '/branches', label: 'Branches', icon: Building2, group: 'Organization', perm: 'branches.view', el: L(() => import('@/pages/admin/Branches')) },
  { path: '/staff', label: 'Staff', icon: UserCog, group: 'Organization', perm: 'staff.view', el: L(() => import('@/pages/admin/Staff')) },
  { path: '/roles', label: 'Roles & Permissions', icon: ShieldCheck, group: 'Organization', perm: 'roles.view', el: L(() => import('@/pages/admin/Roles')) },

  { path: '/notifications', label: 'Notifications', icon: Bell, group: 'System', perm: 'notifications.view', el: L(() => import('@/pages/admin/Notifications')) },
  { path: '/audit', label: 'Audit Logs', icon: ScrollText, group: 'System', perm: 'audit_logs.view', el: L(() => import('@/pages/admin/AuditLogs')) },
  { path: '/settings', label: 'Settings', icon: Settings, group: 'System', perm: 'settings.view', el: L(() => import('@/pages/admin/SettingsPage')) },
  { path: '/account', group: 'General', perm: null, el: L(() => import('@/pages/Account')), hidden: true },
];

export const GROUP_ORDER = ['General', 'Clinical', 'Finance', 'Pharmacy', 'CRM', 'Insights', 'Organization', 'System'];
