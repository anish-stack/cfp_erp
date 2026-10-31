import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload, Trash2, Search, Check, Link2, Film, HardDrive, Cloud } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api, get, getPaged } from '@/lib/api';
import { useCan } from '@/store/auth';
import { errMsg } from '@/lib/utils';

const DRIVER = { local: 'Server disk', s3: 'AWS S3', r2: 'Cloudflare R2', cloudinary: 'Cloudinary' };

/** Media library: pick / upload / delete. type = image | video */
export function MediaPicker({ open, onOpenChange, onPick, type = 'image' }) {
  const can = useCan();
  const qc = useQueryClient();
  const fileRef = useRef();
  const [q, setQ] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const status = useQuery({ queryKey: ['media-status'], enabled: open, queryFn: () => get('/cms/media/status'), staleTime: 300_000 });
  const list = useQuery({ queryKey: ['media', type, q], enabled: open, queryFn: () => getPaged('/cms/media', { type, q: q || undefined, limit: 60 }) });

  const upload = async (files) => {
    if (!files?.length) return;
    const fd = new FormData();
    [...files].forEach((f) => fd.append('files', f));
    setBusy(true);
    try {
      const r = await api.post('/cms/media', fd, { timeout: 120_000 });
      toast.success(`${r.data.data.length} uploaded`);
      qc.invalidateQueries({ queryKey: ['media'] });
      if (r.data.data.length === 1) { onPick(r.data.data[0].url); onOpenChange(false); }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const remove = async (m) => {
    if (!window.confirm(`Delete ${m.name}? Pages using it will show a broken image.`)) return;
    try { await api.delete(`/cms/media/${m._id}`); qc.invalidateQueries({ queryKey: ['media'] }); } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={type === 'video' ? 'Video library' : 'Media library'} size="xl">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {can('cms.create') && <Button loading={busy} onClick={() => fileRef.current?.click()}><Upload /> Upload</Button>}
          <input ref={fileRef} type="file" multiple hidden accept={type === 'video' ? 'video/mp4,video/webm' : 'image/jpeg,image/png,image/webp,image/gif'} onChange={(e) => upload(e.target.files)} />
          {status.data && <Badge variant="outline" className="gap-1">{status.data.active === 'local' ? <HardDrive className="h-3 w-3" /> : <Cloud className="h-3 w-3" />} {DRIVER[status.data.active]}</Badge>}
        </div>
        <div
          className="min-h-[280px] rounded-lg border border-dashed p-2"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (can('cms.create')) upload(e.dataTransfer.files); }}
        >
          {list.isLoading ? <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="aspect-square" />)}</div>
            : !list.data?.items?.length ? <p className="py-16 text-center text-sm text-muted-foreground">No files yet — drop files here or click Upload ({type === 'video' ? 'MP4/WEBM up to 40 MB' : 'JPG/PNG/WEBP/GIF up to 5 MB'})</p>
              : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {list.data.items.map((m) => (
                    <div key={m._id} className="group relative overflow-hidden rounded-md border bg-muted">
                      <button type="button" className="block w-full" onClick={() => { onPick(m.url); onOpenChange(false); }}>
                        {m.resourceType === 'video' ? <div className="grid aspect-square place-items-center"><Film className="h-8 w-8 text-muted-foreground" /></div> : <img src={m.url} alt="" loading="lazy" className="aspect-square w-full object-cover" />}
                        <span className="absolute inset-0 hidden place-items-center bg-black/40 text-white group-hover:grid"><Check /></span>
                      </button>
                      <p className="truncate px-1.5 py-1 text-[10px]">{m.name}</p>
                      {can('cms.delete') && <button type="button" className="absolute right-1 top-1 hidden rounded bg-white/90 p-1 text-destructive group-hover:block" onClick={() => remove(m)}><Trash2 className="h-3.5 w-3.5" /></button>}
                    </div>
                  ))}
                </div>
              )}
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1"><Link2 className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-8" placeholder={type === 'video' ? 'or paste YouTube / video URL' : 'or paste image URL (https://…)'} value={url} onChange={(e) => setUrl(e.target.value)} /></div>
          <Button variant="outline" disabled={!/^https:\/\//.test(url)} onClick={() => { onPick(url); setUrl(''); onOpenChange(false); }}>Use URL</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
