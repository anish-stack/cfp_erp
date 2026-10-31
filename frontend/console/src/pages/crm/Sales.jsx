import { useState } from 'react';
import { Target } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FormBuilder } from '@/components/common/FormBuilder';
import { useGet, useAction } from '@/hooks/queries';
import { put } from '@/lib/api';
import { useCan } from '@/store/auth';
import { todayIST } from '@/lib/utils';

const Progress = ({ v, t }) => {
  const pct = t ? Math.min(100, Math.round((v / t) * 100)) : 0;
  return (
    <div className="min-w-[110px]">
      <p className="text-sm"><b>{v}</b>{t ? <span className="text-muted-foreground"> / {t}</span> : ''}</p>
      {t > 0 && <div className="mt-1 h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-primary" style={{ width: `${pct}%` }} /></div>}
    </div>
  );
};

export default function Sales() {
  const can = useCan();
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const [editing, setEditing] = useState(null);
  const { data = [], isLoading } = useGet(['perf', month], '/crm/performance', { month });
  const save = useAction((v) => put('/crm/targets', { user: editing.user._id, month, leadsTarget: v.leadsTarget || 0, conversionsTarget: v.conversionsTarget || 0, appointmentsTarget: v.appointmentsTarget || 0, revenueTarget: v.revenueTarget || 0 }), { success: 'Target saved', invalidate: ['perf'], onSuccess: () => setEditing(null) });
  return (
    <div>
      <PageHeader title="Targets & performance" actions={<Input type="month" className="w-40" value={month} onChange={(e) => setMonth(e.target.value)} />} />
      <DataTable loading={isLoading} rows={data} rowKey="user" columns={[
        { key: 'u', header: 'Salesperson', cell: (r) => <span className="font-medium">{r.user.name}</span> },
        { key: 'l', header: 'Leads', cell: (r) => <Progress v={r.leads} t={r.target.leads} /> },
        { key: 'c', header: 'Calls (connected)', cell: (r) => `${r.calls} (${r.connected})` },
        { key: 'a', header: 'Appointments', cell: (r) => <Progress v={r.appointments} t={r.target.appointments} /> },
        { key: 'v', header: 'Visited', cell: (r) => r.visited },
        { key: 'cv', header: 'Conversions', cell: (r) => <Progress v={r.converted} t={r.target.conversions} /> },
        { key: 'cr', header: 'Conv. rate', cell: (r) => `${r.conversionRate}%` },
        { key: 'x', header: '', cell: (r) => can('sales.edit') && <Button size="sm" variant="ghost" onClick={() => setEditing(r)}><Target /> Target</Button> },
      ]} />
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title={`Targets · ${editing?.user.name} · ${month}`}>
          {editing && <FormBuilder fields={[
            { name: 'leadsTarget', label: 'Leads', type: 'number' },
            { name: 'appointmentsTarget', label: 'Appointments', type: 'number' },
            { name: 'conversionsTarget', label: 'Conversions', type: 'number' },
            { name: 'revenueTarget', label: 'Revenue (₹)', type: 'number' },
          ]} defaultValues={{ leadsTarget: editing.target.leads, appointmentsTarget: editing.target.appointments, conversionsTarget: editing.target.conversions, revenueTarget: editing.target.revenue }} onSubmit={(v) => save.mutate(v)} loading={save.isPending} onCancel={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
