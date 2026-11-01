import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { toast } from 'sonner';
import { ScanLine, Camera, Keyboard, ImageUp, Loader2, SearchX, History } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { get } from '@/lib/api';
import { errMsg, cn } from '@/lib/utils';
import { CameraScanner, scanImageFile } from './CameraScanner';
import { ScanResult } from './ScanResults';

/** global open/close (header button, USB scanner hotkey) */
export const useScanner = create((set) => ({ open: false, code: '', show: (code = '') => set({ open: true, code }), hide: () => set({ open: false, code: '' }) }));

const MODE_KEY = 'cpf-scanner-mode';

export function ScannerDialog() {
  const { open, code: incoming, hide } = useScanner();
  const [mode, setMode] = useState(() => { try { return localStorage.getItem(MODE_KEY) || 'camera'; } catch { return 'camera'; } });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [history, setHistory] = useState([]);
  const inputRef = useRef();
  const fileRef = useRef();

  const lastQ = useRef({ q: '', at: 0 });
  const lookup = async (q, force = false) => {
    const v = String(q || '').trim();
    if (v.length < 2) return;
    // the same code read twice in a row (camera frames / double fire) → one lookup
    if (!force && lastQ.current.q === v && Date.now() - lastQ.current.at < 3000) return;
    lastQ.current = { q: v, at: Date.now() };
    setBusy(true);
    setText(v);
    try {
      const r = await get('/lookup', { q: v });
      setRes(r);
      setHistory((h) => [{ q: v, label: r.results[0] ? `${r.results[0].type}` : 'not found', at: Date.now() }, ...h.filter((x) => x.q !== v)].slice(0, 8));
      if (!r.results.length) toast.error('Nothing found for this code');
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  // camera: a code that stays in front of the lens is looked up once (until a different code is read)
  const camLast = useRef('');
  const fromCamera = (v) => { if (v === camLast.current) return; camLast.current = v; lookup(v); };
  useEffect(() => { if (!open) camLast.current = ''; }, [open]);
  useEffect(() => { if (open && incoming) { setMode('usb'); lookup(incoming); } }, [open, incoming]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open) { setRes(null); setText(''); } }, [open]);
  useEffect(() => { try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ } if (open && mode === 'usb') setTimeout(() => inputRef.current?.focus(), 50); }, [mode, open]);

  const fromImage = async (f) => {
    if (!f) return;
    setBusy(true);
    try { await lookup(await scanImageFile(f)); } catch { toast.error('No QR / barcode found in this image'); setBusy(false); } finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && hide()}>
      <DialogContent size="xl" title={<span className="flex items-center gap-2"><ScanLine className="h-5 w-5 text-primary" /> Scanner</span>} description="Scan any QR or barcode — patient ID, sticker, attendant pass, bill, receipt, booking, prescription, medicine, coupon — or type it.">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
              {[['camera', Camera, 'Camera'], ['usb', Keyboard, 'Scanner gun'], ['photo', ImageUp, 'Photo']].map(([k, Ic, l]) => (
                <button key={k} type="button" onClick={() => setMode(k)} className={cn('flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium', mode === k ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')}><Ic className="h-4 w-4" />{l}</button>
              ))}
            </div>
            {mode === 'camera' && open && <CameraScanner paused={busy} onCode={fromCamera} />}
            {mode === 'photo' && (
              <button type="button" onClick={() => fileRef.current?.click()} className="grid aspect-[4/3] w-full place-items-center rounded-lg border-2 border-dashed text-sm text-muted-foreground hover:bg-muted">
                <span className="text-center"><ImageUp className="mx-auto mb-2 h-8 w-8" />Upload a photo / screenshot of the QR or barcode</span>
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => fromImage(e.target.files?.[0])} />
            <form onSubmit={(e) => { e.preventDefault(); lookup(text, true); }} className="flex gap-2">
              <Input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === 'usb' ? 'Point the scanner gun & scan… or type' : 'Patient ID, mobile, bill no, ADM no…'} className="font-mono" autoComplete="off" />
              <Button type="submit" loading={busy} disabled={text.trim().length < 2}>Find</Button>
            </form>
            {mode === 'usb' && <p className="text-xs text-muted-foreground">USB / Bluetooth scanner guns work anywhere in the console — scan while no text box is focused and this window opens by itself.</p>}
            {history.length > 0 && (
              <div className="space-y-1">
                <p className="flex items-center gap-1 text-[11px] font-semibold uppercase text-muted-foreground"><History className="h-3 w-3" /> Recent scans</p>
                <div className="flex flex-wrap gap-1.5">{history.map((h) => <button key={h.q} type="button" onClick={() => lookup(h.q, true)} className="max-w-[220px] truncate rounded-full border px-2 py-0.5 font-mono text-[11px] hover:bg-muted" title={h.q}>{h.q.length > 28 ? `${h.q.slice(0, 26)}…` : h.q}</button>)}</div>
              </div>
            )}
          </div>
          <div className="max-h-[70vh] min-h-[200px] space-y-3 overflow-y-auto pr-1 scrollbar-thin">
            {busy && <div className="grid h-40 place-items-center text-sm text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
            {!busy && !res && <div className="grid h-40 place-items-center rounded-lg border border-dashed text-center text-sm text-muted-foreground"><span><ScanLine className="mx-auto mb-2 h-8 w-8" />Scan something to see its details here</span></div>}
            {!busy && res && !res.results.length && <div className="grid h-40 place-items-center rounded-lg border border-dashed text-center text-sm text-muted-foreground"><span><SearchX className="mx-auto mb-2 h-8 w-8" />No record found for<br /><span className="font-mono text-foreground">{res.query.slice(0, 80)}</span></span></div>}
            {!busy && res?.results.map((r, i) => <ScanResult key={`${r.type}-${i}`} r={r} onGo={hide} />)}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** header button */
export function ScannerButton() {
  const show = useScanner((s) => s.show);
  return (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => show()} title="Scan QR / barcode (Alt+S)">
      <ScanLine className="h-4 w-4" /><span className="hidden sm:inline">Scan</span>
    </Button>
  );
}

/**
 * USB/Bluetooth scanner guns "type" very fast and press Enter. Detect that anywhere in the console
 * (when no input is focused) and open the scanner with the code. Alt+S opens it manually.
 */
export function useScannerHotkeys() {
  const show = useScanner((s) => s.show);
  useEffect(() => {
    let buf = '';
    let lastAt = 0;
    let gaps = [];
    const onKey = (e) => {
      if (e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); show(); return; }
      const t = e.target;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (useScanner.getState().open) return;
      const now = performance.now();
      if (now - lastAt > 80) { buf = ''; gaps = []; } else gaps.push(now - lastAt);
      lastAt = now;
      if (e.key === 'Enter') {
        const fast = gaps.length >= 3 && gaps.reduce((a, b) => a + b, 0) / gaps.length < 40;
        if (buf.length >= 4 && fast) { e.preventDefault(); show(buf); }
        buf = ''; gaps = [];
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) buf += e.key;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [show]);
}
