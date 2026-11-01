import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserRound, UserPlus, Pencil, Trash2, FileText, Receipt, Download, Eye, LogOut, X, BedDouble } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api, get, post, patch, openDoc } from '@/lib/api';
import { usePatient } from '@/store/patient';
import { cn, errMsg, fmtDate, ageOf } from '@/lib/utils';

const BG = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const REL = ['self', 'spouse', 'child', 'parent', 'sibling', 'other'];
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const toForm = (p = {}) => ({
  name: p.name || '', relation: p.relation || 'spouse', gender: p.gender || '',
  dob: p.dob ? String(p.dob).slice(0, 10) : '', ageYears: p.dob ? '' : (p.ageYears ?? ''),
  email: p.email || '', altPhone: p.altPhone || '', bloodGroup: p.bloodGroup || '',
  allergies: (p.allergies || []).join(', '),
  line1: p.address?.line1 || '', city: p.address?.city || '', state: p.address?.state || '', pincode: p.address?.pincode || '',
  ecName: p.emergencyContact?.name || '', ecPhone: p.emergencyContact?.phone || '', ecRelation: p.emergencyContact?.relation || '',
});

const toBody = (f) => {
  const b = { name: f.name.trim(), relation: f.relation, gender: f.gender };
  if (f.dob) b.dob = f.dob; else if (f.ageYears !== '') b.ageYears = Number(f.ageYears);
  if (f.email.trim()) b.email = f.email.trim();
  if (f.altPhone.trim()) b.altPhone = f.altPhone.trim();
  if (f.bloodGroup) b.bloodGroup = f.bloodGroup;
  b.allergies = f.allergies.split(',').map((s) => s.trim()).filter(Boolean);
  const addr = { line1: f.line1.trim(), city: f.city.trim(), state: f.state.trim(), pincode: f.pincode.trim() };
  Object.keys(addr).forEach((k) => !addr[k] && delete addr[k]);
  if (Object.keys(addr).length) b.address = addr;
  if (f.ecName.trim() && f.ecPhone.trim()) b.emergencyContact = { name: f.ecName.trim(), phone: f.ecPhone.trim(), ...(f.ecRelation.trim() ? { relation: f.ecRelation.trim() } : {}) };
  return b;
};

function ProfileForm({ initial, isNew, hasSelf, onClose, onSaved }) {
  const [f, setF] = useState(toForm(initial));
  const [busy, setBusy] = useState(false);
  const s = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (f.name.trim().length < 2 || !f.gender || (!f.dob && f.ageYears === '')) return toast.error('Name, gender and age / DOB are required');
    setBusy(true);
    try {
      const body = toBody(f);
      if (isNew) await post('/portal/profiles', body);
      else await patch(`/portal/profiles/${initial._id}`, body);
      toast.success('Saved');
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between"><p className="font-semibold">{isNew ? 'Add family member' : `Edit ${initial.name}`}</p><button onClick={onClose}><X className="h-4 w-4" /></button></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5"><Label>Full name *</Label><Input value={f.name} onChange={s('name')} /></div>
        <div className="space-y-1.5"><Label>Gender *</Label><Select value={f.gender} onChange={s('gender')} placeholder="Select"><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></Select></div>
        <div className="space-y-1.5"><Label>Relation</Label><Select value={f.relation} onChange={s('relation')} disabled={initial?.relation === 'self'}>{REL.filter((r) => r !== 'self' || !hasSelf || initial?.relation === 'self').map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}</Select></div>
        <div className="space-y-1.5"><Label>Date of birth</Label><Input type="date" max={new Date().toISOString().slice(0, 10)} value={f.dob} onChange={s('dob')} /></div>
        <div className="space-y-1.5"><Label>or Age</Label><Input type="number" min={0} max={120} disabled={!!f.dob} value={f.ageYears} onChange={s('ageYears')} /></div>
        <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={f.email} onChange={s('email')} /></div>
        <div className="space-y-1.5"><Label>Alternate mobile</Label><Input inputMode="numeric" maxLength={10} value={f.altPhone} onChange={(e) => setF({ ...f, altPhone: e.target.value.replace(/\D/g, '') })} /></div>
        <div className="space-y-1.5"><Label>Blood group</Label><Select value={f.bloodGroup} onChange={s('bloodGroup')} placeholder="—">{BG.map((b) => <option key={b}>{b}</option>)}</Select></div>
        <div className="space-y-1.5"><Label>Allergies</Label><Input placeholder="comma separated" value={f.allergies} onChange={s('allergies')} /></div>
        <p className="col-span-2 pt-1 text-xs font-semibold uppercase text-muted-foreground">Address</p>
        <div className="col-span-2 space-y-1.5"><Input placeholder="House / street / area" value={f.line1} onChange={s('line1')} /></div>
        <Input placeholder="City" value={f.city} onChange={s('city')} />
        <Input placeholder="State" value={f.state} onChange={s('state')} />
        <Input placeholder="Pincode" inputMode="numeric" maxLength={6} value={f.pincode} onChange={(e) => setF({ ...f, pincode: e.target.value.replace(/\D/g, '') })} />
        <p className="col-span-2 pt-1 text-xs font-semibold uppercase text-muted-foreground">Emergency contact</p>
        <Input placeholder="Name" value={f.ecName} onChange={s('ecName')} />
        <Input placeholder="Mobile" inputMode="numeric" maxLength={10} value={f.ecPhone} onChange={(e) => setF({ ...f, ecPhone: e.target.value.replace(/\D/g, '') })} />
        <Input className="col-span-2" placeholder="Relation" value={f.ecRelation} onChange={s('ecRelation')} />
      </div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></div>
    </Card>
  );
}

export default function Profile() {
  const qc = useQueryClient();
  const { token, mobile, logout } = usePatient();
  const [tab, setTab] = useState('family');
  const [edit, setEdit] = useState(null); // profile | 'new'
  const me = useQuery({ queryKey: ['me', token], enabled: !!token, queryFn: () => get('/portal/me') });
  const rx = useQuery({ queryKey: ['my-rx'], enabled: !!token && tab === 'rx', queryFn: () => get('/portal/prescriptions') });
  const inv = useQuery({ queryKey: ['my-inv'], enabled: !!token && tab === 'bills', queryFn: () => get('/portal/invoices') });
  const stays = useQuery({ queryKey: ['my-stays'], enabled: !!token && tab === 'stays', queryFn: () => get('/portal/admissions') });

  if (!token) return <Card className="mx-auto max-w-md p-6 text-center"><p className="mb-4">Login with your mobile number to manage your profile.</p><Button asChild><Link to="/login?next=/profile">Login / Book</Link></Button></Card>;

  const profiles = me.data?.profiles || [];
  const hasSelf = profiles.some((p) => p.relation === 'self');
  const remove = async (p) => {
    if (!window.confirm(`Remove ${p.name} from your account?`)) return;
    try { await api.delete(`/portal/profiles/${p._id}`); toast.success('Removed'); qc.invalidateQueries({ queryKey: ['me'] }); } catch (e) { toast.error(errMsg(e)); }
  };
  const doc = (type, id, name) => (dl) => openDoc(type, id, { download: dl, filename: `${name}.pdf` }).catch((e) => toast.error(errMsg(e)));
  const logoutAll = async () => { try { await post('/portal/logout-all'); } catch { /* ignore */ } logout(); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-semibold">My account</h1><p className="text-sm text-muted-foreground">+91 {mobile}</p></div>
        <Button size="sm" variant="outline" onClick={logoutAll}><LogOut /> Logout all devices</Button>
      </div>
      <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
        {[['family', 'Family'], ['rx', 'Prescriptions'], ['bills', 'Bills'], ['stays', 'Hospital stays']].map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={cn('flex-1 rounded-md py-1.5', tab === k ? 'bg-card font-medium shadow' : 'text-muted-foreground')}>{l}</button>)}
      </div>

      {tab === 'family' && (
        edit ? (
          <ProfileForm initial={edit === 'new' ? { relation: hasSelf ? 'spouse' : 'self' } : edit} isNew={edit === 'new'} hasSelf={hasSelf} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['me'] }); }} />
        ) : me.isLoading ? <Skeleton className="h-32" /> : (
          <div className="space-y-2">
            {profiles.map((p) => (
              <Card key={p._id} className="flex items-center gap-3 p-4">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary"><UserRound className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{p.name} <span className="font-mono text-xs text-muted-foreground">{p.uhid}</span></p>
                  <p className="truncate text-xs text-muted-foreground">{p.relation} · {p.gender} · {ageOf(p)}y{p.bloodGroup ? ` · ${p.bloodGroup}` : ''}{p.allergies?.length ? ` · Allergic: ${p.allergies.join(', ')}` : ''}</p>
                </div>
                <Button size="icon" variant="ghost" onClick={() => setEdit(p)}><Pencil /></Button>
                {p.relation !== 'self' && <Button size="icon" variant="ghost" onClick={() => remove(p)}><Trash2 className="text-destructive" /></Button>}
              </Card>
            ))}
            {profiles.length < (me.data?.maxProfiles || 10) && <Button variant="outline" className="w-full border-dashed" onClick={() => setEdit('new')}><UserPlus /> Add family member</Button>}
          </div>
        )
      )}

      {tab === 'rx' && (rx.isLoading ? <Skeleton className="h-32" /> : !rx.data?.length ? <Card className="p-6 text-center text-sm text-muted-foreground">No prescriptions yet</Card> : (
        <div className="space-y-2">
          {rx.data.map((r) => (
            <Card key={r._id} className="flex items-center gap-3 p-4">
              <FileText className="h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.patient?.name} · {fmtDate(r.createdAt)}</p>
                <p className="truncate text-xs text-muted-foreground">{r.doctor?.name} · {r.branch?.name}{r.diagnosis ? ` · ${r.diagnosis}` : ''}{r.items?.length ? ` · ${r.items.length} medicines` : ''}</p>
                {r.followUpDate && <Badge variant="outline" className="mt-1">Follow-up {fmtDate(r.followUpDate)}</Badge>}
              </div>
              <Button size="icon" variant="ghost" onClick={() => doc('rx', r._id, r.rxNo)(false)}><Eye /></Button>
              <Button size="icon" variant="ghost" onClick={() => doc('rx', r._id, r.rxNo)(true)}><Download /></Button>
            </Card>
          ))}
        </div>
      ))}

      {tab === 'stays' && (stays.isLoading ? <Skeleton className="h-32" /> : !stays.data?.length ? <Card className="p-6 text-center text-sm text-muted-foreground">No hospital admissions</Card> : (
        <div className="space-y-2">
          {stays.data.map((s) => (
            <Card key={s._id} className="flex items-center gap-3 p-4">
              <BedDouble className="h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.patient?.name} · {fmtDate(s.admittedAt)}{s.dischargedAt ? ` → ${fmtDate(s.dischargedAt)}` : ''}</p>
                <p className="truncate text-xs text-muted-foreground">{s.admissionNo} · {s.branch?.name} · {s.doctor?.name}{s.plannedProcedure?.name ? ` · ${s.plannedProcedure.name}` : ''}</p>
              </div>
              <Badge variant={s.status === 'discharged' ? 'success' : 'warning'}>{s.status === 'discharged' ? 'Discharged' : 'Admitted'}</Badge>
              {s.status === 'discharged' && <Button size="icon" variant="ghost" title="Discharge summary" onClick={() => doc('discharge', s._id, `Discharge-${s.admissionNo}`)(true)}><Download /></Button>}
            </Card>
          ))}
        </div>
      ))}

      {tab === 'bills' && (inv.isLoading ? <Skeleton className="h-32" /> : !inv.data?.length ? <Card className="p-6 text-center text-sm text-muted-foreground">No bills yet</Card> : (
        <div className="space-y-2">
          {inv.data.map((i) => (
            <Card key={i._id} className="flex items-center gap-3 p-4">
              <Receipt className="h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{i.invoiceNo} · {inr(i.grandTotal)}</p>
                <p className="truncate text-xs text-muted-foreground">{i.patient?.name} · {i.branch?.name} · {fmtDate(i.createdAt)}</p>
              </div>
              <Badge variant={i.balance > 0 ? 'warning' : 'success'}>{i.balance > 0 ? `Due ${inr(i.balance)}` : 'Paid'}</Badge>
              <Button size="icon" variant="ghost" onClick={() => doc('invoice', i._id, i.invoiceNo)(true)}><Download /></Button>
            </Card>
          ))}
        </div>
      ))}
    </div>
  );
}
