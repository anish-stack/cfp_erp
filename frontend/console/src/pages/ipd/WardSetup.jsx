import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Pencil, BedDouble, ArrowLeft, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/common/Field';
import { WARD_TYPES, BED_TONE } from '@/components/ipd/ipdUtils';
import { useBranches, useBranchKey } from '@/hooks/queries';
import { useAuth, useCan } from '@/store/auth';
import { get, post, patch } from '@/lib/api';
import { cn, errMsg, inr } from '@/lib/utils';

export default function WardSetup() {
  const nav = useNavigate();
  const can = useCan();
  const qc = useQueryClient();
  const bk = useBranchKey();
  const activeBranch = useAuth((s) => s.branchId);
  const { data: branches = [] } = useBranches();
  const wards = useQuery({ queryKey: ['ipd-wards', bk], queryFn: () => get('/ipd/wards', { all: 'true' }) });
  const beds = useQuery({ queryKey: ['ipd-beds-all', bk], queryFn: () => get('/ipd/beds') });
  const [ward, setWard] = useState(null);
  const [addBeds, setAddBeds] = useState(null);
  const editable = can('ipd.manage_settings');
  const refresh = () => { qc.invalidateQueries({ queryKey: ['ipd-wards'] }); qc.invalidateQueries({ queryKey: ['ipd-beds-all'] }); qc.invalidateQueries({ queryKey: ['ipd-board'] }); };

  const saveWard = async () => {
    try {
      const body = { name: ward.name, type: ward.type, floor: ward.floor || undefined, dailyRate: Number(ward.dailyRate) || 0, nursingRate: Number(ward.nursingRate) || 0, gstRate: Number(ward.gstRate) || 0, description: ward.description || undefined, isActive: ward.isActive !== false };
      if (ward._id) await patch(`/ipd/wards/${ward._id}`, body); else await post('/ipd/wards', { ...body, branch: ward.branch });
      toast.success('Ward saved');
      setWard(null);
      refresh();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const createBeds = async () => {
    try {
      const r = await post('/ipd/beds', { ward: addBeds.ward._id, prefix: addBeds.prefix, from: Number(addBeds.from), to: Number(addBeds.to), features: addBeds.features ? addBeds.features.split(',').map((s) => s.trim()).filter(Boolean) : undefined });
      toast.success(`${r.length} bed(s) added`);
      setAddBeds(null);
      refresh();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const removeBed = async (b) => {
    if (!window.confirm(`Remove bed ${b.number}?`)) return;
    try { await patch(`/ipd/beds/${b._id}`, { isActive: false }); refresh(); } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Wards & beds" description="Room types, per-day rent & nursing charges, bed numbers"
        actions={<div className="flex gap-2"><Button variant="outline" onClick={() => nav('/ipd')}><ArrowLeft /> Bed board</Button>{editable && <Button onClick={() => setWard({ branch: activeBranch || branches[0]?._id || '', name: '', type: 'general', dailyRate: 1500, nursingRate: 500, gstRate: 0, isActive: true })}><Plus /> New ward</Button>}</div>} />
      {wards.isLoading ? <Skeleton className="h-64" /> : (wards.data || []).map((w) => {
        const list = (beds.data || []).filter((b) => (b.ward?._id || b.ward) === w._id);
        return (
          <Card key={w._id} className={cn('space-y-3 p-4', !w.isActive && 'opacity-60')}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{w.name} <span className="text-xs font-normal text-muted-foreground">· {WARD_TYPES[w.type]} · {w.branch?.name}{w.floor ? ` · ${w.floor} floor` : ''}</span> {!w.isActive && <Badge variant="secondary">Inactive</Badge>}</p>
                <p className="text-sm text-muted-foreground">Room {inr(w.dailyRate)}/day · Nursing {inr(w.nursingRate)}/day{w.gstRate ? ` · GST ${w.gstRate}%` : ''}</p>
              </div>
              {editable && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setAddBeds({ ward: w, prefix: `${w.name.split(/\s+/).map((x) => x[0]).join('').toUpperCase()}-`, from: list.length + 1, to: list.length + 1, features: '' })}><BedDouble /> Add beds</Button><Button size="sm" variant="ghost" onClick={() => setWard({ ...w, branch: w.branch?._id })}><Pencil /> Edit</Button></div>}
            </div>
            <div className="flex flex-wrap gap-2">
              {list.map((b) => (
                <span key={b._id} className={cn('group flex items-center gap-1 rounded-md border px-2 py-1 text-xs', BED_TONE[b.status])}>
                  {b.number}{b.features?.length ? <span className="opacity-60">· {b.features.join(', ')}</span> : null}
                  {editable && b.status !== 'occupied' && <button type="button" className="hidden group-hover:inline" onClick={() => removeBed(b)}><Trash2 className="h-3 w-3" /></button>}
                </span>
              ))}
              {!list.length && <p className="text-sm text-muted-foreground">No beds — click “Add beds”.</p>}
            </div>
          </Card>
        );
      })}
      {!wards.isLoading && !wards.data?.length && <Card className="p-8 text-center text-sm text-muted-foreground">No wards yet. Create General ward, Private room, Day care etc.</Card>}

      <Dialog open={!!ward} onOpenChange={(o) => !o && setWard(null)}>
        <DialogContent title={ward?._id ? `Edit ${ward.name}` : 'New ward / room type'}>
          {ward && (
            <div className="grid grid-cols-2 gap-3">
              {!ward._id && <Field label="Branch" className="col-span-2"><Select value={ward.branch} onChange={(e) => setWard({ ...ward, branch: e.target.value })}>{branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</Select></Field>}
              <Field label="Name" className="col-span-2"><Input value={ward.name} onChange={(e) => setWard({ ...ward, name: e.target.value })} placeholder="e.g. Private Room" /></Field>
              <Field label="Type"><Select value={ward.type} onChange={(e) => setWard({ ...ward, type: e.target.value })}>{Object.entries(WARD_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
              <Field label="Floor"><Input value={ward.floor || ''} onChange={(e) => setWard({ ...ward, floor: e.target.value })} /></Field>
              <Field label="Room rent / day (₹)"><Input type="number" min="0" value={ward.dailyRate} onChange={(e) => setWard({ ...ward, dailyRate: e.target.value })} /></Field>
              <Field label="Nursing / day (₹)"><Input type="number" min="0" value={ward.nursingRate} onChange={(e) => setWard({ ...ward, nursingRate: e.target.value })} /></Field>
              <Field label="GST on room rent %" hint="Hospital rooms ≤ ₹5,000/day are usually exempt"><Input type="number" min="0" max="28" value={ward.gstRate} onChange={(e) => setWard({ ...ward, gstRate: e.target.value })} /></Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><Switch checked={ward.isActive !== false} onCheckedChange={(v) => setWard({ ...ward, isActive: v })} /> Active</label>
              <div className="col-span-2 flex justify-end gap-2"><Button variant="outline" onClick={() => setWard(null)}>Cancel</Button><Button disabled={!ward.name || !ward.branch} onClick={saveWard}>Save</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!addBeds} onOpenChange={(o) => !o && setAddBeds(null)}>
        <DialogContent title={`Add beds · ${addBeds?.ward?.name || ''}`}>
          {addBeds && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Prefix"><Input value={addBeds.prefix} onChange={(e) => setAddBeds({ ...addBeds, prefix: e.target.value })} /></Field>
              <Field label="From no."><Input type="number" min="0" value={addBeds.from} onChange={(e) => setAddBeds({ ...addBeds, from: e.target.value })} /></Field>
              <Field label="To no."><Input type="number" min="0" value={addBeds.to} onChange={(e) => setAddBeds({ ...addBeds, to: e.target.value })} /></Field>
              <Field label="Features (comma separated)" className="col-span-3"><Input value={addBeds.features} placeholder="AC, Oxygen, Monitor" onChange={(e) => setAddBeds({ ...addBeds, features: e.target.value })} /></Field>
              <p className="col-span-3 text-xs text-muted-foreground">Creates {addBeds.prefix}{addBeds.from} … {addBeds.prefix}{addBeds.to}</p>
              <div className="col-span-3 flex justify-end gap-2"><Button variant="outline" onClick={() => setAddBeds(null)}>Cancel</Button><Button disabled={Number(addBeds.to) < Number(addBeds.from)} onClick={createBeds}>Create beds</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
