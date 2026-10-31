import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Sparkles, Wand2, ArrowRight, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/common/Field';
import { get, post } from '@/lib/api';
import { errMsg } from '@/lib/utils';
import { BLOCK_DEFS } from './blockDefs';

const IDEAS = [
  'Google Ads landing page for laser piles treatment in Dwarka — free consultation, same-day discharge',
  'Kshar Sutra fistula treatment page for Facebook ads, targeting working professionals in West Delhi',
  'Anal fissure treatment page for women, Paschim Vihar clinic, caring tone',
  'Pilonidal sinus laser treatment page for young men in Rohini, Instagram campaign',
];

/** "Create with AI" — Hugging Face writes the whole landing page from a short brief */
export function AiCreateDialog({ open, onOpenChange, fields, campaigns = [] }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => get('/crm/ai/status'), enabled: open, staleTime: 60_000 });
  const [brief, setBrief] = useState('');
  const [language, setLanguage] = useState('en');
  const [tone, setTone] = useState('caring');
  const [campaign, setCampaign] = useState('');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    try {
      setDraft(await post('/crm/ai/landing', { brief, language, tone }, { timeout: 120_000 }));
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const create = async () => {
    setBusy(true);
    try {
      const f = await post('/crm/forms', { ...draft, fields, defaultSource: 'landing_page', campaign: campaign || null, isActive: true, successMessage: 'Thank you! Our team will call you shortly.' });
      qc.invalidateQueries({ queryKey: ['/crm/forms'] });
      toast.success('Page created — fine-tune it in the designer');
      onOpenChange(false);
      setDraft(null);
      setBrief('');
      nav(`/forms/${f._id}/design`);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Create landing page with AI" size="lg">
        {status.data && !status.data.configured && <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">AI is not set up. Add a Hugging Face token in <b>Settings → Integrations → AI writer</b>.</p>}
        {!draft ? (
          <div className="space-y-3">
            <Field label="What is this page for?" hint="Treatment, area/branch, audience, ad platform, offer">
              <Textarea rows={4} autoFocus value={brief} maxLength={1500} onChange={(e) => setBrief(e.target.value)} placeholder={IDEAS[0]} />
            </Field>
            <div className="flex flex-wrap gap-1.5">{IDEAS.map((i) => <button key={i} type="button" onClick={() => setBrief(i)} className="rounded-full border px-2.5 py-1 text-left text-[11px] text-muted-foreground hover:border-primary hover:text-primary">{i.slice(0, 60)}…</button>)}</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Language"><Select value={language} onChange={(e) => setLanguage(e.target.value)}><option value="en">English</option><option value="hi">Hindi</option><option value="hinglish">Hinglish</option></Select></Field>
              <Field label="Tone"><Select value={tone} onChange={(e) => setTone(e.target.value)}><option value="caring">Caring</option><option value="professional">Professional</option><option value="friendly">Friendly</option><option value="urgent">Urgent (offer)</option></Select></Field>
              <Field label="Campaign"><Select value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="From UTM">{campaigns.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</Select></Field>
            </div>
            <p className="text-[11px] text-muted-foreground">AI follows medical-advertising rules (no cure guarantees, no fake numbers). Always review the text before publishing.</p>
            <div className="flex justify-end"><Button loading={busy} disabled={brief.trim().length < 5 || status.data?.configured === false} onClick={generate}><Wand2 /> {busy ? 'Writing… (20–60 s)' : 'Generate page'}</Button></div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Page name"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
              <Field label="URL slug"><Input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} /></Field>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Headline</p>
              <p className="text-lg font-bold text-primary">{draft.blocks.find((b) => b.type === 'hero')?.props?.title}</p>
              <p className="text-sm">{draft.blocks.find((b) => b.type === 'hero')?.props?.subtitle}</p>
              <p className="mt-2 text-xs text-muted-foreground">SEO: {draft.page?.seoTitle}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">{draft.blocks.map((b) => <Badge key={b.id} variant="outline">{BLOCK_DEFS[b.type]?.label || b.type}</Badge>)}</div>
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setDraft(null)}><RotateCcw /> Change brief</Button>
              <div className="flex gap-2"><Button variant="outline" loading={busy} onClick={generate}><Sparkles /> Regenerate</Button><Button loading={busy} onClick={create}>Create & open designer <ArrowRight /></Button></div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
