/* Shared landing-page renderer — identical copy in console (builder preview) and booking (public page).
 * Content is rendered as text/URLs only (no raw HTML). Colours come from CSS vars set on the wrapper. */
import { useState } from 'react';
import {
  Award, Zap, Leaf, Clock, Wallet, Car, MapPin, HeartHandshake, Stethoscope, Star, Phone, CheckCircle2, Users, ShieldCheck,
  Syringe, Pill, Activity, ThumbsUp, Sparkles, Hospital, Mail, MessageCircle, ChevronDown, Play, CalendarCheck2, BadgePercent, Ambulance, ImageIcon,
} from 'lucide-react';

export const ICONS = { Award, Zap, Leaf, Clock, Wallet, Car, MapPin, HeartHandshake, Stethoscope, Star, Phone, CheckCircle2, Users, ShieldCheck, Syringe, Pill, Activity, ThumbsUp, Sparkles, Hospital, Mail, MessageCircle, CalendarCheck2, BadgePercent, Ambulance };

export const safeUrl = (u) => {
  const s = String(u || '').trim();
  return /^(https?:\/\/|tel:|mailto:|#|\/)/i.test(s) ? s : '#';
};
const cx = (...a) => a.filter(Boolean).join(' ');
const isExternal = (u) => /^https?:\/\//i.test(u);

function A({ href, className, children, style }) {
  const u = safeUrl(href);
  const onClick = (e) => {
    if (u.startsWith('#') && u.length > 1) {
      const el = e.currentTarget.ownerDocument.getElementById(u.slice(1));
      if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    }
  };
  return <a href={u} onClick={onClick} className={className} style={style} {...(isExternal(u) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>;
}

const Img = ({ src, alt = '', className, placeholder = true }) =>
  src ? <img src={src} alt={alt} loading="lazy" className={className} /> : placeholder ? <div className={cx('grid place-items-center bg-slate-100 text-slate-400', className)}><ImageIcon className="h-8 w-8" /></div> : null;

const Section = ({ children, className, style, id }) => <section id={id} className={cx('px-4 py-12 sm:px-6 md:py-16', className)} style={style}><div className="mx-auto max-w-6xl">{children}</div></section>;
const bgClass = (bg) => ({ white: 'bg-white', tint: 'bg-[color:var(--lp-tint)]', dark: 'bg-[color:var(--lp-dark)] text-white', brand: 'bg-[color:var(--lp-primary)] text-white' }[bg] || 'bg-white');
const Eyebrow = ({ children, light }) => (children ? <span className={cx('mb-3 inline-block rounded-full border px-3 py-1 text-xs font-medium', light ? 'border-white/40 bg-white/10 text-white' : 'border-[color:var(--lp-primary)]/30 text-[color:var(--lp-primary)]')}>{children}</span> : null);
const cols = (n) => ({ 1: 'grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[Number(n) || 3]);

const ytId = (u = '') => (u.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/) || [])[1];
function Video({ url, poster, className }) {
  const id = ytId(url);
  if (id) return <div className={cx('aspect-video overflow-hidden rounded-xl bg-black', className)}><iframe className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${id}`} title="video" allow="accelerometer; encrypted-media; picture-in-picture" allowFullScreen loading="lazy" /></div>;
  if (/^https?:\/\//i.test(url || '')) return <video className={cx('w-full rounded-xl bg-black', className)} src={url} poster={poster || undefined} controls playsInline preload="metadata" />;
  return <div className={cx('grid aspect-video place-items-center rounded-xl bg-slate-100 text-slate-400', className)}><Play className="h-8 w-8" /></div>;
}

// ------------------------------------------------------------------ blocks
const B = {
  header: ({ p, clinic }) => (
    <header className={cx('z-30 border-b bg-white/95 backdrop-blur', p.sticky !== false && 'sticky top-0')}>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          {(p.logo || clinic?.logo) ? <img src={p.logo || clinic.logo} alt="" className="h-10 w-auto max-w-[160px] object-contain" /> : <span className="truncate font-bold text-[color:var(--lp-primary)]">{p.title || clinic?.name}</span>}
        </div>
        {(p.ctaText || p.phone) && (
          <A href={p.ctaLink || (p.phone ? `tel:${p.phone}` : '#form')} className="inline-flex shrink-0 items-center gap-2 rounded-md bg-teal-500 px-3 py-2 text-xs font-semibold text-white shadow sm:text-sm" style={{ background: 'var(--lp-cta, #14b8a6)' }}>
            <Phone className="h-4 w-4" /> {p.ctaText}{p.phone ? ` · ${p.phone}` : ''}
          </A>
        )}
      </div>
    </header>
  ),

  hero: ({ p }) => {
    const dark = p.style === 'dark' || p.style === 'brand' || p.style === 'gradient';
    const bgStyle = p.bgImage
      ? { backgroundImage: `linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.45)),url("${encodeURI(p.bgImage)}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : p.style === 'gradient' ? { backgroundImage: 'linear-gradient(135deg, var(--lp-dark) 0%, var(--lp-primary) 100%)' } : undefined;
    return (
      <section className={cx('relative overflow-hidden', p.style === 'brand' ? 'bg-[color:var(--lp-primary)] text-white' : dark ? 'bg-[color:var(--lp-dark)] text-white' : 'bg-white')} style={bgStyle}>
        {p.style === 'gradient' && <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-2xl" />}
        {!dark && !p.bgImage && p.align === 'center' && <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--lp-tint),transparent_70%)]" />}
        {!dark && !p.bgImage && p.align !== 'center' && <div className="pointer-events-none absolute -right-24 top-0 h-full w-1/2 skew-x-[-12deg] bg-[color:var(--lp-primary)] opacity-90 max-md:hidden" />}
        <div className="relative mx-auto grid max-w-6xl items-center gap-8 px-4 py-12 sm:px-6 md:grid-cols-2 md:py-20">
          <div className={cx(p.align === 'center' && 'mx-auto max-w-3xl text-center md:col-span-2', p.align === 'image_left' && 'md:order-2')}>
            <Eyebrow light={dark || !!p.bgImage}>{p.eyebrow}</Eyebrow>
            <h1 className={cx('font-extrabold leading-tight tracking-tight', p.align === 'center' ? 'text-4xl sm:text-6xl' : 'text-4xl sm:text-5xl', !dark && !p.bgImage && 'text-[color:var(--lp-primary)]')}>{p.title}</h1>
            {p.subtitle && <p className={cx('mt-4 text-xl sm:text-2xl', dark || p.bgImage ? 'text-white/85' : 'text-slate-800')}>{p.subtitle}</p>}
            <div className={cx('mt-6 flex flex-wrap gap-3', p.align === 'center' && 'justify-center')}>
              {p.ctaText && <A href={p.ctaLink || '#form'} className="rounded-md bg-[color:var(--lp-primary)] px-5 py-3 font-semibold text-white shadow hover:opacity-90" style={dark ? { background: 'var(--lp-accent)', color: '#111' } : undefined}>{p.ctaText}</A>}
              {p.ctaText2 && <A href={p.ctaLink2} className={cx('rounded-md border px-5 py-3 font-semibold', dark || p.bgImage ? 'border-white/60 text-white' : 'border-slate-300 text-slate-800')}>{p.ctaText2}</A>}
            </div>
          </div>
          {p.align !== 'center' && (p.image ? <img src={p.image} alt="" className="relative mx-auto max-h-[460px] w-full rounded-2xl object-cover shadow-xl" /> : <Img src="" className="relative aspect-[4/3] w-full rounded-2xl" />)}
        </div>
      </section>
    );
  },

  form: ({ p, renderForm }) => (
    <section id="form" className="scroll-mt-20 px-4 py-6 sm:px-6">
      <div className={cx('mx-auto max-w-6xl rounded-xl p-5 shadow-lg sm:p-6', p.bg === 'light' ? 'border bg-white' : p.bg === 'dark' ? 'bg-[color:var(--lp-dark)] text-white' : 'bg-[color:var(--lp-primary)] text-white')}>
        {p.layout === 'card' ? (
          <div className="grid items-center gap-6 md:grid-cols-2">
            <div>
              {p.title && <h2 className="text-2xl font-bold">{p.title}</h2>}
              {p.subtitle && <p className="mt-2 opacity-85">{p.subtitle}</p>}
              {p.image && <img src={p.image} alt="" className="mt-4 w-full rounded-lg object-cover" />}
            </div>
            <div className="rounded-lg bg-white p-4 text-slate-900">{renderForm?.({ layout: 'stack', buttonText: p.buttonText })}</div>
          </div>
        ) : (
          <>
            {p.title && <h2 className="mb-3 text-lg font-bold">{p.title}</h2>}
            {p.subtitle && <p className="-mt-2 mb-3 text-sm opacity-85">{p.subtitle}</p>}
            {renderForm?.({ layout: 'inline', buttonText: p.buttonText, dark: p.bg !== 'light' })}
          </>
        )}
      </div>
    </section>
  ),

  gallery: ({ p }) => (
    <Section>
      <div className="mb-8 text-center"><Eyebrow>{p.eyebrow}</Eyebrow>{p.heading && <h2 className="text-3xl font-extrabold tracking-tight text-slate-300 sm:text-4xl" style={{ WebkitTextStroke: '1px #334155' }}>{p.heading}</h2>}</div>
      <div className={cx('grid gap-4', cols(p.columns))}>
        {(p.items || []).map((it, i) => (
          <figure key={i} className="overflow-hidden rounded-xl bg-slate-900 shadow">
            {it.video ? <Video url={it.video} poster={it.image} className="rounded-none" /> : <A href={it.link || it.image || '#'}><Img src={it.image} className="aspect-video w-full object-cover" /></A>}
            {it.caption && <figcaption className="bg-white px-3 py-2 text-sm text-slate-700">{it.caption}</figcaption>}
          </figure>
        ))}
      </div>
    </Section>
  ),

  features: ({ p }) => (
    <Section className="bg-white">
      {p.heading && <h2 className="mx-auto mb-2 max-w-xl text-center text-3xl font-bold text-slate-900">{p.heading}</h2>}
      {p.subheading && <p className="mx-auto mb-8 max-w-2xl text-center text-slate-600">{p.subheading}</p>}
      <div className={cx('mt-8 grid gap-5', cols(p.columns))}>
        {(p.items || []).map((it, i) => {
          const Ic = ICONS[it.icon] || CheckCircle2;
          if (p.style === 'minimal' || p.style === 'numbered') return (
            <div key={i} className="flex gap-4">
              {p.style === 'numbered'
                ? <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[color:var(--lp-primary)] text-sm font-bold text-white">{i + 1}</span>
                : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[color:var(--lp-tint)]">{it.image ? <img src={it.image} alt="" className="h-6 w-6 object-contain" /> : <Ic className="h-6 w-6 text-[color:var(--lp-primary)]" />}</span>}
              <div><h3 className="font-semibold text-slate-900">{it.title}</h3>{it.text && <p className="mt-1 text-sm text-slate-600">{it.text}</p>}</div>
            </div>
          );
          return (
            <div key={i} className="rounded-lg bg-[color:var(--lp-tint)] p-6 transition hover:-translate-y-0.5 hover:shadow-md">
              {it.image ? <img src={it.image} alt="" className="mb-4 h-10 w-10 object-contain" /> : <Ic className="mb-4 h-8 w-8 text-[color:var(--lp-primary)]" />}
              <h3 className="font-semibold text-slate-900">{it.title}</h3>
              {it.text && <p className="mt-2 text-sm text-slate-600">{it.text}</p>}
            </div>
          );
        })}
      </div>
    </Section>
  ),

  text: ({ p }) => (
    <Section className={bgClass(p.bg)}>
      <div className={cx(p.align === 'center' && 'mx-auto max-w-3xl text-center')}>
        {p.heading && <h2 className="text-3xl font-bold tracking-tight">{p.heading}</h2>}
        {p.body && <p className="mt-4 whitespace-pre-line leading-relaxed opacity-80">{p.body}</p>}
        {p.buttonText && <A href={p.buttonLink || '#form'} className="mt-6 inline-block rounded-md bg-[color:var(--lp-primary)] px-5 py-3 font-semibold text-white">{p.buttonText}</A>}
      </div>
    </Section>
  ),

  list: ({ p }) => (
    <Section className={bgClass(p.bg || 'tint')}>
      <div className="mb-6 grid gap-4 md:grid-cols-2 md:items-end">
        {p.heading && <h2 className="text-2xl font-bold sm:text-3xl">{p.heading}</h2>}
        {p.intro && <p className="text-sm opacity-75">{p.intro}</p>}
      </div>
      <div className={p.style === 'grid' ? 'grid gap-3 sm:grid-cols-2' : 'space-y-3'}>
        {(p.items || []).map((it, i) => (
          <div key={i} className={cx('rounded-lg border bg-white p-4 text-slate-900 shadow-sm', p.style === 'grid' && 'border-l-4 border-l-[color:var(--lp-primary)]')}>
            <h3 className="font-semibold">{it.title}</h3>
            {it.text && <p className="mt-1 text-sm text-slate-600">{it.text}</p>}
          </div>
        ))}
      </div>
    </Section>
  ),

  imageText: ({ p }) => (
    <Section className="bg-white">
      <div className="mb-6 grid gap-4 md:grid-cols-2 md:items-end">
        {p.heading && <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{p.heading}</h2>}
        {p.intro && <p className="text-sm text-slate-600">{p.intro}</p>}
      </div>
      <div className={cx('grid items-center gap-6 md:grid-cols-2', p.imageSide === 'left' && 'md:[&>*:first-child]:order-2')}>
        <div className="space-y-3">
          {(p.items || []).map((it, i) => (
            <div key={i} className="rounded-lg border p-4 shadow-sm">
              <h3 className="font-semibold text-slate-900">{it.title}</h3>
              {it.text && <p className="mt-1 text-sm text-slate-600">{it.text}</p>}
            </div>
          ))}
        </div>
        <Img src={p.image} className="aspect-square w-full rounded-xl object-cover" />
      </div>
    </Section>
  ),

  cta: ({ p }) => (
    <section className={cx('text-center text-white', p.style === 'card' ? 'bg-white px-4 py-10 sm:px-6' : 'px-4 py-14 sm:px-6')} style={p.style === 'card' ? undefined : { background: p.bgColor || 'var(--lp-primary)', backgroundImage: p.bgImage ? `linear-gradient(rgba(0,0,0,.4),rgba(0,0,0,.4)),url("${encodeURI(p.bgImage)}")` : undefined, backgroundSize: 'cover' }}>
      <div className={cx('mx-auto', p.style === 'card' ? 'max-w-5xl rounded-3xl px-6 py-12 shadow-xl' : 'max-w-3xl')} style={p.style === 'card' ? { backgroundImage: `linear-gradient(135deg, ${p.bgColor || 'var(--lp-primary)'}, var(--lp-dark))` } : undefined}>
        {p.eyebrow && <p className="mb-2 text-sm opacity-90">{p.eyebrow}</p>}
        {p.heading && <h2 className="text-xl font-bold sm:text-2xl">{p.heading}</h2>}
        {p.text && <p className="mt-2 opacity-90">{p.text}</p>}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {(p.buttons || []).map((b, i) => (
            <A key={i} href={b.link} className={cx('rounded-full px-6 py-2.5 text-sm font-semibold', b.style === 'outline' ? 'border-2 border-white text-white' : b.style === 'accent' ? 'bg-[color:var(--lp-accent)] text-slate-900' : 'bg-white text-slate-900')}>{b.label}</A>
          ))}
        </div>
      </div>
    </section>
  ),

  stats: ({ p }) => (
    <Section className={bgClass(p.bg || 'brand')}>
      <div className={cx('grid gap-6 text-center', cols((p.items || []).length > 3 ? 4 : (p.items || []).length || 3))}>
        {(p.items || []).map((it, i) => <div key={i}><p className="text-4xl font-extrabold">{it.value}</p><p className="mt-1 text-sm opacity-80">{it.label}</p></div>)}
      </div>
    </Section>
  ),

  faq: function Faq({ p }) {
    const [open, setOpen] = useState(0);
    return (
      <Section className={bgClass(p.bg)}>
        {p.heading && <h2 className="mb-6 text-center text-3xl font-bold">{p.heading}</h2>}
        <div className="mx-auto max-w-3xl divide-y rounded-xl border bg-white text-slate-900">
          {(p.items || []).map((it, i) => (
            <div key={i}>
              <button type="button" onClick={() => setOpen(open === i ? -1 : i)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left font-medium">{it.q}<ChevronDown className={cx('h-4 w-4 shrink-0 transition', open === i && 'rotate-180')} /></button>
              {open === i && <p className="whitespace-pre-line px-4 pb-4 text-sm text-slate-600">{it.a}</p>}
            </div>
          ))}
        </div>
      </Section>
    );
  },

  image: ({ p }) => (
    <section className="px-4 py-6 sm:px-6">
      <div className="mx-auto" style={{ maxWidth: Number(p.maxWidth) || 1152 }}>
        {p.link ? <A href={p.link}><Img src={p.image} alt={p.alt} className={cx('w-full object-cover', p.rounded !== false && 'rounded-xl')} /></A> : <Img src={p.image} alt={p.alt} className={cx('w-full object-cover', p.rounded !== false && 'rounded-xl')} />}
        {p.caption && <p className="mt-2 text-center text-sm text-slate-500">{p.caption}</p>}
      </div>
    </section>
  ),

  video: ({ p }) => (
    <Section className={bgClass(p.bg)}>
      {p.heading && <h2 className="mb-6 text-center text-3xl font-bold">{p.heading}</h2>}
      <div className="mx-auto max-w-4xl"><Video url={p.url} poster={p.poster} /></div>
    </Section>
  ),

  doctors: ({ p }) => (
    <Section className={bgClass(p.bg || 'tint')}>
      {p.heading && <h2 className="mb-8 text-center text-3xl font-bold">{p.heading}</h2>}
      <div className={cx('grid gap-6', cols(Math.min(3, (p.items || []).length || 2)))}>
        {(p.items || []).map((d, i) => (
          <div key={i} className="overflow-hidden rounded-xl bg-white text-slate-900 shadow">
            <Img src={d.photo} className="aspect-[4/3] w-full object-cover object-top" />
            <div className="p-4"><h3 className="text-lg font-semibold">{d.name}</h3>{d.qualification && <p className="text-sm text-[color:var(--lp-primary)]">{d.qualification}</p>}{d.text && <p className="mt-2 text-sm text-slate-600">{d.text}</p>}</div>
          </div>
        ))}
      </div>
    </Section>
  ),

  footer: ({ p, clinic }) => (
    <footer className="bg-[color:var(--lp-dark)] px-4 py-12 text-white/80 sm:px-6">
      <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-3">
        <div>
          {(p.logo || clinic?.logo) && <img src={p.logo || clinic.logo} alt="" className="mb-4 h-14 w-auto rounded bg-white p-1" />}
          {p.about && <p className="text-sm">{p.about}</p>}
        </div>
        <div>
          <h4 className="mb-3 font-semibold text-white">Connect Us</h4>
          <div className="space-y-2 text-sm">
            {p.email && <A href={`mailto:${p.email}`} className="flex items-center gap-2"><Mail className="h-4 w-4" /> {p.email}</A>}
            {p.phone && <A href={`tel:${p.phone}`} className="flex items-center gap-2"><Phone className="h-4 w-4" /> {p.phone}</A>}
            {(p.links || []).map((l, i) => <A key={i} href={l.link} className="block hover:text-white">{l.label}</A>)}
          </div>
        </div>
        <div>
          <h4 className="mb-3 font-semibold text-white">Address</h4>
          <div className="space-y-3 text-sm">{(p.addresses || []).map((a, i) => <div key={i}><p className="font-medium text-white">{a.title}</p><p>{a.text}</p></div>)}</div>
        </div>
      </div>
      {p.copyright && <p className="mx-auto mt-10 max-w-6xl border-t border-white/10 pt-4 text-center text-xs">{p.copyright}</p>}
    </footer>
  ),

  steps: ({ p }) => (
    <Section className={bgClass(p.bg || 'white')}>
      {p.heading && <h2 className="mb-2 text-center text-3xl font-bold">{p.heading}</h2>}
      {p.subheading && <p className="mx-auto mb-8 max-w-2xl text-center opacity-75">{p.subheading}</p>}
      {p.style === 'timeline' ? (
        <div className="relative mt-10 grid gap-8 md:grid-cols-4">
          <div className="absolute left-0 right-0 top-5 hidden h-0.5 bg-[color:var(--lp-primary)]/20 md:block" />
          {(p.items || []).map((it, i) => (
            <div key={i} className="relative text-center">
              <span className="relative z-10 mx-auto grid h-10 w-10 place-items-center rounded-full bg-[color:var(--lp-primary)] font-bold text-white ring-8 ring-white">{i + 1}</span>
              <h3 className="mt-3 font-semibold">{it.title}</h3>
              {it.text && <p className="mt-1 text-sm opacity-75">{it.text}</p>}
            </div>
          ))}
        </div>
      ) : (
        <div className="mx-auto mt-8 max-w-3xl space-y-4">
          {(p.items || []).map((it, i) => (
            <div key={i} className="flex gap-4 rounded-xl border bg-white p-4 text-slate-900">
              <span className="text-3xl font-extrabold text-[color:var(--lp-primary)]/30">{String(i + 1).padStart(2, '0')}</span>
              <div><h3 className="font-semibold">{it.title}</h3>{it.text && <p className="mt-1 text-sm text-slate-600">{it.text}</p>}</div>
            </div>
          ))}
        </div>
      )}
    </Section>
  ),

  pricing: ({ p }) => (
    <Section className={bgClass(p.bg || 'tint')}>
      {p.heading && <h2 className="text-center text-3xl font-bold">{p.heading}</h2>}
      {p.subheading && <p className="mx-auto mt-2 max-w-2xl text-center opacity-75">{p.subheading}</p>}
      <div className={cx('mt-10 grid items-stretch gap-6', cols(Math.min(4, (p.items || []).length || 3)))}>
        {(p.items || []).map((it, i) => (
          <div key={i} className={cx('relative flex flex-col rounded-2xl border bg-white p-6 text-slate-900', it.highlight ? 'border-2 border-[color:var(--lp-primary)] shadow-xl' : 'shadow-sm')}>
            {it.highlight && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[color:var(--lp-primary)] px-3 py-0.5 text-xs font-semibold text-white">Most chosen</span>}
            <h3 className="text-lg font-semibold">{it.title}</h3>
            <p className="mt-3 text-3xl font-extrabold text-[color:var(--lp-primary)]">{it.price}</p>
            {it.note && <p className="text-sm text-slate-500">{it.note}</p>}
            <ul className="mt-4 flex-1 space-y-2 text-sm">{String(it.features || '').split('\n').filter(Boolean).map((f, j) => <li key={j} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--lp-primary)]" />{f}</li>)}</ul>
            {it.buttonText && <A href={it.buttonLink || '#form'} className={cx('mt-6 rounded-lg px-4 py-2.5 text-center font-semibold', it.highlight ? 'bg-[color:var(--lp-primary)] text-white' : 'border border-[color:var(--lp-primary)] text-[color:var(--lp-primary)]')}>{it.buttonText}</A>}
          </div>
        ))}
      </div>
      {p.note && <p className="mt-6 text-center text-xs opacity-60">{p.note}</p>}
    </Section>
  ),

  spacer: ({ p }) => <div style={{ height: Math.min(400, Number(p.height) || 40) }} />,
};

export const BLOCK_RENDERERS = B;

export const designVars = (d = {}) => ({
  '--lp-primary': d.primary || '#e21f26',
  '--lp-accent': d.accent || '#d4a017',
  '--lp-dark': d.dark || '#0f172a',
  '--lp-tint': d.tint || '#fff1f1',
  '--lp-cta': d.cta || '#14b8a6',
  fontFamily: `'${d.font || 'Inter'}', ui-sans-serif, system-ui, sans-serif`,
});

export function Block({ block, design, renderForm, clinic }) {
  const R = B[block.type];
  if (!R) return null;
  return <R p={block.props || {}} design={design} renderForm={renderForm} clinic={clinic} />;
}

export function fontHref(font) {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font || 'Inter')}:wght@400;500;600;700;800&display=swap`;
}

export default function LandingPage({ blocks = [], design, renderForm, clinic, children }) {
  return (
    <div className="min-h-screen bg-white text-slate-900" style={designVars(design)}>
      {blocks.filter((b) => !b.hidden).map((b) => <Block key={b.id} block={b} design={design} renderForm={renderForm} clinic={clinic} />)}
      {children}
    </div>
  );
}
