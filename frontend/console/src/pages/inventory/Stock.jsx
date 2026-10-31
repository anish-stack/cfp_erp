import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PackagePlus, SlidersHorizontal, Download } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Pagination } from '@/components/common/DataTable';
import { SearchInput } from '@/components/common/SearchInput';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/common/Field';
import { Can } from '@/components/common/Can';
import { LineEditor, toNum } from './LineEditor';
import { useGet, usePaged, useAction, useBranches } from '@/hooks/queries';
import { post, getPaged, openFile } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useQuery } from '@tanstack/react-query';
import { fmtDate, fmtDateTime, inr, todayIST, addDays, cn } from '@/lib/utils';

function ReceiveForm({ onDone }) {
  const branchId = useAuth((s) => s.branchId);
  const { data: branches = [] } = useBranches();
  const [branch, setBranch] = useState(branchId || '');
  const [supplier, setSupplier] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [lines, setLines] = useState([]);
  const sup = useQuery({ queryKey: ['suppliers-all'], queryFn: () => getPaged('/inventory/suppliers', { all: 'true' }).then((r) => r.items) });
  const save = useAction(() => post('/inventory/receive', { branch, supplier: supplier || undefined, invoiceNo: invoiceNo || undefined, lines: lines.map((l) => ({ product: l.product, batchNo: l.batchNo, expiry: l.expiry, qty: Number(l.qty), purchasePrice: toNum(l.purchasePrice), mrp: toNum(l.mrp), sellPrice: toNum(l.sellPrice) })) }), { success: 'Stock received', invalidate: ['stock', 'batches', 'alerts', 'movements'], onSuccess: onDone });
  const ok = branch && lines.length && lines.every((l) => l.batchNo && l.expiry && Number(l.qty) > 0);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Branch" required><Select value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Select">{branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</Select></Field>
        <Field label="Supplier"><Select value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="—">{(sup.data || []).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select></Field>
        <Field label="Supplier invoice no."><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></Field>
      </div>
      <LineEditor lines={lines} setLines={setLines} cols={['batchNo', 'expiry', 'qty', 'purchasePrice', 'mrp', 'sellPrice']} />
      <div className="flex justify-end"><Button disabled={!ok} loading={save.isPending} onClick={() => save.mutate()}>Receive stock</Button></div>
    </div>
  );
}

function AdjustForm({ batch, onDone }) {
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const save = useAction(() => post('/inventory/adjust', { batch: batch._id, delta: Number(delta), reason }), { success: 'Adjusted', invalidate: ['stock', 'batches', 'alerts', 'movements'], onSuccess: onDone });
  return (
    <div className="space-y-3">
      <p className="text-sm">{batch.product?.name} · batch {batch.batchNo} · current {batch.qty}</p>
      <Field label="Change (+ add / − remove)"><Input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} /></Field>
      <Field label="Reason" required><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Damaged, expired write-off, count correction…" /></Field>
      <div className="flex justify-end"><Button disabled={!Number(delta) || reason.length < 3} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>
    </div>
  );
}

export default function Stock() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'stock';
  const [q, setQ] = useState('');
  const [low, setLow] = useState(false);
  const [dlg, setDlg] = useState(null);
  const [mvPage, setMvPage] = useState(1);
  const [mvType, setMvType] = useState('');
  const stock = useGet(['stock', low], '/inventory/stock', { low: low ? 'true' : undefined }, { enabled: tab === 'stock' });
  const batches = useGet(['batches'], '/inventory/batches', { inStock: 'true' }, { enabled: tab === 'batches' });
  const alerts = useGet(['alerts'], '/inventory/alerts', undefined, { enabled: tab === 'alerts' });
  const moves = usePaged(['movements'], '/inventory/movements', { page: mvPage, limit: 30, type: mvType || undefined }, { enabled: tab === 'movements' });
  const ql = q.toLowerCase();
  const filt = (arr, f) => (q ? arr?.filter((x) => f(x).toLowerCase().includes(ql)) : arr);
  const expTone = (d) => (d < todayIST() ? 'danger' : d <= addDays(todayIST(), 90) ? 'warning' : 'secondary');

  return (
    <div>
      <PageHeader title="Stock" description="Branch-wise inventory by batch" actions={<>
        <Can perm="reports.export"><Button variant="outline" onClick={() => openFile('/reports/inventory', { download: true, filename: `stock-${todayIST()}.csv`, params: { format: 'csv' } })}><Download /> Export</Button></Can>
        <Can perm="inventory.create"><Button onClick={() => setDlg({ type: 'receive' })}><PackagePlus /> Receive stock</Button></Can>
      </>} />
      <Tabs value={tab} onValueChange={(v) => setSp({ tab: v })}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <TabsList><TabsTrigger value="stock">Stock</TabsTrigger><TabsTrigger value="batches">Batches</TabsTrigger><TabsTrigger value="alerts">Alerts</TabsTrigger><TabsTrigger value="movements">Movements</TabsTrigger></TabsList>
          {tab !== 'movements' && <SearchInput value={q} onChange={setQ} placeholder="Filter product" />}
          {tab === 'stock' && <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Low stock only</label>}
          {tab === 'movements' && <Select className="w-40" value={mvType} onChange={(e) => setMvType(e.target.value)} placeholder="All types">{['purchase', 'sale', 'return', 'transfer_in', 'transfer_out', 'adjust', 'cancel'].map((t) => <option key={t}>{t}</option>)}</Select>}
        </div>
        <TabsContent value="stock">
          <DataTable loading={stock.isLoading} rows={filt(stock.data, (s) => `${s.product.name} ${s.product.sku}`)} rowKey="product" columns={[
            { key: 'sku', header: 'SKU', cell: (s) => <span className="font-mono text-xs">{s.product.sku}</span> },
            { key: 'name', header: 'Product', cell: (s) => <span className="font-medium">{s.product.name}</span> },
            { key: 'qty', header: 'In stock', cell: (s) => <span className={cn('font-semibold', s.low && 'text-red-600')}>{s.qty} {s.product.unit}</span> },
            { key: 'reorder', header: 'Reorder at', cell: (s) => s.product.reorderLevel },
            { key: 'exp', header: 'Nearest expiry', cell: (s) => (s.nearestExpiry ? <Badge variant={expTone(s.nearestExpiry)}>{fmtDate(s.nearestExpiry)}</Badge> : '—') },
            { key: 'expired', header: 'Expired qty', cell: (s) => (s.expiredQty ? <span className="text-red-600">{s.expiredQty}</span> : '—') },
            { key: 'val', header: 'Value (cost)', className: 'text-right', cell: (s) => inr(s.value) },
          ]} />
        </TabsContent>
        <TabsContent value="batches">
          <DataTable loading={batches.isLoading} rows={filt(batches.data, (b) => `${b.product?.name} ${b.batchNo}`)} columns={[
            { key: 'p', header: 'Product', cell: (b) => <span className="font-medium">{b.product?.name}</span> },
            { key: 'bn', header: 'Batch', cell: (b) => <span className="font-mono text-xs">{b.batchNo}</span> },
            { key: 'br', header: 'Branch', cell: (b) => b.branch?.code },
            { key: 'e', header: 'Expiry', cell: (b) => <Badge variant={expTone(b.expiry)}>{fmtDate(b.expiry)}</Badge> },
            { key: 'q', header: 'Qty', cell: (b) => b.qty },
            { key: 'c', header: 'Cost', cell: (b) => inr(b.purchasePrice) },
            { key: 'm', header: 'MRP', cell: (b) => inr(b.mrp) },
            { key: 's', header: 'Supplier', cell: (b) => b.supplier?.name || '—' },
            { key: 'a', header: '', cell: (b) => <Can perm="inventory.edit"><Button size="sm" variant="ghost" onClick={() => setDlg({ type: 'adjust', batch: b })}><SlidersHorizontal /> Adjust</Button></Can> },
          ]} />
        </TabsContent>
        <TabsContent value="alerts" className="grid gap-4 lg:grid-cols-2">
          <Card className="p-3">
            <p className="mb-2 font-semibold">Low stock ({alerts.data?.low?.length ?? '…'})</p>
            <DataTable loading={alerts.isLoading} rows={filt(alerts.data?.low, (s) => s.product.name)} rowKey="product" className="border-0 shadow-none" columns={[
              { key: 'n', header: 'Product', cell: (s) => s.product.name },
              { key: 'q', header: 'Qty', cell: (s) => <span className="font-semibold text-red-600">{s.qty}</span> },
              { key: 'r', header: 'Reorder', cell: (s) => s.product.reorderLevel },
            ]} />
          </Card>
          <Card className="p-3">
            <p className="mb-2 font-semibold">Expiring within {alerts.data?.days ?? 90} days ({alerts.data?.expiring?.length ?? '…'})</p>
            <DataTable loading={alerts.isLoading} rows={filt(alerts.data?.expiring, (b) => b.product?.name || '')} className="border-0 shadow-none" columns={[
              { key: 'n', header: 'Product', cell: (b) => b.product?.name },
              { key: 'b', header: 'Batch', cell: (b) => b.batchNo },
              { key: 'br', header: 'Br', cell: (b) => b.branch?.code },
              { key: 'e', header: 'Expiry', cell: (b) => <Badge variant={expTone(b.expiry)}>{fmtDate(b.expiry)}</Badge> },
              { key: 'q', header: 'Qty', cell: (b) => b.qty },
            ]} />
          </Card>
        </TabsContent>
        <TabsContent value="movements">
          <DataTable loading={moves.isLoading} rows={moves.data?.items} footer={<Pagination meta={moves.data?.meta} page={mvPage} setPage={setMvPage} />} columns={[
            { key: 'd', header: 'When', cell: (m) => fmtDateTime(m.createdAt) },
            { key: 'p', header: 'Product', cell: (m) => m.product?.name },
            { key: 'b', header: 'Batch', cell: (m) => m.batchNo },
            { key: 't', header: 'Type', cell: (m) => <Badge variant="outline">{m.type}</Badge> },
            { key: 'q', header: 'Qty', cell: (m) => <span className={m.qty < 0 ? 'text-red-600' : 'text-emerald-600'}>{m.qty > 0 ? '+' : ''}{m.qty}</span> },
            { key: 'bal', header: 'Balance', cell: (m) => m.balanceAfter },
            { key: 'ref', header: 'Ref', cell: (m) => m.refNo || m.reason || '—' },
            { key: 'br', header: 'Br', cell: (m) => m.branch?.code },
            { key: 'by', header: 'By', cell: (m) => m.by?.name },
          ]} />
        </TabsContent>
      </Tabs>
      <Dialog open={dlg?.type === 'receive'} onOpenChange={(o) => !o && setDlg(null)}><DialogContent title="Receive stock (GRN)" size="xl"><ReceiveForm onDone={() => setDlg(null)} /></DialogContent></Dialog>
      <Dialog open={dlg?.type === 'adjust'} onOpenChange={(o) => !o && setDlg(null)}><DialogContent title="Stock adjustment" size="sm">{dlg?.batch && <AdjustForm batch={dlg.batch} onDone={() => setDlg(null)} />}</DialogContent></Dialog>
    </div>
  );
}
