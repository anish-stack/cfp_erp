import { useState } from 'react';
import { Download } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts';
import { PageHeader } from '@/components/common/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { DataTable } from '@/components/common/DataTable';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useGet } from '@/hooks/queries';
import { openFile } from '@/lib/api';
import { useCan } from '@/store/auth';
import { inr, todayIST, addDays, titleCase } from '@/lib/utils';

const C = ['#0f766e', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ef4444', '#22c55e', '#64748b', '#ec4899'];
const grid = <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(214 25% 89%)" />;

function ChartCard({ title, children, loading, className }) {
  return (
    <Card className={className}>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="h-72">{loading ? <Skeleton className="h-full" /> : <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>}</CardContent>
    </Card>
  );
}

export default function Reports() {
  const can = useCan();
  const [from, setFrom] = useState(addDays(todayIST(), -29));
  const [to, setTo] = useState(todayIST());
  const [tab, setTab] = useState(() => (can('billing.view') ? 'revenue' : 'appointments'));
  const [groupBy, setGroupBy] = useState('day');
  const r = { from, to };
  const rev = useGet(['rep-rev', groupBy], '/reports/revenue', { ...r, groupBy }, { enabled: tab === 'revenue' && can('billing.view') });
  const appt = useGet('rep-appt', '/reports/appointments', r, { enabled: tab === 'appointments' });
  const pat = useGet('rep-pat', '/reports/patients', r, { enabled: tab === 'patients' });
  const inv = useGet('rep-inv', '/reports/inventory', r, { enabled: tab === 'inventory' && can('inventory.view') });
  const pnl = useGet('rep-pnl', '/reports/pnl', r, { enabled: tab === 'pnl' && can('billing.view') && can('expenses.view') });
  const leads = useGet('rep-leads', '/reports/leads', r, { enabled: tab === 'leads' && can('leads.view') });
  const exp = (name, extra = {}) => can('reports.export') && <Button variant="outline" size="sm" onClick={() => openFile(`/reports/${name}`, { download: true, filename: `${name}-${from}-${to}.csv`, params: { ...r, ...extra, format: 'csv' } })}><Download /> CSV</Button>;

  return (
    <div>
      <PageHeader title="Reports" actions={<>
        <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
      </>} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {can('billing.view') && <TabsTrigger value="revenue">Revenue</TabsTrigger>}
          <TabsTrigger value="appointments">Appointments</TabsTrigger>
          <TabsTrigger value="patients">Patients</TabsTrigger>
          {can('inventory.view') && <TabsTrigger value="inventory">Inventory</TabsTrigger>}
          {can('billing.view') && can('expenses.view') && <TabsTrigger value="pnl">P&amp;L</TabsTrigger>}
          {can('leads.view') && <TabsTrigger value="leads">Leads</TabsTrigger>}
        </TabsList>

        <TabsContent value="revenue" className="space-y-4">
          <div className="flex items-center gap-2"><Select className="w-40" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}><option value="day">By day</option><option value="month">By month</option><option value="branch">By branch</option><option value="mode">By mode</option></Select>{exp('revenue', { groupBy })}</div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Collected" value={inr(rev.data?.rows.reduce((a, x) => a + x.collected, 0))} loading={rev.isLoading} />
            <StatCard label="Refunds" value={inr(rev.data?.rows.reduce((a, x) => a + x.refunds, 0))} loading={rev.isLoading} tone="red" />
            <StatCard label="Net" value={inr(rev.data?.rows.reduce((a, x) => a + x.net, 0))} loading={rev.isLoading} tone="emerald" />
            <StatCard label="Billed" value={inr(rev.data?.billedByType.reduce((a, x) => a + x.billed, 0))} loading={rev.isLoading} tone="sky" />
          </div>
          <ChartCard title="Collections" loading={rev.isLoading}>
            <BarChart data={rev.data?.rows.map((x) => ({ ...x, label: String(x.label ?? '—') }))}>{grid}<XAxis dataKey="label" fontSize={11} tickLine={false} /><YAxis fontSize={11} tickLine={false} axisLine={false} /><Tooltip formatter={(v) => inr(v)} /><Legend /><Bar dataKey="collected" fill={C[0]} radius={[3, 3, 0, 0]} /><Bar dataKey="refunds" fill={C[4]} radius={[3, 3, 0, 0]} /></BarChart>
          </ChartCard>
          <DataTable rows={rev.data?.billedByType} loading={rev.isLoading} rowKey="_id" columns={[
            { key: 't', header: 'Invoice type', cell: (x) => titleCase(x._id) }, { key: 'n', header: 'Invoices', cell: (x) => x.n },
            { key: 'b', header: 'Billed', cell: (x) => inr(x.billed) }, { key: 'tx', header: 'GST', cell: (x) => inr(x.tax) }, { key: 'd', header: 'Discount', cell: (x) => inr(x.discount) },
          ]} />
        </TabsContent>

        <TabsContent value="appointments" className="space-y-4">
          <div className="flex justify-end">{exp('appointments')}</div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Total" value={appt.data?.total ?? 0} loading={appt.isLoading} />
            <StatCard label="No-show rate" value={`${appt.data?.noShowRate ?? 0}%`} loading={appt.isLoading} tone="red" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="By status" loading={appt.isLoading}><PieChart><Pie data={appt.data?.byStatus.map((s) => ({ name: titleCase(s._id), value: s.n }))} dataKey="value" nameKey="name" outerRadius={95} innerRadius={50}>{appt.data?.byStatus.map((_, i) => <Cell key={i} fill={C[i % C.length]} />)}</Pie><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} /></PieChart></ChartCard>
            <ChartCard title="By source" loading={appt.isLoading}><BarChart data={appt.data?.byType.map((s) => ({ name: titleCase(s._id), n: s.n }))}>{grid}<XAxis dataKey="name" fontSize={11} /><YAxis fontSize={11} allowDecimals={false} /><Tooltip /><Bar dataKey="n" fill={C[1]} radius={[3, 3, 0, 0]} /></BarChart></ChartCard>
          </div>
          <DataTable rows={appt.data?.byDoctor} loading={appt.isLoading} columns={[
            { key: 'n', header: 'Doctor', cell: (d) => d.name || '—' }, { key: 't', header: 'Total', cell: (d) => d.total }, { key: 'c', header: 'Completed', cell: (d) => d.completed },
            { key: 'ns', header: 'No-show', cell: (d) => d.noShow }, { key: 'cx', header: 'Cancelled', cell: (d) => d.cancelled },
          ]} />
        </TabsContent>

        <TabsContent value="patients" className="space-y-4">
          <div className="flex items-center justify-between"><StatCard label="New patients" value={pat.data?.total ?? 0} loading={pat.isLoading} />{exp('patients')}</div>
          <ChartCard title="New registrations" loading={pat.isLoading}><LineChart data={pat.data?.byDay}>{grid}<XAxis dataKey="_id" fontSize={11} tickFormatter={(v) => v.slice(5)} /><YAxis fontSize={11} allowDecimals={false} /><Tooltip /><Line dataKey="n" stroke={C[0]} strokeWidth={2} dot={false} /></LineChart></ChartCard>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="By branch" loading={pat.isLoading}><BarChart data={pat.data?.byBranch}>{grid}<XAxis dataKey="name" fontSize={11} /><YAxis fontSize={11} allowDecimals={false} /><Tooltip /><Bar dataKey="n" fill={C[0]} radius={[3, 3, 0, 0]} /></BarChart></ChartCard>
            <ChartCard title="By source" loading={pat.isLoading}><PieChart><Pie data={pat.data?.bySource.map((s) => ({ name: titleCase(s._id), value: s.n }))} dataKey="value" nameKey="name" outerRadius={95}>{pat.data?.bySource.map((_, i) => <Cell key={i} fill={C[i % C.length]} />)}</Pie><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} /></PieChart></ChartCard>
          </div>
        </TabsContent>

        <TabsContent value="inventory" className="space-y-4">
          <div className="flex justify-end">{exp('inventory')}</div>
          <DataTable rows={inv.data?.valuation} loading={inv.isLoading} columns={[
            { key: 'n', header: 'Branch', cell: (v) => v.name }, { key: 'u', header: 'Units', cell: (v) => v.units }, { key: 'c', header: 'Value at cost', cell: (v) => inr(v.cost) }, { key: 'm', header: 'Value at MRP', cell: (v) => inr(v.mrp) },
          ]} />
          <ChartCard title="Top selling (qty)" loading={inv.isLoading}><BarChart data={inv.data?.topSelling} layout="vertical" margin={{ left: 60 }}><XAxis type="number" fontSize={11} /><YAxis type="category" dataKey="name" width={160} fontSize={11} /><Tooltip /><Bar dataKey="qty" fill={C[2]} radius={[0, 3, 3, 0]} /></BarChart></ChartCard>
        </TabsContent>

        <TabsContent value="pnl" className="space-y-4">
          <div className="flex justify-end">{exp('pnl')}</div>
          <DataTable rows={pnl.data?.rows} loading={pnl.isLoading} rowKey="branch" columns={[
            { key: 'b', header: 'Branch', cell: (x) => x.branch }, { key: 'i', header: 'Collections', cell: (x) => inr(x.inflow) }, { key: 'r', header: 'Refunds', cell: (x) => inr(x.refunds) },
            { key: 'e', header: 'Expenses', cell: (x) => inr(x.expenses) }, { key: 'p', header: 'Purchases', cell: (x) => inr(x.purchases) },
            { key: 'n', header: 'Net', cell: (x) => <span className={x.net < 0 ? 'font-semibold text-red-600' : 'font-semibold text-emerald-700'}>{inr(x.net)}</span> },
          ]} />
          <ChartCard title="Expenses by category" loading={pnl.isLoading}><PieChart><Pie data={pnl.data?.expByCat.map((e) => ({ name: titleCase(e._id), value: e.amt }))} dataKey="value" nameKey="name" outerRadius={95}>{pnl.data?.expByCat.map((_, i) => <Cell key={i} fill={C[i % C.length]} />)}</Pie><Tooltip formatter={(v) => inr(v)} /><Legend wrapperStyle={{ fontSize: 12 }} /></PieChart></ChartCard>
        </TabsContent>

        <TabsContent value="leads" className="space-y-4">
          <div className="flex justify-end">{exp('leads')}</div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Funnel" loading={leads.isLoading}><BarChart data={leads.data?.funnel}>{grid}<XAxis dataKey="name" fontSize={10} interval={0} angle={-20} textAnchor="end" height={60} /><YAxis fontSize={11} allowDecimals={false} /><Tooltip /><Bar dataKey="count" radius={[3, 3, 0, 0]}>{leads.data?.funnel.map((s, i) => <Cell key={i} fill={s.color} />)}</Bar></BarChart></ChartCard>
            <ChartCard title="Leads per day" loading={leads.isLoading}><LineChart data={leads.data?.byDay}>{grid}<XAxis dataKey="_id" fontSize={11} tickFormatter={(v) => v.slice(5)} /><YAxis fontSize={11} allowDecimals={false} /><Tooltip /><Line dataKey="n" stroke={C[2]} strokeWidth={2} dot={false} /></LineChart></ChartCard>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <DataTable rows={leads.data?.bySource} loading={leads.isLoading} columns={[{ key: 's', header: 'Source', cell: (x) => titleCase(x._id) }, { key: 'n', header: 'Leads', cell: (x) => x.n }, { key: 'c', header: 'Converted', cell: (x) => x.converted }, { key: 'r', header: 'Rate', cell: (x) => `${x.n ? Math.round((x.converted / x.n) * 100) : 0}%` }]} />
            <DataTable rows={leads.data?.byCampaign} loading={leads.isLoading} columns={[{ key: 'c', header: 'Campaign', cell: (x) => x.name }, { key: 'n', header: 'Leads', cell: (x) => x.n }, { key: 'cv', header: 'Converted', cell: (x) => x.converted }, { key: 'cpl', header: 'CPL', cell: (x) => (x.cpl ? inr(x.cpl) : '—') }]} />
          </div>
          {leads.data?.lostReasons?.length > 0 && <DataTable rows={leads.data.lostReasons} columns={[{ key: 'r', header: 'Lost reason', cell: (x) => x._id }, { key: 'n', header: 'Count', cell: (x) => x.n }]} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
