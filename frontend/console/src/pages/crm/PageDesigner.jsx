import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft, Monitor, Tablet, Smartphone, Save, Eye, EyeOff, Copy, Trash2, ArrowUp, ArrowDown, GripVertical, Plus, Undo2, Redo2,
  LayoutTemplate, Palette, Gift, MessageSquare, Phone as PhoneIcon, ImagePlus, X, ChevronDown, ChevronRight, ExternalLink, Film, Sparkles, Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/common/Field';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { get, patch, post } from '@/lib/api';
import { useCan } from '@/store/auth';
import { cn, errMsg } from '@/lib/utils';
import { Block, ICONS, designVars, fontHref } from '@/components/landing/LandingRenderer';
import { BLOCK_DEFS, LINK_PLACEHOLDER, newId, clone } from '@/components/landing/blockDefs';
import { MediaPicker } from '@/components/landing/MediaPicker';
import LandingWidgets from '@/components/landing/Widgets';

const BOOKING_URL = import.meta.env.VITE_BOOKING_URL || 'https://appointment.centreforpilesandfistula.com';
const DEVICES = { desktop: { w: 1280, icon: Monitor }, tablet: { w: 820, icon: Tablet }, mobile: { w: 390, icon: Smartphone } };
const FONTS = ['Inter', 'Poppins', 'Montserrat', 'Roboto', 'Lato', 'Open Sans', 'Nunito'];
const DEFAULT_DESIGN = { primary: '#e21f26', accent: '#d4a017', dark: '#0f172a', tint: '#fff1f1', cta: '#14b8a6', font: 'Inter', showHeader: true };

// ------------------------------------------------------------------ iframe canvas (real viewport → responsive classes work)
function Frame({ width, font, children }) {
  const ref = useRef(null);
  const box = useRef(null);
  const [mount, setMount] = useState(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const doc = ref.current.contentDocument;
    doc.open();
    doc.write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"></body></html>');
    doc.close();
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => {
      const c = n.cloneNode(true);
      if (n.tagName === 'LINK') c.href = n.href;
      doc.head.appendChild(c);
    });
    const font = doc.createElement('link');
    font.rel = 'stylesheet';
    font.id = 'lp-font';
    doc.head.appendChild(font);
    setMount(doc.body);
  }, []);
  useEffect(() => {
    const l = ref.current?.contentDocument?.getElementById('lp-font');
    if (l) l.href = fontHref(font);
  }, [font, mount]);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  // render at the real device width, scale down to fit the canvas (so md:/lg: layouts show correctly)
  const scale = size.w && width > size.w ? size.w / width : 1;
  return (
    <div ref={box} className="relative h-full w-full overflow-hidden">
      <iframe
        ref={ref}
        title="preview"
        className="absolute left-1/2 top-0 block rounded-md border bg-white shadow-sm"
        style={{ width, height: size.h / scale || '100%', transform: `translateX(-50%) scale(${scale})`, transformOrigin: 'top center' }}
      />
      {mount && createPortal(children, mount)}
    </div>
  );
}

// ------------------------------------------------------------------ inspector widgets
function ImageInput({ value, onChange, video }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1.5">
      {value && !video && <img src={value} alt="" className="h-24 w-full rounded-md border object-cover" />}
      <div className="flex gap-1.5">
        <Input className="h-8 text-xs" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={video ? 'YouTube or video URL' : 'https://…'} />
        <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0" title="Library" onClick={() => setOpen(true)}>{video ? <Film /> : <ImagePlus />}</Button>
        {value && <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => onChange('')}><X /></Button>}
      </div>
      <MediaPicker open={open} onOpenChange={setOpen} type={video ? 'video' : 'image'} onPick={onChange} />
    </div>
  );
}

function IconInput({ value, onChange }) {
  return (
    <div className="grid grid-cols-8 gap-1">
      {Object.entries(ICONS).map(([k, Ic]) => (
        <button key={k} type="button" title={k} onClick={() => onChange(k)} className={cn('grid h-8 place-items-center rounded border', value === k ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent')}><Ic className="h-4 w-4" /></button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ page widgets: floating buttons, popup, spin wheel
function WidgetsPanel({ widgets = {}, onChange, onPreview }) {
  const { data: wheels = [] } = useQuery({ queryKey: ['wheels'], queryFn: () => get('/crm/wheels'), staleTime: 60_000 });
  const set = (group, k, v) => onChange({ ...widgets, [group]: { ...(widgets[group] || {}), [k]: v } });
  const num = (v) => (v === '' ? undefined : Math.max(0, parseInt(v, 10) || 0));
  const fl = widgets.floating || {};
  const pp = widgets.popup || {};
  const wh = widgets.wheel || {};
  const Head = ({ icon: Ic, title, group, on }) => (
    <div className="flex items-center justify-between">
      <p className="flex items-center gap-2 text-xs font-semibold"><Ic className="h-3.5 w-3.5" />{title}</p>
      <Switch checked={!!on} onCheckedChange={(v) => set(group, 'enabled', v)} />
    </div>
  );
  return (
    <div className="space-y-3 border-t pt-3">
      <p className="text-xs font-semibold uppercase text-muted-foreground">Widgets</p>
      <div className="space-y-2 rounded-lg border p-2.5">
        <Head icon={PhoneIcon} title="WhatsApp & Call buttons" group="floating" on={fl.enabled} />
        {fl.enabled && (
          <div className="space-y-2">
            <Field label="WhatsApp number"><Input inputMode="numeric" maxLength={10} value={fl.whatsapp || ''} onChange={(e) => set('floating', 'whatsapp', e.target.value.replace(/\D/g, ''))} placeholder="10-digit" /></Field>
            <Field label="Pre-filled WhatsApp message"><Input maxLength={300} value={fl.message || ''} onChange={(e) => set('floating', 'message', e.target.value)} placeholder="Hi, I want to know about…" /></Field>
            <Field label="Call number"><Input inputMode="numeric" maxLength={10} value={fl.phone || ''} onChange={(e) => set('floating', 'phone', e.target.value.replace(/\D/g, ''))} placeholder="10-digit" /></Field>
            <p className="text-[11px] text-muted-foreground">Fixed at the bottom-right of the page. Leave a number empty to hide that button.</p>
          </div>
        )}
      </div>
      <div className="space-y-2 rounded-lg border p-2.5">
        <Head icon={MessageSquare} title="Contact popup" group="popup" on={pp.enabled} />
        {pp.enabled && (
          <div className="space-y-2">
            <Field label="Title"><Input maxLength={120} value={pp.title || ''} onChange={(e) => set('popup', 'title', e.target.value)} placeholder="Get a free call back" /></Field>
            <Field label="Subtitle"><Textarea rows={2} maxLength={300} value={pp.subtitle || ''} onChange={(e) => set('popup', 'subtitle', e.target.value)} /></Field>
            <Field label="Image (optional)"><ImageInput value={pp.image} onChange={(v) => set('popup', 'image', v)} /></Field>
            <Field label="Button text"><Input maxLength={40} value={pp.buttonText || ''} onChange={(e) => set('popup', 'buttonText', e.target.value)} placeholder="Request call back" /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Show when"><Select value={pp.trigger || 'delay'} onChange={(e) => set('popup', 'trigger', e.target.value)}><option value="delay">After delay</option><option value="exit">Leaving page</option><option value="scroll">On scroll</option></Select></Field>
              {pp.trigger === 'scroll'
                ? <Field label="Scroll %"><Input type="number" min={5} max={100} value={pp.scrollPct ?? 50} onChange={(e) => set('popup', 'scrollPct', Math.min(100, Math.max(5, num(e.target.value) || 50)))} /></Field>
                : <Field label="Delay (sec)"><Input type="number" min={0} max={300} value={pp.delaySec ?? 15} onChange={(e) => set('popup', 'delaySec', Math.min(300, num(e.target.value) ?? 15))} /></Field>}
            </div>
            <Field label="Show again after (days)"><Input type="number" min={0} max={90} value={pp.repeatDays ?? 3} onChange={(e) => set('popup', 'repeatDays', Math.min(90, num(e.target.value) ?? 3))} /></Field>
            <p className="text-[11px] text-muted-foreground">Uses this page's form fields. "Leaving page" falls back to a 25-second delay on phones.</p>
            <Button size="sm" variant="outline" className="w-full" onClick={() => onPreview('popup')}>Preview popup</Button>
          </div>
        )}
      </div>
      <div className="space-y-2 rounded-lg border p-2.5">
        <Head icon={Gift} title="Spin & Win wheel" group="wheel" on={wh.enabled} />
        {wh.enabled && (
          <div className="space-y-2">
            <Field label="Wheel"><Select value={wh.wheelId || ''} onChange={(e) => set('wheel', 'wheelId', e.target.value)}><option value="">Select a wheel</option>{wheels.map((w) => <option key={w._id} value={w._id}>{w.name}{w.live ? '' : ' (off)'}</option>)}</Select></Field>
            {!wheels.length && <p className="text-[11px] text-amber-600">No wheels yet — create one in CRM → Spin Wheels.</p>}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Open"><Select value={wh.trigger || 'delay'} onChange={(e) => set('wheel', 'trigger', e.target.value)}><option value="delay">After delay</option><option value="exit">Leaving page</option><option value="button">Only on click</option></Select></Field>
              {wh.trigger !== 'button' && <Field label="Delay (sec)"><Input type="number" min={0} max={300} value={wh.delaySec ?? 8} onChange={(e) => set('wheel', 'delaySec', Math.min(300, num(e.target.value) ?? 8))} /></Field>}
            </div>
            <Field label="Tab button text"><Input maxLength={30} value={wh.tabText || ''} onChange={(e) => set('wheel', 'tabText', e.target.value)} placeholder="Spin & Win" /></Field>
            <p className="text-[11px] text-muted-foreground">A "Spin & Win" button stays at the bottom-left. Every spin is tracked in Spin Wheels.</p>
            <Button size="sm" variant="outline" className="w-full" disabled={!wh.wheelId} onClick={() => onPreview('wheel')}>Preview wheel (test spin, not saved)</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function FieldInput({ def, value, onChange }) {
  const [, , kind, opts] = def;
  switch (kind) {
    case 'textarea': return <Textarea rows={3} className="text-sm" value={value || ''} onChange={(e) => onChange(e.target.value)} />;
    case 'number': return <Input type="number" className="h-8" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />;
    case 'toggle': return <Switch checked={value !== false && !!value} onCheckedChange={onChange} />;
    case 'select': return <Select className="h-8" value={String(value ?? opts[0])} onChange={(e) => onChange(/^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value)}>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</Select>;
    case 'color': return <div className="flex gap-1.5"><input type="color" className="h-8 w-10 cursor-pointer rounded border" value={value || '#000000'} onChange={(e) => onChange(e.target.value)} /><Input className="h-8 font-mono text-xs" value={value || ''} onChange={(e) => onChange(e.target.value)} /></div>;
    case 'image': return <ImageInput value={value} onChange={onChange} />;
    case 'video': return <ImageInput value={value} onChange={onChange} video />;
    case 'icon': return <IconInput value={value} onChange={onChange} />;
    case 'link': return <Input className="h-8 text-xs" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={LINK_PLACEHOLDER} />;
    case 'list': return <ListInput sub={opts} value={value || []} onChange={onChange} />;
    default: return <Input className="h-8" value={value || ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

function ListInput({ sub, value, onChange }) {
  const [open, setOpen] = useState(0);
  const upd = (i, k, v) => onChange(value.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const move = (i, d) => { const a = [...value]; const [x] = a.splice(i, 1); a.splice(i + d, 0, x); onChange(a); setOpen(i + d); };
  const title = (it, i) => it.title || it.label || it.name || it.q || it.caption || it.value || `Item ${i + 1}`;
  return (
    <div className="space-y-1.5">
      {value.map((it, i) => (
        <div key={i} className="rounded-md border">
          <div className="flex items-center gap-1 px-2 py-1">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-medium" onClick={() => setOpen(open === i ? -1 : i)}>{open === i ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}<span className="truncate">{title(it, i)}</span></button>
            <button type="button" disabled={i === 0} className="p-0.5 disabled:opacity-30" onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></button>
            <button type="button" disabled={i === value.length - 1} className="p-0.5 disabled:opacity-30" onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></button>
            <button type="button" className="p-0.5" onClick={() => onChange([...value.slice(0, i + 1), clone(it), ...value.slice(i + 1)])}><Copy className="h-3.5 w-3.5" /></button>
            <button type="button" className="p-0.5 text-destructive" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
          {open === i && <div className="space-y-2 border-t p-2">{sub.map((d) => <div key={d[0]} className="space-y-1"><p className="text-[11px] text-muted-foreground">{d[1]}</p><FieldInput def={d} value={it[d[0]]} onChange={(v) => upd(i, d[0], v)} /></div>)}</div>}
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="h-7 w-full text-xs" onClick={() => { onChange([...value, Object.fromEntries(sub.map((d) => [d[0], d[2] === 'icon' ? 'CheckCircle2' : '']))]); setOpen(value.length); }}><Plus /> Add</Button>
    </div>
  );
}

// ------------------------------------------------------------------ AI rewrite for one block (Hugging Face)
const QUICK = ['Make it shorter', 'More persuasive', 'Simpler words for elderly patients', 'Add 2 more items', 'Focus on painless laser & quick recovery', 'Mention free consultation'];
function AiBlockPanel({ block, onApply }) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [language, setLanguage] = useState('keep');
  const [busy, setBusy] = useState(false);
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => get('/crm/ai/status'), staleTime: 60_000 });
  if (['spacer', 'image', 'video', 'header', 'footer'].includes(block.type)) return null;
  const run = async (ins = instruction) => {
    if (!ins.trim()) return;
    setBusy(true);
    try {
      const r = await post('/crm/ai/block', { type: block.type, props: block.props, instruction: ins, language }, { timeout: 120_000 });
      onApply(r.props);
      toast.success('AI updated this section — Ctrl+Z to undo');
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-md border border-violet-200 bg-violet-50/60 p-2">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 text-xs font-semibold text-violet-700"><Sparkles className="h-3.5 w-3.5" /> Write with AI {open ? <ChevronDown className="ml-auto h-3.5 w-3.5" /> : <ChevronRight className="ml-auto h-3.5 w-3.5" />}</button>
      {open && (
        status.data && !status.data.configured ? <p className="mt-2 text-[11px] text-muted-foreground">Add a Hugging Face token in Settings → Integrations → AI writer.</p> : (
          <div className="mt-2 space-y-2">
            <Textarea rows={2} className="text-xs" placeholder="e.g. Rewrite for Google Ads, mention Dwarka clinic" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
            <div className="flex flex-wrap gap-1">{QUICK.map((q) => <button key={q} type="button" disabled={busy} onClick={() => { setInstruction(q); run(q); }} className="rounded-full border bg-white px-2 py-0.5 text-[10px] hover:border-violet-400">{q}</button>)}</div>
            <div className="flex gap-1.5">
              <Select className="h-8 text-xs" value={language} onChange={(e) => setLanguage(e.target.value)}><option value="keep">Same language</option><option value="en">English</option><option value="hi">Hindi</option><option value="hinglish">Hinglish</option></Select>
              <Button size="sm" className="h-8 shrink-0 bg-violet-600 hover:bg-violet-700" loading={busy} disabled={!instruction.trim()} onClick={() => run()}><Wand2 /> Apply</Button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

// ------------------------------------------------------------------ preview form (non-functional)
function MockForm({ fields, layout, buttonText, dark }) {
  const fl = (fields || []).filter((f) => !['checkbox', 'radio', 'textarea'].includes(f.type) || layout !== 'inline');
  return (
    <div className={cn('grid gap-2', layout === 'inline' ? 'sm:grid-cols-2 lg:grid-cols-4' : '')}>
      {fl.slice(0, layout === 'inline' ? 3 : 8).map((f) => (
        f.type === 'select' || f.mapTo === 'branch'
          ? <select key={f.key} disabled className="h-10 rounded-md border bg-white px-3 text-sm text-slate-500"><option>{f.label}{f.required ? '*' : ''}</option></select>
          : <input key={f.key} disabled placeholder={`${f.label}${f.required ? '*' : ''}`} className="h-10 rounded-md border bg-white px-3 text-sm" />
      ))}
      <button type="button" className={cn('h-10 rounded-md px-4 text-sm font-bold', dark ? 'bg-[color:var(--lp-accent)] text-slate-900' : 'bg-[color:var(--lp-primary)] text-white')}>{buttonText || 'Submit'}</button>
    </div>
  );
}

// ------------------------------------------------------------------ page
export default function PageDesigner() {
  const { id } = useParams();
  const can = useCan();
  const qc = useQueryClient();
  const formQ = useQuery({ queryKey: ['form-design', id], queryFn: () => get(`/crm/forms/${id}`), refetchOnWindowFocus: false });
  const [blocks, setBlocksRaw] = useState(null);
  const [design, setDesign] = useState(DEFAULT_DESIGN);
  const [widgetSignal, setWidgetSignal] = useState(null);
  const [page, setPage] = useState({});
  const [sel, setSel] = useState(null);
  const [device, setDevice] = useState('desktop');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drop, setDrop] = useState(null); // insertion index
  const [panel, setPanel] = useState('blocks'); // left panel: blocks | layers
  const drag = useRef(null);
  const hist = useRef({ past: [], future: [] });

  useEffect(() => {
    if (!formQ.data || blocks) return;
    setBlocksRaw(formQ.data.blocks || []);
    setDesign({ ...DEFAULT_DESIGN, ...(formQ.data.design || {}) });
    setPage(formQ.data.page || {});
  }, [formQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const setBlocks = useCallback((next) => {
    setBlocksRaw((cur) => {
      const v = typeof next === 'function' ? next(cur) : next;
      hist.current.past.push(cur);
      if (hist.current.past.length > 60) hist.current.past.shift();
      hist.current.future = [];
      return v;
    });
    setDirty(true);
  }, []);
  const undo = useCallback(() => { const h = hist.current; if (!h.past.length) return; setBlocksRaw((cur) => { h.future.push(cur); return h.past.pop(); }); setDirty(true); }, []);
  const redo = useCallback(() => { const h = hist.current; if (!h.future.length) return; setBlocksRaw((cur) => { h.past.push(cur); return h.future.pop(); }); setDirty(true); }, []);

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !['INPUT', 'TEXTAREA'].includes(tag)) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    };
    const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', warn); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const insert = (type, at) => {
    const b = { id: newId(type), type, props: clone(BLOCK_DEFS[type].defaults) };
    setBlocks((cur) => { const a = [...cur]; a.splice(at ?? a.length, 0, b); return a; });
    setSel(b.id);
  };
  const moveTo = (bid, at) => setBlocks((cur) => {
    const from = cur.findIndex((b) => b.id === bid);
    if (from < 0) return cur;
    const a = [...cur];
    const [x] = a.splice(from, 1);
    a.splice(at > from ? at - 1 : at, 0, x);
    return a;
  });
  const updateProps = (bid, k, v) => setBlocks((cur) => cur.map((b) => (b.id === bid ? { ...b, props: { ...b.props, [k]: v } } : b)));
  const act = (bid, what) => setBlocks((cur) => {
    const i = cur.findIndex((b) => b.id === bid);
    const a = [...cur];
    if (what === 'up' && i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]];
    if (what === 'down' && i < a.length - 1) [a[i + 1], a[i]] = [a[i], a[i + 1]];
    if (what === 'dup') a.splice(i + 1, 0, { ...clone(a[i]), id: newId(a[i].type) });
    if (what === 'hide') a[i] = { ...a[i], hidden: !a[i].hidden };
    if (what === 'del') { a.splice(i, 1); setSel(null); }
    return a;
  });

  const [tplOpen, setTplOpen] = useState(false);
  const loadTemplate = async (variant) => {
    if (typeof variant !== 'string') return setTplOpen(true);
    if (blocks?.length && !window.confirm('Replace the current page with this template?')) return;
    setTplOpen(false);
    try {
      const t = await get('/crm/landing-template', { variant });
      setBlocks(t.blocks);
      setDesign((d) => ({ ...d, ...t.design }));
      setSel(null);
    } catch (e) { toast.error(errMsg(e)); }
  };

  async function save() {
    if (!can('cms.edit') || saving || !blocks) return;
    setSaving(true);
    try {
      const pg = Object.fromEntries(Object.entries(page || {}).filter(([k, v]) => v != null && !['_id'].includes(k)));
      await patch(`/crm/forms/${id}`, { blocks, design, page: pg });
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['/crm/forms'] });
      toast.success('Page saved');
    } catch (e) {
      const d = e?.response?.data?.details;
      toast.error(errMsg(e), Array.isArray(d) ? { description: d.slice(0, 3).map((x) => `${x.path}: ${x.message}`).join(' · ') } : undefined);
    } finally {
      setSaving(false);
    }
  }

  // ---- drag & drop
  const onDragOverBlock = (e, i) => {
    if (!drag.current) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setDrop(e.clientY < r.top + r.height / 2 ? i : i + 1);
  };
  const onDrop = (e) => {
    e.preventDefault();
    const d = drag.current;
    const at = drop ?? blocks.length;
    if (d?.kind === 'new') insert(d.type, at);
    if (d?.kind === 'move') moveTo(d.id, at);
    drag.current = null;
    setDrop(null);
  };
  const endDrag = () => { drag.current = null; setDrop(null); };

  const selected = blocks?.find((b) => b.id === sel);
  const def = selected && BLOCK_DEFS[selected.type];
  const fields = formQ.data?.fields || [];
  const renderForm = useMemo(() => (o) => <MockForm fields={fields} {...o} />, [fields]);
  const groups = useMemo(() => Object.entries(BLOCK_DEFS).reduce((g, [k, d]) => ({ ...g, [d.group]: [...(g[d.group] || []), [k, d]] }), {}), []);

  if (formQ.isLoading || !blocks) return <div className="space-y-3 p-4"><Skeleton className="h-12" /><Skeleton className="h-[70vh]" /></div>;
  if (formQ.error) return <p className="p-6 text-destructive">{errMsg(formQ.error)}</p>;
  const f = formQ.data;

  const Indicator = ({ show }) => (show ? <div className="pointer-events-none relative z-20 h-0"><div className="absolute inset-x-0 -top-0.5 h-1 rounded bg-blue-500 shadow-[0_0_0_2px_rgba(59,130,246,.3)]" /></div> : null);

  return (
    <div className="-m-3 flex h-[calc(100vh-3.5rem)] flex-col bg-muted/40 sm:-m-6">
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <Button asChild size="sm" variant="ghost"><Link to="/forms"><ArrowLeft /> Back</Link></Button>
        <div className="min-w-0"><p className="truncate text-sm font-semibold">{f.name}</p><p className="truncate font-mono text-[11px] text-muted-foreground">/f/{f.slug}</p></div>
        {dirty && <Badge variant="warning">Unsaved</Badge>}
        <div className="mx-auto flex rounded-md border bg-background p-0.5">
          {Object.entries(DEVICES).map(([k, d]) => <button key={k} type="button" title={k} onClick={() => setDevice(k)} className={cn('rounded px-2.5 py-1', device === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}><d.icon className="h-4 w-4" /></button>)}
        </div>
        <Button size="icon" variant="ghost" title="Undo (Ctrl+Z)" onClick={undo}><Undo2 /></Button>
        <Button size="icon" variant="ghost" title="Redo (Ctrl+Shift+Z)" onClick={redo}><Redo2 /></Button>
        <Button size="sm" variant="outline" onClick={loadTemplate}><LayoutTemplate /> Template</Button>
        <Button size="sm" variant={sel ? 'outline' : 'secondary'} onClick={() => setSel(null)}><Palette /> Design</Button>
        <Button asChild size="sm" variant="outline"><a href={`${BOOKING_URL}/f/${f.slug}`} target="_blank" rel="noreferrer"><ExternalLink /> Live</a></Button>
        {can('cms.edit') && <Button size="sm" loading={saving} disabled={!dirty} onClick={save}><Save /> Save</Button>}
      </div>

      <Dialog open={tplOpen} onOpenChange={setTplOpen}>
        <DialogContent title="Choose a page layout" size="lg">
          <div className="grid gap-3 sm:grid-cols-3">
            {[['classic', 'Classic', 'Red split hero, booking strip, success stories, services grid, conditions, treatments, CTA band', 'from-red-600 to-red-400'], ['modern', 'Modern gradient', 'Dark→brand gradient hero, numbers, call-back card, timeline steps, package pricing, doctors, FAQ', 'from-slate-900 to-red-600'], ['minimal', 'Minimal clean', 'Centred hero, form card, conditions grid, numbered steps, FAQ — fast & simple', 'from-white to-slate-100']].map(([k, n, d, g]) => (
              <button key={k} type="button" onClick={() => loadTemplate(k)} className="overflow-hidden rounded-lg border text-left transition hover:border-primary hover:shadow-md">
                <div className={cn('h-24 bg-gradient-to-br', g)}><div className="space-y-1.5 p-3"><div className={cn('h-2 w-3/4 rounded', k === 'minimal' ? 'bg-slate-300' : 'bg-white/80')} /><div className={cn('h-2 w-1/2 rounded', k === 'minimal' ? 'bg-slate-200' : 'bg-white/50')} /><div className={cn('mt-3 h-4 w-20 rounded', k === 'minimal' ? 'bg-red-500' : 'bg-white')} /></div></div>
                <div className="p-3"><p className="font-semibold">{n}</p><p className="text-xs text-muted-foreground">{d}</p></div>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">All text, images and colours stay editable. Replaces the current blocks (Ctrl+Z to undo).</p>
        </DialogContent>
      </Dialog>
      <div className="flex min-h-0 flex-1">
        {/* left: palette / layers */}
        <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
          <div className="flex border-b text-xs">{['blocks', 'layers'].map((p) => <button key={p} type="button" onClick={() => setPanel(p)} className={cn('flex-1 py-2 capitalize', panel === p ? 'border-b-2 border-primary font-semibold' : 'text-muted-foreground')}>{p === 'blocks' ? 'Add blocks' : `Layers (${blocks.length})`}</button>)}</div>
          <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
            {panel === 'blocks' ? Object.entries(groups).map(([g, items]) => (
              <div key={g} className="mb-3">
                <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase text-muted-foreground">{g}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {items.map(([k, d]) => (
                    <button key={k} type="button" draggable onDragStart={(e) => { drag.current = { kind: 'new', type: k }; e.dataTransfer.setData('text/plain', k); e.dataTransfer.effectAllowed = 'copy'; }} onDragEnd={endDrag}
                      onClick={() => insert(k, sel ? blocks.findIndex((b) => b.id === sel) + 1 : undefined)}
                      className="flex cursor-grab flex-col items-center gap-1 rounded-md border bg-background p-2 text-center text-[11px] hover:border-primary hover:text-primary active:cursor-grabbing">
                      <d.icon className="h-5 w-5" />{d.label}
                    </button>
                  ))}
                </div>
              </div>
            )) : (
              <div className="space-y-1">
                {blocks.map((b, i) => {
                  const D = BLOCK_DEFS[b.type];
                  return (
                    <div key={b.id} draggable onDragStart={(e) => { drag.current = { kind: 'move', id: b.id }; e.dataTransfer.setData('text/plain', b.id); }} onDragEnd={endDrag}
                      onDragOver={(e) => onDragOverBlock(e, i)} onDrop={onDrop}
                      onClick={() => setSel(b.id)} className={cn('relative flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1.5 text-xs', sel === b.id ? 'border-primary bg-primary/5' : 'bg-background', b.hidden && 'opacity-50')}>
                      {drop === i && <span className="absolute inset-x-0 -top-1 h-0.5 bg-blue-500" />}
                      <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />{D && <D.icon className="h-3.5 w-3.5" />}<span className="flex-1 truncate">{D?.label || b.type}</span>
                      <button type="button" onClick={(e) => { e.stopPropagation(); act(b.id, 'hide'); }}>{b.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>
                      {drop === blocks.length && i === blocks.length - 1 && <span className="absolute inset-x-0 -bottom-1 h-0.5 bg-blue-500" />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <p className="border-t p-2 text-[11px] text-muted-foreground">Drag blocks onto the page, or click to add below the selected block.</p>
        </aside>

        {/* canvas */}
        <main className="min-w-0 flex-1 p-3" onDragOver={(e) => drag.current && e.preventDefault()} onDrop={onDrop}>
          <Frame width={DEVICES[device].w} font={design.font}>
            <div style={designVars(design)} className="min-h-screen bg-white text-slate-900"
              onDragOver={(e) => { if (drag.current && e.target === e.currentTarget) { e.preventDefault(); setDrop(blocks.length); } }} onDrop={onDrop}
              onClickCapture={(e) => { if (e.target.closest('a,button[type="submit"]') && !e.target.closest('[data-lp-tool]')) e.preventDefault(); }}>
              {blocks.length === 0 && (
                <div className="m-6 grid min-h-[60vh] place-items-center rounded-xl border-2 border-dashed border-slate-300 p-8 text-center text-slate-500" onDragOver={(e) => { e.preventDefault(); setDrop(0); }} onDrop={onDrop}>
                  <div><p className="text-lg font-semibold text-slate-700">Empty page</p><p className="mt-1 text-sm">Drag blocks here from the left, or start from the ready-made template.</p><button type="button" data-lp-tool onClick={loadTemplate} className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">Choose a layout</button></div>
                </div>
              )}
              {blocks.map((b, i) => (
                <div key={b.id}>
                  <Indicator show={drop === i} />
                  <div
                    draggable
                    onDragStart={(e) => { drag.current = { kind: 'move', id: b.id }; e.dataTransfer.setData('text/plain', b.id); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragEnd={endDrag}
                    onDragOver={(e) => onDragOverBlock(e, i)}
                    onDrop={onDrop}
                    onClick={() => setSel(b.id)}
                    className={cn('group/blk relative cursor-pointer outline-offset-[-2px]', sel === b.id ? 'outline outline-2 outline-blue-500' : 'hover:outline hover:outline-1 hover:outline-blue-300', b.hidden && 'opacity-40')}
                  >
                    <div data-lp-tool className={cn('absolute right-2 top-2 z-40 items-center gap-0.5 rounded-md bg-slate-900 p-0.5 text-white shadow', sel === b.id ? 'flex' : 'hidden group-hover/blk:flex')}>
                      <span className="flex cursor-grab items-center gap-1 px-1.5 text-[11px]"><GripVertical className="h-3.5 w-3.5" />{BLOCK_DEFS[b.type]?.label}</span>
                      {[['up', ArrowUp], ['down', ArrowDown], ['dup', Copy], ['hide', b.hidden ? EyeOff : Eye], ['del', Trash2]].map(([k, Ic]) => (
                        <button key={k} type="button" data-lp-tool title={k} onClick={(e) => { e.stopPropagation(); act(b.id, k); }} className="rounded p-1 hover:bg-white/20"><Ic className="h-3.5 w-3.5" /></button>
                      ))}
                    </div>
                    <div className="pointer-events-none select-none">
                      <Block block={b} design={design} renderForm={renderForm} clinic={null} />
                    </div>
                  </div>
                </div>
              ))}
              <Indicator show={drop === blocks.length && blocks.length > 0} />
              {blocks.length > 0 && <div className="h-24" onDragOver={(e) => { if (drag.current) { e.preventDefault(); setDrop(blocks.length); } }} onDrop={onDrop} />}
              <div data-lp-tool>
                <LandingWidgets preview widgets={design.widgets || {}} renderForm={renderForm} openSignal={widgetSignal} formSlug={formQ.data?.slug}
                  wheelApi={{ load: (wid) => get(`/crm/wheels/${wid}`) }} />
              </div>
            </div>
          </Frame>
        </main>

        {/* right: inspector */}
        <aside className="w-80 shrink-0 overflow-y-auto border-l bg-card scrollbar-thin max-lg:w-72">
          {selected ? (
            <div className="space-y-3 p-3">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 text-sm font-semibold">{def && <def.icon className="h-4 w-4" />}{def?.label || selected.type}</p>
                <div className="flex gap-0.5">
                  <Button size="icon" variant="ghost" className="h-7 w-7" title="Duplicate" onClick={() => act(selected.id, 'dup')}><Copy /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" title={selected.hidden ? 'Show' : 'Hide'} onClick={() => act(selected.id, 'hide')}>{selected.hidden ? <EyeOff /> : <Eye />}</Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Delete" onClick={() => act(selected.id, 'del')}><Trash2 /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setSel(null)}><X /></Button>
                </div>
              </div>
              <AiBlockPanel key={selected.id} block={selected} onApply={(props) => setBlocks((cur) => cur.map((b) => (b.id === selected.id ? { ...b, props } : b)))} />
              {def?.note && <p className="rounded-md bg-muted p-2 text-[11px] text-muted-foreground">{def.note}</p>}
              {def?.fields.map((d) => (
                <div key={d[0]} className="space-y-1">
                  <p className="text-xs font-medium">{d[1]}</p>
                  <FieldInput def={d} value={selected.props?.[d[0]]} onChange={(v) => updateProps(selected.id, d[0], v)} />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold"><Palette className="h-4 w-4" /> Page design</p>
              <div className="grid grid-cols-2 gap-2">
                {[['primary', 'Brand colour'], ['accent', 'Accent'], ['dark', 'Dark / footer'], ['tint', 'Card tint'], ['cta', 'Header button']].map(([k, l]) => (
                  <div key={k} className="space-y-1"><p className="text-xs">{l}</p><FieldInput def={[k, l, 'color']} value={design[k]} onChange={(v) => { setDesign((d) => ({ ...d, [k]: v })); setDirty(true); }} /></div>
                ))}
              </div>
              <Field label="Font"><Select value={design.font} onChange={(e) => { setDesign((d) => ({ ...d, font: e.target.value })); setDirty(true); }}>{FONTS.map((x) => <option key={x}>{x}</option>)}</Select></Field>
              <WidgetsPanel widgets={design.widgets || {}} onChange={(w) => { setDesign((d) => ({ ...d, widgets: w })); setDirty(true); }} onPreview={(which) => setWidgetSignal({ which, n: Date.now() })} />
              <div className="space-y-2 border-t pt-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground">SEO</p>
                <Field label="Page title"><Input value={page.seoTitle || ''} maxLength={120} onChange={(e) => { setPage((p) => ({ ...p, seoTitle: e.target.value })); setDirty(true); }} /></Field>
                <Field label="Meta description"><Textarea rows={3} maxLength={300} value={page.seoDescription || ''} onChange={(e) => { setPage((p) => ({ ...p, seoDescription: e.target.value })); setDirty(true); }} /></Field>
              </div>
              <p className="rounded-md bg-muted p-2 text-[11px] text-muted-foreground">Click any block on the page to edit it. Drag the dark toolbar or the Layers list to reorder. Form fields, campaign and lead routing are set in CMS &amp; Forms → Edit.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
