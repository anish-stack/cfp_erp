import { ResourcePage } from '@/components/common/ResourcePage';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { useGet } from '@/hooks/queries';
import { inr, fmtDate, titleCase } from '@/lib/utils';

const CHANNELS = ['google_ads', 'facebook_ads', 'instagram', 'whatsapp', 'sms', 'email', 'seo', 'offline', 'other'];

export default function Campaigns() {
  const { data: stats = [] } = useGet('campaign-stats', '/crm/campaigns/stats');
  const s = (id) => stats.find((x) => x._id === id) || {};
  return (
    <ResourcePage
      title="Campaigns"
      description="Match leads automatically via utm_campaign"
      endpoint="/crm/campaigns"
      module="campaigns"
      newDefaults={{ channel: 'google_ads', status: 'active', isActive: true }}
      toForm={(c) => ({ ...c, branch: c.branch?._id || '' })}
      toPayload={(v) => ({ ...v, branch: v.branch || null })}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'channel', label: 'Channel', type: 'select', options: CHANNELS.map((c) => ({ value: c, label: titleCase(c) })) },
        { name: 'utmCampaign', label: 'utm_campaign value', hint: 'Exact value used in ad URLs' },
        { name: 'branch', label: 'Branch', optionsQuery: { url: '/branches/names', map: (b) => ({ value: b._id, label: b.name }) } },
        { name: 'budget', label: 'Budget', type: 'number' },
        { name: 'spend', label: 'Spend to date', type: 'number' },
        { name: 'startDate', label: 'Start', type: 'date' },
        { name: 'endDate', label: 'End', type: 'date' },
        { name: 'status', label: 'Status', type: 'select', options: ['draft', 'active', 'paused', 'ended'] },
        { name: 'notes', label: 'Notes', type: 'textarea', colSpan: 2 },
      ]}
      columns={[
        { key: 'n', header: 'Campaign', cell: (c) => <div><p className="font-medium">{c.name}</p><p className="font-mono text-xs text-muted-foreground">{c.utmCampaign}</p></div> },
        { key: 'ch', header: 'Channel', cell: (c) => <Badge variant="outline">{titleCase(c.channel)}</Badge> },
        { key: 'dates', header: 'Dates', cell: (c) => `${fmtDate(c.startDate)} – ${c.endDate ? fmtDate(c.endDate) : 'open'}` },
        { key: 'leads', header: 'Leads', cell: (c) => s(c._id).leads || 0 },
        { key: 'conv', header: 'Converted', cell: (c) => s(c._id).converted || 0 },
        { key: 'spend', header: 'Spend / CPL', cell: (c) => `${inr(c.spend)}${s(c._id).leads ? ` · ${inr(c.spend / s(c._id).leads)}` : ''}` },
        { key: 'st', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
      ]}
    />
  );
}
