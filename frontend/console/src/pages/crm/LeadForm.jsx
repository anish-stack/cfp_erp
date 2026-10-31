import { useState } from 'react';
import { FormBuilder } from '@/components/common/FormBuilder';
import { useAction } from '@/hooks/queries';
import { post } from '@/lib/api';
import { useCan } from '@/store/auth';

export const SOURCES = ['website', 'google_ads', 'facebook_ads', 'instagram', 'whatsapp', 'phone', 'walkin', 'manual', 'import', 'referral', 'landing_page'];
export const CONDITIONS = ['Piles', 'Fistula', 'Fissure', 'Pilonidal sinus', 'Rectal prolapse', 'Constipation', 'Other'];

export function LeadForm({ onDone }) {
  const can = useCan();
  const [dup, setDup] = useState(null);
  const [last, setLast] = useState(null);
  const fields = [
    { name: 'name', label: 'Name', required: true },
    { name: 'phone', label: 'Mobile', type: 'tel', required: true },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'city', label: 'City / area' },
    { name: 'condition', label: 'Condition', type: 'select', options: CONDITIONS },
    { name: 'source', label: 'Source', type: 'select', options: SOURCES },
    { name: 'branch', label: 'Preferred branch', optionsQuery: { url: '/branches/names', map: (b) => ({ value: b._id, label: b.name }) } },
    { name: 'campaign', label: 'Campaign', optionsQuery: { url: '/crm/campaigns', params: { all: 'true', active: 'true' }, map: (c) => ({ value: c._id, label: c.name }) } },
    ...(can('leads.assign') ? [{ name: 'assignedTo', label: 'Assign to', optionsQuery: { url: '/crm/users', map: (u) => ({ value: u._id, label: u.name }) } }] : []),
    { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high'] },
    { name: 'nextFollowUpAt', label: 'Next follow-up', type: 'datetime-local' },
  ];
  const save = useAction((v) => post('/crm/leads', v), {
    success: 'Lead created',
    invalidate: ['/crm/leads', 'crm-dash'],
    onSuccess: (r) => onDone(r.lead),
    onError: (e) => e.response?.status === 409 && setDup(e.response.data.details?.duplicate),
  });
  const submit = (v) => {
    const body = { ...v, nextFollowUpAt: v.nextFollowUpAt ? new Date(v.nextFollowUpAt).toISOString() : undefined };
    setLast(body);
    save.mutate(body);
  };
  return (
    <div className="space-y-3">
      {dup && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          Possible duplicate: <b>{dup.name}</b> ({dup.phone}) · {dup.stage?.name} · {dup.assignedTo?.name || 'unassigned'}
          <div className="mt-2 flex gap-2">
            <a className="text-primary underline" href={`/leads/${dup._id}`}>Open existing</a>
            <button className="text-primary underline" onClick={() => save.mutate({ ...last, force: true })}>Create anyway</button>
          </div>
        </div>
      )}
      <FormBuilder fields={fields} defaultValues={{ source: 'phone', priority: 'medium' }} onSubmit={submit} loading={save.isPending} onCancel={() => onDone(null)} submitText="Create lead" />
    </div>
  );
}
