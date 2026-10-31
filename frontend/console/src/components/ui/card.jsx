import { cn } from '@/lib/utils';

export const Card = ({ className, ...p }) => <div className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)} {...p} />;
export const CardHeader = ({ className, ...p }) => <div className={cn('flex flex-col gap-1 p-4 pb-2', className)} {...p} />;
export const CardTitle = ({ className, ...p }) => <h3 className={cn('font-semibold leading-none tracking-tight', className)} {...p} />;
export const CardDescription = ({ className, ...p }) => <p className={cn('text-sm text-muted-foreground', className)} {...p} />;
export const CardContent = ({ className, ...p }) => <div className={cn('p-4 pt-2', className)} {...p} />;
export const CardFooter = ({ className, ...p }) => <div className={cn('flex items-center p-4 pt-0', className)} {...p} />;
