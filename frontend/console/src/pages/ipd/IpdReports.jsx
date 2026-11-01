import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { BedDouble, LogIn, LogOut, Clock, Percent, IndianRupee, Wallet, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CLAIM_STATUS, PAYERS } from '@/components/ipd/ipdUtils';
import { get } from '@/lib/api';
import { useBranchKey } from '@/hooks/queries';
import { inr, todayIST, addDays } from '@/lib/utils';

const COLORS = ['#e21f26', '#0ea5e9', '#f59e0b', '#10b981', '#8b5cf6', '#64748b'];

export default function IpdReports() {
  const b = useBranchKey();
  const [from, setFrom] = useState(addDays(todayIST(), -29));
  const [to, setTo] = useState(todayIST());
  const { data: d, isLoading } = useQuery({ queryKey: ['ipd-reports', from, to, b], queryFn: () => get('/ipd/reports', { from, to }) });
  const k = d?.kpis;
  const csv = () => {
    const rows = [['Date', 'Admissions', 'Discharges', 'Census'], ...(d?.series || []).map((r) => [r.date, r.admissions, r.discharges, r.census])];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ipd-${from}-${to}.csv`; a.click();
  };
  return (
    <div className="space-y-4">
      <PageHeader title="IPD reports" description="Occupancy, stays, revenue, payers, procedures and insurance claims"
        actions={<div className="flex flex-wrap items-center gap-2"><Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} /><span>→</span><Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          {[[7, '7 d'], [30, '30 d'], [90, '90 d']].map(([n, l]) => <Button key={n} size="sm" variant="outline" onClick={() => { setFrom(addDays(todayIST(), -(n - 1))); setTo(todayIST()); }}>{l}</Button>)}
          <Button size="sm" variant="outline" onClick={csv}>CSV</Button></div>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Occupancy" value={k ? `${k.occupancy}%` : '—'} hint={k && `${k.bedDays} bed-days · ${k.beds} beds`} icon={Percent} loading={isLoading} />
        <StatCard label="Admissions" value={k?.admissions ?? '—'} hint={k && `${k.dayCare} day care · ${k.emergency} emergency`} icon={LogIn} tone="sky" loading={isLoading} />
        <StatCard label="Discharges" value={k?.discharges ?? '—'} hint={k && `${k.inHouse} in hospital now`} icon={LogOut} tone="emerald" loading={isLoading} />
        <StatCard label="Avg. length of stay" value={k ? `${k.alos} d` : '—'} icon={Clock} tone="violet" loading={isLoading} />
        <StatCard label="IPD revenue" value={inr(k?.revenue)} icon={IndianRupee} tone="emerald" loading={isLoading} />
        <StatCard label="Collected" value={inr(k?.collected)} icon={Wallet} tone="sky" loading={isLoading} />
        <StatCard label="Outstanding" value={inr(k?.outstanding)} icon={AlertCircle} tone="red" loading={isLoading} />
        <StatCard label="Beds" value={k?.beds ?? '—'} icon={BedDouble} loading={isLoading} />
      </div>
      {isLoading ? <Skeleton className="h-72" /> : d && (
        <>
          <Card className="h-72 p-4">
            <p className="mb-2 text-sm font-semibold">Daily census, admissions & discharges</p>
            <ResponsiveContainer height="90%"><LineChart data={d.series}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="date" fontSize={10} tickFormatter={(x) => x.slice(5)} /><YAxis fontSize={10} allowDecimals={false} /><Tooltip /><Legend /><Line dataKey="census" name="In hospital" stroke="#e21f26" strokeWidth={2} dot={false} /><Line dataKey="admissions" name="Admissions" stroke="#0ea5e9" dot={false} /><Line dataKey="discharges" name="Discharges" stroke="#10b981" dot={false} /></LineChart></ResponsiveContainer>
          </Card>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="h-72 p-4">
              <p className="mb-2 text-sm font-semibold">Revenue by payer</p>
              <ResponsiveContainer height="88%"><PieChart><Pie data={d.byPayer.map((x) => ({ ...x, name: PAYERS[x.name] || x.name }))} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} label={(x) => inr(x.value)} fontSize={10}>{d.byPayer.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip formatter={(v) => inr(v)} /><Legend /></PieChart></ResponsiveContainer>
            </Card>
            <Card className="h-72 p-4">
              <p className="mb-2 text-sm font-semibold">Revenue by ward</p>
              <ResponsiveContainer height="88%"><BarChart data={d.byWard}><XAxis dataKey="name" fontSize={10} /><YAxis fontSize={10} /><Tooltip formatter={(v) => inr(v)} /><Bar dataKey="value" name="Revenue" fill="#e21f26" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
            </Card>
            <Card className="h-72 p-4">
              <p className="mb-2 text-sm font-semibold">Top procedures</p>
              <ResponsiveContainer height="88%"><BarChart data={d.procedures} layout="vertical"><XAxis type="number" fontSize={10} allowDecimals={false} /><YAxis type="category" dataKey="name" width={130} fontSize={9} /><Tooltip /><Bar dataKey="value" name="Done" fill="#0ea5e9" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer>
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <p className="mb-2 text-sm font-semibold">Admissions by consultant</p>
              {d.byDoctor.map((x) => <p key={x.name} className="flex justify-between border-b py-1.5 text-sm last:border-0"><span>{x.name}</span><b>{x.value}</b></p>)}
              {!d.byDoctor.length && <p className="text-sm text-muted-foreground">No admissions in range.</p>}
            </Card>
            <Card className="p-4">
              <p className="mb-2 text-sm font-semibold">Insurance claims</p>
              {d.claims.map((x) => <p key={x._id} className="flex justify-between border-b py-1.5 text-sm last:border-0"><span>{CLAIM_STATUS[x._id]?.[0] || x._id} ({x.n})</span><span>claimed {inr(x.claimed)} · settled {inr(x.settled)}{x.deduction ? ` · ded. ${inr(x.deduction)}` : ''}</span></p>)}
              {!d.claims.length && <p className="text-sm text-muted-foreground">No claims.</p>}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
