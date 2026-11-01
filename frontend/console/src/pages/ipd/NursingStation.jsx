import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HeartPulse, Pill, FlaskConical, Activity, ClipboardCheck, Printer, Utensils, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { DIETS, stayLabel } from '@/components/ipd/ipdUtils';
import { get } from '@/lib/api';
import { useBranchKey, usePublicInfo } from '@/hooks/queries';
import { printHandover } from '@/components/ipd/printHandover';
import { useAuth } from '@/store/auth';
import { cn, ageOf, fmtDateTime } from '@/lib/utils';

const t = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—');

/** one screen for the ward: meds due, vitals due, labs pending, pre-op, diet — refreshes every minute */
export default function NursingStation() {
  const nav = useNavigate();
  const b = useBranchKey();
  const { data = [], isLoading } = useQuery({ queryKey: ['ipd-nursing', b], queryFn: () => get('/ipd/nursing'), refetchInterval: 60_000 });
  const { data: clinic } = usePublicInfo();
  const me = useAuth((x) => x.me);
  const branchName = (me?.user?.branches || []).find((x) => String(x._id || x) === String(b))?.name || '';
  const sum = (k) => data.reduce((s, x) => s + (typeof x[k] === 'number' ? x[k] : x[k] ? 1 : 0), 0);
  return (
    <div className="space-y-4">
      <PageHeader title="Nursing station" description="Due medicines, vitals, lab samples, pre-op and diet for every in-patient (auto-refresh)"
        actions={<Button variant="outline" disabled={!data.length} onClick={() => printHandover(data, { clinic: clinic?.name || 'Clinic', branch: branchName ? `${branchName} branch` : 'All branches' })}><Printer /> Print handover / diet list</Button>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="In-patients" value={data.length} icon={HeartPulse} loading={isLoading} />
        <StatCard label="Medicines due" value={sum('medsDue')} icon={Pill} tone="red" loading={isLoading} />
        <StatCard label="Vitals due (>6 h)" value={sum('vitalsDue')} icon={Activity} tone="amber" loading={isLoading} />
        <StatCard label="Lab pending" value={sum('labsPending')} icon={FlaskConical} tone="sky" loading={isLoading} />
        <StatCard label="Pre-op pending" value={data.filter((x) => x.preOpPending && x.nextProcedure).length} icon={ClipboardCheck} tone="violet" loading={isLoading} />
      </div>
      {isLoading ? <Skeleton className="h-64" /> : !data.length ? <EmptyState icon={HeartPulse} title="No in-patients" /> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.map((a) => (
            <Card key={a._id} className={cn('cursor-pointer space-y-2 p-4 transition hover:shadow-md print:break-inside-avoid', a.meds.some((m) => m.overdue) && 'border-red-300')} onClick={() => nav(`/ipd/admissions/${a._id}`)}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold"><span className="mr-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">{a.bed?.number}</span>{a.patient?.name} <span className="text-xs font-normal text-muted-foreground">{[ageOf(a.patient) && `${ageOf(a.patient)}y`, a.patient?.gender?.[0]?.toUpperCase()].filter(Boolean).join('/')}</span></p>
                  <p className="text-xs text-muted-foreground">{a.ward?.name} · {a.doctor?.name} · {stayLabel(a.admittedAt)}{a.allergies ? <span className="text-destructive"> · Allergy: {a.allergies}</span> : null}</p>
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  {a.status === 'discharge_initiated' && <Badge variant="warning">Discharge</Badge>}
                  {a.diet?.type && <Badge variant={a.diet.type === 'nbm' ? 'danger' : 'outline'}><Utensils className="mr-1 h-3 w-3" />{DIETS[a.diet.type]}</Badge>}
                </div>
              </div>
              {a.diet?.notes && <p className="text-xs text-muted-foreground">Diet: {a.diet.notes}</p>}
              <div className="grid gap-2 text-xs sm:grid-cols-2">
                <div className="rounded-md bg-muted/60 p-2">
                  <p className="mb-1 font-semibold">Medicines</p>
                  {!a.meds.length && <p className="text-muted-foreground">None active</p>}
                  {a.meds.map((m) => (
                    <p key={m._id} className={cn('flex justify-between gap-2', m.overdue && 'font-semibold text-destructive', m.due && !m.overdue && 'font-medium text-amber-700')}>
                      <span className="truncate">{m.name} {m.dose} {m.route}</span>
                      <span className="shrink-0">{m.frequency}{m.nextAt ? ` · ${m.overdue ? 'overdue ' : ''}${t(m.nextAt)}` : ''}</span>
                    </p>
                  ))}
                </div>
                <div className="space-y-1 rounded-md bg-muted/60 p-2">
                  <p className={cn('flex items-center gap-1', a.vitalsDue && 'font-semibold text-amber-700')}>{a.vitalsDue && <AlertTriangle className="h-3 w-3" />}Vitals: {a.lastVitalsAt ? `${fmtDateTime(a.lastVitalsAt)} (BP ${a.lastVitals?.bp || '—'}, P ${a.lastVitals?.pulse || '—'}, T ${a.lastVitals?.temp ?? '—'})` : 'not recorded'}</p>
                  <p>I/O 24 h: {a.io24.intake} / {a.io24.output} ml</p>
                  {a.labsPending > 0 && <p className="text-sky-700">Lab pending: {a.labsPending}</p>}
                  {a.nextProcedure && <p className="text-violet-700">Procedure: {a.nextProcedure.name} {a.nextProcedure.scheduledAt ? `· ${fmtDateTime(a.nextProcedure.scheduledAt)}` : ''}{a.preOpPending ? ` · pre-op ${a.preOpPending} pending` : ' · pre-op ✓'}</p>}
                  {a.expectedDischargeAt && <p>Exp. discharge: {fmtDateTime(a.expectedDischargeAt)}</p>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
