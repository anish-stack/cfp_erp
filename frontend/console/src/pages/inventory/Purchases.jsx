import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Send, PackageCheck, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Pagination } from '@/components/common/DataTable';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog, DialogContent, SheetContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Field } from '@/components/common/Field';
import { Can } from '@/components/common/Can';
import { LineEditor, toNum } from './LineEditor';
import { usePaged, useGet, useAction, useBranches } from '@/hooks/queries';
import { post, getPaged } from '@/lib/api';
import { useAuth, useCan } from '@/store/auth';
import { fmtDate, inr } from '@/lib/utils';

function useSuppliers() {
  return useQuery({ queryKey: ['suppliers-all'], queryFn: () => getPaged('/inventory/suppliers', { all: 'true' }).then((r) => r.items) });
}

function NewPO({ onDone }) {
  const branchId = useAuth((s) => s.branchId);
  const { data: branches = [] } = useBranches();
  const { data: suppliers = [] } = useSuppliers();
  const [branch, setBranch] = useState(branchId || '');
  const [supplier, setSupplier] = useState('');
  const [expectedDate, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([]);
  const save = useAction(() => post('/inventory/purchase-orders', { branch, supplier, expectedDate: expectedDate || undefined, notes: notes || undefined, items: lines.map((l) => ({ product: l.product, qty: Number(l.qty), rate: Number(l.rate) || 0, gstRate: Number(l.gstRate) || 0 })) }), { success: (p) => `PO ${p.poNo} created`, invalidate: ['/inventory/purchase-orders'], onSuccess: onDone });
  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.rate) || 0) * (1 + (Number(l.gstRate) || 0) / 100), 0);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Branch" required><Select value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Select">{branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</Select></Field>
        <Field label="Supplier" required><Select value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Select">{suppliers.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select></Field>
        <Field label="Expected date"><Input type="date" value={expectedDate} onChange={(e) => setExpected(e.target.value)} /></Field>
      </div>
      <LineEditor lines={lines} setLines={setLines} cols={['qty', 'rate', 'gstRate']} />
      <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="flex items-center justify-between"><span className="text-sm">Estimated total <b>{inr(total)}</b></span><Button disabled={!branch || !supplier || !lines.length} loading={save.isPending} onClick={() => save.mutate()}>Create draft PO</Button></div>
    </div>
  );
}

function PODetail({ id, onClose }) {
  const can = useCan();
  const { data: po, isLoading } = useGet(['/inventory/purchase-orders', id], `/inventory/purchase-orders/${id}`);
  const [lines, setLines] = useState([]);
  const [invoiceNo, setInvoiceNo] = useState('');
  useEffect(() => {
    if (po) setLines(po.items.filter((i) => i.receivedQty < i.qty).map((i) => ({ product: i.product._id, name: i.product.name, qty: i.qty - i.receivedQty, ordered: i.qty, received: i.receivedQty, purchasePrice: i.rate, batchNo: '', expiry: '', mrp: '' })));
  }, [po]);
  const inv = ['/inventory/purchase-orders', 'stock', 'batches', 'alerts'];
  const status = useAction((s) => post(`/inventory/purchase-orders/${id}/status`, { status: s }), { success: 'Updated', invalidate: inv });
  const receive = useAction(() => post(`/inventory/purchase-orders/${id}/receive`, { invoiceNo: invoiceNo || undefined, lines: lines.filter((l) => Number(l.qty) > 0).map((l) => ({ product: l.product, batchNo: l.batchNo, expiry: l.expiry, qty: Number(l.qty), purchasePrice: toNum(l.purchasePrice), mrp: toNum(l.mrp), sellPrice: toNum(l.sellPrice) })) }), { success: 'Stock received', invalidate: inv });
  if (isLoading || !po) return <Skeleton className="h-64 w-full" />;
  const canReceive = ['ordered', 'partial'].includes(po.status) && can('purchases.edit');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><StatusBadge status={po.status} /><span className="text-sm text-muted-foreground">{po.supplier?.name} · {po.branch?.name} · {inr(po.total)}</span></div>
      <DataTable rows={po.items} columns={[
        { key: 'p', header: 'Product', cell: (i) => i.product?.name },
        { key: 'q', header: 'Ordered', cell: (i) => i.qty },
        { key: 'r', header: 'Received', cell: (i) => i.receivedQty },
        { key: 'rt', header: 'Rate', cell: (i) => inr(i.rate) },
        { key: 'g', header: 'GST', cell: (i) => `${i.gstRate}%` },
      ]} />
      <div className="flex flex-wrap gap-2">
        {po.status === 'draft' && can('purchases.approve') && <Button size="sm" loading={status.isPending} onClick={() => status.mutate('ordered')}><Send /> Approve & mark ordered</Button>}
        {['draft', 'ordered'].includes(po.status) && can('purchases.approve') && <Button size="sm" variant="outline" className="text-destructive" onClick={() => status.mutate('cancelled')}><XCircle /> Cancel PO</Button>}
      </div>
      {canReceive && (
        <div className="space-y-3 rounded-lg border p-3">
          <p className="font-semibold">Receive goods (GRN)</p>
          <Field label="Supplier invoice no."><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></Field>
          <LineEditor lines={lines} setLines={setLines} cols={['batchNo', 'expiry', 'qty', 'purchasePrice', 'mrp', 'sellPrice']} />
          <div className="flex justify-end"><Button disabled={!lines.some((l) => Number(l.qty) > 0) || lines.some((l) => Number(l.qty) > 0 && (!l.batchNo || !l.expiry))} loading={receive.isPending} onClick={() => receive.mutate()}><PackageCheck /> Receive</Button></div>
        </div>
      )}
      {po.receipts?.length > 0 && <p className="text-xs text-muted-foreground">Receipts: {po.receipts.map((r) => `${fmtDate(r.at)}${r.invoiceNo ? ` (${r.invoiceNo})` : ''}`).join(', ')}</p>}
      <div className="flex justify-end"><Button variant="outline" onClick={onClose}>Close</Button></div>
    </div>
  );
}

export default function Purchases() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const { data, isLoading } = usePaged(['/inventory/purchase-orders'], '/inventory/purchase-orders', { status: status || undefined, page, limit: 25 });
  return (
    <div>
      <PageHeader title="Purchase Orders" actions={<Can perm="purchases.create"><Button onClick={() => setCreating(true)}><Plus /> New PO</Button></Can>} />
      <div className="mb-3"><Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses">{['draft', 'ordered', 'partial', 'received', 'cancelled'].map((s) => <option key={s}>{s}</option>)}</Select></div>
      <DataTable loading={isLoading} rows={data?.items} onRowClick={(p) => setOpen(p)} footer={<Pagination meta={data?.meta} page={page} setPage={setPage} />} columns={[
        { key: 'no', header: 'PO', cell: (p) => <span className="font-mono text-xs">{p.poNo}</span> },
        { key: 'd', header: 'Date', cell: (p) => fmtDate(p.createdAt) },
        { key: 's', header: 'Supplier', cell: (p) => p.supplier?.name },
        { key: 'b', header: 'Branch', cell: (p) => p.branch?.code },
        { key: 'i', header: 'Items', cell: (p) => p.items.length },
        { key: 't', header: 'Total', cell: (p) => inr(p.total) },
        { key: 'st', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
      ]} />
      <Dialog open={creating} onOpenChange={setCreating}><DialogContent title="New purchase order" size="xl"><NewPO onDone={() => setCreating(false)} /></DialogContent></Dialog>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}><SheetContent title={open?.poNo} width="max-w-4xl">{open && <PODetail id={open._id} onClose={() => setOpen(null)} />}</SheetContent></Dialog>
    </div>
  );
}
