import { lazy } from 'react';
import {
  LayoutDashboard, CalendarDays, Users, Stethoscope, CalendarClock, BellRing, Receipt, ShoppingCart, Wallet, Banknote,
  Package, Boxes, Truck, ArrowLeftRight, Building2, Target, ListTodo, Megaphone, FileText, BarChart3, UserCog, ShieldCheck,
  ScrollText, Settings, Bell, Contact, Gauge, PhoneCall, UserPlus, FileStack, BedDouble, ClipboardList, Hotel, HeartPulse, Scissors, ShieldPlus, PackageOpen, ChartColumn, Send, Gift, TicketPercent, CreditCard, Globe,
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

  { path: '/ipd', label: 'Bed Board', icon: BedDouble, group: 'IPD', feature: 'ipd', perm: 'ipd.view', el: L(() => import('@/pages/ipd/BedBoard')) },
  { path: '/ipd/admissions', label: 'Admissions', icon: ClipboardList, group: 'IPD', feature: 'ipd', perm: 'ipd.view', el: L(() => import('@/pages/ipd/Admissions')) },
  { path: '/ipd/admissions/:id', group: 'IPD', feature: 'ipd', perm: 'ipd.view', el: L(() => import('@/pages/ipd/AdmissionPage')), hidden: true },
  { path: '/ipd/nursing', label: 'Nursing Station', icon: HeartPulse, group: 'IPD', feature: 'ipd', perm: 'ipd.view', el: L(() => import('@/pages/ipd/NursingStation')) },
  { path: '/ipd/ot', label: 'OT Schedule', icon: Scissors, group: 'IPD', feature: 'ipd', perm: 'ipd.view', el: L(() => import('@/pages/ipd/OtSchedule')) },
  { path: '/ipd/claims', label: 'Insurance Claims', icon: ShieldPlus, group: 'IPD', feature: 'ipd', perm: 'ipd.view', el: L(() => import('@/pages/ipd/Claims')) },
  { path: '/ipd/packages', label: 'Packages', icon: PackageOpen, group: 'IPD', feature: 'ipd', perm: 'ipd.view', el: L(() => import('@/pages/ipd/Packages')) },
  { path: '/ipd/reports', label: 'IPD Reports', icon: ChartColumn, group: 'IPD', feature: 'ipd', perm: 'ipd.view', el: L(() => import('@/pages/ipd/IpdReports')) },
  { path: '/ipd/setup', label: 'Wards & Beds', icon: Hotel, group: 'IPD', feature: 'ipd', perm: 'ipd.manage_settings', el: L(() => import('@/pages/ipd/WardSetup')) },

  { path: '/billing', label: 'Invoices', icon: Receipt, group: 'Finance', perm: 'billing.view', el: L(() => import('@/pages/billing/Invoices')) },
  { path: '/billing/new', group: 'Finance', perm: 'billing.create', el: L(() => import('@/pages/billing/NewInvoice')), hidden: true },
  { path: '/billing/:id', group: 'Finance', perm: ['billing.view', 'pos.view'], el: L(() => import('@/pages/billing/InvoiceDetail')), hidden: true },
  { path: '/pos', label: 'POS', icon: ShoppingCart, group: 'Finance', perm: 'pos.view', el: L(() => import('@/pages/billing/Pos')) },
  { path: '/online-payments', label: 'Online Payments', icon: CreditCard, group: 'Finance', perm: 'billing.view', el: L(() => import('@/pages/billing/OnlinePayments')) },
  { path: '/coupons', label: 'Coupons & Loyalty', icon: TicketPercent, group: 'Finance', perm: 'pos.view', el: L(() => import('@/pages/billing/Coupons')) },
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
  { path: '/marketing', label: 'Marketing', icon: Send, group: 'CRM', perm: 'marketing.view', feature: 'marketing', el: L(() => import('@/pages/crm/Marketing')) },
  { path: '/forms/:id/design', group: 'CRM', perm: 'cms.view', el: L(() => import('@/pages/crm/PageDesigner')), hidden: true },
  { path: '/forms', label: 'CMS & Forms', icon: FileText, group: 'CRM', perm: 'cms.view', el: L(() => import('@/pages/crm/Forms')) },
  { path: '/wheels', label: 'Spin Wheels', icon: Gift, group: 'CRM', perm: 'cms.view', el: L(() => import('@/pages/crm/SpinWheels')) },
  { path: '/website-widget', label: 'Website Widget', icon: Globe, group: 'CRM', perm: 'cms.view', el: L(() => import('@/pages/crm/WebsiteWidget')) },

  { path: '/reports', label: 'Reports', icon: BarChart3, group: 'Insights', perm: 'reports.view', el: L(() => import('@/pages/Reports')) },

  { path: '/branches', label: 'Branches', icon: Building2, group: 'Organization', perm: 'branches.view', el: L(() => import('@/pages/admin/Branches')) },
  { path: '/staff', label: 'Staff', icon: UserCog, group: 'Organization', perm: 'staff.view', el: L(() => import('@/pages/admin/Staff')) },
  { path: '/roles', label: 'Roles & Permissions', icon: ShieldCheck, group: 'Organization', perm: 'roles.view', el: L(() => import('@/pages/admin/Roles')) },

  { path: '/notifications', label: 'Notifications', icon: Bell, group: 'System', perm: 'notifications.view', el: L(() => import('@/pages/admin/Notifications')) },
  { path: '/audit', label: 'Audit Logs', icon: ScrollText, group: 'System', perm: 'audit_logs.view', el: L(() => import('@/pages/admin/AuditLogs')) },
  { path: '/settings', label: 'Settings', icon: Settings, group: 'System', perm: 'settings.view', el: L(() => import('@/pages/admin/SettingsPage')) },
  { path: '/account', group: 'General', perm: null, el: L(() => import('@/pages/Account')), hidden: true },
];

export const GROUP_ORDER = ['General', 'Clinical', 'IPD', 'Finance', 'Pharmacy', 'CRM', 'Insights', 'Organization', 'System'];