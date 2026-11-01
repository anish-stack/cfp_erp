import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BedDouble, BedSingle, Sparkles, Wrench, UserPlus, LogOut, Percent, ListChecks, Settings2, HeartPulse, Scissors, ShieldCheck, Package, BarChart3, CalendarPlus, Utensils } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/common/Field';
import { PatientPicker } from '@/components/clinic/PatientPicker';
import { post, del } from '@/lib/api';
import { PageHeader } from '@/components/common/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { Dropdown, DropdownTrigger, DropdownContent, DropdownItem } from '@/components/ui/dropdown';
import { AdmitDialog } from '@/components/ipd/AdmitDialog';
import { BED_TONE, WARD_TYPES, stayLabel, PAYERS, DIETS, toLocalInput } from '@/components/ipd/ipdUtils';
import { get, patch } from '@/lib/api';
import { useCan } from '@/store/auth';
import { useBranchKey } from '@/hooks/queries';
import { cn, errMsg, inr, ageOf, fmtDateTime } from '@/lib/utils';

export default function BedBoard() {
  const nav = useNavigate();
  const can = useCan();
  const qc = useQueryClient();
  const b = useBranchKey();
  const [admit, setAdmit] = useState(null); // { bed }
  const [filter, setFilter] = useState('all');
  const [reserve, setReserve] = useState(null);
  const doReserve = async () => {
    try {
      await post(`/ipd/beds/${reserve.bed._id}/reserve`, { patient: reserve.patient?._id, name: reserve.patient?.name || reserve.name, phone: reserve.patient?.mobile || reserve.phone || undefined, date: new Date(reserve.date).toISOString(), note: reserve.note || undefined });
      toast.success(`Bed ${reserve.bed.number} reserved`);
      setReserve(null);
      qc.invalidateQueries({ queryKey: ['ipd-board'] });
    } catch (e) { toast.error(errMsg(e)); }
  };
  const unreserve = async (bed) => { try { await del(`/ipd/beds/${bed._id}/reserve`); qc.invalidateQueries({ queryKey: ['ipd-board'] }); } catch (e) { toast.error(errMsg(e)); } };
  const { data, isLoading } = useQuery({ queryKey: ['ipd-board', b], queryFn: () => get('/ipd/board'), refetchInterval: 60_000 });
  const setStatus = async (bed, status) => {
    try { await patch(`/ipd/beds/${bed._id}`, { status }); qc.invalidateQueries({ queryKey: ['ipd-board'] }); toast.success(`Bed ${bed.number} → ${status}`); } catch (e) { toast.error(errMsg(e)); }
  };
  const s = data?.stats;

  return (
    <div className="space-y-4">
      <PageHeader title="Bed board" description="Live ward & bed status. Click a free bed to admit, an occupied bed to open the patient file."
        actions={<div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => nav('/ipd/nursing')}><HeartPulse /> Nursing station</Button>
          <Button variant="outline" onClick={() => nav('/ipd/ot')}><Scissors /> OT schedule</Button>
          <Button variant="outline" onClick={() => nav('/ipd/admissions')}><ListChecks /> Admissions</Button>
          {can('ipd.create') && <Button onClick={() => setAdmit({})}><UserPlus /> Admit patient</Button>}
        </div>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Occupancy" value={s ? `${s.occupancy}%` : '—'} icon={Percent} loading={isLoading} hint={s && `${s.occupied} of ${s.total} beds`} />
        <StatCard label="Available" value={s?.available ?? '—'} icon={BedSingle} tone="emerald" loading={isLoading} onClick={() => setFilter('available')} />
        <StatCard label="Occupied" value={s?.occupied ?? '—'} icon={BedDouble} tone="red" loading={isLoading} onClick={() => setFilter('occupied')} />
        <StatCard label="Cleaning" value={s?.cleaning ?? '—'} icon={Sparkles} tone="amber" loading={isLoading} onClick={() => setFilter('cleaning')} />
        <StatCard label="Discharges due" value={data?.dischargesDue ?? '—'} icon={LogOut} tone="violet" loading={isLoading} hint="today / pending" />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {['all', 'available', 'occupied', 'cleaning', 'reserved', 'maintenance'].map((k) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={cn('rounded-full border px-3 py-1 capitalize', filter === k ? 'border-primary bg-primary text-primary-foreground' : 'bg-card')}>{k}</button>
        ))}
      </div>
      {isLoading ? <Skeleton className="h-64" /> : !data?.wards?.length ? (
        <EmptyState icon={BedDouble} title="No wards yet" description="Create wards and beds to start admitting patients." action={can('ipd.manage_settings') && <Button onClick={() => nav('/ipd/setup')}>Set up wards & beds</Button>} />
      ) : data.wards.map((w) => {
        const beds = w.beds.filter((x) => filter === 'all' || x.status === filter);
        if (!beds.length && filter !== 'all') return null;
        const occ = w.beds.filter((x) => x.status === 'occupied').length;
        return (
          <Card key={w._id} className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{w.name} <span className="text-xs font-normal text-muted-foreground">· {WARD_TYPES[w.type]}{w.branch?.name ? ` · ${w.branch.name}` : ''}{w.floor ? ` · ${w.floor} floor` : ''}</span></p>
                <p className="text-xs text-muted-foreground">{w.dailyRate ? `${inr(w.dailyRate)}/day` : 'No room rent'}{w.nursingRate ? ` + nursing ${inr(w.nursingRate)}/day` : ''}</p>
              </div>
              <Badge variant="outline">{occ}/{w.beds.length} occupied</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {beds.map((bed) => {
                const a = bed.currentAdmission;
                return (
                  <div key={bed._id} className={cn('group relative rounded-lg border-2 p-2.5 text-xs transition hover:shadow-md', BED_TONE[bed.status], (bed.status === 'available' || a) && 'cursor-pointer')}
                    onClick={() => (a ? nav(`/ipd/admissions/${a._id}`) : ['available', 'reserved'].includes(bed.status) && can('ipd.create') ? setAdmit({ bed: { ...bed, wardObj: w, ward: w } }) : null)}>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-sm font-bold"><BedDouble className="h-4 w-4" />{bed.number}</span>
                      {can('ipd.edit') && !a && (
                        <Dropdown>
                          <DropdownTrigger asChild><button type="button" onClick={(e) => e.stopPropagation()} className="rounded p-0.5 opacity-60 hover:bg-white/60 hover:opacity-100"><Wrench className="h-3.5 w-3.5" /></button></DropdownTrigger>
                          <DropdownContent onClick={(e) => e.stopPropagation()}>
                            {bed.status === 'available' && <DropdownItem onSelect={() => setReserve({ bed, patient: null, name: '', phone: '', date: toLocalInput(Date.now() + 86_400_000), note: '' })}><CalendarPlus /> Reserve for planned admission</DropdownItem>}
                            {bed.status === 'reserved' && <DropdownItem onSelect={() => unreserve(bed)}>Cancel reservation</DropdownItem>}
                            {['available', 'cleaning', 'maintenance'].filter((x) => x !== bed.status && bed.status !== 'reserved').map((x) => <DropdownItem key={x} onSelect={() => setStatus(bed, x)} className="capitalize">Mark {x}</DropdownItem>)}
                          </DropdownContent>
                        </Dropdown>
                      )}
                    </div>
                    {a ? (
                      <div className="mt-1.5 space-y-0.5">
                        <p className="truncate font-semibold">{a.patient?.name}</p>
                        <p className="truncate opacity-80">{[a.patient?.gender?.[0]?.toUpperCase(), ageOf(a.patient) && `${ageOf(a.patient)}y`].filter(Boolean).join(' / ')} · {stayLabel(a.admittedAt)}</p>
                        <p className="truncate opacity-80">{a.doctor?.name}</p>
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {a.status === 'discharge_initiated' && <span className="rounded bg-amber-200 px-1 text-[10px] font-medium text-amber-900">Discharge</span>}
                          {a.type === 'emergency' && <span className="rounded bg-red-200 px-1 text-[10px] font-medium">ER</span>}
                          {a.type === 'day_care' && <span className="rounded bg-sky-200 px-1 text-[10px] font-medium">Day care</span>}
                          {a.payer?.type && a.payer.type !== 'self' && <span className="rounded bg-violet-200 px-1 text-[10px] font-medium">{PAYERS[a.payer.type].split(' ')[0]}</span>}
                          {a.package?.name && <span className="rounded bg-emerald-200 px-1 text-[10px] font-medium">Pkg</span>}
                          {a.diet?.type && a.diet.type !== 'normal' && <span className={cn('rounded px-1 text-[10px] font-medium', a.diet.type === 'nbm' ? 'bg-red-300' : 'bg-slate-200')}>{a.diet.type === 'nbm' ? 'NBM' : DIETS[a.diet.type]}</span>}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1.5">
                        <p className="font-medium capitalize">{bed.status}</p>
                        {bed.status === 'reserved' && bed.reservation && <p className="truncate">{bed.reservation.patient?.name || bed.reservation.name}<br /><span className="opacity-70">{fmtDateTime(bed.reservation.date)}</span></p>}
                        {bed.status === 'cleaning' && can('ipd.edit') && <button type="button" onClick={(e) => { e.stopPropagation(); setStatus(bed, 'available'); }} className="mt-1 rounded bg-white/70 px-1.5 py-0.5 text-[11px] font-medium hover:bg-white">✓ Ready</button>}
                        {bed.status === 'available' && can('ipd.create') && <p className="mt-0.5 opacity-70 group-hover:opacity-100">+ Admit</p>}
                        {bed.note && <p className="truncate opacity-70">{bed.note}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
      <Dialog open={!!reserve} onOpenChange={(o) => !o && setReserve(null)}>
        <DialogContent title={`Reserve bed ${reserve?.bed?.number || ''}`}>
          {reserve && (
            <div className="space-y-3">
              <Field label="Patient (registered)"><PatientPicker value={reserve.patient} onChange={(p) => setReserve({ ...reserve, patient: p })} /></Field>
              {!reserve.patient && <div className="grid grid-cols-2 gap-2"><Input placeholder="or Name" value={reserve.name} onChange={(e) => setReserve({ ...reserve, name: e.target.value })} /><Input placeholder="Mobile" value={reserve.phone} onChange={(e) => setReserve({ ...reserve, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} /></div>}
              <Field label="Admission date & time"><Input type="datetime-local" value={reserve.date} onChange={(e) => setReserve({ ...reserve, date: e.target.value })} /></Field>
              <Field label="Note"><Input value={reserve.note} placeholder="e.g. Planned laser piles, NBM from midnight" onChange={(e) => setReserve({ ...reserve, note: e.target.value })} /></Field>
              <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setReserve(null)}>Cancel</Button><Button disabled={!reserve.patient && reserve.name.trim().length < 2} onClick={doReserve}><CalendarPlus /> Reserve</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AdmitDialog open={!!admit} onOpenChange={(o) => !o && setAdmit(null)} bed={admit?.bed} branch={admit?.bed?.branch} />
    </div>
  );
}
