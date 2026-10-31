import { useState } from 'react';
import { Plus, Check, X, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/common/Field';
import { Can } from '@/components/common/Can';
import { useGet, useAction, useBranches, useDoctors } from '@/hooks/queries';
import { post, patch, del } from '@/lib/api';
import { useAuth, useCan } from '@/store/auth';
import { fmtDate, todayIST, titleCase } from '@/lib/utils';

const monthRange = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return { from: `${ym}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
};
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const TYPE_VARIANT = { holiday: 'danger', leave: 'warning', special_day: 'success', block: 'secondary' };

function ExceptionForm({ onDone }) {
  const branchId = useAuth((s) => s.branchId);
  const me = useAuth((s) => s.me);
  const global = me.user.allBranches || me.permissions.includes('*');
  const { data: branches = [] } = useBranches();
  const [f, setF] = useState({ type: 'leave', branch: branchId || '', doctor: me.user.doctor || '', date: todayIST(), dateTo: '', reason: '', sessions: [] });
  const { data: doctors = [] } = useDoctors(f.branch);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const needSessions = ['special_day', 'block'].includes(f.type);
  const save = useAction(() => post('/scheduling/exceptions', {
    type: f.type, branch: f.branch || null, doctor: ['leave', 'special_day', 'block'].includes(f.type) && f.doctor ? f.doctor : null,
    date: f.date, dateTo: f.dateTo || undefined, reason: f.reason || undefined, sessions: f.sessions,
  }), { success: (d) => `${d.length} day(s) saved`, invalidate: ['exceptions', 'availability'], onSuccess: onDone });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type"><Select value={f.type} onChange={(e) => set('type', e.target.value)}><option value="leave">Doctor leave</option><option value="holiday">Holiday (branch closed)</option><option value="special_day">Special working day</option><option value="block">Block slots</option></Select></Field>
        <Field label="Branch" hint={global ? 'Blank = all branches' : undefined}>
          <Select value={f.branch} onChange={(e) => set('branch', e.target.value)} placeholder={global ? 'All branches' : 'Select'}>{branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</Select>
        </Field>
        {f.type !== 'holiday' && <Field label={f.type === 'leave' ? 'Doctor' : 'Doctor (optional)'} required={f.type === 'leave'}><Select value={f.doctor} onChange={(e) => set('doctor', e.target.value)} placeholder={f.type === 'leave' ? 'Select' : 'Whole branch'}>{doctors.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>}
        <Field label="From"><Input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="To (optional)"><Input type="date" value={f.dateTo} min={f.date} onChange={(e) => set('dateTo', e.target.value)} /></Field>
        <Field label="Reason" className="sm:col-span-2"><Input value={f.reason} onChange={(e) => set('reason', e.target.value)} /></Field>
      </div>
      {(needSessions || f.type === 'leave') && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{f.type === 'special_day' ? 'Working hours' : f.type === 'block' ? 'Blocked windows' : 'Partial leave windows (blank = full day)'}</p>
          {f.sessions.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input type="time" className="w-32" value={s.start} onChange={(e) => set('sessions', f.sessions.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
              <span>–</span>
              <Input type="time" className="w-32" value={s.end} onChange={(e) => set('sessions', f.sessions.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
              <Button variant="ghost" size="icon" onClick={() => set('sessions', f.sessions.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => set('sessions', [...f.sessions, { start: '10:00', end: '13:00' }])}><Plus /> Add window</Button>
        </div>
      )}
      <div className="flex justify-end"><Button loading={save.isPending} disabled={(f.type === 'leave' && !f.doctor) || (needSessions && !f.sessions.length)} onClick={() => save.mutate()}>Save</Button></div>
    </div>
  );
}

export default function Slots() {
  const can = useCan();
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const [type, setType] = useState('');
  const [open, setOpen] = useState(false);
  const { data = [], isLoading } = useGet(['exceptions', month, type], '/scheduling/exceptions', { ...monthRange(month), type: type || undefined });
  const approve = useAction(({ id, status }) => patch(`/scheduling/exceptions/${id}/approve`, { status }), { success: 'Updated', invalidate: ['exceptions', 'availability'] });
  const remove = useAction((id) => del(`/scheduling/exceptions/${id}`), { success: 'Removed', invalidate: ['exceptions', 'availability'] });
  return (
    <div>
      <PageHeader title="Slots & Leave" description="Holidays, doctor leave, special working days and blocked slots. Weekly schedules are set per doctor." actions={<Can perm="slots.create"><Button onClick={() => setOpen(true)}><Plus /> Add</Button></Can>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="icon" variant="outline" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft /></Button>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
        <Button size="icon" variant="outline" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight /></Button>
        <Select className="w-44" value={type} onChange={(e) => setType(e.target.value)} placeholder="All types"><option value="holiday">Holiday</option><option value="leave">Leave</option><option value="special_day">Special day</option><option value="block">Block</option></Select>
      </div>
      <DataTable loading={isLoading} rows={data} columns={[
        { key: 'date', header: 'Date', cell: (e) => fmtDate(e.date) },
        { key: 'type', header: 'Type', cell: (e) => <Badge variant={TYPE_VARIANT[e.type]}>{titleCase(e.type)}</Badge> },
        { key: 'branch', header: 'Branch', cell: (e) => e.branch?.name || 'All branches' },
        { key: 'doctor', header: 'Doctor', cell: (e) => e.doctor?.name || '—' },
        { key: 'win', header: 'Windows', cell: (e) => (e.sessions.length ? e.sessions.map((s) => `${s.start}–${s.end}`).join(', ') : 'Full day') },
        { key: 'reason', header: 'Reason', cell: (e) => e.reason || '—' },
        { key: 'status', header: 'Status', cell: (e) => <StatusBadge status={e.status} /> },
        { key: 'act', header: '', className: 'text-right', cell: (e) => (
          <div className="flex justify-end gap-1">
            {e.status === 'pending' && can('slots.approve') && <>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" onClick={() => approve.mutate({ id: e._id, status: 'approved' })}><Check /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600" onClick={() => approve.mutate({ id: e._id, status: 'rejected' })}><X /></Button>
            </>}
            {can('slots.delete') && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove.mutate(e._id)}><Trash2 /></Button>}
          </div>
        ) },
      ]} />
      <Dialog open={open} onOpenChange={setOpen}><DialogContent title="Add schedule exception" size="lg"><ExceptionForm onDone={() => setOpen(false)} /></DialogContent></Dialog>
    </div>
  );
}
