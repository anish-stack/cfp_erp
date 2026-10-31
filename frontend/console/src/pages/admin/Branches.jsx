import { useState } from 'react';
import { Settings2, Plus, Trash2 } from 'lucide-react';
import { ResourcePage } from '@/components/common/ResourcePage';
import { Badge } from '@/components/ui/badge';
import { DropdownItem } from '@/components/ui/dropdown';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/common/Field';
import { useAction } from '@/hooks/queries';
import { patch } from '@/lib/api';
import { useCan } from '@/store/auth';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function SettingsForm({ branch, onDone }) {
  const [s, setS] = useState({ ...branch.settings });
  const set = (k, v) => setS((x) => ({ ...x, [k]: v }));
  const save = useAction(() => patch(`/branches/${branch._id}/settings`, {
    slotMinutes: Number(s.slotMinutes), gapMinutes: Number(s.gapMinutes), openTime: s.openTime, closeTime: s.closeTime,
    breaks: s.breaks, weeklyOff: s.weeklyOff, bookingWindowDays: Number(s.bookingWindowDays), minLeadMinutes: Number(s.minLeadMinutes), invoicePrefix: s.invoicePrefix || undefined,
  }), { success: 'Settings saved', invalidate: ['/branches', 'availability'], onSuccess: onDone });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Default slot (min)"><Input type="number" value={s.slotMinutes} onChange={(e) => set('slotMinutes', e.target.value)} /></Field>
        <Field label="Gap between slots (min)"><Input type="number" value={s.gapMinutes} onChange={(e) => set('gapMinutes', e.target.value)} /></Field>
        <Field label="Online booking window (days)"><Input type="number" value={s.bookingWindowDays} onChange={(e) => set('bookingWindowDays', e.target.value)} /></Field>
        <Field label="Opens"><Input type="time" value={s.openTime} onChange={(e) => set('openTime', e.target.value)} /></Field>
        <Field label="Closes"><Input type="time" value={s.closeTime} onChange={(e) => set('closeTime', e.target.value)} /></Field>
        <Field label="Min notice for online booking (min)"><Input type="number" value={s.minLeadMinutes} onChange={(e) => set('minLeadMinutes', e.target.value)} /></Field>
      </div>
      <Field label="Weekly off">
        <div className="flex flex-wrap gap-3">{DAYS.map((d, i) => <label key={d} className="flex items-center gap-1.5 text-sm"><Checkbox checked={s.weeklyOff.includes(i)} onCheckedChange={(c) => set('weeklyOff', c ? [...s.weeklyOff, i] : s.weeklyOff.filter((x) => x !== i))} />{d}</label>)}</div>
      </Field>
      <div className="space-y-2">
        <p className="text-sm font-medium">Breaks (lunch etc.)</p>
        {s.breaks.map((b, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input className="w-36" placeholder="Label" value={b.label || ''} onChange={(e) => set('breaks', s.breaks.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <Input type="time" className="w-32" value={b.start} onChange={(e) => set('breaks', s.breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
            <Input type="time" className="w-32" value={b.end} onChange={(e) => set('breaks', s.breaks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
            <Button variant="ghost" size="icon" onClick={() => set('breaks', s.breaks.filter((_, j) => j !== i))}><Trash2 /></Button>
          </div>
        ))}
        {s.breaks.length < 5 && <Button variant="outline" size="sm" onClick={() => set('breaks', [...s.breaks, { label: 'Break', start: '14:00', end: '15:00' }])}><Plus /> Add break</Button>}
      </div>
      <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Save settings</Button></div>
    </div>
  );
}

export default function Branches() {
  const can = useCan();
  const [settings, setSettings] = useState(null);
  return (
    <>
      <ResourcePage
        title="Branches"
        endpoint="/branches"
        module="branches"
        canDelete={false}
        newDefaults={{ isActive: true, acceptsOnlineBooking: true }}
        toForm={(b) => ({ ...b, line1: b.address?.line1, line2: b.address?.line2, city: b.address?.city, state: b.address?.state, pincode: b.address?.pincode, mapUrl: b.address?.mapUrl })}
        toPayload={({ line1, line2, city, state, pincode, mapUrl, ...v }) => ({ ...v, address: { line1, line2, city, state, pincode, mapUrl } })}
        fields={[
          { name: 'name', label: 'Name', required: true },
          { name: 'code', label: 'Code (2-5 letters)', required: true, pattern: /^[A-Za-z]{2,5}$/, patternMessage: '2-5 letters' },
          { name: 'phone', label: 'Phone' },
          { name: 'whatsapp', label: 'WhatsApp' },
          { name: 'email', label: 'Email', type: 'email' },
          { name: 'gstin', label: 'GSTIN' },
          { name: 'line1', label: 'Address line 1', colSpan: 2 },
          { name: 'line2', label: 'Address line 2', colSpan: 2 },
          { name: 'city', label: 'City' },
          { name: 'state', label: 'State' },
          { name: 'pincode', label: 'Pincode' },
          { name: 'mapUrl', label: 'Google Maps URL' },
          { name: 'acceptsOnlineBooking', label: 'Online booking', type: 'switch' },
          { name: 'isActive', label: 'Active', type: 'switch' },
        ]}
        columns={[
          { key: 'n', header: 'Branch', cell: (b) => <div><p className="font-medium">{b.name}</p><p className="text-xs text-muted-foreground">{[b.address?.line1, b.address?.city].filter(Boolean).join(', ')}</p></div> },
          { key: 'c', header: 'Code', cell: (b) => <Badge variant="outline">{b.code}</Badge> },
          { key: 'p', header: 'Phone', cell: (b) => b.phone || '—' },
          { key: 'h', header: 'Hours', cell: (b) => `${b.settings?.openTime}–${b.settings?.closeTime} · ${b.settings?.slotMinutes}m slots` },
          { key: 'o', header: 'Online', cell: (b) => (b.acceptsOnlineBooking ? <Badge variant="success">On</Badge> : <Badge variant="secondary">Off</Badge>) },
          { key: 's', header: 'Status', cell: (b) => (b.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>) },
        ]}
        rowActions={(b) => can('branches.manage_settings') && <DropdownItem onSelect={() => setSettings(b)}><Settings2 /> Slot & hours settings</DropdownItem>}
      />
      <Dialog open={!!settings} onOpenChange={(o) => !o && setSettings(null)}><DialogContent title={`${settings?.name} · settings`} size="lg">{settings && <SettingsForm branch={settings} onDone={() => setSettings(null)} />}</DialogContent></Dialog>
    </>
  );
}
