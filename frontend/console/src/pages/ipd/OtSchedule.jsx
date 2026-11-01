import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Scissors, ShieldCheck, ClipboardCheck } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { get } from '@/lib/api';
import { useBranchKey } from '@/hooks/queries';
import { cn, todayIST, addDays, fmtDate } from '@/lib/utils';

const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // 7 AM – 9 PM
const tone = { scheduled: 'border-sky-300 bg-sky-50', in_progress: 'border-amber-300 bg-amber-50', done: 'border-emerald-300 bg-emerald-50' };
const hm = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** OT day planner: one column per OT room, blocks sized by duration */
export default function OtSchedule() {
  const nav = useNavigate();
  const b = useBranchKey();
  const [date, setDate] = useState(todayIST());
  const { data, isLoading } = useQuery({ queryKey: ['ipd-ot', date, b], queryFn: () => get('/ipd/ot', { date }), refetchInterval: 60_000 });
  const rooms = [...new Set([...(data?.rooms || []), ...(data?.items || []).map((x) => x.proc.ot).filter(Boolean)])];
  const unassigned = (data?.items || []).filter((x) => !x.proc.ot);
  const pos = (x) => {
    const d = new Date(x.proc.scheduledAt);
    const h = Number(d.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' })) + Number(d.toLocaleString('en-US', { minute: 'numeric', timeZone: 'Asia/Kolkata' })) / 60;
    return { top: Math.max(0, (h - 7) * 56), height: Math.max(36, ((x.proc.durationMin || 60) / 60) * 56 - 4) };
  };
  const Block = ({ x, style }) => (
    <div style={style} onClick={() => nav(`/ipd/admissions/${x.admission}`)} className={cn('absolute inset-x-1 cursor-pointer overflow-hidden rounded-md border-l-4 p-1.5 text-[11px] shadow-sm hover:shadow', tone[x.proc.status] || 'bg-muted')}>
      <p className="font-semibold">{hm(x.proc.scheduledAt)} · {x.proc.name}</p>
      <p className="truncate">{x.patient} · Bed {x.bed || '—'} · {x.surgeon || ''}</p>
      <div className="flex gap-1 pt-0.5">
        {x.consent ? <ShieldCheck className="h-3 w-3 text-emerald-700" /> : <span className="text-red-700">No consent</span>}
        <span className={cn('flex items-center gap-0.5', x.preOpDone < x.preOpTotal && 'text-amber-700')}><ClipboardCheck className="h-3 w-3" />{x.preOpDone}/{x.preOpTotal}</span>
        {x.proc.anaesthesia && <span>{x.proc.anaesthesia}</span>}
      </div>
    </div>
  );
  return (
    <div className="space-y-4">
      <PageHeader title="OT schedule" description="Procedures by operation theatre. Times clash-checked when scheduling."
        actions={<div className="flex items-center gap-1"><Button size="icon" variant="outline" onClick={() => setDate(addDays(date, -1))}><ChevronLeft /></Button><Input type="date" className="w-40" value={date} onChange={(e) => setDate(e.target.value)} /><Button size="icon" variant="outline" onClick={() => setDate(addDays(date, 1))}><ChevronRight /></Button><Button variant="outline" onClick={() => setDate(todayIST())}>Today</Button></div>} />
      <p className="text-sm text-muted-foreground">{fmtDate(date)} · {(data?.items || []).length} procedure(s)</p>
      {isLoading ? <Skeleton className="h-96" /> : (
        <Card className="overflow-x-auto p-3">
          <div className="flex min-w-[640px]">
            <div className="w-14 shrink-0 pt-8">{HOURS.map((h) => <div key={h} className="h-14 border-t pr-1 text-right text-[10px] text-muted-foreground">{h % 12 || 12} {h < 12 ? 'AM' : 'PM'}</div>)}</div>
            {rooms.map((r) => (
              <div key={r} className="min-w-[180px] flex-1 border-l">
                <p className="flex h-8 items-center justify-center gap-1 text-sm font-semibold"><Scissors className="h-3.5 w-3.5" />{r}</p>
                <div className="relative" style={{ height: HOURS.length * 56 }}>
                  {HOURS.map((h) => <div key={h} className="h-14 border-t border-dashed" />)}
                  {(data?.items || []).filter((x) => x.proc.ot === r).map((x) => <Block key={x.proc._id} x={x} style={pos(x)} />)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {unassigned.length > 0 && (
        <Card className="space-y-2 p-3">
          <p className="text-sm font-semibold">Not assigned to an OT</p>
          {unassigned.map((x) => <div key={x.proc._id} className="flex cursor-pointer items-center justify-between rounded border p-2 text-sm hover:bg-muted" onClick={() => nav(`/ipd/admissions/${x.admission}`)}><span>{hm(x.proc.scheduledAt)} · {x.proc.name} · {x.patient}</span><Badge variant="outline">{x.proc.status}</Badge></div>)}
        </Card>
      )}
    </div>
  );
}
