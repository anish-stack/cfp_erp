import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ImagePlus, Trash2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/utils';

/** Image field: upload (to `uploadUrl`, returns { url }) or paste a URL. value = public image URL. */
export function ImageField({ value, onChange, uploadUrl, round = false, maxMb = 3 }) {
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const pick = async (file) => {
    if (!file) return;
    if (!/image\/(png|jpe?g|webp)/.test(file.type)) return toast.error('JPG, PNG or WEBP only');
    if (file.size > maxMb * 1024 * 1024) return toast.error(`Max ${maxMb} MB`);
    const fd = new FormData();
    fd.append('file', file);
    setBusy(true);
    try {
      const r = await api.post(uploadUrl, fd);
      onChange(r.data.data.url);
      toast.success('Image uploaded');
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  return (
    <div className="flex items-start gap-3">
      <div className={`grid h-20 w-20 shrink-0 place-items-center overflow-hidden border bg-muted ${round ? 'rounded-full' : 'rounded-lg'}`}>
        {value ? <img src={value} alt="" className="h-full w-full object-cover object-top" /> : <UserRound className="h-8 w-8 text-muted-foreground" />}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap gap-2">
          <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <Button type="button" size="sm" variant="outline" loading={busy} onClick={() => ref.current?.click()}><ImagePlus /> {value ? 'Change photo' : 'Upload photo'}</Button>
          {value && <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => onChange('')}><Trash2 /> Remove</Button>}
        </div>
        <Input className="h-8 text-xs" placeholder="…or paste an image URL" value={value || ''} onChange={(e) => onChange(e.target.value)} />
        <p className="text-[11px] text-muted-foreground">Square photo works best (at least 400×400). Max {maxMb} MB.</p>
      </div>
    </div>
  );
}
