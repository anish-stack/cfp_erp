import { Fragment, useEffect, useMemo, useState } from 'react';
import { Plus, Lock, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Field } from '@/components/common/Field';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useGet, useAction } from '@/hooks/queries';
import { post, patch, del } from '@/lib/api';
import { useCan } from '@/store/auth';
import { titleCase, cn } from '@/lib/utils';

export default function Roles() {
  const can = useCan();
  const { data: roles = [], isLoading } = useGet('/roles', '/roles');
  const { data: cat } = useGet('roles-catalog', '/roles/catalog', undefined, { staleTime: Infinity });
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState(null);
  const [delOpen, setDelOpen] = useState(false);
  useEffect(() => { if (!sel && roles.length) setSel(roles[0]._id); }, [roles, sel]);
  const role = roles.find((r) => r._id === sel);
  useEffect(() => { if (role) setDraft({ name: role.name, slug: role.slug, description: role.description || '', scope: role.scope, permissions: [...role.permissions] }); }, [role]);
  const isNew = sel === 'new';
  const locked = role?.slug === 'super_admin';
  const editable = (isNew ? can('roles.create') : can('roles.edit')) && !locked;

  const save = useAction(() => (isNew ? post('/roles', draft) : patch(`/roles/${sel}`, draft)), { success: 'Role saved', invalidate: ['/roles'], onSuccess: (r) => setSel(r._id) });
  const remove = useAction(() => del(`/roles/${sel}`), { success: 'Role deleted', invalidate: ['/roles'], onSuccess: () => { setSel(null); setDelOpen(false); } });

  const groups = useMemo(() => {
    const g = {};
    (cat?.modules || []).forEach((m) => (g[m.group] ||= []).push(m));
    return g;
  }, [cat]);
  const has = (p) => draft?.permissions.includes(p) || draft?.permissions.includes('*');
  const toggle = (p) => setDraft((d) => ({ ...d, permissions: d.permissions.includes(p) ? d.permissions.filter((x) => x !== p) : [...d.permissions, p] }));
  const toggleRow = (m) => {
    const all = cat.actions.map((a) => `${m}.${a}`);
    const on = all.every((p) => draft.permissions.includes(p));
    setDraft((d) => ({ ...d, permissions: on ? d.permissions.filter((p) => !all.includes(p)) : [...new Set([...d.permissions, ...all])] }));
  };

  if (isLoading || !cat) return <Skeleton className="h-96 w-full" />;
  return (
    <div>
      <PageHeader title="Roles & Permissions" description="Granular access per module. Sidebar menus follow the View permission." actions={can('roles.create') && <Button onClick={() => { setSel('new'); setDraft({ name: '', slug: '', description: '', scope: 'branch', permissions: [] }); }}><Plus /> New role</Button>} />
      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="h-fit p-2">
          {roles.map((r) => (
            <button key={r._id} onClick={() => setSel(r._id)} className={cn('flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted', sel === r._id && 'bg-accent font-medium')}>
              <span className="flex items-center gap-2">{r.slug === 'super_admin' && <Lock className="h-3.5 w-3.5" />}{r.name}</span>
              <Badge variant="secondary">{r.userCount}</Badge>
            </button>
          ))}
          {isNew && <div className="rounded-md bg-accent px-3 py-2 text-sm font-medium">New role</div>}
        </Card>
        {draft && (
          <Card className="space-y-4 p-4 lg:col-span-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Name"><Input value={draft.name} disabled={!editable} onChange={(e) => setDraft({ ...draft, name: e.target.value, ...(isNew ? { slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') } : {}) })} /></Field>
              <Field label="Key"><Input value={draft.slug} disabled={!isNew} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} /></Field>
              <Field label="Scope"><Select value={draft.scope} disabled={!editable} onChange={(e) => setDraft({ ...draft, scope: e.target.value })}><option value="branch">Branch</option><option value="global">Global</option></Select></Field>
              <Field label="Description"><Input value={draft.description} disabled={!editable} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
            </div>
            {locked ? <p className="rounded-md bg-muted p-3 text-sm">Super Admin has full access to everything and cannot be edited.</p> : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60"><tr><th className="px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground">Module</th>{cat.actions.map((a) => <th key={a} className="px-1 py-2 text-center text-[11px] font-semibold uppercase text-muted-foreground">{titleCase(a).replace('Manage Settings', 'Settings')}</th>)}</tr></thead>
                  <tbody>
                    {Object.entries(groups).map(([g, mods]) => (
                      <Fragment key={g}>
                        <tr className="bg-muted/30"><td colSpan={cat.actions.length + 1} className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g}</td></tr>
                        {mods.map((m) => (
                          <tr key={m.key} className="border-t">
                            <td className="px-3 py-1.5"><button disabled={!editable} onClick={() => toggleRow(m.key)} className="text-left hover:text-primary disabled:hover:text-inherit">{m.label}</button></td>
                            {cat.actions.map((a) => <td key={a} className="text-center"><Checkbox disabled={!editable} checked={has(`${m.key}.${a}`)} onCheckedChange={() => toggle(`${m.key}.${a}`)} /></td>)}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {editable && (
              <div className="flex justify-between">
                {!isNew && !role?.isSystem && can('roles.delete') ? <Button variant="ghost" className="text-destructive" onClick={() => setDelOpen(true)}><Trash2 /> Delete</Button> : <span />}
                <div className="flex items-center gap-3"><span className="text-xs text-muted-foreground">{draft.permissions.length} permissions</span><Button loading={save.isPending} disabled={!draft.name || !draft.slug} onClick={() => save.mutate()}>Save role</Button></div>
              </div>
            )}
          </Card>
        )}
      </div>
      <ConfirmDialog open={delOpen} onOpenChange={setDelOpen} title={`Delete role ${role?.name}?`} destructive confirmText="Delete" loading={remove.isPending} onConfirm={() => remove.mutate()} />
    </div>
  );
}
