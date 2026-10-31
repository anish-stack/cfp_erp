import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PenLine, Upload, Trash2, Eraser } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/utils';

/** Doctor signature: upload a scan/photo, or draw one with mouse/finger. Printed on prescription PDFs. */
export function SignatureUpload({ doctorId, hasSignature, onChange }) {
  const [src, setSrc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const fileRef = useRef();
  const canvas = useRef();
  const pen = useRef({ down: false, drawn: false });

  const load = async () => {
    try {
      const r = await api.get(`/doctors/${doctorId}/signature`, { responseType: 'blob' });
      setSrc((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(r.data); });
    } catch { setSrc(null); }
  };
  useEffect(() => { if (hasSignature) load(); else setSrc(null); }, [doctorId, hasSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (file) => {
    if (!file) return;
    if (!/image\/(png|jpeg)/.test(file.type)) return toast.error('PNG or JPG only');
    if (file.size > 2 * 1024 * 1024) return toast.error('Max 2 MB');
    const fd = new FormData();
    fd.append('file', file);
    setBusy(true);
    try {
      await api.post(`/doctors/${doctorId}/signature`, fd);
      toast.success('Signature saved');
      setDrawing(false);
      await load();
      onChange?.(true);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const remove = async () => {
    if (!window.confirm('Remove signature?')) return;
    try { await api.delete(`/doctors/${doctorId}/signature`); setSrc(null); onChange?.(false); toast.success('Removed'); } catch (e) { toast.error(errMsg(e)); }
  };

  // ---- draw pad
  const pos = (e) => { const r = canvas.current.getBoundingClientRect(); const t = e.touches?.[0] || e; return [(t.clientX - r.left) * (canvas.current.width / r.width), (t.clientY - r.top) * (canvas.current.height / r.height)]; };
  const start = (e) => { e.preventDefault(); const c = canvas.current.getContext('2d'); const [x, y] = pos(e); c.beginPath(); c.moveTo(x, y); pen.current.down = true; };
  const move = (e) => { if (!pen.current.down) return; e.preventDefault(); const c = canvas.current.getContext('2d'); c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#1e2a78'; const [x, y] = pos(e); c.lineTo(x, y); c.stroke(); pen.current.drawn = true; };
  const end = () => { pen.current.down = false; };
  const clear = () => { canvas.current.getContext('2d').clearRect(0, 0, canvas.current.width, canvas.current.height); pen.current.drawn = false; };
  const saveDrawn = () => { if (!pen.current.drawn) return toast.error('Draw your signature first'); canvas.current.toBlob((b) => upload(new File([b], 'signature.png', { type: 'image/png' })), 'image/png'); };

  return (
    <div className="space-y-2">
      <div className="grid h-28 place-items-center rounded-md border border-dashed bg-[repeating-linear-gradient(45deg,#fafafa,#fafafa_8px,#fff_8px,#fff_16px)]">
        {drawing ? (
          <canvas ref={canvas} width={600} height={200} className="h-full w-full touch-none cursor-crosshair" onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end} onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
        ) : src ? <img src={src} alt="signature" className="max-h-24 object-contain" /> : <p className="text-xs text-muted-foreground">No signature — prescriptions show a blank signature line</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {drawing ? (
          <>
            <Button size="sm" loading={busy} onClick={saveDrawn}>Save drawing</Button>
            <Button size="sm" variant="outline" onClick={clear}><Eraser /> Clear</Button>
            <Button size="sm" variant="ghost" onClick={() => setDrawing(false)}>Cancel</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" loading={busy} onClick={() => fileRef.current?.click()}><Upload /> Upload image</Button>
            <Button size="sm" variant="outline" onClick={() => setDrawing(true)}><PenLine /> Draw</Button>
            {src && <Button size="sm" variant="ghost" className="text-destructive" onClick={remove}><Trash2 /> Remove</Button>}
          </>
        )}
        <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg" onChange={(e) => upload(e.target.files?.[0])} />
      </div>
      <p className="text-[11px] text-muted-foreground">Tip: sign on white paper, photograph it, crop tightly. Transparent PNG looks best. Printed above the doctor’s name on every prescription.</p>
    </div>
  );
}
