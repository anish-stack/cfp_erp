import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Pencil, Package } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable } from '@/components/common/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/checkbox';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/common/Field';
import { useBranches } from '@/hooks/queries';
import { useCan } from '@/store/auth';
import { get, post, patch } from '@/lib/api';
import { errMsg, inr } from '@/lib/utils';
import { CHARGE_KINDS } from '@/components/ipd/ipdUtils';

const COVERABLE = ['bed', 'nursing', 'procedure', 'ot', 'surgeon', 'anaesthesia', 'doctor_visit', 'pharmacy', 'consumable', 'investigation'];

export default function Packages() {
  const can = useCan();
  const qc = useQueryClient();
  const { data: branches = [] } = useBranches();
  const { data = [], isLoading } = useQuery({ queryKey: ['ipd-packages-all'], queryFn: () => get('/ipd/packages', { all: 'true' }) });
  const { data: services = [] } = useQuery({ queryKey: ['ipd-services'], staleTime: 300_000, queryFn: () => get('/inventory/products/search', { q: '', type: 'service' }) });
  const [f, setF] = useState(null);
  const editable = can('ipd.manage_settings');
  const save = async () => {
    try {
      const body = { branch: f.branch || null, name: f.name, procedure: f.procedure || null, wardType: f.wardType || undefined, price: Number(f.price) || 0, includedDays: Number(f.includedDays) || 0, covers: f.covers, inclusions: f.inclusions.split('\n').map((s) => s.trim()).filter(Boolean), exclusions: f.exclusions.split('\n').map((s) => s.trim()).filter(Boolean), isActive: f.isActive };
      if (f._id) await patch(`/ipd/packages/${f._id}`, body); else await post('/ipd/packages', body);
      toast.success('Package saved');
      setF(null);
      qc.invalidateQueries({ queryKey: ['ipd-packages-all'] });
      qc.invalidateQueries({ queryKey: ['ipd-packages'] });
    } catch (e) { toast.error(errMsg(e)); }
  };
  const open = (p) => setF(p ? { ...p, branch: p.branch?._id || '', procedure: p.procedure?._id || '', inclusions: (p.inclusions || []).join('\n'), exclusions: (p.exclusions || []).join('\n') } : { name: '', branch: '', procedure: '', wardType: 'general', price: '', includedDays: 1, covers: ['bed', 'nursing', 'procedure', 'ot', 'surgeon', 'anaesthesia', 'doctor_visit'], inclusions: '', exclusions: 'Medicines & consumables\nInvestigations\nExtra days beyond package\nRoom upgrade difference', isActive: true });
  return (
    <div className="space-y-4">
      <PageHeader title="Surgery & day-care packages" description="Fixed-price packages. Covered items show as “included” on the bill; anything extra is charged normally."
        actions={editable && <Button onClick={() => open(null)}><Plus /> New package</Button>} />
      <DataTable loading={isLoading} rows={data} onRowClick={editable ? open : undefined} columns={[
        { key: 'n', header: 'Package', cell: (p) => <div><p className="flex items-center gap-2 font-medium"><Package className="h-4 w-4 text-primary" />{p.name}</p><p className="text-xs text-muted-foreground">{p.procedure?.name || 'No linked procedure'}</p></div> },
        { key: 'p', header: 'Price', cell: (p) => <b>{inr(p.price)}</b> },
        { key: 'd', header: 'Stay incl.', cell: (p) => `${p.includedDays} day(s)${p.wardType ? ` · ${p.wardType}` : ''}` },
        { key: 'c', header: 'Covers', cell: (p) => <div className="flex max-w-xs flex-wrap gap-1">{p.covers.map((c) => <Badge key={c} variant="outline">{CHARGE_KINDS[c] || c}</Badge>)}</div> },
        { key: 'b', header: 'Branch', cell: (p) => p.branch?.name || 'All' },
        { key: 's', header: 'Status', cell: (p) => (p.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Off</Badge>) },
        { key: 'e', header: '', cell: () => editable && <Pencil className="h-4 w-4 text-muted-foreground" /> },
      ]} />
      <Dialog open={!!f} onOpenChange={(o) => !o && setF(null)}>
        <DialogContent title={f?._id ? 'Edit package' : 'New package'} size="lg">
          {f && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Procedure (service)"><Select value={f.procedure} onChange={(e) => setF({ ...f, procedure: e.target.value })} placeholder="—">{services.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select></Field>
              <Field label="Branch"><Select value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })}><option value="">All branches</option>{branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</Select></Field>
              <Field label="Price ₹"><Input type="number" min="0" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
              <Field label="Included stay (days)"><Input type="number" min="0" value={f.includedDays} onChange={(e) => setF({ ...f, includedDays: e.target.value })} /></Field>
              <Field label="Room class"><Select value={f.wardType || ''} onChange={(e) => setF({ ...f, wardType: e.target.value })}>{['general', 'semi_private', 'private', 'day_care'].map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</Select></Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><Switch checked={f.isActive !== false} onCheckedChange={(v) => setF({ ...f, isActive: v })} /> Active</label>
              <Field label="Covered charge types" className="sm:col-span-2">
                <div className="flex flex-wrap gap-2">{COVERABLE.map((c) => <label key={c} className="flex items-center gap-1 rounded border px-2 py-1 text-xs"><input type="checkbox" checked={f.covers.includes(c)} onChange={(e) => setF({ ...f, covers: e.target.checked ? [...f.covers, c] : f.covers.filter((x) => x !== c) })} />{CHARGE_KINDS[c]}</label>)}</div>
              </Field>
              <Field label="Inclusions (one per line — shown on estimate)"><Textarea rows={4} value={f.inclusions} onChange={(e) => setF({ ...f, inclusions: e.target.value })} /></Field>
              <Field label="Exclusions (one per line)"><Textarea rows={4} value={f.exclusions} onChange={(e) => setF({ ...f, exclusions: e.target.value })} /></Field>
              <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="outline" onClick={() => setF(null)}>Cancel</Button><Button disabled={!f.name || f.price === ''} onClick={save}>Save</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
