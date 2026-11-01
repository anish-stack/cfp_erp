import { Link } from 'react-router-dom';
import { UserRound, BedDouble, Receipt, CalendarDays, Pill, Package, Gift, TicketPercent, Globe, IndianRupee, ExternalLink, AlertTriangle, Wallet, Award, Users, FileText, Phone, ShieldCheck, Contact } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { inr, fmtDate, fmtDateTime, fmtTime, ageOf, titleCase } from '@/lib/utils';

const Card = ({ icon: Ic, title, sub, badge, to, onGo, children }) => (
  <div className="rounded-lg border bg-card p-3">
    <div className="flex items-start justify-between gap-2">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Ic className="h-5 w-5" /></span>
        <div className="min-w-0"><p className="truncate font-semibold">{title}</p>{sub && <p className="text-xs text-muted-foreground">{sub}</p>}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{badge}{to && <Button asChild size="sm" variant="outline" onClick={onGo}><Link to={to}><ExternalLink /> Open</Link></Button>}</div>
    </div>
    {children && <div className="mt-2.5 space-y-2 text-sm">{children}</div>}
  </div>
);
const KV = ({ k, v, tone }) => (v === undefined || v === null || v === '' ? null : <div className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className={tone}>{v}</span></div>);
const Mini = ({ title, children }) => <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p><div className="space-y-1">{children}</div></div>;
const ST = { paid: 'success', partial: 'warning', unpaid: 'danger', cancelled: 'secondary', refunded: 'secondary', partially_refunded: 'warning' };

function PatientCard({ d, extra, onGo }) {
  const p = d.patient;
  if (d.limited) return <Card icon={UserRound} title={p.name} sub={`${p.patientId} · registered at another branch — limited access`} />;
  return (
    <Card icon={UserRound} title={p.name} sub={[p.patientId, [ageOf(p) && `${ageOf(p)}y`, p.gender].filter(Boolean).join(' / '), p.registeredBranch?.name].filter(Boolean).join(' · ')} to={`/patients/${p._id}`} onGo={onGo}
      badge={d.admission ? <Badge variant="danger">Admitted</Badge> : d.upcoming?.length ? <Badge variant="info">Appointment</Badge> : null}>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {p.mobile && <a href={`tel:${p.mobile}`} className="flex items-center gap-1 text-primary"><Phone className="h-3.5 w-3.5" />{p.mobile}</a>}
        {p.bloodGroup && <span>Blood: <b>{p.bloodGroup}</b></span>}
        {p.relation && p.relation !== 'self' && <span>Relation: {titleCase(p.relation)}</span>}
      </div>
      {p.allergies?.length > 0 && <p className="flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-sm font-medium text-red-700"><AlertTriangle className="h-4 w-4" /> Allergy: {p.allergies.join(', ')}</p>}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className={`rounded-md p-2 ${d.money?.due > 0 ? 'bg-amber-50 text-amber-800' : 'bg-muted'}`}><p className="text-[11px]">Dues</p><p className="font-semibold">{inr(d.money?.due || 0)}</p></div>
        <div className="rounded-md bg-muted p-2"><p className="flex items-center justify-center gap-1 text-[11px]"><Wallet className="h-3 w-3" /> Advance</p><p className="font-semibold">{d.money?.advance == null ? '—' : inr(d.money.advance)}</p></div>
        <div className="rounded-md bg-muted p-2"><p className="flex items-center justify-center gap-1 text-[11px]"><Award className="h-3 w-3" /> Points</p><p className="font-semibold">{d.money?.loyalty ?? '—'}</p></div>
      </div>
      {d.admission && (
        <Link to={`/ipd/admissions/${d.admission._id}`} onClick={onGo} className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-sm hover:bg-red-100">
          <span className="flex items-center gap-2"><BedDouble className="h-4 w-4 text-red-600" /><b>{d.admission.ward?.name} · Bed {d.admission.bed?.number}</b> · {d.admission.doctor?.name}</span>
          <span className="text-xs">{d.admission.admissionNo} · since {fmtDate(d.admission.admittedAt)}</span>
        </Link>
      )}
      {d.upcoming?.length > 0 && <Mini title="Upcoming appointments">{d.upcoming.map((a) => <Link key={a._id} to={`/appointments/${a._id}`} onClick={onGo} className="flex justify-between rounded px-1 hover:bg-muted"><span>{fmtDate(a.date)} {fmtTime(a.start)} · {a.doctor?.name}</span><span className="text-xs text-muted-foreground">{a.branch?.code} · {titleCase(a.status)}</span></Link>)}</Mini>}
      {d.followups?.length > 0 && <Mini title="Follow-ups due">{d.followups.map((f) => <p key={f._id} className="flex justify-between"><span>{fmtDate(f.dueDate)} · {f.reason || 'Review'}</span><Badge variant="warning">{f.status}</Badge></p>)}</Mini>}
      {d.prescriptions?.length > 0 && <Mini title="Last prescription">{d.prescriptions.slice(0, 1).map((x) => <p key={x._id}><b>{x.diagnosis || '—'}</b> <span className="text-xs text-muted-foreground">· {fmtDate(x.createdAt)} · {x.doctor?.name}</span><br /><span className="text-xs text-muted-foreground">{(x.items || []).map((i) => i.name).slice(0, 5).join(', ')}</span></p>)}</Mini>}
      {d.invoices?.length > 0 && <Mini title="Recent bills">{d.invoices.slice(0, 4).map((i) => <Link key={i._id} to={`/billing/${i._id}`} onClick={onGo} className="flex justify-between rounded px-1 hover:bg-muted"><span>{i.invoiceNo} · {fmtDate(i.createdAt)}</span><span className="flex items-center gap-2">{inr(i.grandTotal)}<Badge variant={ST[i.status]}>{titleCase(i.status)}</Badge></span></Link>)}</Mini>}
      {d.recent?.length > 0 && <Mini title={`Past visits (${d.recent.length}${d.admissionsCount ? ` · ${d.admissionsCount} admission${d.admissionsCount > 1 ? 's' : ''}` : ''})`}>{d.recent.slice(0, 4).map((a) => <Link key={a._id} to={`/appointments/${a._id}`} onClick={onGo} className="flex justify-between rounded px-1 hover:bg-muted"><span>{fmtDate(a.date)} · {a.doctor?.name}</span><span className="text-xs text-muted-foreground">{titleCase(a.status)}</span></Link>)}</Mini>}
      {(d.family?.length > 0 || extra?.others?.length > 0) && <Mini title="Family on this mobile"><div className="flex flex-wrap gap-1.5">{[...(d.family || []), ...(extra?.others || [])].filter((x, i, a) => a.findIndex((y) => y._id === x._id) === i).map((f) => <Link key={f._id} to={`/patients/${f._id}`} onClick={onGo} className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted"><Users className="mr-1 inline h-3 w-3" />{f.name} · {f.patientId}</Link>)}</div></Mini>}
      {d.leads?.length > 0 && <Mini title="CRM">{d.leads.map((l) => <Link key={l._id} to={`/leads/${l._id}`} onClick={onGo} className="flex justify-between rounded px-1 hover:bg-muted"><span><Contact className="mr-1 inline h-3.5 w-3.5" />Lead · {titleCase(l.source || '')}</span><span className="text-xs">{l.stage?.name}</span></Link>)}</Mini>}
    </Card>
  );
}

/** one card per scan result */
export function ScanResult({ r, onGo }) {
  const d = r.data;
  switch (r.type) {
    case 'patient': return <PatientCard d={d} extra={r} onGo={onGo} />;
    case 'admission': return (
      <Card icon={BedDouble} title={`${d.admissionNo} · ${d.patient?.name || ''}`} sub={`${d.ward?.name || ''} · Bed ${d.bed?.number || ''} · ${d.doctor?.name || ''}`} to={`/ipd/admissions/${d._id}`} onGo={onGo}
        badge={<Badge variant={['admitted', 'discharge_initiated'].includes(d.status) ? 'danger' : 'secondary'}>{titleCase(d.status)}</Badge>}>
        {r.pass && <p className={`flex items-center gap-1.5 rounded-md px-2 py-1 font-medium ${['admitted', 'discharge_initiated'].includes(d.status) ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}><ShieldCheck className="h-4 w-4" /> Attendant pass {['admitted', 'discharge_initiated'].includes(d.status) ? 'VALID — patient is admitted' : `NOT valid — patient ${d.status}`}</p>}
        <KV k="Admitted" v={fmtDateTime(d.admittedAt)} />
        {d.attendant?.name && <KV k="Attendant" v={`${d.attendant.name}${d.attendant.relation ? ` (${d.attendant.relation})` : ''} ${d.attendant.phone || ''}`} />}
        <KV k="Payer" v={titleCase(d.payer?.type || '')} />
      </Card>
    );
    case 'invoice': return (
      <Card icon={Receipt} title={`Bill ${d.invoiceNo}`} sub={`${d.patient?.name || d.customer?.name || 'Walk-in'} · ${fmtDateTime(d.createdAt)} · ${d.branch?.code || ''}`} to={`/billing/${d._id}`} onGo={onGo} badge={<Badge variant={ST[d.status]}>{titleCase(d.status)}</Badge>}>
        <KV k="Total" v={inr(d.grandTotal)} /><KV k="Paid" v={inr(d.paid)} /><KV k="Balance" v={inr(d.balance)} tone={d.balance > 0 ? 'font-semibold text-amber-700' : ''} />
        {r.verified === false && <p className="text-xs text-amber-700">Link signature expired/invalid — record shown from database.</p>}
      </Card>
    );
    case 'receipt': return (
      <Card icon={IndianRupee} title={`Receipt ${d.receiptNo}`} sub={`${d.patient?.name || ''} · ${fmtDateTime(d.createdAt)}`} to={d.invoice ? `/billing/${d.invoice._id}` : undefined} onGo={onGo} badge={<Badge>{titleCase(d.kind)}</Badge>}>
        <KV k="Amount" v={inr(d.amount)} /><KV k="Mode" v={String(d.mode).toUpperCase()} /><KV k="Reference" v={d.reference} /><KV k="Bill" v={d.invoice?.invoiceNo} />
      </Card>
    );
    case 'creditNote': return <Card icon={FileText} title={`Credit note ${d.creditNoteNo}`} sub={`Bill ${d.invoice?.invoiceNo || ''}`} to={d.invoice ? `/billing/${d.invoice._id}` : undefined} onGo={onGo}><KV k="Amount" v={inr(d.amount)} /><KV k="Reason" v={d.reason} /></Card>;
    case 'appointment': return (
      <Card icon={CalendarDays} title={`Booking ${d.bookingId}`} sub={`${d.patient?.name || ''} · ${fmtDate(d.date)} ${fmtTime(d.start)} · ${d.doctor?.name || ''} · ${d.branch?.code || ''}`} to={`/appointments/${d._id}`} onGo={onGo} badge={<Badge variant="info">{titleCase(d.status)}</Badge>}>
        {d.prepaid?.amount > 0 && <KV k="Paid online" v={inr(d.prepaid.amount)} tone="text-emerald-700" />}
        {d.complaint && <KV k="Complaint" v={d.complaint} />}
      </Card>
    );
    case 'prescription': return (
      <Card icon={Pill} title={`Prescription ${d.rxNo}`} sub={`${d.patient?.name || ''} · ${d.doctor?.name || ''} · ${fmtDate(d.createdAt)}`} to={d.patient ? `/patients/${d.patient._id}` : undefined} onGo={onGo}>
        <KV k="Diagnosis" v={d.diagnosis} />
        {(d.items || []).length > 0 && <ul className="list-inside list-disc text-xs">{d.items.slice(0, 8).map((i, k) => <li key={k}>{i.name} {i.dose} {i.frequency} {i.duration}</li>)}</ul>}
      </Card>
    );
    case 'product': return (
      <Card icon={Package} title={d.name} sub={`${d.sku}${d.barcode ? ` · ${d.barcode}` : ''}${d.genericName ? ` · ${d.genericName}` : ''}`} to="/products" onGo={onGo} badge={!d.isActive ? <Badge variant="secondary">Inactive</Badge> : null}>
        <KV k="Price" v={inr(d.sellPrice)} /><KV k="MRP" v={d.mrp ? inr(d.mrp) : null} /><KV k="GST" v={`${d.gstRate || 0}%`} />
        {d.type !== 'service' && <Mini title="Stock">{d.stock?.length ? d.stock.map((s) => <p key={s._id} className="flex justify-between"><span>{s.branch}</span><span>{s.qty} · next expiry {s.nextExpiry}</span></p>) : <p className="text-destructive">Out of stock</p>}</Mini>}
      </Card>
    );
    case 'batch': return <Card icon={Package} title={`Batch ${d.batchNo} · ${d.product?.name || ''}`} sub={`${d.branch?.code || ''} · expiry ${d.expiry}`}><KV k="In stock" v={d.qty} /><KV k="MRP" v={inr(d.mrp)} /></Card>;
    case 'spin': return (
      <Card icon={Gift} title={`Spin code ${d.code}`} sub={`${d.name} · ${d.phone} · ${d.wheel?.name || ''}`} to="/wheels" onGo={onGo} badge={<Badge variant={d.status === 'won' ? 'success' : 'secondary'}>{titleCase(d.status)}</Badge>}>
        <KV k="Prize" v={d.prize} /><KV k="Valid till" v={d.expiresAt ? fmtDate(d.expiresAt) : null} />
      </Card>
    );
    case 'coupon': return <Card icon={TicketPercent} title={`Coupon ${d.code}`} sub={d.description} to="/coupons" onGo={onGo} badge={<Badge variant={d.isActive ? 'success' : 'secondary'}>{d.isActive ? 'Active' : 'Off'}</Badge>}><KV k="Discount" v={d.type === 'percent' ? `${d.value}%` : inr(d.value)} /><KV k="Used" v={`${d.used}${d.usageLimit ? ` / ${d.usageLimit}` : ''}`} /></Card>;
    case 'lead': return <Card icon={Contact} title={d.name} sub={`Lead · ${d.phone} · ${d.stage?.name || ''}`} to={`/leads/${d._id}`} onGo={onGo} />;
    case 'upi': return <Card icon={IndianRupee} title="UPI payment QR" sub={d.pa}><KV k="Payee" v={d.pn} /><KV k="Amount" v={d.am ? inr(d.am) : null} /><KV k="Note" v={d.tn} /></Card>;
    case 'url': return <Card icon={Globe} title={d.landing ? `Landing page /f/${d.landing}` : 'Web link'} sub={d.url}><Button asChild size="sm" variant="outline"><a href={d.url} target="_blank" rel="noopener noreferrer"><ExternalLink /> Open link</a></Button></Card>;
    default: return null;
  }
}
