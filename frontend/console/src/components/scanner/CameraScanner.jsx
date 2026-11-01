import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats as F } from 'html5-qrcode';
import { CameraOff, SwitchCamera, Flashlight } from 'lucide-react';
import { Button } from '@/components/ui/button';

const FORMATS = [F.QR_CODE, F.CODE_128, F.CODE_39, F.CODE_93, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.ITF, F.CODABAR, F.DATA_MATRIX, F.PDF_417, F.AZTEC];
const KEY = 'cpf-scanner-camera';

/** Live camera QR + barcode reader. Calls onCode(text) once per distinct read. */
export function CameraScanner({ onCode, paused }) {
  const id = useRef(`cam-${Math.random().toString(36).slice(2)}`);
  const inst = useRef(null);
  const last = useRef({ text: '', at: 0 });
  const [cams, setCams] = useState([]);
  const [cam, setCam] = useState(() => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } });
  const [err, setErr] = useState('');
  const [torch, setTorch] = useState(false);
  const cb = useRef(onCode);
  cb.current = onCode;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    let alive = true;
    Html5Qrcode.getCameras().then((list) => {
      if (!alive) return;
      setCams(list);
      if (!list.length) setErr('No camera found on this device. Use a USB scanner or upload a photo.');
      else if (!list.some((c) => c.id === cam)) setCam((list.find((c) => /back|rear|environment/i.test(c.label)) || list[list.length - 1]).id);
    }).catch(() => setErr('Camera permission denied. Allow camera access in the browser (address bar → site settings), or use a USB scanner / photo.'));
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!cam) return undefined;
    let stopped = false;
    const q = new Html5Qrcode(id.current, { formatsToSupport: FORMATS, verbose: false, useBarCodeDetectorIfSupported: true });
    inst.current = q;
    q.start(cam, { fps: 12, qrbox: (w, h) => ({ width: Math.max(60, Math.floor(Math.min(w, h) * 0.75)), height: Math.max(60, Math.floor(Math.min(w, h) * 0.6)) }), aspectRatio: 1.333 }, (text) => {
      if (pausedRef.current) return;
      const now = Date.now();
      if (text === last.current.text && now - last.current.at < 3000) return;
      last.current = { text, at: now };
      try { navigator.vibrate?.(60); } catch { /* ignore */ }
      cb.current(text);
    }, () => {}).then(() => { try { localStorage.setItem(KEY, cam); } catch { /* ignore */ } setErr(''); })
      .catch((e) => !stopped && setErr(`Camera could not start: ${e?.message || e}`));
    return () => {
      stopped = true;
      const s = q.isScanning ? q.stop() : Promise.resolve();
      s.catch(() => {}).finally(() => { try { q.clear(); } catch { /* ignore */ } });
    };
  }, [cam]);

  const toggleTorch = async () => {
    try { await inst.current?.applyVideoConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch); } catch { setErr('This camera has no flashlight'); }
  };
  const next = () => { if (cams.length > 1) setCam(cams[(cams.findIndex((c) => c.id === cam) + 1) % cams.length].id); };

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-lg bg-black">
        <div id={id.current} className="aspect-[4/3] w-full [&_video]:!h-full [&_video]:!w-full [&_video]:object-cover" />
        {err && <div className="absolute inset-0 grid place-items-center bg-black/80 p-4 text-center text-sm text-white"><div><CameraOff className="mx-auto mb-2 h-8 w-8" />{err}</div></div>}
        {paused && !err && <div className="absolute inset-0 grid place-items-center bg-black/40 text-sm font-medium text-white">Looking up…</div>}
      </div>
      {cams.length > 0 && (
        <div className="flex gap-2">
          {cams.length > 1 && <Button size="sm" variant="outline" onClick={next}><SwitchCamera /> Switch camera</Button>}
          <Button size="sm" variant="outline" onClick={toggleTorch}><Flashlight /> {torch ? 'Light off' : 'Light'}</Button>
        </div>
      )}
    </div>
  );
}

/** decode a photo / screenshot */
export async function scanImageFile(file) {
  const holder = document.createElement('div');
  holder.id = `img-${Math.random().toString(36).slice(2)}`;
  holder.style.display = 'none';
  document.body.appendChild(holder);
  const q = new Html5Qrcode(holder.id, { formatsToSupport: FORMATS, verbose: false });
  try { return await q.scanFile(file, false); } finally { try { q.clear(); } catch { /* ignore */ } holder.remove(); }
}
