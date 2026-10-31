import { Check, X } from 'lucide-react';
import { ResourcePage } from '@/components/common/ResourcePage';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { DropdownItem } from '@/components/ui/dropdown';
import { useAction } from '@/hooks/queries';
import { post } from '@/lib/api';
import { useCan } from '@/store/auth';
import { fmtDate, inr, todayIST, titleCase } from '@/lib/utils';

const CATS = ['rent', 'salary', 'utilities', 'marketing', 'maintenance', 'supplies', 'travel', 'professional_fees', 'taxes', 'misc'];

export default function Expenses() {
  const can = useCan();
  const approve = useAction(({ id, status }) => post(`/admin/expenses/${id}/approve`, { status }), { success: 'Updated', invalidate: ['/admin/expenses'] });
  return (
    <ResourcePage
      title="Expenses"
      endpoint="/admin/expenses"
      module="expenses"
      deleteLabel="Delete"
      newDefaults={{ date: todayIST(), mode: 'cash' }}
      fields={[
        { name: 'category', label: 'Category', type: 'select', required: true, options: CATS.map((c) => ({ value: c, label: titleCase(c) })) },
        { name: 'amount', label: 'Amount', type: 'number', required: true },
        { name: 'date', label: 'Date', type: 'date', required: true },
        { name: 'mode', label: 'Mode', type: 'select', options: ['cash', 'upi', 'card', 'bank'] },
        { name: 'paidTo', label: 'Paid to' },
        { name: 'reference', label: 'Reference' },
        { name: 'note', label: 'Note', type: 'textarea', colSpan: 2 },
      ]}
      columns={[
        { key: 'date', header: 'Date', cell: (e) => fmtDate(e.date) },
        { key: 'cat', header: 'Category', cell: (e) => <Badge variant="outline">{titleCase(e.category)}</Badge> },
        { key: 'to', header: 'Paid to', cell: (e) => e.paidTo || '—' },
        { key: 'branch', header: 'Branch', cell: (e) => e.branch?.code },
        { key: 'mode', header: 'Mode', cell: (e) => e.mode?.toUpperCase() },
        { key: 'by', header: 'By', cell: (e) => e.createdBy?.name },
        { key: 'st', header: 'Status', cell: (e) => <StatusBadge status={e.status} /> },
        { key: 'amt', header: 'Amount', className: 'text-right', cell: (e) => inr(e.amount) },
      ]}
      rowActions={(e) => e.status === 'pending' && can('expenses.approve') && (<>
        <DropdownItem onSelect={() => approve.mutate({ id: e._id, status: 'approved' })}><Check /> Approve</DropdownItem>
        <DropdownItem onSelect={() => approve.mutate({ id: e._id, status: 'rejected' })}><X /> Reject</DropdownItem>
      </>)}
    />
  );
}
