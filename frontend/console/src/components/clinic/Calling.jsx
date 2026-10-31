import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Phone, PhoneCall, Play, Square, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, get, post } from '@/lib/api';
import { errMsg } from '@/lib/utils';

export const useCallConfig = () => useQuery({ queryKey: ['call-config'], queryFn: () => get('/crm/calls/config'), staleTime: 300_000 });

/**
 * Click-to-call. With Exotel: Exotel rings the agent's phone first, then bridges to the customer (recorded).
 * Without Exotel (or agent has no mobile on profile): falls back to a tel: link.
 */
export function CallButton({ lead, patient, phone, size = 'sm', variant = 'outline', label = 'Call', onPlaced, className }) {
  const { data: cfg } = useCallConfig();
  const [busy, setBusy] = useState(false);
  const number = phone || lead?.phone || patient?.mobile;
  if (!cfg?.enabled || !cfg.agentPhone) {
    return (
      <Button asChild size={size} variant={variant} className={className} title={cfg?.enabled ? 'Add your mobile in Staff to use the dialer' : 'Exotel not configured — dials from this device'}>
        <a href={`tel:${number}`}><Phone /> {label}</a>
      </Button>
    );
  }
  const place = async () => {
    setBusy(true);
    try {
      const call = await post('/crm/calls', lead ? { lead: lead._id } : patient ? { patient: patient._id } : { phone: number });
      toast.success(`Calling your phone (${cfg.agentPhone}) — pick up to connect to ${number}`, { duration: 8000 });
      onPlaced?.(call);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return <Button size={size} variant={variant} className={className} loading={busy} onClick={place} title="Call via Exotel (recorded)"><PhoneCall /> {label}</Button>;
}

/** Streams the recording through the API (auth + audit); never exposes the provider URL */
export function RecordingPlayer({ callId, compact }) {
  const [src, setSrc] = useState(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef();
  useEffect(() => () => src && URL.revokeObjectURL(src), [src]);
  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/crm/calls/${callId}/recording`, { responseType: 'blob', timeout: 120000 });
      setSrc(URL.createObjectURL(r.data));
      setTimeout(() => ref.current?.play().catch(() => {}), 50);
    } catch (e) {
      let msg = errMsg(e);
      if (e.response?.data instanceof Blob) msg = JSON.parse(await e.response.data.text()).message || msg;
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };
  if (src) {
    return (
      <div className="flex items-center gap-1">
        <audio ref={ref} src={src} controls className={compact ? 'h-8 w-56' : 'h-9 w-full max-w-sm'} />
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setSrc(null)}><Square /></Button>
      </div>
    );
  }
  return (
    <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="h-7 px-2">
      {loading ? <Loader2 className="animate-spin" /> : <Play />} Recording
    </Button>
  );
}

export const fmtDuration = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '—');
