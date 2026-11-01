import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Package, Utensils, ShieldCheck, Paperclip, Upload, Trash2, Eye, FlaskConical, Plus, CheckCircle2, TestTube } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/common/Field';
import { api, get, post, put, patch, openFile } from '@/lib/api';
import { cn, errMsg, fmtDateTime, inr } from '@/lib/utils';
import { DIETS, CLAIM_STATUS, LAB_TESTS } from './ipdUtils';

/** package on an admission (snapshot) */
export function PackageCard({ a, run, closed }) {
  const { data: packages = [] } = useQuery({ queryKey: ['ipd-packages', a.branch?._id], queryFn: () => get('/ipd/packages', { branch: a.branch?._id }), staleTime: 300_000 });
  const [sel, setSel] = useState('');
  const [price, setPrice] = useState('');
  const p = a.package?.name ? a.package : null;
  return (
    <Card className="space-y-2 p-4">
      <p className="flex items-center gap-2 font-semibold"><Package className="h-4 w-4" /> Package</p>
      {p ? (
        <div className="rounded-md bg-emerald-50 p-2 text-sm text-emerald-900">
          <p className="font-medium">{p.name} · {inr(p.price)}</p>
          <p className="text-xs">Includes {p.includedDays} day(s) · covers {(p.covers || []).join(', ').replace(/_/g, ' ')}</p>
        </div>
      ) : <p className="text-sm text-muted-foreground">Itemised billing (no package).</p>}
      {!closed && (
        <div className="flex flex-wrap gap-2">
          <Select className="h-9 min-w-[200px] flex-1" value={sel} onChange={(e) => { setSel(e.target.value); setPrice(String(packages.find((x) => x._id === e.target.value)?.price ?? '')); }} placeholder={p ? 'Change package' : 'Apply package'}>
            {packages.map((x) => <option key={x._id} value={x._id}>{x.name} · {inr(x.price)}</option>)}
          </Select>
          {sel && <Input className="h-9 w-28" type="number" value={price} onChange={(e) => setPrice(e.target.value)} title="Price for this patient" />}
          {sel && <Button size="sm" onClick={() => run(() => put(`/ipd/admissions/${a._id}/package`, { package: sel, price: price === '' ? undefined : Number(price) }), 'Package applied').then(() => setSel(''))}>Apply</Button>}
          {p && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => run(() => put(`/ipd/admissions/${a._id}/package`, { package: null }), 'Package removed')}>Remove</Button>}
        </div>
      )}
    </Card>
  );
}

export function DietCard({ a, run, closed }) {
  const [d, setD] = useState({ type: a.diet?.type || 'normal', notes: a.diet?.notes || '' });
  return (
    <Card className="space-y-2 p-4">
      <p className="flex items-center gap-2 font-semibold"><Utensils className="h-4 w-4" /> Diet {a.diet?.at && <span className="text-xs font-normal text-muted-foreground">· {a.diet.by?.name} {fmtDateTime(a.diet.at)}</span>}</p>
      <div className="flex flex-wrap gap-2">
        <Select disabled={closed} className="h-9 w-48" value={d.type} onChange={(e) => setD({ ...d, type: e.target.value })}>{Object.entries(DIETS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Input disabled={closed} className="h-9 min-w-[160px] flex-1" placeholder="Instructions (e.g. warm fluids, no spicy food)" value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
        {!closed && <Button size="sm" variant="outline" onClick={() => run(() => put(`/ipd/admissions/${a._id}/diet`, { type: d.type, notes: d.notes || undefined }), 'Diet updated')}>Save</Button>}
      </div>
    </Card>
  );
}

export function ClaimCard({ a, run }) {
  if (!a.payer?.type || a.payer.type === 'self') return null;
  const c = a.claim;
  return (
    <Card className="space-y-2 p-4">
      <p className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" /> Insurance claim</p>
      {c ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div><p className="font-mono text-xs">{c.claimRef}</p><Badge variant={CLAIM_STATUS[c.status]?.[1]}>{CLAIM_STATUS[c.status]?.[0]}</Badge></div>
          <div className="text-right text-xs text-muted-foreground">{c.approvedAmount ? <p>Approved {inr(c.approvedAmount)}</p> : null}{c.claimedAmount ? <p>Claimed {inr(c.claimedAmount)}</p> : null}{c.settledAmount ? <p className="text-emerald-700">Settled {inr(c.settledAmount)}</p> : null}</div>
          <Button asChild size="sm" variant="outline"><Link to={`/ipd/claims?open=${c._id}`}>Open claim</Link></Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 text-sm"><span className="text-muted-foreground">Track pre-auth, submission, queries and settlement.</span><Button size="sm" onClick={() => run(() => post(`/ipd/admissions/${a._id}/claim`).then(() => null), 'Claim opened')}>Open claim</Button></div>
      )}
    </Card>
  );
}

export function DocumentsCard({ a, run, closed }) {
  const ref = useRef();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('report');
  const upload = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', title || file.name);
    fd.append('category', category);
    await run(() => api.post(`/ipd/admissions/${a._id}/documents`, fd).then((r) => r.data.data), 'Uploaded').catch(() => {});
    setTitle('');
    if (ref.current) ref.current.value = '';
  };
  return (
    <Card className="space-y-2 p-4">
      <p className="flex items-center gap-2 font-semibold"><Paperclip className="h-4 w-4" /> Documents ({a.documents?.length || 0})</p>
      {(a.documents || []).map((d) => (
        <div key={d._id} className="flex items-center gap-2 border-b py-1.5 text-sm last:border-0">
          <Badge variant="outline" className="capitalize">{d.category.replace('_', ' ')}</Badge>
          <span className="min-w-0 flex-1 truncate">{d.title}</span>
          <span className="text-[11px] text-muted-foreground">{fmtDateTime(d.at)}</span>
          <button type="button" onClick={() => openFile(`/ipd/admissions/${a._id}/documents/${d._id}`).catch((e) => toast.error(errMsg(e)))}><Eye className="h-4 w-4" /></button>
          {!closed && <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => window.confirm('Delete document?') && run(() => api.delete(`/ipd/admissions/${a._id}/documents/${d._id}`).then((r) => r.data.data), 'Deleted')}><Trash2 className="h-4 w-4" /></button>}
        </div>
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        <Input className="h-9 min-w-[140px] flex-1" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Select className="h-9 w-32" value={category} onChange={(e) => setCategory(e.target.value)}>{['report', 'scan', 'consent', 'claim', 'id_proof', 'other'].map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</Select>
        <Button size="sm" variant="outline" onClick={() => ref.current?.click()}><Upload /> Upload</Button>
        <input ref={ref} type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => upload(e.target.files?.[0])} />
      </div>
    </Card>
  );
}

/** lab / radiology orders with results and report attachment */
export function LabTab({ a, run, closed }) {
  const [rows, setRows] = useState([{ name: '', rate: '', urgent: false }]);
  const [res, setRes] = useState({});
  const fileRef = useRef();
  const [attachTo, setAttachTo] = useState(null);
  const order = () => {
    const tests = rows.filter((r) => r.name.trim().length >= 2).map((r) => ({ name: r.name.trim(), rate: Number(r.rate) || 0, urgent: r.urgent }));
    if (!tests.length) return toast.error('Add a test');
    run(() => post(`/ipd/admissions/${a._id}/investigations`, { tests }), `${tests.length} test(s) ordered`).then(() => setRows([{ name: '', rate: '', urgent: false }]));
  };
  const attach = async (file) => {
    if (!file || !attachTo) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', `${attachTo.name} report`);
    fd.append('category', 'report');
    fd.append('investigation', attachTo._id);
    await run(() => api.post(`/ipd/admissions/${a._id}/documents`, fd).then((r) => r.data.data), 'Report attached').catch(() => {});
    setAttachTo(null);
    if (fileRef.current) fileRef.current.value = '';
  };
  const tone = { ordered: 'warning', sample_collected: 'info', reported: 'success', cancelled: 'secondary' };
  return (
    <div className="space-y-3">
      {!closed && (
        <Card className="space-y-2 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold"><FlaskConical className="h-4 w-4" /> Order investigations <span className="text-xs font-normal text-muted-foreground">(rate &gt; 0 is charged to the bill)</span></p>
          <datalist id="lab-tests">{LAB_TESTS.map(([n]) => <option key={n} value={n} />)}</datalist>
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <Input list="lab-tests" className="h-9 min-w-[220px] flex-1" placeholder="Test name" value={r.name} onChange={(e) => { const hit = LAB_TESTS.find(([n]) => n === e.target.value); setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value, rate: hit ? String(hit[1]) : x.rate } : x))); }} />
              <Input className="h-9 w-24" type="number" placeholder="Rate" value={r.rate} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={r.urgent} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, urgent: e.target.checked } : x)))} /> Urgent</label>
              {i > 0 && <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 /></Button>}
            </div>
          ))}
          <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setRows([...rows, { name: '', rate: '', urgent: false }])}><Plus /> Another test</Button><Button size="sm" onClick={order}>Order</Button></div>
        </Card>
      )}
      {(a.investigations || []).slice().reverse().map((t) => (
        <Card key={t._id} className="space-y-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="flex items-center gap-2 font-medium"><TestTube className="h-4 w-4 text-primary" />{t.name} {t.urgent && <Badge variant="danger">Urgent</Badge>} <Badge variant={tone[t.status]}>{t.status.replace('_', ' ')}</Badge> {t.abnormal && <Badge variant="danger">Abnormal</Badge>}</p>
              <p className="text-xs text-muted-foreground">Ordered {fmtDateTime(t.orderedAt)}{t.orderedBy?.name ? ` by ${t.orderedBy.name}` : ''}{t.rate ? ` · ${inr(t.rate)}` : ''}{t.reportedAt ? ` · reported ${fmtDateTime(t.reportedAt)}` : ''}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {t.document && <Button size="sm" variant="outline" onClick={() => openFile(`/ipd/admissions/${a._id}/documents/${t.document}`)}><Eye /> Report</Button>}
              {!closed && t.status === 'ordered' && <Button size="sm" variant="outline" onClick={() => run(() => patch(`/ipd/admissions/${a._id}/investigations/${t._id}`, { status: 'sample_collected' }), 'Sample collected')}>Sample collected</Button>}
              {t.status !== 'cancelled' && <Button size="sm" variant="outline" onClick={() => { setAttachTo(t); setTimeout(() => fileRef.current?.click(), 0); }}><Upload /> Attach report</Button>}
              {!closed && ['ordered', 'sample_collected'].includes(t.status) && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => run(() => patch(`/ipd/admissions/${a._id}/investigations/${t._id}`, { status: 'cancelled' }), 'Cancelled')}>Cancel</Button>}
            </div>
          </div>
          {t.result ? <p className="whitespace-pre-line rounded bg-muted p-2 text-sm">{t.result}</p> : t.status !== 'cancelled' && (
            <div className="flex gap-2">
              <Textarea rows={1} className="text-sm" placeholder="Enter result…" value={res[t._id] || ''} onChange={(e) => setRes({ ...res, [t._id]: e.target.value })} />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!res[`${t._id}-ab`]} onChange={(e) => setRes({ ...res, [`${t._id}-ab`]: e.target.checked })} /> Abnormal</label>
              <Button size="sm" disabled={!res[t._id]?.trim()} onClick={() => run(() => patch(`/ipd/admissions/${a._id}/investigations/${t._id}`, { result: res[t._id], abnormal: !!res[`${t._id}-ab`] }), 'Result saved')}><CheckCircle2 /> Save</Button>
            </div>
          )}
        </Card>
      ))}
      {!a.investigations?.length && <Card className="p-6 text-center text-sm text-muted-foreground">No investigations ordered.</Card>}
      <input ref={fileRef} type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => attach(e.target.files?.[0])} />
    </div>
  );
}

export const cnx = cn;
