import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserPlus, X, Phone } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { NewPatientForm } from './PatientForm';
import { get, getPaged } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { ageOf } from '@/lib/utils';
import { useCan } from '@/store/auth';

/** value: patient object | null */
export function PatientPicker({ value, onChange, allowCreate = true }) {
  const can = useCan();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const dq = useDebounce(q.trim(), 300);
  const isMobile = /^[6-9]\d{9}$/.test(dq);
  const { data: results = [], isFetching } = useQuery({
    queryKey: ['patient-search', dq],
    enabled: dq.length >= 2,
    queryFn: async () => {
      if (isMobile) return get('/patients/lookup', { mobile: dq });
      return (await getPaged('/patients', { q: dq, limit: 8 })).items;
    },
  });

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border bg-accent/40 px-3 py-2">
        <div>
          <p className="text-sm font-medium">{value.name} <span className="text-muted-foreground">· {value.patientId}</span></p>
          <p className="text-xs text-muted-foreground">{[value.gender, ageOf(value) && `${ageOf(value)}y`, value.mobile].filter(Boolean).join(' · ')}</p>
        </div>
        <Button variant="ghost" size="icon" type="button" onClick={() => onChange(null)}><X /></Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Phone className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mobile, name or patient ID" className="pl-8" autoFocus />
        </div>
        {allowCreate && can('patients.create') && <Button type="button" variant="outline" onClick={() => setCreating(true)}><UserPlus /> New</Button>}
      </div>
      {dq.length >= 2 && (
        <div className="max-h-56 overflow-y-auto rounded-md border scrollbar-thin">
          {isFetching && !results.length && <p className="p-3 text-sm text-muted-foreground">Searching…</p>}
          {!isFetching && !results.length && <p className="p-3 text-sm text-muted-foreground">No patient found{isMobile ? ' for this mobile' : ''}.</p>}
          {results.map((p) => (
            <button type="button" key={p._id} onClick={() => onChange({ ...p, mobile: p.mobile || dq })} className="flex w-full items-center justify-between border-b px-3 py-2 text-left last:border-0 hover:bg-muted">
              <div>
                <p className="text-sm font-medium">{p.name} <span className="text-xs text-muted-foreground">{p.patientId}</span></p>
                <p className="text-xs text-muted-foreground">{[p.gender, ageOf(p) && `${ageOf(p)}y`, p.mobile].filter(Boolean).join(' · ')}</p>
              </div>
              {p.relation && p.relation !== 'self' && <Badge variant="secondary">{p.relation}</Badge>}
            </button>
          ))}
        </div>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="New patient" size="lg">
          <NewPatientForm mobile={isMobile ? dq : ''} onCancel={() => setCreating(false)} onCreated={(p) => { setCreating(false); onChange(p); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
