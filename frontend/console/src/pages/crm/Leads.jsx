import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import { Plus, Upload, Download, List, KanbanSquare, UserCheck, Phone } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, Pagination } from '@/components/common/DataTable';
import { SearchInput } from '@/components/common/SearchInput';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/common/Field';
import { Can } from '@/components/common/Can';
import { LeadForm, SOURCES } from './LeadForm';
import { CallButton } from '@/components/clinic/Calling';
import { usePaged, useGet, useAction, useStages, useStaffList } from '@/hooks/queries';
import { post, patch, openFile } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useCan } from '@/store/auth';
import { fmtDateTime, titleCase, todayIST, cn } from '@/lib/utils';
import { toast } from 'sonner';

function ImportDialog({ onDone }) {
  const fileRef = useRef();
  const [rows, setRows] = useState([]);
  const [source, setSource] = useState('import');
  const [skip, setSkip] = useState(true);
  const run = useAction(() => post('/crm/leads/import', { rows, defaults: { source }, skipDuplicates: skip }), {
    invalidate: ['/crm/leads', 'crm-dash'],
    onSuccess: (r) => { toast.success(`Imported ${r.created} · duplicates ${r.duplicates} · invalid ${r.invalid}`); onDone(); },
  });
  const parse = () => {
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    Papa.parse(f, { header: true, skipEmptyLines: true, complete: (res) => setRows(res.data.slice(0, 5000)) });
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">CSV with headers: <code>name, phone, email, city, condition</code>. Excel → Save as CSV. Max 5000 rows.</p>
      <input type="file" accept=".csv" ref={fileRef} onChange={parse} className="text-sm" />
      {rows.length > 0 && <p className="text-sm">{rows.length} rows ready · first: {JSON.stringify(rows[0]).slice(0, 120)}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Source"><Select value={source} onChange={(e) => setSource(e.target.value)}>{SOURCES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></Field>
        <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> Skip duplicates (90 days)</label>
      </div>
      <div className="flex justify-end"><Button disabled={!rows.length} loading={run.isPending} onClick={() => run.mutate()}>Import</Button></div>
    </div>
  );
}

function Board({ leads, stages, onOpen }) {
  const can = useCan();
  const move = useAction(({ id, stage }) => patch(`/crm/leads/${id}`, { stage }), { invalidate: ['/crm/leads'] });
  const [drag, setDrag] = useState(null);
  return (
    <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-thin">
      {stages.map((s) => {
        const items = leads.filter((l) => l.stage?._id === s._id);
        return (
          <div key={s._id} className="w-72 shrink-0" onDragOver={(e) => e.preventDefault()} onDrop={() => {
            if (!drag || drag.stage?._id === s._id || !can('leads.edit')) return;
            if (s.isLost) return toast.info('Open the lead to mark it lost with a reason');
            move.mutate({ id: drag._id, stage: s._id });
          }}>
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="flex items-center gap-2 text-sm font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.name}</span>
              <Badge variant="secondary">{items.length}</Badge>
            </div>
            <div className="min-h-[300px] space-y-2 rounded-lg bg-muted/50 p-2">
              {items.map((l) => (
                <Card key={l._id} draggable onDragStart={() => setDrag(l)} onClick={() => onOpen(l._id)} className="cursor-pointer p-2.5 hover:shadow-md">
                  <p className="text-sm font-medium">{l.name}</p>
                  <p className="text-xs text-muted-foreground">{l.phone} · {titleCase(l.source)}</p>
                  {l.condition && <Badge variant="outline" className="mt-1">{l.condition}</Badge>}
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{l.assignedTo?.name || 'Unassigned'}</span>
                    {l.nextFollowUpAt && <span className={cn(new Date(l.nextFollowUpAt) < new Date() && 'text-red-600')}>⏰ {fmtDateTime(l.nextFollowUpAt)}</span>}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Leads() {
  const nav = useNavigate();
  const can = useCan();
  const [view, setView] = useState('list');
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [source, setSource] = useState('');
  const [assignedTo, setAssigned] = useState('');
  const [followup, setFollowup] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState([]);
  const [dlg, setDlg] = useState(null);
  const [bulkUser, setBulkUser] = useState('');
  const dq = useDebounce(q);
  const { data: stages = [] } = useStages();
  const { data: staff = [] } = useStaffList();
  const filters = { q: dq || undefined, stage: stage || undefined, source: source || undefined, assignedTo: assignedTo || undefined, followup: followup || undefined };
  const list = usePaged(['/crm/leads', 'list'], '/crm/leads', { ...filters, page, limit: 25 }, { enabled: view === 'list' });
  const board = useGet(['/crm/leads', 'board'], '/crm/leads', { ...filters, view: 'board' }, { enabled: view === 'board' });
  const bulk = useAction(() => post('/crm/leads/bulk-assign', { ids: sel, assignedTo: bulkUser }), { success: (r) => `${r.updated} lead(s) assigned`, invalidate: ['/crm/leads'], onSuccess: () => { setSel([]); setDlg(null); } });
  const rows = list.data?.items || [];
  const allSel = rows.length > 0 && rows.every((r) => sel.includes(r._id));

  const cols = useMemo(() => [
    ...(can('leads.assign') ? [{ key: 'sel', header: <Checkbox checked={allSel} onCheckedChange={(c) => setSel(c ? rows.map((r) => r._id) : [])} />, className: 'w-8', cell: (l) => <div onClick={(e) => e.stopPropagation()}><Checkbox checked={sel.includes(l._id)} onCheckedChange={(c) => setSel(c ? [...sel, l._id] : sel.filter((x) => x !== l._id))} /></div> }] : []),
    { key: 'name', header: 'Lead', cell: (l) => <div><p className="font-medium">{l.name}</p><p className="flex items-center gap-1 text-xs text-muted-foreground"><Phone className="h-3 w-3" />{l.phone}{l.city && ` · ${l.city}`}</p></div> },
    { key: 'cond', header: 'Condition', cell: (l) => l.condition || '—' },
    { key: 'src', header: 'Source', cell: (l) => <div><Badge variant="outline">{titleCase(l.source)}</Badge>{l.campaign && <p className="mt-0.5 text-xs text-muted-foreground">{l.campaign.name}</p>}</div> },
    { key: 'stage', header: 'Stage', cell: (l) => <span className="inline-flex items-center gap-1.5 text-sm"><span className="h-2 w-2 rounded-full" style={{ background: l.stage?.color }} />{l.stage?.name}</span> },
    { key: 'owner', header: 'Owner', cell: (l) => l.assignedTo?.name || <span className="text-muted-foreground">Unassigned</span> },
    { key: 'fu', header: 'Follow-up', cell: (l) => (l.nextFollowUpAt ? <span className={cn('text-xs', new Date(l.nextFollowUpAt) < new Date() && 'font-medium text-red-600')}>{fmtDateTime(l.nextFollowUpAt)}</span> : '—') },
    { key: 'created', header: 'Created', cell: (l) => <span className="text-xs">{fmtDateTime(l.createdAt)}</span> },
    ...(can('leads.edit') ? [{ key: 'call', header: '', className: 'w-10', cell: (l) => <div onClick={(e) => e.stopPropagation()}><CallButton lead={l} label="" size="icon" variant="ghost" className="h-8 w-8" /></div> }] : []),
  ], [rows, sel, allSel, can]);

  return (
    <div>
      <PageHeader title="Leads" actions={<>
        <Can perm="leads.export"><Button variant="outline" onClick={() => openFile('/crm/leads/export', { download: true, filename: `leads-${todayIST()}.csv`, params: filters })}><Download /> Export</Button></Can>
        <Can perm="leads.import"><Button variant="outline" onClick={() => setDlg('import')}><Upload /> Import</Button></Can>
        <Can perm="leads.create"><Button onClick={() => setDlg('new')}><Plus /> New lead</Button></Can>
      </>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Tabs value={view} onValueChange={setView}><TabsList><TabsTrigger value="list"><List className="h-4 w-4" /> List</TabsTrigger><TabsTrigger value="board"><KanbanSquare className="h-4 w-4" /> Funnel</TabsTrigger></TabsList></Tabs>
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Name, phone, email" />
        {view === 'list' && <Select className="w-40" value={stage} onChange={(e) => setStage(e.target.value)} placeholder="All stages">{stages.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>}
        <Select className="w-36" value={source} onChange={(e) => setSource(e.target.value)} placeholder="All sources">{SOURCES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>
        <Select className="w-36" value={assignedTo} onChange={(e) => setAssigned(e.target.value)} placeholder="Anyone"><option value="me">Me</option>{can('leads.assign') && <option value="none">Unassigned</option>}{can('leads.assign') && staff.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}</Select>
        <Select className="w-40" value={followup} onChange={(e) => setFollowup(e.target.value)} placeholder="Any follow-up"><option value="today">Due today</option><option value="overdue">Overdue</option><option value="upcoming">Upcoming</option><option value="none">Not set</option></Select>
        {sel.length > 0 && <Button size="sm" onClick={() => setDlg('assign')}><UserCheck /> Assign {sel.length}</Button>}
      </div>
      {view === 'list'
        ? <DataTable columns={cols} rows={rows} loading={list.isLoading} onRowClick={(l) => nav(`/leads/${l._id}`)} footer={<Pagination meta={list.data?.meta} page={page} setPage={setPage} />} />
        : <Board leads={board.data || []} stages={stages} onOpen={(id) => nav(`/leads/${id}`)} />}
      <Dialog open={dlg === 'new'} onOpenChange={(o) => !o && setDlg(null)}><DialogContent title="New lead" size="lg"><LeadForm onDone={(l) => { setDlg(null); if (l) nav(`/leads/${l._id}`); }} /></DialogContent></Dialog>
      <Dialog open={dlg === 'import'} onOpenChange={(o) => !o && setDlg(null)}><DialogContent title="Import leads" size="lg"><ImportDialog onDone={() => setDlg(null)} /></DialogContent></Dialog>
      <Dialog open={dlg === 'assign'} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent title={`Assign ${sel.length} lead(s)`} size="sm">
          <Select value={bulkUser} onChange={(e) => setBulkUser(e.target.value)} placeholder="Select salesperson">{staff.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}</Select>
          <div className="flex justify-end"><Button disabled={!bulkUser} loading={bulk.isPending} onClick={() => bulk.mutate()}>Assign</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
