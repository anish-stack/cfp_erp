import { useNavigate } from 'react-router-dom';
import { Target, AlarmClock, AlertCircle, ListTodo } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, PieChart, Pie, Legend } from 'recharts';
import { PageHeader } from '@/components/common/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useGet } from '@/hooks/queries';
import { titleCase } from '@/lib/utils';

const PIE = ['#0f766e', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ef4444', '#22c55e', '#64748b', '#ec4899', '#14b8a6', '#a855f7', '#eab308'];

export default function CrmHome() {
  const nav = useNavigate();
  const { data: d, isLoading } = useGet('crm-dash', '/crm/dashboard', undefined, { refetchInterval: 60_000 });
  return (
    <div className="space-y-5">
      <PageHeader title="Sales home" description="Your pipeline at a glance" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="New leads today" value={d?.newToday ?? 0} icon={Target} loading={isLoading} onClick={() => nav('/leads')} />
        <StatCard label="Follow-ups today" value={d?.followToday ?? 0} icon={AlarmClock} tone="amber" loading={isLoading} onClick={() => nav('/leads')} />
        <StatCard label="Overdue follow-ups" value={d?.overdue ?? 0} icon={AlertCircle} tone="red" loading={isLoading} onClick={() => nav('/leads')} />
        <StatCard label="Open tasks" value={d?.tasksOpen ?? 0} icon={ListTodo} tone="violet" loading={isLoading} onClick={() => nav('/tasks')} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Funnel</CardTitle></CardHeader>
          <CardContent className="h-80">
            {isLoading ? <Skeleton className="h-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.funnel} layout="vertical" margin={{ left: 40 }}>
                  <XAxis type="number" allowDecimals={false} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={140} fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>{d.funnel.map((s) => <Cell key={s._id} fill={s.color} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Sources (30 days)</CardTitle></CardHeader>
          <CardContent className="h-80">
            {isLoading ? <Skeleton className="h-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={d.bySource.map((s) => ({ name: titleCase(s._id), value: s.n }))} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90}>
                    {d.bySource.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                  </Pie>
                  <Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
