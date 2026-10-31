import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export function Field({ label, error, hint, children, className, required }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && <Label>{label}{required && <span className="text-destructive"> *</span>}</Label>}
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
