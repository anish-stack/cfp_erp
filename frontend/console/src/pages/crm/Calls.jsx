import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PhoneIncoming, PhoneOutgoing, Delete, PhoneCall, RefreshCw, ArrowRight, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Pagination } from '@/components/common/DataTable';
import { SearchInput } from '@/components/common/SearchInput';
import { StatCard } from '@/components/common/StatCard';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/common/EmptyState';
import { CallButton, RecordingPlayer, useCallConfig, fmtDuration } from '@/components/clinic/Calling';
import { usePaged, useGet, useAction } from '@/hooks/queries';
import { post, patch } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useCan } from '@/store/auth';
import { fmtDateTime, titleCase, todayIST, errMsg } from '@/lib/utils';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const OUTCOMES = ['connected', 'no_answer', 'busy', 'switched_off', 'wrong_number', 'callback'];

function Dialer({ cfg }) {
  const [num, setNum] = useState('');
  const [busy, setBusy] = useState(false);
  const digits = num.replace(/\D/g, '');
  const valid = /^\d{10}$/.test(digits.slice(-10)) && digits.length >= 10;
  const dial = async () => {
    if (!cfg?.enabled || !cfg.agentPhone) return (location.href = `tel:${digits}`);
    setBusy(true);
    try {
      await post('/crm/calls', { phone: digits });
      toast.success(`Exotel is calling you on ${cfg.agentPhone} — pick up to connect`, { duration: 8000 });
      setNum('');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="p-4">
      <Input value={num} onChange={(e) => setNum(e.target.value.replace(/[^\d+*#]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && valid && dial()} placeholder="Enter number" className="mb-3 h-12 text-center text-xl tracking-wider" inputMode="tel" />
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k) => <Button key={k} variant="outline" className="h-12 text-lg" onClick={() => setNum((n) => n + k)}>{k}</Button>)}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <span />
        <Button className="h-12 rounded-full bg-emerald-600 hover:bg-emerald-700" disabled={!valid} loading={busy} onClick={dial}><PhoneCall /></Button>
        <Button variant="ghost" className="h-12" onClick={() => setNum((n) => n.slice(0, -1))}><Delete /></Button>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        {cfg?.enabled ? (cfg.agentPhone ? `Exotel rings ${cfg.agentPhone} first, then the customer · calls are recorded` : 'Add your mobile number to your staff profile to use Exotel') : 'Exotel not configured — calls are placed from this device'}
      </p>
    </Card>
  );
}

function Queue() {
  const nav = useNavigate();
  const can = useCan();
  const [all, setAll] = useState(false);
  const { data = [], isLoading, refetch } = useGet(['call-queue', all], '/crm/calls/queue', { all: all ? 'true' : undefined });
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Call queue <Badge variant="secondary" className="ml-1">{data.length}</Badge></CardTitle>
        <div className="flex items-center gap-2">
          {can('leads.assign') && <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Whole team</label>}
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => refetch()}><RefreshCw /></Button>
        </div>
      </CardHeader>
      <CardContent className="max-h-[520px] space-y-1 overflow-y-auto scrollbar-thin">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && !data.length && <EmptyState title="Queue clear" description="No overdue follow-ups or uncontacted leads." />}
        {data.map((l) => (
          <div key={l._id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{l.name} <span className="text-xs text-muted-foreground">{l.phone}</span></p>
              <p className="flex items-center gap-1.5 text-xs">
                <span className="h-2 w-2 rounded-full" style={{ background: l.stage?.color }} />{l.stage?.name}
                <Badge variant={l.reason === 'overdue' ? 'danger' : l.reason === 'due today' ? 'warning' : 'info'}>{l.reason}</Badge>
                {l.condition && <span className="text-muted-foreground">· {l.condition}</span>}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <CallButton lead={l} label="" size="icon" variant="outline" className="h-8 w-8" onPlaced={() => setTimeout(refetch, 2000)} />
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => nav(`/leads/${l._id}`)}><ArrowRight /></Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function CallLog() {
  const nav = useNavigate();
  const can = useCan();
  const [q, setQ] = useState('');
  const [direction, setDirection] = useState('');
  const [status, setStatus] = useState('');
  const [agent, setAgent] = useState('');
  const [from, setFrom] = useState('');
  const [recorded, setRecorded] = useState(false);
  const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  const { data, isLoading } = usePaged(['/crm/calls'], '/crm/calls', { q: dq || undefined, direction: direction || undefined, status: status || undefined, agent: agent || undefined, from: from || undefined, recorded: recorded ? 'true' : undefined, page, limit: 25 }, { refetchInterval: 20_000 });
  const setOutcome = useAction(({ id, outcome }) => patch(`/crm/calls/${id}`, { outcome }), { success: 'Saved', invalidate: ['/crm/calls'] });
  const refresh = useAction((id) => post(`/crm/calls/${id}/refresh`), { success: 'Updated from Exotel', invalidate: ['/crm/calls'] });
  const st = Object.fromEntries((data?.meta?.stats || []).map((x) => [x._id, x]));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Outbound" value={st.outbound?.n ?? 0} hint={`${st.outbound?.connected ?? 0} connected`} icon={PhoneOutgoing} loading={isLoading} />
        <StatCard label="Inbound" value={st.inbound?.n ?? 0} hint={`${st.inbound?.connected ?? 0} answered`} icon={PhoneIncoming} tone="sky" loading={isLoading} />
        <StatCard label="Talk time" value={fmtDuration((st.outbound?.talk || 0) + (st.inbound?.talk || 0))} tone="emerald" loading={isLoading} />
        <StatCard label="Connect rate" value={`${st.outbound?.n ? Math.round((st.outbound.connected / st.outbound.n) * 100) : 0}%`} tone="violet" loading={isLoading} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Number or lead name" />
        <Select className="w-32" value={direction} onChange={(e) => setDirection(e.target.value)} placeholder="All calls"><option value="outbound">Outbound</option><option value="inbound">Inbound</option></Select>
        <Select className="w-36" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Any status">{['completed', 'no-answer', 'busy', 'failed', 'in-progress', 'queued'].map((s) => <option key={s}>{s}</option>)}</Select>
        <Select className="w-32" value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="Everyone"><option value="me">My calls</option></Select>
        <Input type="date" className="w-40" value={from} max={todayIST()} onChange={(e) => setFrom(e.target.value)} />
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={recorded} onChange={(e) => setRecorded(e.target.checked)} /> With recording</label>
      </div>
      <DataTable loading={isLoading} rows={data?.items} footer={<Pagination meta={data?.meta} page={page} setPage={setPage} />} columns={[
        { key: 'd', header: '', className: 'w-8', cell: (c) => (c.direction === 'inbound' ? <PhoneIncoming className="h-4 w-4 text-sky-600" /> : <PhoneOutgoing className="h-4 w-4 text-primary" />) },
        { key: 'w', header: 'When', cell: (c) => <span className="text-xs">{fmtDateTime(c.startedAt || c.createdAt)}</span> },
        { key: 'who', header: 'Contact', cell: (c) => (c.lead ? <button className="text-left" onClick={() => nav(`/leads/${c.lead._id}`)}><p className="font-medium text-primary">{c.lead.name}</p><p className="text-xs text-muted-foreground">{c.direction === 'inbound' ? c.from : c.to}</p></button> : <div><p className="font-medium">{c.patient?.name || '—'}</p><p className="text-xs text-muted-foreground">{c.direction === 'inbound' ? c.from : c.to}</p></div>) },
        { key: 'ivr', header: 'IVR', cell: (c) => (c.ivrLabel ? <Badge variant="outline">{c.ivrDigits} · {c.ivrLabel}</Badge> : '—') },
        { key: 'a', header: 'Agent', cell: (c) => c.agent?.name || '—' },
        { key: 's', header: 'Status', cell: (c) => <StatusBadge status={c.status === 'completed' ? 'done' : c.status === 'no-answer' ? 'missed' : c.status} /> },
        { key: 'o', header: 'Outcome', cell: (c) => (can('leads.edit') ? <Select className="h-8 w-32" value={c.outcome || ''} onChange={(e) => setOutcome.mutate({ id: c._id, outcome: e.target.value })} placeholder="—">{OUTCOMES.map((o) => <option key={o} value={o}>{titleCase(o)}</option>)}</Select> : titleCase(c.outcome || '—')) },
        { key: 't', header: 'Talk', cell: (c) => fmtDuration(c.durationSec) },
        { key: 'r', header: 'Recording', cell: (c) => (c.hasRecording ? <RecordingPlayer callId={c._id} compact /> : c.sid && !String(c.sid).startsWith('demo-') && ['completed', 'in-progress', 'queued'].includes(c.status) ? <Button size="sm" variant="ghost" className="h-7 px-2" loading={refresh.isPending && refresh.variables === c._id} onClick={() => refresh.mutate(c._id)}><RefreshCw /> Fetch</Button> : <span className="text-xs text-muted-foreground">—</span>) },
      ]} />
    </div>
  );
}

export default function Calls() {
  const { data: cfg } = useCallConfig();
  return (
    <div>
      <PageHeader title="Calls & Dialer" description="Exotel click-to-call, inbound IVR and recordings" />
      {cfg && !cfg.enabled && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
          <span>Exotel keys are not set on the server, so calls open your phone dialer and are not recorded. Add <code>EXOTEL_*</code> to the API <code>.env</code> to enable click-to-call, IVR and recordings.</span>
        </div>
      )}
      <Tabs defaultValue="dialer">
        <TabsList><TabsTrigger value="dialer">Dialer</TabsTrigger><TabsTrigger value="log">Call log</TabsTrigger></TabsList>
        <TabsContent value="dialer" className="grid gap-4 lg:grid-cols-3">
          <Dialer cfg={cfg} />
          <div className="lg:col-span-2"><Queue /></div>
        </TabsContent>
        <TabsContent value="log"><CallLog /></TabsContent>
      </Tabs>
    </div>
  );
}
