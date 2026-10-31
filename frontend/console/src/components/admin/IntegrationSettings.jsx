import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Cloud, Mail, PhoneCall, MessageCircle, Settings2, Sparkles, Eye, EyeOff, CheckCircle2, XCircle, PlugZap, RotateCcw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { get, post, put } from '@/lib/api';
import { cn, errMsg } from '@/lib/utils';

const GROUPS = {
  general: { title: 'Application', icon: Settings2, hint: 'Shown as the sender name on emails and in test messages.' },
  storage: { title: 'Media storage (CMS / landing page images & videos)', icon: Cloud, hint: 'auto = first configured of R2 → S3 → Cloudinary, otherwise server disk (uploads/media).', test: 'storage' },
  smtp: { title: 'Email (SMTP)', icon: Mail, hint: 'Lead alerts, daily stock alerts. Port 465 = SSL, 587 = STARTTLS.', test: 'smtp', testTo: 'Send test mail to (email)' },
  exotel: { title: 'Exotel (dialer, IVR, recordings)', icon: PhoneCall, hint: 'Exotel dashboard → Settings → API. Mumbai accounts use api.in.exotel.com.', test: 'exotel' },
  whatsapp: { title: 'WhatsApp (sms4power WAPP)', icon: MessageCircle, hint: 'OTP, booking, prescription, invoice messages.', test: 'whatsapp', testTo: 'Send test message to (mobile)' },
  ai: { title: 'AI writer (Hugging Face)', icon: Sparkles, hint: 'Writes CMS landing pages and rewrites sections. Token: huggingface.co → Settings → Access Tokens → fine-grained with “Make calls to Inference Providers”.', test: 'ai' },
};
const LABEL = {
  APP_NAME: 'App name', STORAGE_DRIVER: 'Storage driver',
  S3_BUCKET: 'S3 bucket', S3_REGION: 'S3 region', S3_ACCESS_KEY_ID: 'S3 access key ID', S3_SECRET_ACCESS_KEY: 'S3 secret access key', S3_ENDPOINT: 'S3 endpoint (optional, MinIO/Spaces)', S3_PUBLIC_URL: 'S3 public URL / CloudFront (optional)',
  R2_ACCOUNT_ID: 'R2 account ID', R2_BUCKET: 'R2 bucket', R2_ACCESS_KEY_ID: 'R2 access key ID', R2_SECRET_ACCESS_KEY: 'R2 secret access key', R2_PUBLIC_URL: 'R2 public URL (r2.dev or custom domain)',
  CLOUDINARY_CLOUD_NAME: 'Cloudinary cloud name', CLOUDINARY_API_KEY: 'Cloudinary API key', CLOUDINARY_API_SECRET: 'Cloudinary API secret', CLOUDINARY_FOLDER: 'Cloudinary folder',
  SMTP_HOST: 'SMTP host', SMTP_PORT: 'SMTP port', SMTP_USER: 'SMTP username', SMTP_PASS: 'SMTP password', SMTP_FROM: 'From address', ALERT_EMAILS: 'Alert emails (comma separated)',
  EXOTEL_SID: 'Account SID', EXOTEL_API_KEY: 'API key', EXOTEL_API_TOKEN: 'API token', EXOTEL_SUBDOMAIN: 'API host (region)', EXOTEL_CALLER_ID: 'Caller ID (ExoPhone)', EXOTEL_WEBHOOK_TOKEN: 'Webhook token (random 32+ chars)',
  WAPP_API_URL: 'API URL', WAPP_API_KEY: 'API key', WAPP_COUNTRY: 'Country code',
  HF_TOKEN: 'Hugging Face access token', HF_MODEL: 'Model (auto recommended)', HF_API_URL: 'API URL (OpenAI-compatible router)',
};
const SUBHEAD = { S3_BUCKET: 'AWS S3', R2_ACCOUNT_ID: 'Cloudflare R2', CLOUDINARY_CLOUD_NAME: 'Cloudinary' };
const SRC = { settings: ['Saved here', 'success'], env: ['From .env', 'secondary'], none: ['Not set', 'outline'] };

function Group({ group, rows, editable, onSaved }) {
  const g = GROUPS[group];
  const [vals, setVals] = useState({});
  const [show, setShow] = useState({});
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [test, setTest] = useState(null);
  const models = useQuery({ queryKey: ['ai-models'], queryFn: () => get('/admin/integrations/ai-models'), enabled: group === 'ai' && rows.some((r) => r.key === 'HF_TOKEN' && r.source !== 'none'), staleTime: 600_000 });
  useEffect(() => { setVals(Object.fromEntries(rows.filter((r) => !r.secret).map((r) => [r.key, r.value]))); }, [rows]);
  const dirty = rows.some((r) => (r.secret ? !!vals[r.key] : (vals[r.key] ?? '') !== (r.value ?? '')));

  const save = async (extra = {}) => {
    setBusy(true);
    try {
      const values = {};
      for (const r of rows) {
        const v = vals[r.key];
        if (r.secret) { if (v) values[r.key] = v; } else if ((v ?? '') !== (r.value ?? '')) values[r.key] = v ?? '';
      }
      await put('/admin/integrations', { values: { ...values, ...extra } });
      toast.success(`${g.title.split(' (')[0]} saved`);
      setVals((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !rows.find((r) => r.key === k)?.secret)));
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const runTest = async () => {
    setTest({ loading: true });
    try { setTest(await post(`/admin/integrations/test/${g.test}`, { to: testTo || undefined })); } catch (e) { setTest({ ok: false, message: errMsg(e) }); }
  };

  return (
    <Card className="space-y-3 p-4">
      <div><p className="flex items-center gap-2 font-semibold"><g.icon className="h-4 w-4" /> {g.title}</p><p className="text-xs text-muted-foreground">{g.hint}</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.key} className={cn('space-y-1', SUBHEAD[r.key] && 'sm:col-span-2')}>
            {SUBHEAD[r.key] && <p className="border-t pt-3 text-xs font-semibold uppercase text-muted-foreground">{SUBHEAD[r.key]}</p>}
            <div className={cn(SUBHEAD[r.key] && 'sm:w-1/2 sm:pr-1.5')}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label className="text-xs font-medium">{LABEL[r.key] || r.key}</label>
                <div className="flex items-center gap-1">
                  <Badge variant={SRC[r.source][1]} className="text-[10px]">{SRC[r.source][0]}</Badge>
                  {r.saved && editable && <button type="button" title="Remove saved value (fall back to .env)" className="text-muted-foreground hover:text-destructive" onClick={() => save({ [r.key]: null })}><RotateCcw className="h-3 w-3" /></button>}
                </div>
              </div>
              {r.options ? (
                <Select className="h-9" disabled={!editable} value={vals[r.key] ?? ''} onChange={(e) => setVals((x) => ({ ...x, [r.key]: e.target.value }))} placeholder={r.envValue ? `.env: ${r.envValue}` : 'Default'}>{r.options.map((o) => <option key={o} value={o}>{o}</option>)}</Select>
              ) : r.secret ? (
                <div className="relative">
                  <Input className="h-9 pr-9 font-mono text-xs" type={show[r.key] ? 'text' : 'password'} autoComplete="new-password" disabled={!editable} value={vals[r.key] || ''} placeholder={r.masked ? `${r.masked} — leave blank to keep` : 'Not set'} onChange={(e) => setVals((x) => ({ ...x, [r.key]: e.target.value }))} />
                  <button type="button" className="absolute right-2 top-2.5 text-muted-foreground" onClick={() => setShow((x) => ({ ...x, [r.key]: !x[r.key] }))}>{show[r.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                </div>
              ) : (
                <>
                  <Input className="h-9" list={r.key === 'HF_MODEL' ? 'hf-models' : undefined} inputMode={r.number ? 'numeric' : undefined} disabled={!editable} value={vals[r.key] ?? ''} placeholder={r.envValue ? `.env: ${r.envValue}` : ''} onChange={(e) => setVals((x) => ({ ...x, [r.key]: e.target.value }))} />
                  {r.key === 'HF_MODEL' && (
                    <>
                      <datalist id="hf-models"><option value="auto" />{(models.data || []).map((m) => <option key={m} value={m} />)}</datalist>
                      <p className="mt-1 text-[11px] text-muted-foreground">“auto” picks the best model your providers serve. {models.data?.length ? `${models.data.length} models available — start typing to search.` : ''}</p>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        {g.test && (
          <>
            {g.testTo && <Input className="h-9 w-56" placeholder={g.testTo} value={testTo} onChange={(e) => setTestTo(e.target.value)} />}
            <Button variant="outline" size="sm" loading={test?.loading} onClick={runTest}><PlugZap /> Test</Button>
          </>
        )}
        {editable && <Button size="sm" disabled={!dirty} loading={busy} onClick={() => save()}>Save</Button>}
      </div>
      {test && !test.loading && <p className={cn('flex items-start gap-1.5 rounded-md p-2 text-xs', test.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700')}>{test.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}{test.message}</p>}
    </Card>
  );
}

export function IntegrationSettings({ editable }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['integrations'], queryFn: () => get('/admin/integrations'), enabled: editable });
  if (!editable) return <Card className="p-4 text-sm text-muted-foreground">Only users with “Settings → manage” permission can view integration keys.</Card>;
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <Card className="p-4 text-sm text-destructive">{errMsg(q.error)}</Card>;
  return (
    <div className="space-y-4">
      <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">Keys saved here override the server <code>.env</code> and apply within 30 seconds — no restart needed. Secrets are stored encrypted and are never shown again; leave a secret blank to keep it. ↺ removes a saved value so the <code>.env</code> value is used.</p>
      {Object.keys(GROUPS).map((g) => q.data[g] && <Group key={g} group={g} rows={q.data[g]} editable={editable} onSaved={() => { qc.invalidateQueries({ queryKey: ['integrations'] }); qc.invalidateQueries({ queryKey: ['call-config'] }); }} />)}
    </div>
  );
}