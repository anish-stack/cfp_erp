import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldCheck, IndianRupee, Clock, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { DataTable, Pagination } from '@/components/common/DataTable';
import { SearchInput } from '@/components/common/SearchInput';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Dialog as Sheet, SheetContent } from '@/components/ui/dialog';
import { Field } from '@/components/common/Field';
import { CLAIM_STATUS } from '@/components/ipd/ipdUtils';
import { get, getPaged, patch, post, openFile } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useBranchKey } from '@/hooks/queries';
import { useCan } from '@/store/auth';
import { cn, errMsg, fmtDate, fmtDateTime, inr } from '@/lib/utils';

const NEXT = {
  pre_auth_pending: ['pre_auth_approved', 'pre_auth_rejected'], pre_auth_approved: ['ready_to_submit'], pre_auth_rejected: ['closed'],
  ready_to_submit: ['submitted'], submitted: ['query', 'approved', 'rejected'], query: ['submitted', 'rejected'], approved: [], rejected: ['closed'], settled: ['closed'], closed: [],
};

function ClaimSheet({ id, onClose }) {
  const can = useCan();
  const qc = useQueryClient();
  const { data: c, refetch } = useQuery({ queryKey: ['ipd-claim', id], enabled: !!id, queryFn: () => get(`/ipd/claims/${id}`) });
  const [f, setF] = useState(null);
  const [note, setNote] = useState('');
  const [settle, setSettle] = useState({ settledAmount: '', tds: '', deduction: '', deductionReason: '', reference: '' });
  useEffect(() => { if (c) setF({ insurer: c.insurer || '', tpa: c.tpa || '', policyNo: c.policyNo || '', cardNo: c.cardNo || '', preAuthNo: c.preAuthNo || '', claimNo: c.claimNo || '', approvedAmount: c.approvedAmount ?? '', claimedAmount: c.claimedAmount ?? '', followUpOn: c.followUpOn ? c.followUpOn.slice(0, 10) : '' }); }, [c]);
  const save = async (status) => {
    try {
      const num = (v) => (v === '' || v == null ? undefined : Number(v));
      await patch(`/ipd/claims/${id}`, { ...f, approvedAmount: num(f.approvedAmount), claimedAmount: num(f.claimedAmount), followUpOn: f.followUpOn ? new Date(f.followUpOn).toISOString() : null, status, note: note || undefined });
      toast.success(status ? `→ ${CLAIM_STATUS[status][0]}` : 'Saved');
      setNote('');
      refetch();
      qc.invalidateQueries({ queryKey: ['ipd-claims'] });
    } catch (e) { toast.error(errMsg(e)); }
  };
  const doSettle = async () => {
    try {
      await post(`/ipd/claims/${id}/settle`, { settledAmount: Number(settle.settledAmount) || 0, tds: Number(settle.tds) || 0, deduction: Number(settle.deduction) || 0, deductionReason: settle.deductionReason || undefined, reference: settle.reference || undefined });
      toast.success('Settlement posted to the bill');
      refetch();
      qc.invalidateQueries({ queryKey: ['ipd-claims'] });
    } catch (e) { toast.error(errMsg(e)); }
  };
  const editable = can('ipd.edit') && c && !['settled', 'closed'].includes(c.status);
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={c ? `Claim ${c.claimRef}` : 'Claim'} width="max-w-2xl">
        {!c || !f ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : (
          <div className="space-y-4 overflow-y-auto p-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="font-semibold">{c.patient?.name} <span className="text-xs text-muted-foreground">{c.patient?.patientId}</span></p><p className="text-xs text-muted-foreground"><Link className="text-primary underline" to={`/ipd/admissions/${c.admission?._id}`}>{c.admission?.admissionNo}</Link> · {fmtDate(c.admission?.admittedAt)} → {c.admission?.dischargedAt ? fmtDate(c.admission.dischargedAt) : 'in hospital'}</p></div>
              <Badge variant={CLAIM_STATUS[c.status][1]}>{CLAIM_STATUS[c.status][0]}</Badge>
            </div>
            {c.invoice && <p className="rounded-md bg-muted p-2 text-sm">Bill <Link className="text-primary underline" to={`/billing/${c.invoice._id}`}>{c.invoice.invoiceNo}</Link> · total {inr(c.invoice.grandTotal)} · paid {inr(c.invoice.paid)} · <b>balance {inr(c.invoice.balance)}</b></p>}
            <div className="grid grid-cols-2 gap-2">
              {[['insurer', 'Insurer'], ['tpa', 'TPA'], ['policyNo', 'Policy no.'], ['cardNo', 'Card / member ID'], ['preAuthNo', 'Pre-auth no.'], ['claimNo', 'Claim no. (TPA)']].map(([k, l]) => <Field key={k} label={l}><Input disabled={!editable} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
              <Field label="Approved amount ₹"><Input disabled={!editable} type="number" value={f.approvedAmount} onChange={(e) => setF({ ...f, approvedAmount: e.target.value })} /></Field>
              <Field label="Claimed amount ₹"><Input disabled={!editable} type="number" value={f.claimedAmount} onChange={(e) => setF({ ...f, claimedAmount: e.target.value })} /></Field>
              <Field label="Follow up on"><Input disabled={!editable} type="date" value={f.followUpOn} onChange={(e) => setF({ ...f, followUpOn: e.target.value })} /></Field>
            </div>
            {editable && (
              <div className="space-y-2">
                <Textarea rows={2} placeholder="Note (query details, courier no., call with TPA…)" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => save()}>Save</Button>
                  {(NEXT[c.status] || []).map((st) => <Button key={st} size="sm" variant={['rejected', 'pre_auth_rejected'].includes(st) ? 'ghost' : 'default'} className={cn(['rejected', 'pre_auth_rejected'].includes(st) && 'text-destructive')} onClick={() => save(st)}>→ {CLAIM_STATUS[st][0]}</Button>)}
                </div>
              </div>
            )}
            {editable && ['approved', 'submitted', 'query'].includes(c.status) && c.invoice && (
              <div className="space-y-2 rounded-md border p-3">
                <p className="flex items-center gap-2 text-sm font-semibold"><IndianRupee className="h-4 w-4" /> Record settlement</p>
                <div className="grid grid-cols-3 gap-2">
                  <Input type="number" placeholder="Amount received" value={settle.settledAmount} onChange={(e) => setSettle({ ...settle, settledAmount: e.target.value })} />
                  <Input type="number" placeholder="TDS" value={settle.tds} onChange={(e) => setSettle({ ...settle, tds: e.target.value })} />
                  <Input type="number" placeholder="Deduction" value={settle.deduction} onChange={(e) => setSettle({ ...settle, deduction: e.target.value })} />
                  <Input className="col-span-2" placeholder="Deduction reason (non-payables, co-pay…)" value={settle.deductionReason} onChange={(e) => setSettle({ ...settle, deductionReason: e.target.value })} />
                  <Input placeholder="UTR / reference" value={settle.reference} onChange={(e) => setSettle({ ...settle, reference: e.target.value })} />
                </div>
                <p className="text-xs text-muted-foreground">Amount + TDS is posted to the bill as an “insurance” payment. Anything still due afterwards is the patient’s share.</p>
                <Button size="sm" disabled={!settle.settledAmount} onClick={doSettle}>Post settlement</Button>
              </div>
            )}
            {c.status === 'settled' && <p className="rounded-md bg-emerald-50 p-2 text-sm text-emerald-800">Settled {inr(c.settledAmount)}{c.tds ? ` + TDS ${inr(c.tds)}` : ''}{c.deduction ? ` · deduction ${inr(c.deduction)} (${c.deductionReason || '—'})` : ''} · {fmtDate(c.settledAt)}{c.settlementRef ? ` · ${c.settlementRef}` : ''}</p>}
            <div>
              <p className="mb-1 text-sm font-semibold">Claim documents</p>
              {(c.admission?.documents || []).filter((d) => ['claim', 'report', 'scan', 'id_proof', 'consent'].includes(d.category)).map((d) => <button key={d._id} type="button" className="mr-2 text-xs text-primary underline" onClick={() => openFile(`/ipd/admissions/${c.admission._id}/documents/${d._id}`)}>{d.title}</button>)}
              <p className="text-xs text-muted-foreground">Upload ID proof, reports and claim forms on the admission (Overview → Documents). Discharge summary & bill PDFs are on the admission.</p>
            </div>
            <div>
              <p className="mb-1 text-sm font-semibold">Timeline</p>
              <div className="space-y-1.5 border-l pl-3">
                {[...(c.timeline || [])].reverse().map((t, i) => <div key={i} className="text-xs"><Badge variant={CLAIM_STATUS[t.status]?.[1] || 'outline'}>{CLAIM_STATUS[t.status]?.[0] || t.status}</Badge> <span className="text-muted-foreground">{fmtDateTime(t.at)} · {t.by?.name}</span>{t.note && <p className="mt-0.5">{t.note}</p>}</div>)}
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function Claims() {
  const [sp, setSp] = useSearchParams();
  const b = useBranchKey();
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounce(q, 300);
  const { data, isLoading } = useQuery({ queryKey: ['ipd-claims', status, dq, page, b], queryFn: () => getPaged('/ipd/claims', { status: status || undefined, q: dq || undefined, page, limit: 25 }) });
  const sum = Object.fromEntries((data?.meta?.summary || []).map((x) => [x._id, x]));
  const open = sp.get('open');
  const pick = (k) => Object.entries(sum).filter(([s]) => k.includes(s)).reduce((a, [, x]) => ({ n: a.n + x.n, claimed: a.claimed + x.claimed, settled: a.settled + x.settled }), { n: 0, claimed: 0, settled: 0 });
  const pending = pick(['ready_to_submit', 'submitted', 'query', 'approved']);
  return (
    <div className="space-y-4">
      <PageHeader title="Insurance / TPA claims" description="Pre-authorisation → submission → queries → settlement" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Pre-auth pending" value={pick(['pre_auth_pending']).n} icon={Clock} tone="amber" loading={isLoading} />
        <StatCard label="Awaiting payment" value={pending.n} hint={inr(pending.claimed)} icon={ShieldCheck} tone="sky" loading={isLoading} />
        <StatCard label="Queries" value={pick(['query']).n} icon={AlertCircle} tone="red" loading={isLoading} />
        <StatCard label="Settled" value={inr(pick(['settled', 'closed']).settled)} icon={IndianRupee} tone="emerald" loading={isLoading} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-52" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="open">All open</option><option value="">All</option>{Object.entries(CLAIM_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Patient, claim no., insurer, policy" className="w-72" />
      </div>
      <DataTable loading={isLoading} rows={data?.items} onRowClick={(c) => setSp({ open: c._id })} columns={[
        { key: 'r', header: 'Claim', cell: (c) => <div><p className="font-mono text-xs">{c.claimRef}</p><p className="text-xs text-muted-foreground">{c.claimNo || '—'}</p></div> },
        { key: 'p', header: 'Patient', cell: (c) => <div><p className="font-medium">{c.patient?.name}</p><p className="text-xs text-muted-foreground">{c.admission?.admissionNo}</p></div> },
        { key: 'i', header: 'Insurer / TPA', cell: (c) => <div><p>{c.insurer || '—'}</p><p className="text-xs text-muted-foreground">{c.tpa}</p></div> },
        { key: 'a', header: 'Approved', cell: (c) => (c.approvedAmount ? inr(c.approvedAmount) : '—') },
        { key: 'c', header: 'Claimed', cell: (c) => (c.claimedAmount ? inr(c.claimedAmount) : '—') },
        { key: 's', header: 'Settled', cell: (c) => (c.settledAmount ? inr(c.settledAmount) : '—') },
        { key: 'b', header: 'Bill due', cell: (c) => (c.invoice ? inr(c.invoice.balance) : '—') },
        { key: 'st', header: 'Status', cell: (c) => <Badge variant={CLAIM_STATUS[c.status][1]}>{CLAIM_STATUS[c.status][0]}</Badge> },
        { key: 'u', header: 'Updated', cell: (c) => <span className="text-xs">{fmtDate(c.updatedAt)}</span> },
      ]} footer={<Pagination meta={data?.meta} page={page} setPage={setPage} />} />
      <ClaimSheet id={open} onClose={() => setSp({})} />
    </div>
  );
}
