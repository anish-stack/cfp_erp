import { useNavigate } from 'react-router-dom';
import { CalendarDays, IndianRupee, UserPlus, BellRing, Target, PackageX, Clock, AlertTriangle } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from 'recharts';
import { PageHeader } from '@/components/common/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { useGet } from '@/hooks/queries';
import { useAuth } from '@/store/auth';
import { inr, fmtTime, fmtDate } from '@/lib/utils';

export default function Dashboard() {
  const nav = useNavigate();
  const me = useAuth((s) => s.me);
  const { data: d, isLoading } = useGet('dashboard', '/reports/dashboard', undefined, { refetchInterval: 60_000 });
  const a = d?.access || {};

  return (
    <div className="space-y-5">
      <PageHeader title={`Hello, ${me.user.name.split(' ')[0]}`} description={d ? `Today · ${fmtDate(d.today)}` : ' '} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(a.appointments || isLoading) && <StatCard label="Appointments today" value={d?.appointments.total ?? 0} hint={d ? `${d.appointments.byStatus.completed || 0} completed · ${d.appointments.byStatus.checked_in || 0} waiting` : ''} icon={CalendarDays} loading={isLoading} onClick={() => nav('/appointments')} />}
        {(a.billing || isLoading) && <StatCard label="Collection today" value={inr(d?.collectionToday)} hint={d ? `${inr(d.outstanding.amt)} outstanding` : ''} icon={IndianRupee} tone="emerald" loading={isLoading} onClick={() => nav('/payments')} />}
        <StatCard label="New patients" value={d?.newPatients ?? 0} icon={UserPlus} tone="sky" loading={isLoading} onClick={() => nav('/patients')} />
        <StatCard label="Follow-ups due" value={d?.followupsDue ?? 0} icon={BellRing} tone="amber" loading={isLoading} onClick={() => nav('/followups')} />
        {a.leads && <StatCard label="Leads today" value={d?.leadsToday ?? 0} icon={Target} tone="violet" loading={isLoading} onClick={() => nav('/leads')} />}
        {a.inventory && <StatCard label="Low stock items" value={d?.lowStock ?? 0} icon={PackageX} tone="red" loading={isLoading} onClick={() => nav('/inventory?tab=alerts')} />}
        {a.inventory && <StatCard label="Expiring ≤ 60 days" value={d?.expiring ?? 0} icon={AlertTriangle} tone="amber" loading={isLoading} onClick={() => nav('/inventory?tab=alerts')} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Last 14 days</CardTitle></CardHeader>
          <CardContent className="h-72">
            {isLoading ? <Skeleton className="h-full w-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.series} margin={{ left: -10, right: 8 }}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(174 72% 30%)" stopOpacity={0.35} /><stop offset="100%" stopColor="hsl(174 72% 30%)" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(214 25% 89%)" />
                  <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="l" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  {a.billing && <YAxis yAxisId="r" orientation="right" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />}
                  <Tooltip formatter={(v, n) => (n === 'revenue' ? inr(v) : v)} />
                  {a.billing && <Area yAxisId="r" type="monotone" dataKey="revenue" stroke="hsl(174 72% 30%)" fill="url(#rev)" strokeWidth={2} />}
                  <Area yAxisId="l" type="monotone" dataKey="appointments" stroke="#0ea5e9" fill="transparent" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4" /> Up next today</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {isLoading ? <Skeleton className="h-40 w-full" /> : !d.upcoming?.length ? <EmptyState title="No pending appointments" /> : d.upcoming.map((u) => (
              <button key={u._id} onClick={() => nav(`/appointments/${u._id}`)} className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left hover:bg-muted">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{u.patient?.name}</p>
                  <p className="text-xs text-muted-foreground">{fmtTime(u.start)} · {u.doctor?.name}{u.tokenNo ? ` · Token ${u.tokenNo}` : ''}</p>
                </div>
                <StatusBadge status={u.status} />
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      {d?.byBranch?.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Collections by branch (this month)</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.byBranch} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(214 25% 89%)" />
                <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v) => inr(v)} />
                <Bar dataKey="amt" name="Collected" fill="hsl(174 72% 30%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
