import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FormBuilder } from '@/components/common/FormBuilder';
import { Can } from '@/components/common/Can';
import { useGet, useAction } from '@/hooks/queries';
import { post, patch, del } from '@/lib/api';
import { useCan } from '@/store/auth';
import { fmtDateTime, cn } from '@/lib/utils';

export default function Tasks() {
  const nav = useNavigate();
  const can = useCan();
  const [filter, setFilter] = useState('open');
  const [creating, setCreating] = useState(false);
  const params = filter === 'open' ? { status: 'open,in_progress' } : filter === 'today' ? { due: 'today', status: 'open,in_progress' } : filter === 'overdue' ? { due: 'overdue' } : { status: 'done,cancelled' };
  const { data = [], isLoading } = useGet(['/crm/tasks', filter], '/crm/tasks', params);
  const upd = useAction(({ id, ...b }) => patch(`/crm/tasks/${id}`, b), { invalidate: ['/crm/tasks', 'crm-dash'] });
  const create = useAction((v) => post('/crm/tasks', { ...v, dueAt: v.dueAt ? new Date(v.dueAt).toISOString() : undefined }), { success: 'Task created', invalidate: ['/crm/tasks', 'crm-dash'], onSuccess: () => setCreating(false) });
  const remove = useAction((id) => del(`/crm/tasks/${id}`), { success: 'Deleted', invalidate: ['/crm/tasks'] });
  const fields = [
    { name: 'title', label: 'Title', required: true, colSpan: 2 },
    { name: 'description', label: 'Description', type: 'textarea', colSpan: 2 },
    { name: 'dueAt', label: 'Due', type: 'datetime-local' },
    { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high'] },
    ...(can('leads.assign') ? [{ name: 'assignedTo', label: 'Assign to', optionsQuery: { url: '/crm/users', map: (u) => ({ value: u._id, label: u.name }) } }] : []),
  ];
  return (
    <div>
      <PageHeader title="Tasks" actions={<Can perm="tasks.create"><Button onClick={() => setCreating(true)}><Plus /> New task</Button></Can>} />
      <Tabs value={filter} onValueChange={setFilter} className="mb-3"><TabsList><TabsTrigger value="open">Open</TabsTrigger><TabsTrigger value="today">Due today</TabsTrigger><TabsTrigger value="overdue">Overdue</TabsTrigger><TabsTrigger value="done">Closed</TabsTrigger></TabsList></Tabs>
      <DataTable loading={isLoading} rows={data} columns={[
        { key: 't', header: 'Task', cell: (t) => <div><p className="font-medium">{t.title}</p>{t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}</div> },
        { key: 'l', header: 'Lead', cell: (t) => (t.lead ? <button className="text-primary hover:underline" onClick={() => nav(`/leads/${t.lead._id}`)}>{t.lead.name}</button> : '—') },
        { key: 'd', header: 'Due', cell: (t) => (t.dueAt ? <span className={cn(new Date(t.dueAt) < new Date() && ['open', 'in_progress'].includes(t.status) && 'font-medium text-red-600')}>{fmtDateTime(t.dueAt)}</span> : '—') },
        { key: 'p', header: 'Priority', cell: (t) => <Badge variant={t.priority === 'high' ? 'danger' : t.priority === 'low' ? 'secondary' : 'warning'}>{t.priority}</Badge> },
        { key: 'a', header: 'Owner', cell: (t) => t.assignedTo?.name },
        { key: 's', header: 'Status', cell: (t) => (
          <Select className="h-8 w-32" value={t.status} disabled={!can('tasks.edit')} onChange={(e) => upd.mutate({ id: t._id, status: e.target.value })}>{['open', 'in_progress', 'done', 'cancelled'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select>
        ) },
        { key: 'x', header: '', cell: (t) => can('tasks.delete') && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove.mutate(t._id)}><Trash2 /></Button> },
      ]} />
      <Dialog open={creating} onOpenChange={setCreating}><DialogContent title="New task"><FormBuilder fields={fields} defaultValues={{ priority: 'medium' }} onSubmit={(v) => create.mutate(v)} loading={create.isPending} onCancel={() => setCreating(false)} /></DialogContent></Dialog>
    </div>
  );
}
