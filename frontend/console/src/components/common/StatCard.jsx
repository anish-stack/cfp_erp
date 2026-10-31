import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function StatCard({ label, value, icon: Icon, hint, loading, tone = 'primary', onClick }) {
  const tones = { primary: 'bg-primary/10 text-primary', amber: 'bg-amber-100 text-amber-700', red: 'bg-red-100 text-red-700', sky: 'bg-sky-100 text-sky-700', emerald: 'bg-emerald-100 text-emerald-700', violet: 'bg-violet-100 text-violet-700' };
  return (
    <Card className={cn('p-4', onClick && 'cursor-pointer transition-shadow hover:shadow-md')} onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          {loading ? <Skeleton className="mt-2 h-7 w-20" /> : <p className="mt-1 truncate text-2xl font-semibold">{value}</p>}
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {Icon && <div className={cn('rounded-lg p-2', tones[tone])}><Icon className="h-5 w-5" /></div>}
      </div>
    </Card>
  );
}
