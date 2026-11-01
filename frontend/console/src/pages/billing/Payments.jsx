import { useState } from 'react';
import { Plus, QrCode } from 'lucide-react';
import { CollectOnline, usePayConfig } from '@/components/billing/CollectOnline';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Pagination } from '@/components/common/DataTable';
import { StatCard } from '@/components/common/StatCard';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/common/Field';
import { PatientPicker } from '@/components/clinic/PatientPicker';
import { Can } from '@/components/common/Can';
import { usePaged, useAction } from '@/hooks/queries';
import { post } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { fmtDateTime, inr, todayIST, addDays } from '@/lib/utils';

function AdvanceForm({ onDone }) {
  const branchId = useAuth((s) => s.branchId);
  const [patient, setPatient] = useState(null);
  const [mode, setMode] = useState('cash');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const { data: payCfg } = usePayConfig();
  const [online, setOnline] = useState(false);
  const save = useAction(() => post('/billing/advances', { branch: branchId, patient: patient._id, mode, amount: Number(amount), reference: reference || undefined }), { success: 'Advance received', invalidate: ['/billing/payments', 'advance'], onSuccess: onDone });
  if (!branchId) return <p className="text-sm text-destructive">Select a branch from the top bar first.</p>;
  return (
    <div className="space-y-3">
      <Field label="Patient"><PatientPicker value={patient} onChange={setPatient} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Mode"><Select value={mode} onChange={(e) => setMode(e.target.value)}>{['cash', 'upi', 'card', 'bank'].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}</Select></Field>
        <Field label="Amount"><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      </div>
      <Field label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
      <div className="flex justify-end gap-2">
        {payCfg?.enabled && <Button variant="outline" disabled={!patient || !(Number(amount) > 0)} onClick={() => setOnline(true)}><QrCode /> Collect online</Button>}
        <Button disabled={!patient || !(Number(amount) > 0)} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
      </div>
      {patient && <CollectOnline open={online} onOpenChange={setOnline} purpose="advance" patient={patient} branch={branchId} defaultAmount={amount} onPaid={() => setTimeout(() => onDone?.(), 2000)} />}
    </div>
  );
}

export default function Payments() {
  const [from, setFrom] = useState(addDays(todayIST(), -7));
  const [to, setTo] = useState(todayIST());
  const [mode, setMode] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [adv, setAdv] = useState(false);
  const { data, isLoading } = usePaged(['/billing/payments'], '/billing/payments', { from, to, mode: mode || undefined, kind: kind || undefined, page, limit: 30 });
  const sum = (k, m) => (data?.meta?.byMode || []).filter((x) => x._id.kind === k && (!m || x._id.mode === m)).reduce((a, x) => a + x.amount, 0);
  const inflow = sum('payment') + sum('advance');
  return (
    <div>
      <PageHeader title="Payments" description="Receipts, advances and refunds" actions={<Can perm="billing.create"><Button onClick={() => setAdv(true)}><Plus /> Receive advance</Button></Can>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Net collected" value={inr(inflow - sum('refund'))} loading={isLoading} />
        <StatCard label="Cash" value={inr(sum('payment', 'cash') + sum('advance', 'cash'))} loading={isLoading} tone="emerald" />
        <StatCard label="UPI" value={inr(sum('payment', 'upi') + sum('advance', 'upi'))} loading={isLoading} tone="sky" />
        <StatCard label="Card" value={inr(sum('payment', 'card') + sum('advance', 'card'))} loading={isLoading} tone="violet" />
        <StatCard label="Refunds" value={inr(sum('refund'))} loading={isLoading} tone="red" />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        <Select className="w-32" value={mode} onChange={(e) => setMode(e.target.value)} placeholder="All modes">{['cash', 'upi', 'card', 'bank', 'advance'].map((m) => <option key={m}>{m}</option>)}</Select>
        <Select className="w-40" value={kind} onChange={(e) => setKind(e.target.value)} placeholder="All kinds">{['payment', 'advance', 'advance_adjust', 'refund'].map((m) => <option key={m}>{m}</option>)}</Select>
      </div>
      <DataTable loading={isLoading} rows={data?.items} footer={<Pagination meta={data?.meta} page={page} setPage={setPage} />} columns={[
        { key: 'r', header: 'Receipt', cell: (p) => <span className="font-mono text-xs">{p.receiptNo}</span> },
        { key: 'd', header: 'Date', cell: (p) => fmtDateTime(p.createdAt) },
        { key: 'k', header: 'Kind', cell: (p) => <Badge variant={p.kind === 'refund' ? 'danger' : p.kind === 'advance' ? 'info' : 'default'}>{p.kind.replace('_', ' ')}</Badge> },
        { key: 'm', header: 'Mode', cell: (p) => p.mode.toUpperCase() },
        { key: 'p', header: 'Patient', cell: (p) => p.patient?.name || '—' },
        { key: 'i', header: 'Invoice', cell: (p) => p.invoice?.invoiceNo || '—' },
        { key: 'b', header: 'Branch', cell: (p) => p.branch?.code },
        { key: 'by', header: 'By', cell: (p) => p.by?.name },
        { key: 'a', header: 'Amount', className: 'text-right', cell: (p) => <span className={p.kind === 'refund' ? 'text-red-600' : ''}>{inr(p.amount)}</span> },
      ]} />
      <Dialog open={adv} onOpenChange={setAdv}><DialogContent title="Receive advance" size="lg"><AdvanceForm onDone={() => setAdv(false)} /></DialogContent></Dialog>
    </div>
  );
}
