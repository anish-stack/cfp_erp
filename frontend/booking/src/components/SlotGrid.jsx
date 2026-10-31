import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Sun, Sunset, Moon } from 'lucide-react';
import { get } from '@/lib/api';
import { cn, fmtTime, todayIST, addDays } from '@/lib/utils';

export function DateStrip({ value, onChange, days = 14 }) {
  const list = useMemo(() => Array.from({ length: days }, (_, i) => addDays(todayIST(), i)), [days]);
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
      {list.map((d) => {
        const dt = new Date(`${d}T00:00:00`);
        return (
          <button key={d} type="button" onClick={() => onChange(d)}
            className={cn('flex w-16 shrink-0 flex-col items-center rounded-xl border bg-card py-2 transition', value === d ? 'border-primary bg-primary text-primary-foreground shadow' : 'hover:border-primary')}>
            <span className="text-[11px] uppercase opacity-80">{d === todayIST() ? 'Today' : dt.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
            <span className="text-lg font-semibold">{dt.getDate()}</span>
            <span className="text-[11px] opacity-80">{dt.toLocaleDateString('en-IN', { month: 'short' })}</span>
          </button>
        );
      })}
    </div>
  );
}

const PART = [
  { key: 'Morning', icon: Sun, test: (t) => t < '12:00' },
  { key: 'Afternoon', icon: Sunset, test: (t) => t >= '12:00' && t < '17:00' },
  { key: 'Evening', icon: Moon, test: (t) => t >= '17:00' },
];

/** value: { start, doctor } */
export function SlotGrid({ branch, date, doctor = 'any', value, onChange }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['pub-avail', branch, date, doctor],
    enabled: !!branch && !!date,
    queryFn: () => get('/scheduling/public/availability', { branch, date, doctor }),
  });
  if (isLoading) return <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking availability…</div>;
  if (error) return <p className="py-6 text-center text-sm text-destructive">{error.response?.data?.message || 'Could not load slots'}</p>;
  const slots = doctor === 'any'
    ? data.any.map((s) => ({ ...s, doctor: 'any' }))
    : (data.doctors[0]?.slots || []).map((s) => ({ ...s, doctor: String(data.doctors[0].doctor._id) }));
  const avail = slots.filter((s) => s.available);
  if (!avail.length) {
    const reason = doctor === 'any' ? [...new Set(data.doctors.map((d) => d.reason).filter(Boolean))][0] : data.doctors[0]?.reason;
    return <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">No slots available{reason ? ` · ${reason}` : ''}. Please try another date.</p>;
  }
  return (
    <div className="space-y-4">
      {PART.map((p) => {
        const list = avail.filter((s) => p.test(s.start));
        if (!list.length) return null;
        return (
          <div key={p.key}>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground"><p.icon className="h-4 w-4" /> {p.key}</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {list.map((s) => (
                <button key={s.start} type="button" onClick={() => onChange({ start: s.start, doctor: s.doctor })}
                  className={cn('rounded-lg border bg-card py-2.5 text-sm font-medium transition', value?.start === s.start ? 'border-primary bg-primary text-primary-foreground shadow' : 'hover:border-primary')}>
                  {fmtTime(s.start)}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
