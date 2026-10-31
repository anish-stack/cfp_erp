import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { EmptyState } from './EmptyState';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * columns: [{ key, header, cell?: (row) => node, className }]
 */
export function DataTable({ columns, rows, loading, empty, onRowClick, rowKey = '_id', className, footer }) {
  return (
    <div className={cn('rounded-lg border bg-card', className)}>
      <Table>
        <THead>
          <TR className="hover:bg-transparent">{columns.map((c) => <TH key={c.key} className={c.className}>{c.header}</TH>)}</TR>
        </THead>
        <TBody>
          {loading && !rows?.length
            ? Array.from({ length: 6 }).map((_, i) => (
                <TR key={i}>{columns.map((c) => <TD key={c.key}><Skeleton className="h-4 w-full max-w-[160px]" /></TD>)}</TR>
              ))
            : rows?.map((r, i) => (
                <TR key={r[rowKey] || i} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? 'cursor-pointer' : ''}>
                  {columns.map((c) => <TD key={c.key} className={c.className}>{c.cell ? c.cell(r) : r[c.key] ?? '—'}</TD>)}
                </TR>
              ))}
        </TBody>
      </Table>
      {!loading && !rows?.length && (empty || <EmptyState />)}
      {footer}
    </div>
  );
}

export function Pagination({ meta, page, setPage }) {
  if (!meta || meta.pages <= 1) return meta ? <div className="border-t px-3 py-2 text-xs text-muted-foreground">{meta.total} record(s)</div> : null;
  return (
    <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
      <span>{meta.total} records · page {meta.page} of {meta.pages}</span>
      <div className="flex gap-1">
        <Button size="icon" variant="outline" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft /></Button>
        <Button size="icon" variant="outline" className="h-7 w-7" disabled={page >= meta.pages} onClick={() => setPage(page + 1)}><ChevronRight /></Button>
      </div>
    </div>
  );
}
