import { useState } from 'react';
import { Plus, Check, X } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/common/Field';
import { Can } from '@/components/common/Can';
import { LineEditor } from './LineEditor';
import { useGet, useAction, useBranches } from '@/hooks/queries';
import { post } from '@/lib/api';
import { useAuth, useCan } from '@/store/auth';
import { fmtDateTime } from '@/lib/utils';

function NewTransfer({ onDone }) {
  const branchId = useAuth((s) => s.branchId);
  const { data: all = [] } = useBranches();
  const { data: names = [] } = useGet(['branch-names'], '/branches/names');
  const [from, setFrom] = useState(branchId || '');
  const [to, setTo] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([]);
  const destinations = names;
  const save = useAction(() => post('/inventory/transfers', { fromBranch: from, toBranch: to, notes: notes || undefined, items: lines.map((l) => ({ product: l.product, qty: Number(l.qty) })) }), { success: (t) => `Transfer ${t.transferNo} sent`, invalidate: ['/inventory/transfers', 'stock', 'batches'], onSuccess: onDone });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From" required><Select value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Select">{all.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</Select></Field>
        <Field label="To" required><Select value={to} onChange={(e) => setTo(e.target.value)} placeholder="Select">{destinations.filter((b) => b._id !== from).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</Select></Field>
      </div>
      <p className="text-xs text-muted-foreground">Stock leaves the source branch now (FEFO) and arrives when the destination receives it.</p>
      <LineEditor lines={lines} setLines={setLines} cols={['qty']} />
      <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="flex justify-end"><Button disabled={!from || !to || !lines.length} loading={save.isPending} onClick={() => save.mutate()}>Send transfer</Button></div>
    </div>
  );
}

export default function Transfers() {
  const can = useCan();
  const [creating, setCreating] = useState(false);
  const { data = [], isLoading } = useGet(['/inventory/transfers'], '/inventory/transfers');
  const act = useAction(({ id, action }) => post(`/inventory/transfers/${id}/${action}`), { success: 'Done', invalidate: ['/inventory/transfers', 'stock', 'batches'] });
  return (
    <div>
      <PageHeader title="Stock Transfers" description="Move stock between branches" actions={<Can perm="inventory.create"><Button onClick={() => setCreating(true)}><Plus /> New transfer</Button></Can>} />
      <DataTable loading={isLoading} rows={data} columns={[
        { key: 'no', header: 'Transfer', cell: (t) => <span className="font-mono text-xs">{t.transferNo}</span> },
        { key: 'd', header: 'Sent', cell: (t) => fmtDateTime(t.createdAt) },
        { key: 'r', header: 'Route', cell: (t) => `${t.fromBranch?.code} → ${t.toBranch?.code}` },
        { key: 'i', header: 'Items', cell: (t) => t.items.map((i) => `${i.name} ×${i.qty}`).join(', ') },
        { key: 'by', header: 'By', cell: (t) => t.createdBy?.name },
        { key: 's', header: 'Status', cell: (t) => <StatusBadge status={t.status} /> },
        { key: 'a', header: '', cell: (t) => t.status === 'in_transit' && can('inventory.edit') && (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => act.mutate({ id: t._id, action: 'receive' })}><Check /> Receive</Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" title="Cancel & return to source" onClick={() => act.mutate({ id: t._id, action: 'cancel' })}><X /></Button>
          </div>
        ) },
      ]} />
      <Dialog open={creating} onOpenChange={setCreating}><DialogContent title="New stock transfer" size="xl"><NewTransfer onDone={() => setCreating(false)} /></DialogContent></Dialog>
    </div>
  );
}
