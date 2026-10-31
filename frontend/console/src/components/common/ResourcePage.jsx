import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, MoreHorizontal } from 'lucide-react';
import { PageHeader } from './PageHeader';
import { DataTable, Pagination } from './DataTable';
import { SearchInput } from './SearchInput';
import { FormBuilder } from './FormBuilder';
import { ConfirmDialog } from './ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Dropdown, DropdownTrigger, DropdownContent, DropdownItem } from '@/components/ui/dropdown';
import { usePaged, useAction } from '@/hooks/queries';
import { useDebounce } from '@/hooks/useDebounce';
import { useCan } from '@/store/auth';
import { post, patch, del } from '@/lib/api';

/**
 * Generic CRUD list page for master data.
 * module → permission prefix (`${module}.create` etc.)
 */
export function ResourcePage({
  title, description, endpoint, module, columns, fields, editFields, params = {}, filters, toForm = (r) => r, toPayload = (v) => v,
  newDefaults = {}, canDelete = true, deleteLabel = 'Deactivate', rowActions, headerActions, dialogSize = 'lg', onRowClick,
}) {
  const can = useCan();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const dq = useDebounce(q);
  const [editing, setEditing] = useState(null); // {} for new, row for edit
  const [deleting, setDeleting] = useState(null);
  const queryParams = { page, limit: 20, q: dq || undefined, ...params };
  const { data, isLoading, isFetching } = usePaged([endpoint], endpoint, queryParams);

  const save = useAction((v) => (editing?._id ? patch(`${endpoint}/${editing._id}`, toPayload(v, editing)) : post(endpoint, toPayload(v, null))), {
    success: 'Saved',
    invalidate: [endpoint],
    onSuccess: () => setEditing(null),
  });
  const remove = useAction((id) => del(`${endpoint}/${id}`), { success: 'Done', invalidate: [endpoint], onSuccess: () => setDeleting(null) });

  const allCols = useMemo(() => {
    const showActions = can(`${module}.edit`) || (canDelete && can(`${module}.delete`)) || rowActions;
    if (!showActions) return columns;
    return [
      ...columns,
      {
        key: '_actions', header: '', className: 'w-10 text-right',
        cell: (r) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Dropdown>
              <DropdownTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal /></Button></DropdownTrigger>
              <DropdownContent>
                {can(`${module}.edit`) && <DropdownItem onSelect={() => setEditing(r)}><Pencil /> Edit</DropdownItem>}
                {rowActions?.(r)}
                {canDelete && can(`${module}.delete`) && <DropdownItem className="text-destructive" onSelect={() => setDeleting(r)}><Trash2 /> {deleteLabel}</DropdownItem>}
              </DropdownContent>
            </Dropdown>
          </div>
        ),
      },
    ];
  }, [columns, module, can, canDelete, rowActions, deleteLabel]);

  const formFields = editing?._id && editFields ? editFields : fields;
  const defaults = useMemo(() => (editing?._id ? toForm(editing) : { ...newDefaults }), [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={<>
          {headerActions}
          {fields && can(`${module}.create`) && <Button onClick={() => setEditing({})}><Plus /> Add</Button>}
        </>}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} />
        {filters}
        {isFetching && !isLoading && <span className="text-xs text-muted-foreground">Updating…</span>}
      </div>
      <DataTable columns={allCols} rows={data?.items} loading={isLoading} onRowClick={onRowClick} footer={<Pagination meta={data?.meta} page={page} setPage={setPage} />} />

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title={editing?._id ? `Edit ${title.replace(/s$/, '')}` : `New ${title.replace(/s$/, '')}`} size={dialogSize}>
          {editing && <FormBuilder fields={formFields} defaultValues={defaults} onSubmit={(v) => save.mutate(v)} loading={save.isPending} onCancel={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title={`${deleteLabel}?`} description={deleting?.name || deleting?.title} destructive confirmText={deleteLabel} loading={remove.isPending} onConfirm={() => remove.mutate(deleting._id)} />
    </div>
  );
}
