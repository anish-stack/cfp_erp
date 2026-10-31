import { useState } from 'react';
import { Printer, MessageCircle, Download, Image as ImageIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/common/EmptyState';
import { useAction } from '@/hooks/queries';
import { api, post, openFile } from '@/lib/api';
import { fmtDateTime, fmtDate } from '@/lib/utils';

function RxImage({ rxId, idx }) {
  const [src, setSrc] = useState(null);
  if (!src) {
    api.get(`/clinical/prescriptions/${rxId}/images/${idx}`, { responseType: 'blob' }).then((r) => setSrc(URL.createObjectURL(r.data))).catch(() => {});
    return <div className="h-40 w-full animate-pulse rounded bg-muted" />;
  }
  return <img src={src} alt="" className="w-full rounded border" />;
}

export function PrescriptionList({ items = [], loading }) {
  const [view, setView] = useState(null);
  const send = useAction((id) => post(`/clinical/prescriptions/${id}/send`), { success: 'Queued on WhatsApp' });
  if (loading) return <div className="h-24 animate-pulse rounded-lg bg-muted" />;
  if (!items.length) return <Card><EmptyState title="No prescriptions yet" /></Card>;
  return (
    <div className="space-y-3">
      {items.map((rx) => (
        <Card key={rx._id} className="p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">{rx.diagnosis || (rx.mode === 'image' ? 'Handwritten prescription' : 'Prescription')}</p>
              <p className="text-xs text-muted-foreground">{rx.rxNo} · {fmtDateTime(rx.createdAt)} · {rx.doctor?.name}{rx.templateName ? ` · ${rx.templateName}` : ''}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {rx.mode !== 'typed' && <Badge variant="info"><ImageIcon className="mr-1 h-3 w-3" />{rx.images?.length || 0} image(s)</Badge>}
                {rx.followUpDate && <Badge variant="warning">Follow-up {fmtDate(rx.followUpDate)}</Badge>}
              </div>
            </div>
            <div className="flex gap-1">
              {rx.images?.length > 0 && <Button size="sm" variant="ghost" onClick={() => setView(rx)}><ImageIcon /> View</Button>}
              <Button size="sm" variant="ghost" onClick={() => openFile(`/clinical/prescriptions/${rx._id}/pdf`)}><Printer /> Print</Button>
              <Button size="sm" variant="ghost" onClick={() => openFile(`/clinical/prescriptions/${rx._id}/pdf`, { download: true, filename: `${rx.rxNo.replace(/\//g, '-')}.pdf` })}><Download /></Button>
              <Button size="sm" variant="ghost" loading={send.isPending && send.variables === rx._id} onClick={() => send.mutate(rx._id)}><MessageCircle /> Send</Button>
            </div>
          </div>
          {rx.items?.length > 0 && (
            <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm">
              {rx.items.map((i, k) => <li key={k}><span className="font-medium">{i.name}</span> <span className="text-muted-foreground">{[i.dose, i.frequency, i.timing, i.duration].filter(Boolean).join(' · ')}</span></li>)}
            </ol>
          )}
          {rx.advice && <p className="mt-1 text-xs text-muted-foreground">Advice: {rx.advice}</p>}
        </Card>
      ))}
      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent title={`${view?.rxNo || ''} · images`} size="lg">
          <div className="space-y-3">{view?.images?.map((_, i) => <RxImage key={i} rxId={view._id} idx={i} />)}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
