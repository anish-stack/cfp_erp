import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

const Overlay = () => <D.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />;

export function DialogContent({ className, children, title, description, size = 'md', ...props }) {
  const w = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return (
    <D.Portal>
      <Overlay />
      <D.Content
        className={cn('fixed left-1/2 top-1/2 z-50 grid max-h-[92vh] w-[95vw] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border bg-card p-5 shadow-xl scrollbar-thin data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95', w, className)}
        aria-describedby={description ? undefined : undefined}
        {...props}
      >
        <div className="pr-8">
          <D.Title className="text-lg font-semibold">{title}</D.Title>
          {description ? <D.Description className="text-sm text-muted-foreground">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
        </div>
        {children}
        <D.Close className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100"><X className="h-4 w-4" /><span className="sr-only">Close</span></D.Close>
      </D.Content>
    </D.Portal>
  );
}

/** Right-side drawer */
export function SheetContent({ className, children, title, description, width = 'max-w-xl', ...props }) {
  return (
    <D.Portal>
      <Overlay />
      <D.Content className={cn('fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-card shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-right', width, className)} {...props}>
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <D.Title className="text-lg font-semibold">{title}</D.Title>
            {description ? <D.Description className="text-sm text-muted-foreground">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close className="rounded-sm opacity-70 hover:opacity-100"><X className="h-4 w-4" /></D.Close>
        </div>
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
