import * as M from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

export const Dropdown = M.Root;
export const DropdownTrigger = M.Trigger;
export const DropdownContent = ({ className, align = 'end', ...p }) => (
  <M.Portal>
    <M.Content align={align} sideOffset={4} className={cn('z-50 min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 shadow-md', className)} {...p} />
  </M.Portal>
);
export const DropdownItem = ({ className, ...p }) => (
  <M.Item className={cn('relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4', className)} {...p} />
);
export const DropdownLabel = ({ className, ...p }) => <M.Label className={cn('px-2 py-1.5 text-xs font-semibold text-muted-foreground', className)} {...p} />;
export const DropdownSeparator = () => <M.Separator className="-mx-1 my-1 h-px bg-border" />;
