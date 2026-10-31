import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary/10 text-primary',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      success: 'border-transparent bg-emerald-100 text-emerald-700',
      warning: 'border-transparent bg-amber-100 text-amber-800',
      danger: 'border-transparent bg-red-100 text-red-700',
      info: 'border-transparent bg-sky-100 text-sky-700',
      outline: 'text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

export const Badge = ({ className, variant, ...props }) => <span className={cn(badgeVariants({ variant }), className)} {...props} />;

const STATUS = {
  booked: 'info', confirmed: 'default', checked_in: 'warning', in_consultation: 'warning', completed: 'success',
  cancelled: 'secondary', no_show: 'danger', rescheduled: 'secondary',
  paid: 'success', partial: 'warning', unpaid: 'danger', refunded: 'secondary', partially_refunded: 'warning',
  draft: 'secondary', ordered: 'info', received: 'success', in_transit: 'warning',
  pending: 'warning', approved: 'success', rejected: 'danger', open: 'info', in_progress: 'warning', done: 'success',
  contacted: 'info', missed: 'danger', active: 'success', paused: 'warning', ended: 'secondary', sent: 'success', failed: 'danger', skipped: 'secondary',
};
export const StatusBadge = ({ status, className }) => (
  <Badge variant={STATUS[status] || 'secondary'} className={className}>{String(status || '').replace(/_/g, ' ')}</Badge>
);
