import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/common/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { Composer } from './Composer';
import { get } from '@/lib/api';

export default function NewInvoice() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const apptId = sp.get('appointment');
  const patientId = sp.get('patient');
  const appt = useQuery({ queryKey: ['appt-for-bill', apptId], enabled: !!apptId, queryFn: () => get(`/appointments/${apptId}`) });
  const pat = useQuery({ queryKey: ['pat-for-bill', patientId], enabled: !!patientId, queryFn: () => get(`/patients/${patientId}`) });
  const consult = useQuery({ queryKey: ['consult-product'], enabled: !!apptId, queryFn: () => get('/inventory/products/search', { q: 'SRV-', type: 'service' }) });

  const initial = useMemo(() => {
    if (apptId && appt.data) {
      const a = appt.data;
      const fee = a.visitType === 'followup' ? a.doctor?.followUpFee : a.doctor?.consultationFee;
      const svc = (consult.data || []).find((p) => p.sku === (a.visitType === 'followup' ? 'SRV-FOLLOWUP' : 'SRV-CONSULT'));
      return {
        patient: a.patient,
        appointment: a._id,
        doctor: a.doctor?._id,
        items: [svc ? { product: svc._id, description: `${svc.name} · ${a.doctor?.name}`, qty: 1, rate: fee || svc.sellPrice, discountPct: 0, gstRate: svc.gstRate, type: 'service', stock: null } : { description: `Consultation · ${a.doctor?.name}`, qty: 1, rate: fee || 0, discountPct: 0, gstRate: 0 }],
      };
    }
    if (patientId && pat.data) return { patient: pat.data };
    return {};
  }, [apptId, patientId, appt.data, pat.data, consult.data]);

  const loading = (apptId && (appt.isLoading || consult.isLoading)) || (patientId && pat.isLoading);
  return (
    <div>
      <PageHeader title="New invoice" description={appt.data ? `For appointment ${appt.data.bookingId}` : 'Consultation, treatment, procedure or pharmacy'} />
      {loading ? <Skeleton className="h-96 w-full" /> : <Composer source="billing" initial={initial} onDone={(inv, o) => nav(`/billing/${inv._id}${o?.collect ? '?collect=1' : ''}`, { replace: true })} />}
    </div>
  );
}
