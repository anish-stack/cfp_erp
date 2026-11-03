import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, ExternalLink, Monitor, Smartphone, TriangleAlert, CheckCircle2, CircleSlash } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/PageHeader';
import { Field } from '@/components/common/Field';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { get, API_URL } from '@/lib/api';
import { cn } from '@/lib/utils';

const ORIGIN = API_URL.replace(/\/api\/v1\/?$/, '') || window.location.origin;
const SWATCHES = ['#0f6b52', '#1d4ed8', '#b91c1c', '#7c3aed', '#0f172a', '#d97706'];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function Code({ text }) {
  const copy = () => navigator.clipboard.writeText(text).then(() => toast.success('Copied'), () => toast.error('Copy failed — select and copy manually'));
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border bg-muted/50 p-3 pr-12 text-xs leading-relaxed"><code>{text}</code></pre>
      <Button type="button" variant="outline" size="icon" className="absolute right-2 top-2 h-7 w-7" onClick={copy} aria-label="Copy code"><Copy /></Button>
    </div>
  );
}

function Status({ ok, label, hint }) {
  const Icon = ok ? CheckCircle2 : CircleSlash;
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className={cn('mt-0.5 size-4 shrink-0', ok ? 'text-emerald-600' : 'text-muted-foreground')} />
      <div><div className="font-medium">{label}</div>{hint && <div className="text-xs text-muted-foreground">{hint}</div>}</div>
    </div>
  );
}

export default function WebsiteWidget() {
  const [color, setColor] = useState('#0f6b52');
  const [title, setTitle] = useState('');
  const [position, setPosition] = useState('right');
  const [branch, setBranch] = useState('');
  const [autoOpen, setAutoOpen] = useState(false);
  const [device, setDevice] = useState('desktop');

  const cfg = useQuery({ queryKey: ['widget-config'], queryFn: () => get('/widget/config', undefined, { branchScoped: false }), staleTime: 60_000 });
  const branches = cfg.data?.branches || [];

  const hex = (/^#[0-9a-f]{6}$/i.test(color) ? color : '#0f6b52').slice(1);

  const { script, iframe, frameUrl, demoDoc } = useMemo(() => {
    const base = [`data-color="${hex}"`];
    if (title.trim()) base.push(`data-title="${esc(title.trim())}"`);
    if (position === 'left') base.push('data-position="left"');
    if (branch) base.push(`data-branch="${branch}"`);
    const attrs = (open) => [...base, ...(open ? ['data-open="1"'] : [])].join(' ');

    const qs = new URLSearchParams({ color: hex, ...(title.trim() ? { title: title.trim() } : {}), ...(branch ? { branch } : {}) }).toString();
    const frameUrl = `${ORIGIN}/widget/frame?${qs}`;
    const demoDoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;font-family:system-ui,sans-serif;color:#1e293b;background:#f8fafc}
header{display:flex;justify-content:space-between;align-items:center;padding:14px 24px;background:#fff;border-bottom:1px solid #e2e8f0}
header b{font-size:18px}header span{font-size:13px;color:#64748b;margin-left:16px}
.hero{padding:40px 24px 24px;max-width:560px}.hero h1{margin:0 0 10px;font-size:28px;line-height:1.2}.hero p{margin:0;color:#475569;line-height:1.5}
.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;padding:8px 24px}
.row div{height:90px;border-radius:10px;background:#e2e8f0}
</style></head><body>
<header><b>Your website</b><div><span>Home</span><span>Services</span><span>Contact</span></div></header>
<div class="hero"><h1>Your clinic's own website</h1><p>This is how the booking widget looks to your visitors. It appears on any page where you paste the code.</p></div>
<div class="row"><div></div><div></div><div></div></div>
<script src="${ORIGIN}/widget/v1.js" ${attrs(true)} async></script>
</body></html>`;
    return {
      script: `<script src="${ORIGIN}/widget/v1.js" ${attrs(autoOpen)} async></script>`,
      iframe: `<iframe src="${frameUrl}" title="Book appointment" style="width:380px;height:620px;max-width:100%;border:0;border-radius:16px" loading="lazy"></iframe>`,
      frameUrl,
      demoDoc,
    };
  }, [hex, title, position, branch, autoOpen]);

  return (
    <div>
      <PageHeader title="Website Widget" description="Let visitors book appointments from any website — WordPress, PHP, Laravel or plain HTML." />

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="space-y-4 p-4">
            <Field label="Brand colour">
              <div className="flex items-center gap-2">
                <input type="color" value={`#${hex}`} onChange={(e) => setColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded border bg-card p-1" aria-label="Pick colour" />
                <Input value={color} onChange={(e) => setColor(e.target.value)} className="font-mono" maxLength={7} />
              </div>
              <div className="mt-2 flex gap-2">
                {SWATCHES.map((c) => (
                  <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Use ${c}`} className={cn('size-6 rounded-full border-2', `#${hex}` === c ? 'border-foreground' : 'border-transparent')} style={{ background: c }} />
                ))}
              </div>
            </Field>
            <Field label="Title" hint="Header text. Empty = clinic name.">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} placeholder={cfg.data?.clinic?.name || 'Clinic name'} />
            </Field>
            <Field label="Branch" hint="Lock the widget to one branch, or let visitors choose.">
              <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
                <option value="">All branches (visitor chooses)</option>
                {branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
              </Select>
            </Field>
            <Field label="Button position">
              <Select value={position} onChange={(e) => setPosition(e.target.value)}>
                <option value="right">Bottom right</option>
                <option value="left">Bottom left</option>
              </Select>
            </Field>
            <div className="flex items-center justify-between gap-3">
              <div><div className="text-sm font-medium">Open automatically</div><div className="text-xs text-muted-foreground">Script code only. The demo is always open.</div></div>
              <Switch checked={autoOpen} onCheckedChange={setAutoOpen} />
            </div>
          </Card>

          <Card className="space-y-3 p-4">
            <div className="text-sm font-semibold">Readiness</div>
            {cfg.isLoading ? <div className="text-sm text-muted-foreground">Checking…</div> : cfg.isError ? (
              <Status ok={false} label="Widget API not reachable" hint="Restart the API after adding the widget files." />
            ) : (
              <>
                <Status ok={branches.length > 0} label={`${branches.length} branch${branches.length === 1 ? '' : 'es'} open for online booking`} hint={branches.length ? undefined : 'Enable online booking on a branch (Branches).'} />
                <Status ok={!!cfg.data?.ai} label={cfg.data?.ai ? 'AI assistant on' : 'AI assistant off'} hint={cfg.data?.ai ? 'Understands typed messages like "kal 11 baje".' : 'Add a Groq key in Settings → Integrations → AI writer. Buttons still work.'} />
                <Status ok={!cfg.data?.paymentRequired} label={cfg.data?.paymentRequired ? 'Payment required' : 'No payment needed'} hint={cfg.data?.paymentRequired ? 'Visitors are sent to the booking page to pay.' : undefined} />
              </>
            )}
          </Card>
        </div>

        <Tabs defaultValue="demo">
          <TabsList><TabsTrigger value="demo">Live demo</TabsTrigger><TabsTrigger value="embed">Embed code</TabsTrigger></TabsList>

          <TabsContent value="demo">
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
                <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400"><TriangleAlert className="size-4" /> Demo makes real bookings. Use a test mobile number.</div>
                <div className="flex gap-1">
                  <Button type="button" size="sm" variant={device === 'desktop' ? 'default' : 'outline'} onClick={() => setDevice('desktop')}><Monitor /> Desktop</Button>
                  <Button type="button" size="sm" variant={device === 'mobile' ? 'default' : 'outline'} onClick={() => setDevice('mobile')}><Smartphone /> Mobile</Button>
                  <Button type="button" size="sm" variant="outline" asChild><a href={frameUrl} target="_blank" rel="noreferrer"><ExternalLink /> Full page</a></Button>
                </div>
              </div>
              <div className="flex justify-center bg-muted/40 p-4">
                <iframe
                  key={demoDoc + device}
                  title="Widget demo"
                  srcDoc={demoDoc}
                  className={cn('h-[600px] rounded-lg border bg-white shadow-sm', device === 'mobile' ? 'w-[390px] max-w-full' : 'w-full')}
                />
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="embed" className="space-y-5">
            <Card className="space-y-3 p-4">
              <div><div className="text-sm font-semibold">Option 1 — Script (recommended)</div><div className="text-xs text-muted-foreground">Floating button on every page. Paste just before <code>&lt;/body&gt;</code>.</div></div>
              <Code text={script} />
              <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                <div><b className="text-foreground">WordPress</b><br />Plugin “WPCode” or “Insert Headers and Footers” → Footer. Or theme <code>footer.php</code>.</div>
                <div><b className="text-foreground">Laravel</b><br />Paste in <code>resources/views/layouts/app.blade.php</code> before <code>&lt;/body&gt;</code>.</div>
                <div><b className="text-foreground">PHP / HTML</b><br />Paste in your common footer include or each page.</div>
              </div>
            </Card>
            <Card className="space-y-3 p-4">
              <div><div className="text-sm font-semibold">Option 2 — Iframe</div><div className="text-xs text-muted-foreground">Fixed chat box inside one page (e.g. a “Book appointment” page).</div></div>
              <Code text={iframe} />
            </Card>
            <Card className="p-4 text-xs text-muted-foreground">
              Only want certain websites to use it? On the server set <code>WIDGET_ALLOWED_ORIGINS=https://site.com,https://www.site.com</code> in <code>.env</code> and restart (add this console's address too, or the demo stops working). If a site uses a strict Content-Security-Policy, allow <code>{ORIGIN}</code> for scripts and connections.
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}