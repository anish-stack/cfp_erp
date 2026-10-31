import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { get } from '@/lib/api';
import { cn, fmtTime } from '@/lib/utils';

/**
 * Staff availability grid. value = { doctor, start }.
 * doctor 'any' → merged slots
 */
export function SlotPicker({ branch, date, doctor = 'any', value, onChange }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['availability', branch, date, doctor],
    enabled: !!branch && !!date,
    queryFn: () => get('/scheduling/availability', { branch, date, doctor }, { branchScoped: false }),
  });
  if (!branch || !date) return <p className="text-sm text-muted-foreground">Select branch and date.</p>;
  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading slots…</div>;
  if (error) return <p className="text-sm text-destructive">{error.response?.data?.message || 'Failed to load slots'}</p>;

  if (doctor === 'any') {
    const slots = data.any;
    if (!slots.length) {
      const reasons = [...new Set(data.doctors.map((d) => d.reason).filter(Boolean))];
      return <p className="text-sm text-muted-foreground">No slots. {reasons.join(', ')}</p>;
    }
    return (
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
        {slots.map((s) => (
          <button key={s.start} type="button" disabled={!s.available} onClick={() => onChange({ doctor: 'any', start: s.start })}
            className={cn('rounded-md border px-2 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40', value?.start === s.start ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary hover:bg-accent')}>
            {fmtTime(s.start)}{s.available && <span className="block text-[10px] opacity-70">{s.remaining} left</span>}
          </button>
        ))}
      </div>
    );
  }
  const d = data.doctors[0];
  if (!d) return <p className="text-sm text-muted-foreground">Doctor not available.</p>;
  if (d.closed || !d.slots.length) return <p className="text-sm text-muted-foreground">{d.reason || 'No slots'}</p>;
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
      {d.slots.map((s) => (
        <button key={s.start} type="button" disabled={!s.available} onClick={() => onChange({ doctor: String(d.doctor._id), start: s.start })}
          className={cn('rounded-md border px-2 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40', value?.start === s.start ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary hover:bg-accent')}>
          {fmtTime(s.start)}{d.capacity > 1 && s.available && <span className="block text-[10px] opacity-70">{s.remaining} left</span>}
        </button>
      ))}
    </div>
  );
}
