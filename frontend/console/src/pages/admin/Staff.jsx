import { ResourcePage } from '@/components/common/ResourcePage';
import { Badge } from '@/components/ui/badge';
import { fmtDateTime } from '@/lib/utils';

const base = [
  { name: 'name', label: 'Name', required: true },
  { name: 'designation', label: 'Designation' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'phone', label: 'Mobile', type: 'tel' },
  { name: 'role', label: 'Role', required: true, optionsQuery: { url: '/roles', map: (r) => ({ value: r._id, label: r.name }) } },
  { name: 'allBranches', label: 'Access all branches', type: 'switch' },
  { name: 'branches', label: 'Branches', type: 'multiselect', colSpan: 2, optionsQuery: { url: '/branches', map: (b) => ({ value: b._id, label: b.name }) } },
];
const pwHint = '8+ chars with upper, lower & number';

export default function Staff() {
  return (
    <ResourcePage
      title="Staff"
      description="Users, roles and branch access"
      endpoint="/staff"
      module="staff"
      canDelete={false}
      newDefaults={{ branches: [], allBranches: false }}
      fields={[...base, { name: 'password', label: 'Password', type: 'password', required: true, hint: pwHint }]}
      editFields={[...base, { name: 'isActive', label: 'Active', type: 'switch' }, { name: 'password', label: 'Reset password', type: 'password', hint: `Leave blank to keep. ${pwHint}` }]}
      toForm={(u) => ({ ...u, role: u.role?._id, branches: (u.branches || []).map((b) => b._id), password: '' })}
      toPayload={(v) => {
        const out = { ...v, branches: v.branches || [] };
        if (!out.password) delete out.password;
        return out;
      }}
      columns={[
        { key: 'n', header: 'Name', cell: (u) => <div><p className="font-medium">{u.name}</p><p className="text-xs text-muted-foreground">{u.designation}</p></div> },
        { key: 'c', header: 'Login', cell: (u) => <div className="text-sm">{u.email}<p className="text-xs text-muted-foreground">{u.phone}</p></div> },
        { key: 'r', header: 'Role', cell: (u) => <Badge>{u.role?.name}</Badge> },
        { key: 'b', header: 'Branches', cell: (u) => (u.allBranches ? <Badge variant="info">All</Badge> : <div className="flex flex-wrap gap-1">{u.branches?.map((b) => <Badge key={b._id} variant="secondary">{b.code}</Badge>)}</div>) },
        { key: 'l', header: 'Last login', cell: (u) => fmtDateTime(u.lastLoginAt) },
        { key: 's', header: 'Status', cell: (u) => (u.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Disabled</Badge>) },
      ]}
    />
  );
}
