import { useEffect, useRef, useState } from 'react';
import { X, Phone, MessageCircle, Gift, Copy, Check, Loader2, PartyPopper } from 'lucide-react';

/**
 * Landing page add-ons (shared by booking site + console designer preview):
 *  - floating WhatsApp / Call buttons (bottom-right)
 *  - contact popup (delay / exit-intent / scroll trigger)
 *  - Spin & Win wheel (server decides the prize; every spin is tracked)
 * Props: widgets = design.widgets, renderForm, wheelApi = { load(), spin(body) }, preview, openSignal = { which, n }
 */
const cx = (...a) => a.filter(Boolean).join(' ');
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const digits = (s = '') => String(s).replace(/\D/g, '').slice(-10);

function Modal({ open, onClose, children, wide }) {
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className={cx('relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white text-slate-900 shadow-2xl sm:rounded-2xl', wide ? 'sm:max-w-lg' : 'sm:max-w-md')} onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 z-10 rounded-full bg-white/90 p-1.5 text-slate-500 shadow hover:text-slate-900"><X className="h-4 w-4" /></button>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ floating buttons */
function Floating({ cfg }) {
  const wa = digits(cfg.whatsapp);
  const tel = digits(cfg.phone);
  if (!wa && !tel) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[80] flex flex-col items-end gap-3 print:hidden">
      {wa && (
        <a href={`https://wa.me/91${wa}${cfg.message ? `?text=${encodeURIComponent(cfg.message)}` : ''}`} target="_blank" rel="noopener noreferrer" aria-label="Chat on WhatsApp"
          className="group relative flex h-14 items-center gap-2 rounded-full bg-[#25d366] pl-4 pr-4 font-semibold text-white shadow-lg transition hover:pr-5">
          <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-[#25d366] opacity-30" />
          <MessageCircle className="h-6 w-6" /><span className="hidden text-sm sm:inline">{cfg.label || 'WhatsApp'}</span>
        </a>
      )}
      {tel && (
        <a href={`tel:+91${tel}`} aria-label="Call us" className="flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--lp-primary)] text-white shadow-lg hover:opacity-90">
          <Phone className="h-6 w-6" />
        </a>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ wheel drawing */
export function WheelSvg({ segments, rotation, spinning }) {
  const n = segments.length || 1;
  const seg = 360 / n;
  const r = 150;
  const pt = (deg, rad = r) => [r + rad * Math.sin((deg * Math.PI) / 180), r - rad * Math.cos((deg * Math.PI) / 180)];
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[300px]">
      {/* pointer */}
      <div className="absolute left-1/2 top-[-6px] z-10 -translate-x-1/2 drop-shadow"><div className="h-0 w-0 border-x-[14px] border-t-[26px] border-x-transparent border-t-slate-900" /></div>
      <svg viewBox="-6 -6 312 312" className="h-full w-full drop-shadow-xl">
        <circle cx={r} cy={r} r={r + 4} fill="#0f172a" />
        <g style={{ transform: `rotate(${rotation}deg)`, transformOrigin: '150px 150px', transition: spinning ? 'transform 5.2s cubic-bezier(0.15, 0.7, 0.1, 1)' : 'none' }}>
          {segments.map((s, i) => {
            const a0 = i * seg;
            const a1 = a0 + seg;
            const [x0, y0] = pt(a0);
            const [x1, y1] = pt(a1);
            const mid = a0 + seg / 2;
            const [tx, ty] = pt(mid, r * 0.6);
            const label = s.label.length > 18 ? `${s.label.slice(0, 17)}…` : s.label;
            return (
              <g key={i}>
                <path d={n === 1 ? `M${r} 0 A${r} ${r} 0 1 1 ${r - 0.01} 0 Z` : `M${r} ${r} L${x0} ${y0} A${r} ${r} 0 ${seg > 180 ? 1 : 0} 1 ${x1} ${y1} Z`} fill={s.color || '#e21f26'} stroke="#fff" strokeWidth="2" />
                <text x={tx} y={ty} fill={s.textColor || '#fff'} fontSize={n > 8 ? 10 : 12} fontWeight="700" textAnchor="middle" dominantBaseline="middle" transform={`rotate(${mid > 180 ? mid + 90 : mid - 90} ${tx} ${ty})`}>{label}</text>
              </g>
            );
          })}
        </g>
        <circle cx={r} cy={r} r="22" fill="#fff" stroke="#0f172a" strokeWidth="4" />
        <circle cx={r} cy={r} r="8" fill="var(--lp-primary, #e21f26)" />
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ Spin & Win */
function WheelModal({ open, onClose, wheel, api, preview, formSlug, utm }) {
  const key = `cpf-wheel-${wheel?._id}`;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(() => (preview ? null : store.get(key)));
  const [copied, setCopied] = useState(false);
  const [hp, setHp] = useState('');
  const segs = wheel?.segments || [];

  const go = async (e) => {
    e.preventDefault();
    setErr('');
    if (name.trim().length < 2) return setErr('Please enter your name');
    if (!/^[6-9]\d{9}$/.test(phone)) return setErr('Enter a valid 10-digit mobile number');
    setBusy(true);
    try {
      const r = preview
        ? (() => { const i = Math.floor(Math.random() * segs.length); const s = segs[i]; return { segmentIndex: i, prize: s.label, isWin: s.kind !== 'none', code: s.kind !== 'none' ? 'PREVIEW-CODE' : null, expiresAt: new Date(Date.now() + 30 * 864e5), description: s.description }; })()
        : await api.spin({ name: name.trim(), phone, formSlug, utm, pageUrl: location.href.slice(0, 500), referrer: document.referrer.slice(0, 500) || undefined, language: navigator.language, ...(hp ? { website: hp } : {}) });
      const seg = 360 / segs.length;
      const jitter = (Math.random() - 0.5) * seg * 0.6;
      const target = 360 * 6 + (360 - (r.segmentIndex * seg + seg / 2)) + jitter;
      setSpinning(true);
      setRotation((cur) => cur - (cur % 360) + target);
      setTimeout(() => { setSpinning(false); setResult(r); if (!preview) store.set(key, r); }, 5400);
    } catch (ex) {
      setErr(ex?.response?.data?.details?.[0]?.message || ex?.response?.data?.message || 'Could not spin right now. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(result.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };
  const book = () => { onClose(); document.getElementById('form')?.scrollIntoView({ behavior: 'smooth' }); };

  return (
    <Modal open={open} onClose={() => !spinning && onClose()} wide>
      <div className="bg-gradient-to-b from-[color:var(--lp-tint,#fff1f1)] to-white px-5 pb-6 pt-7 text-center sm:px-8">
        {!wheel ? <Loader2 className="mx-auto h-8 w-8 animate-spin text-slate-400" /> : result && !spinning ? (
          <div className="py-4">
            {result.isWin ? (
              <>
                <PartyPopper className="mx-auto h-14 w-14 text-[color:var(--lp-primary)]" />
                <p className="mt-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{result.repeat ? 'You already won' : 'Congratulations! You won'}</p>
                <p className="mt-1 text-3xl font-extrabold text-[color:var(--lp-primary)]">{result.prize}</p>
                {result.description && <p className="mt-2 text-sm text-slate-600">{result.description}</p>}
                {result.code && (
                  <div className="mx-auto mt-5 flex max-w-xs items-center justify-between gap-2 rounded-xl border-2 border-dashed border-[color:var(--lp-primary)] bg-white px-4 py-3">
                    <span className="font-mono text-xl font-bold tracking-wider">{result.code}</span>
                    <button type="button" onClick={copy} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Copy code">{copied ? <Check className="h-5 w-5 text-emerald-600" /> : <Copy className="h-5 w-5" />}</button>
                  </div>
                )}
                {result.expiresAt && <p className="mt-2 text-xs text-slate-500">Valid till {new Date(result.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · Code also sent on WhatsApp</p>}
                <button type="button" onClick={book} className="mt-6 w-full rounded-lg bg-[color:var(--lp-primary)] py-3 font-bold text-white shadow hover:opacity-90">Book my appointment</button>
              </>
            ) : (
              <>
                <Gift className="mx-auto h-14 w-14 text-slate-400" />
                <p className="mt-3 text-2xl font-bold">{result.prize || 'Better luck next time'}</p>
                <p className="mt-2 text-sm text-slate-600">{result.repeat ? 'You have already used your spin for this offer.' : 'No prize this time — but your first consultation is still free.'}</p>
                <button type="button" onClick={book} className="mt-6 w-full rounded-lg bg-[color:var(--lp-primary)] py-3 font-bold text-white shadow hover:opacity-90">Book free consultation</button>
              </>
            )}
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-extrabold text-[color:var(--lp-primary)]">{wheel.title || 'Spin & Win!'}</h2>
            {wheel.subtitle && <p className="mt-1 text-sm text-slate-600">{wheel.subtitle}</p>}
            <div className="mt-5"><WheelSvg segments={segs} rotation={rotation} spinning={spinning} /></div>
            <form onSubmit={go} noValidate className="mx-auto mt-5 max-w-sm space-y-2.5 text-left">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name*" disabled={spinning} autoComplete="name"
                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[color:var(--lp-primary)]" />
              <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile number*" inputMode="numeric" disabled={spinning} autoComplete="tel-national"
                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[color:var(--lp-primary)]" />
              <input type="text" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} className="hidden" aria-hidden="true" />
              {err && <p className="text-sm text-red-600">{err}</p>}
              <button type="submit" disabled={busy || spinning} className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[color:var(--lp-primary)] text-base font-bold text-white shadow-lg hover:opacity-90 disabled:opacity-60">
                {busy || spinning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Gift className="h-5 w-5" />}{spinning ? 'Spinning…' : wheel.buttonText || 'Spin now'}
              </button>
              {wheel.terms && <p className="pt-1 text-center text-[11px] leading-snug text-slate-500">{wheel.terms}</p>}
              <p className="text-center text-[11px] text-slate-400">By spinning you agree to receive a call / WhatsApp from us.</p>
            </form>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ main */
export default function LandingWidgets({ widgets = {}, renderForm, wheelApi, preview = false, openSignal, formSlug, utm }) {
  const floating = widgets.floating || {};
  const popup = widgets.popup || {};
  const wcfg = widgets.wheel || {};
  const [open, setOpen] = useState(null); // 'popup' | 'wheel' | null
  const [wheel, setWheel] = useState(null);
  const openRef = useRef(null);
  openRef.current = open;
  const wheelOn = wcfg.enabled && wcfg.wheelId && wheelApi;

  useEffect(() => {
    if (!wheelOn) { setWheel(null); return; }
    let live = true;
    wheelApi.load(wcfg.wheelId).then((w) => live && setWheel(w)).catch(() => live && setWheel(null));
    return () => { live = false; };
  }, [wheelOn, wcfg.wheelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // designer buttons: "preview popup / wheel"
  useEffect(() => { if (openSignal?.which) setOpen(openSignal.which); }, [openSignal]);

  // automatic triggers (live site only)
  useEffect(() => {
    if (preview) return undefined;
    const cleanups = [];
    const touch = window.matchMedia?.('(pointer: coarse)').matches;
    const arm = (which, trigger, delaySec, scrollPct, canShow, markShown) => {
      if (!canShow()) return;
      const show = () => { if (!openRef.current && canShow()) { markShown(); setOpen(which); } };
      if (trigger === 'scroll') {
        const onScroll = () => { const h = document.documentElement; if ((h.scrollTop + innerHeight) / h.scrollHeight * 100 >= (scrollPct || 50)) { show(); window.removeEventListener('scroll', onScroll); } };
        window.addEventListener('scroll', onScroll, { passive: true });
        cleanups.push(() => window.removeEventListener('scroll', onScroll));
      } else if (trigger === 'exit' && !touch) {
        const onOut = (e) => { if (!e.relatedTarget && e.clientY <= 0) show(); };
        document.addEventListener('mouseout', onOut);
        cleanups.push(() => document.removeEventListener('mouseout', onOut));
      } else if (trigger !== 'button') {
        // delay — and the mobile fallback for exit-intent
        const t = setTimeout(show, Math.max(1, trigger === 'exit' ? Math.max(delaySec || 0, 25) : delaySec ?? 10) * 1000);
        cleanups.push(() => clearTimeout(t));
      }
    };
    if (popup.enabled) {
      const k = `cpf-popup-${formSlug || 'page'}`;
      const days = popup.repeatDays ?? 3;
      arm('popup', popup.trigger || 'delay', popup.delaySec ?? 15, popup.scrollPct, () => { const t = store.get(k); return !t || (days > 0 && Date.now() - t > days * 864e5); }, () => store.set(k, Date.now()));
    }
    if (wheelOn && wheel) {
      const k = `cpf-wheel-seen-${wcfg.wheelId}`;
      arm('wheel', wcfg.trigger || 'delay', wcfg.delaySec ?? 8, 50, () => !store.get(k) && !store.get(`cpf-wheel-${wcfg.wheelId}`), () => store.set(k, Date.now()));
    }
    return () => cleanups.forEach((f) => f());
  }, [preview, popup.enabled, popup.trigger, popup.delaySec, popup.scrollPct, popup.repeatDays, wheelOn, wheel, wcfg.trigger, wcfg.delaySec, wcfg.wheelId, formSlug]);

  return (
    <>
      {floating.enabled && <Floating cfg={floating} />}

      {wheelOn && wheel && (
        <button type="button" onClick={() => setOpen('wheel')}
          className="fixed bottom-4 left-4 z-[80] flex items-center gap-2 rounded-full bg-[color:var(--lp-primary)] px-4 py-3 text-sm font-bold text-white shadow-lg ring-4 ring-white/70 hover:opacity-95 print:hidden">
          <Gift className="h-5 w-5 animate-bounce" />{wcfg.tabText || 'Spin & Win'}
        </button>
      )}

      {popup.enabled && (
        <Modal open={open === 'popup'} onClose={() => setOpen(null)}>
          {popup.image && <img src={popup.image} alt="" className="h-40 w-full object-cover sm:rounded-t-2xl" />}
          <div className="p-5 sm:p-6">
            <h2 className="pr-6 text-xl font-bold text-[color:var(--lp-primary)]">{popup.title || 'Get a free call back'}</h2>
            {popup.subtitle && <p className="mt-1 text-sm text-slate-600">{popup.subtitle}</p>}
            <div className="mt-4">{renderForm?.({ layout: 'stack', buttonText: popup.buttonText || 'Request call back' })}</div>
          </div>
        </Modal>
      )}

      {wheelOn && <WheelModal open={open === 'wheel'} onClose={() => setOpen(null)} wheel={wheel} api={wheelApi} preview={preview} formSlug={formSlug} utm={utm} />}
    </>
  );
}
