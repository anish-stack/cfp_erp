import { forwardRef } from 'react';
import * as C from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Checkbox = forwardRef(({ className, ...props }, ref) => (
  <C.Root ref={ref} className={cn('peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground', className)} {...props}>
    <C.Indicator className="flex items-center justify-center text-current"><Check className="h-3.5 w-3.5" /></C.Indicator>
  </C.Root>
));
Checkbox.displayName = 'Checkbox';

export const Switch = ({ checked, onCheckedChange, disabled, className }) => (
  <button
    type="button"
    role="switch"
    aria-checked={!!checked}
    disabled={disabled}
    onClick={() => onCheckedChange?.(!checked)}
    className={cn('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50', checked ? 'bg-primary' : 'bg-input', className)}
  >
    <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4' : 'translate-x-0.5')} />
  </button>
);
